import type { Reminder, StageResizePoint, StageVideoMetrics } from '../shared/types'
import type { MenuItemConstructorOptions } from 'electron'

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron'

import type { GoogleCalendarEvent } from '../shared/googleCalendarSchedule'

import { resolveDueCalendarReminders } from '../shared/googleCalendarSchedule'
import { reminderMenuLabel } from '../shared/reminderPresentation'
import { occurrenceKey, resolveDueReminders } from '../shared/schedule'
import { GoogleCalendarService } from './googleCalendarService'
import { startYobuMcpServer, type YobuMcpServerHandle, yobuMcpHost, yobuMcpPath, yobuMcpPort } from './mcpServer'
import { AppStore } from './store'
import { createStageWindowController } from './stageWindow'
import { YobuControlService } from './yobuControlService'

let tray: Tray | null = null
let settingsWindow: BrowserWindow | null = null
let store: AppStore
let stage: ReturnType<typeof createStageWindowController>
let googleCalendar: GoogleCalendarService
let mcpServer: YobuMcpServerHandle | null = null
const shownOccurrences = new Set<string>()
const skippedDueMinuteKeys = new Set<string>()
let pendingDueCues: DueCue[] = []
let activeDueBatchMinuteKey: string | null = null
let stateChangedTimer: ReturnType<typeof setTimeout> | null = null
let cachedCalendarEventsByCalendarId = new Map<string, GoogleCalendarEvent[]>()
let cachedCalendarIdsKey = ''
let calendarEventsFetchedAt = 0

type DueCue = {
  reminder: Reminder
  key: string
}

function appIcon() {
  return nativeImage.createFromPath(join(__dirname, '../../assets/app-icon.png'))
}

function loadSettingsRoute(window: BrowserWindow): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
  else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendReminderSelection(reminderId: string): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return
  }
  settingsWindow.webContents.send('settings:select-reminder', reminderId)
}

function sendStateChanged(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    return
  }
  settingsWindow.webContents.send('settings:state-changed', store.getState())
}

function scheduleStateChanged(): void {
  if (stateChangedTimer) {
    clearTimeout(stateChangedTimer)
  }

  stateChangedTimer = setTimeout(() => {
    stateChangedTimer = null
    sendStateChanged()
  }, 120)
}

function openSettingsWindow(reminderId?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    if (reminderId) {
      sendReminderSelection(reminderId)
    }
    return
  }

  settingsWindow = new BrowserWindow({
    title: '',
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 660,
    show: false,
    icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  settingsWindow.webContents.on('page-title-updated', event => {
    event.preventDefault()
  })

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.setTitle('')
    settingsWindow?.show()
  })

  if (reminderId) {
    settingsWindow.webContents.once('did-finish-load', () => {
      sendReminderSelection(reminderId)
    })
  }

  loadSettingsRoute(settingsWindow)
}

function trayReminderItems(): MenuItemConstructorOptions[] {
  const reminders = store.getState().reminders
  if (reminders.length === 0) {
    return [
      {
        label: '등록된 큐 없음',
        enabled: false,
      },
    ]
  }

  return reminders.map(reminder => ({
    label: reminderMenuLabel(reminder),
    click: () => openSettingsWindow(reminder.id),
  }))
}

function trayMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    {
      label: '큐 시트',
      enabled: false,
    },
    ...trayReminderItems(),
    { type: 'separator' },
    {
      label: '설정 열기',
      click: () => openSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: '종료',
      click: () => app.quit(),
    },
  ]
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()))
}

function clearPendingDueCues(): void {
  pendingDueCues = []
  activeDueBatchMinuteKey = null
}

function clearCalendarEventCache(): void {
  cachedCalendarEventsByCalendarId = new Map<string, GoogleCalendarEvent[]>()
  cachedCalendarIdsKey = ''
  calendarEventsFetchedAt = 0
}

function notifyStateChanged(): void {
  refreshTrayMenu()
  scheduleStateChanged()
}

function notifyCalendarConnectionInvalidated(): void {
  clearCalendarEventCache()
  notifyStateChanged()
}

function setupTray(): void {
  const image = appIcon().resize({ width: 18, height: 18 })
  image.setTemplateImage(false)
  tray = new Tray(image)
  tray.setToolTip('Yobu')
  refreshTrayMenu()
}

function applyLaunchAtLogin(): void {
  app.setLoginItemSettings({
    openAtLogin: store.getState().stageSettings.launchAtLogin,
  })
}

function setupIpc(): void {
  ipcMain.handle('app:get-state', () => store.getState())
  ipcMain.handle('onboarding:set-seen', async (_event, seen: boolean) => {
    const next = await store.setOnboardingSeen(Boolean(seen))
    notifyStateChanged()
    return next
  })
  ipcMain.handle('mcp:get-status', () => ({
    url: mcpServer?.url ?? `http://${yobuMcpHost}:${yobuMcpPort}${yobuMcpPath}`,
    running: mcpServer?.isRunning() ?? false,
  }))
  ipcMain.handle('calendar:get-status', () => googleCalendar.getStatus())
  ipcMain.handle('calendar:connect', async () => {
    const status = await googleCalendar.connect()
    notifyStateChanged()
    return status
  })
  ipcMain.handle('calendar:disconnect', async () => {
    const status = await googleCalendar.disconnect()
    notifyStateChanged()
    return status
  })
  ipcMain.handle('calendar:list-calendars', () => googleCalendar.listCalendars())

  ipcMain.handle('video:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '영상 추가',
      properties: ['openFile'],
      filters: [
        { name: 'Stage Video', extensions: ['mp4', 'mov', 'm4v', 'webm'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { state: store.getState() }
    }
    return store.importVideo(result.filePaths[0])
  })

  ipcMain.handle('video:delete', async (_event, videoId: string) => {
    const next = await store.deleteVideo(videoId)
    refreshTrayMenu()
    return next
  })
  ipcMain.handle('video:url', (_event, videoId: string) => {
    const video = store.getState().videos.find(item => item.id === videoId)
    if (!video) {
      throw new Error('영상을 찾을 수 없습니다.')
    }
    return pathToFileURL(store.getVideoFilePath(video)).toString()
  })
  ipcMain.handle('reminder:create', async () => {
    const next = await store.createReminder()
    refreshTrayMenu()
    return next
  })
  ipcMain.handle('reminder:update', async (_event, reminder: Reminder) => {
    const next = await store.updateReminder(reminder)
    refreshTrayMenu()
    return next
  })
  ipcMain.handle('reminder:delete', async (_event, reminderId: string) => {
    const next = await store.deleteReminder(reminderId)
    refreshTrayMenu()
    return next
  })
  ipcMain.handle('settings:update-stage', async (_event, settings) => {
    const next = await store.updateStageSettings(settings)
    stage.syncBoundsToSettings()
    return next
  })
  ipcMain.handle('stage:reset-position', async () => {
    const next = await store.resetStagePosition()
    stage.syncBoundsToSettings()
    return next
  })
  ipcMain.handle('stage:get-payload', () => stage.getPayload())
  ipcMain.handle('stage:close', () => stage.close())
  ipcMain.handle('stage:set-input-passthrough', (_event, passthrough: boolean) => stage.setInputPassthrough(passthrough))
  ipcMain.handle('stage:set-video-metrics', (_event, metrics: StageVideoMetrics) => stage.setVideoMetrics(metrics))
  ipcMain.handle('stage:begin-move', (_event, point: StageResizePoint) => stage.beginMove(point))
  ipcMain.handle('stage:update-move', (_event, point: StageResizePoint) => stage.updateMove(point))
  ipcMain.handle('stage:end-move', () => stage.endMove())
  ipcMain.handle('stage:begin-resize', (_event, point: StageResizePoint) => stage.beginResize(point))
  ipcMain.handle('stage:update-resize', (_event, point: StageResizePoint) => stage.updateResize(point))
  ipcMain.handle('stage:end-resize', () => stage.endResize())
  ipcMain.handle('stage:open-placement-editor', (_event, videoId?: string) => {
    clearPendingDueCues()
    return stage.openPlacementEditor(videoId)
  })

  ipcMain.handle('stage:preview-video', async (_event, videoId: string) => {
    clearPendingDueCues()
    const video = store.getState().videos.find(item => item.id === videoId)
    if (!video) {
      throw new Error('영상을 찾을 수 없습니다.')
    }
    try {
      await stage.openLibraryPreview(video)
    }
    catch (error) {
      await store.recordVideoError(video.id, error instanceof Error ? error.message : '영상을 열 수 없습니다.')
      throw error
    }
  })

  ipcMain.handle('stage:preview-reminder', async (_event, reminderId: string) => {
    clearPendingDueCues()
    const state = store.getState()
    const reminder = state.reminders.find(item => item.id === reminderId)
    if (!reminder?.stageVideoId) {
      throw new Error('연결된 영상이 없습니다.')
    }
    const video = state.videos.find(item => item.id === reminder.stageVideoId)
    if (!video) {
      throw new Error('영상을 찾을 수 없습니다.')
    }
    try {
      await stage.openReminderPreview(reminder, video)
    }
    catch (error) {
      await store.recordVideoError(video.id, error instanceof Error ? error.message : '영상을 열 수 없습니다.')
      throw error
    }
  })
}

function setupScheduler(): void {
  void checkDueReminder()

  setInterval(() => {
    void checkDueReminder()
  }, 10_000)

  setInterval(() => {
    refreshTrayMenu()
  }, 60_000)
}

function startOfLocalMinute(date: Date): Date {
  const minute = new Date(date)
  minute.setSeconds(0, 0)
  return minute
}

function localMinuteKey(date: Date): string {
  const minute = startOfLocalMinute(date)
  const year = minute.getFullYear()
  const month = String(minute.getMonth() + 1).padStart(2, '0')
  const day = String(minute.getDate()).padStart(2, '0')
  const hour = String(minute.getHours()).padStart(2, '0')
  const minuteValue = String(minute.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minuteValue}`
}

async function calendarEventsFor(reminders: Reminder[], now: Date) {
  const calendarIds = new Set(
    reminders
      .filter(reminder =>
        reminder.enabled
        && reminder.stageVideoId
        && (reminder.scheduleSource ?? 'manual') === 'google_calendar'
        && reminder.googleCalendar?.calendarId,
      )
      .map(reminder => reminder.googleCalendar!.calendarId),
  )
  const eventsByCalendarId = new Map<string, GoogleCalendarEvent[]>()
  if (calendarIds.size === 0) {
    cachedCalendarEventsByCalendarId = eventsByCalendarId
    cachedCalendarIdsKey = ''
    calendarEventsFetchedAt = 0
    return eventsByCalendarId
  }

  const idsKey = [...calendarIds].sort().join('|')
  if (idsKey === cachedCalendarIdsKey && Date.now() - calendarEventsFetchedAt < 55_000) {
    return cachedCalendarEventsByCalendarId
  }

  const status = await googleCalendar.getStatus()
  if (!status.connected) {
    cachedCalendarEventsByCalendarId = eventsByCalendarId
    cachedCalendarIdsKey = idsKey
    calendarEventsFetchedAt = Date.now()
    return eventsByCalendarId
  }

  const timeMin = startOfLocalMinute(now)
  const timeMax = new Date(timeMin.getTime() + 24 * 60 * 60 * 1000)
  for (const calendarId of calendarIds) {
    try {
      eventsByCalendarId.set(calendarId, await googleCalendar.fetchEvents(calendarId, timeMin, timeMax))
    }
    catch (error) {
      console.warn('[Yobu Calendar] failed to fetch events:', error)
    }
  }

  cachedCalendarEventsByCalendarId = eventsByCalendarId
  cachedCalendarIdsKey = idsKey
  calendarEventsFetchedAt = Date.now()
  return eventsByCalendarId
}

async function resolveDueCues(reminders: Reminder[], now: Date): Promise<DueCue[]> {
  const eventsByCalendarId = await calendarEventsFor(reminders, now)
  const dueCues: DueCue[] = []

  for (const reminder of reminders) {
    if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
      const due = resolveDueCalendarReminders([reminder], eventsByCalendarId, now)[0]
      if (!due) {
        continue
      }

      dueCues.push({
        reminder: {
          ...due.reminder,
          bubbleText: due.bubbleText,
        },
        key: due.occurrenceKey,
      })
      continue
    }

    const dueReminder = resolveDueReminders([reminder], now)[0]
    if (dueReminder) {
      dueCues.push({
        reminder,
        key: occurrenceKey(reminder, now),
      })
    }
  }

  return dueCues
}

async function openDueCue(dueCue: DueCue): Promise<boolean> {
  const reminder = dueCue.reminder
  const key = dueCue.key
  if (shownOccurrences.has(key)) {
    return false
  }

  const state = store.getState()
  const video = state.videos.find(item => item.id === reminder.stageVideoId)
  if (!video) {
    shownOccurrences.add(key)
    return false
  }

  shownOccurrences.add(key)
  try {
    await stage.openDueReminder(reminder, video)
    if ((reminder.scheduleSource ?? 'manual') === 'manual' && reminder.repeatType === 'once') {
      await store.updateReminder({
        ...reminder,
        enabled: false,
      })
      refreshTrayMenu()
    }
    return true
  }
  catch (error) {
    await store.recordVideoError(video.id, error instanceof Error ? error.message : '영상을 열 수 없습니다.')
    return false
  }
}

async function openNextPendingDueCue(): Promise<void> {
  if (stage.hasVisiblePreview() || stage.hasVisibleStage()) {
    return
  }

  while (pendingDueCues.length > 0) {
    const nextCue = pendingDueCues.shift()
    if (!nextCue) {
      break
    }

    if (await openDueCue(nextCue)) {
      return
    }
  }

  activeDueBatchMinuteKey = null
}

async function checkDueReminder(): Promise<void> {
  const now = new Date()
  const minuteKey = localMinuteKey(now)

  if (stage.hasVisiblePreview()) {
    return
  }

  if (stage.hasVisibleStage() || pendingDueCues.length > 0) {
    if (activeDueBatchMinuteKey && activeDueBatchMinuteKey !== minuteKey) {
      skippedDueMinuteKeys.add(minuteKey)
    }
    return
  }

  if (skippedDueMinuteKeys.has(minuteKey)) {
    return
  }

  const state = store.getState()
  const dueCues = (await resolveDueCues(state.reminders, now))
    .filter(dueCue => dueCue.reminder.stageVideoId && !shownOccurrences.has(dueCue.key))
  if (dueCues.length === 0) {
    return
  }

  activeDueBatchMinuteKey = minuteKey
  pendingDueCues = dueCues.slice(1)
  if (!await openDueCue(dueCues[0])) {
    await openNextPendingDueCue()
  }
}

app.whenReady().then(async () => {
  app.setName('Yobu')
  store = new AppStore()
  await store.setup()
  stage = createStageWindowController(store, scheduleStateChanged, closedPayload => {
    if (closedPayload.mode === 'due') {
      void openNextPendingDueCue()
    }
  })
  googleCalendar = new GoogleCalendarService(store, notifyCalendarConnectionInvalidated)
  mcpServer = startYobuMcpServer(new YobuControlService({
    store,
    stage,
    onStateChanged: notifyStateChanged,
  }))
  applyLaunchAtLogin()
  setupIpc()
  setupTray()
  setupScheduler()
  app.dock?.hide()
  openSettingsWindow()
})

app.on('window-all-closed', () => {})

app.on('activate', () => {
  openSettingsWindow()
})

app.on('before-quit', () => {
  void mcpServer?.stop()
})
