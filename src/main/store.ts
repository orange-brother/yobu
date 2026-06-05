import type {
  AppState,
  GoogleCalendarConnectionMetadata,
  GoogleCalendarOffsetMinutes,
  Reminder,
  ReminderBubbleMode,
  ReminderRepeatType,
  ReminderScheduleSource,
  ReminderTriggerType,
  StageSettings,
  StageVideo,
  StageVideoExtension,
} from '../shared/types'

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { app } from 'electron'

import { clampStageSizeRatio, canReminderBeActive, inferRepeatType, localDateKey, normalizeIntervalMinutes, weekdaysForRepeatType } from '../shared/schedule'
import { googleCalendarOffsetMinuteOptions, weekdays } from '../shared/types'

const supportedVideoExtensions: StageVideoExtension[] = ['mp4', 'mov', 'm4v', 'webm']
const legacyAppName = 'Remind Video Stage'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function defaultState(): AppState {
  return {
    videos: [],
    reminders: [],
    onboardingSeen: false,
    stageSettings: {
      position: {
        anchor: 'bottom-right',
        relativeX: 1,
        relativeY: 1,
      },
      sizeRatio: 0.3,
      launchAtLogin: true,
    },
  }
}

function isRepeatType(value: unknown): value is ReminderRepeatType {
  return value === 'once'
    || value === 'daily'
    || value === 'weekdays'
    || value === 'weekends'
    || value === 'custom'
}

function isLegacyIntervalRepeatType(value: unknown): boolean {
  return value === 'interval'
}

function isTriggerType(value: unknown): value is ReminderTriggerType {
  return value === 'time' || value === 'interval'
}

function isScheduleSource(value: unknown): value is ReminderScheduleSource {
  return value === 'manual' || value === 'google_calendar'
}

function isBubbleMode(value: unknown): value is ReminderBubbleMode {
  return value === 'custom' || value === 'event_title' || value === 'none'
}

function normalizeCalendarOffsetMinutes(value: unknown): GoogleCalendarOffsetMinutes {
  const minutes = Number(value)
  return googleCalendarOffsetMinuteOptions.includes(minutes as GoogleCalendarOffsetMinutes)
    ? minutes as GoogleCalendarOffsetMinutes
    : 10
}

function defaultOnceDate(): string {
  return localDateKey(new Date())
}

function nextFiveMinuteTime(): Reminder['localTime'] {
  const date = new Date()
  date.setSeconds(0, 0)
  const minute = date.getMinutes()
  const nextMinute = Math.ceil((minute + 1) / 5) * 5
  date.setMinutes(nextMinute)

  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

function sanitizeReminder(reminder: Reminder): Reminder {
  const scheduleSource = isScheduleSource(reminder.scheduleSource) ? reminder.scheduleSource : 'manual'
  const selectedWeekdays = Array.isArray(reminder.weekdays)
    ? weekdays.filter(day => reminder.weekdays.includes(day))
    : [...weekdays]
  const repeatType = isRepeatType(reminder.repeatType)
    ? reminder.repeatType
    : isLegacyIntervalRepeatType(reminder.repeatType)
      ? 'daily'
      : inferRepeatType(selectedWeekdays)
  const triggerType = isLegacyIntervalRepeatType(reminder.repeatType)
    ? 'interval'
    : isTriggerType(reminder.triggerType)
      ? reminder.triggerType
      : 'time'
  const clean: Reminder = {
    ...reminder,
    title: reminder.title.trim() || '새 큐',
    scheduleSource,
    repeatType,
    triggerType,
    onceDate: undefined,
    startDate: reminder.startDate || reminder.onceDate || defaultOnceDate(),
    endDate: repeatType === 'once' ? undefined : reminder.endDate || undefined,
    intervalMinutes: triggerType === 'interval' ? normalizeIntervalMinutes(reminder.intervalMinutes) : undefined,
    weekdays: repeatType === 'custom'
      ? selectedWeekdays.length > 0 ? selectedWeekdays : [...weekdays]
      : weekdaysForRepeatType({ repeatType, weekdays: selectedWeekdays }),
    localTime: {
      hour: Math.min(23, Math.max(0, Number(reminder.localTime.hour) || 0)),
      minute: Math.min(59, Math.max(0, Number(reminder.localTime.minute) || 0)),
    },
    googleCalendar: scheduleSource === 'google_calendar' && reminder.googleCalendar?.calendarId
      ? {
          calendarId: String(reminder.googleCalendar.calendarId),
          calendarName: String(reminder.googleCalendar.calendarName || reminder.googleCalendar.calendarId),
          offsetMinutes: normalizeCalendarOffsetMinutes(reminder.googleCalendar.offsetMinutes),
          excludeAllDay: reminder.googleCalendar.excludeAllDay !== false,
        }
      : undefined,
    bubbleText: reminder.bubbleText?.trim() || undefined,
    bubbleMode: isBubbleMode(reminder.bubbleMode)
      ? reminder.bubbleMode
      : scheduleSource === 'google_calendar'
        ? 'event_title'
        : 'custom',
    updatedAt: nowIso(),
  }

  if (!canReminderBeActive(clean)) {
    clean.enabled = false
  }

  return clean
}

function sanitizeCalendarConnection(metadata: GoogleCalendarConnectionMetadata | undefined): GoogleCalendarConnectionMetadata | undefined {
  if (!metadata) {
    return undefined
  }

  return {
    connectedAt: metadata.connectedAt,
    accountLabel: metadata.accountLabel?.trim() || undefined,
    primaryCalendarId: metadata.primaryCalendarId?.trim() || undefined,
  }
}

function sanitizeStageSettings(settings: StageSettings): StageSettings {
  return {
    ...settings,
    sizeRatio: clampStageSizeRatio(settings.sizeRatio),
    position: {
      anchor: settings.position.anchor,
      relativeX: Math.min(1, Math.max(0, Number(settings.position.relativeX) || 0)),
      relativeY: Math.min(1, Math.max(0, Number(settings.position.relativeY) || 0)),
    },
  }
}

async function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export class AppStore {
  readonly rootDir: string
  readonly videosDir: string
  readonly settingsPath: string
  private readonly legacyRootDir: string

  private state: AppState = defaultState()

  constructor() {
    this.rootDir = app.getPath('userData')
    this.videosDir = join(this.rootDir, 'videos')
    this.settingsPath = join(this.rootDir, 'settings.json')
    this.legacyRootDir = join(app.getPath('appData'), legacyAppName)
  }

  async setup(): Promise<void> {
    await this.migrateLegacyData()
    await mkdir(this.videosDir, { recursive: true })
    await this.load()
  }

  getState(): AppState {
    return structuredClone(this.state)
  }

  getVideoFilePath(video: StageVideo): string {
    return join(this.videosDir, video.storedFileName)
  }

  async importVideo(sourcePath: string): Promise<{ state: AppState, duplicateVideoId?: string, importedVideoId?: string }> {
    const extension = extname(sourcePath).replace('.', '').toLowerCase() as StageVideoExtension
    if (!supportedVideoExtensions.includes(extension)) {
      throw new Error('지원하지 않는 영상 형식입니다.')
    }

    const [fileStat, sha256] = await Promise.all([
      stat(sourcePath),
      sha256File(sourcePath),
    ])

    const duplicate = this.state.videos.find(video => video.sha256 === sha256)
    if (duplicate) {
      return { state: this.getState(), duplicateVideoId: duplicate.id }
    }

    const id = randomUUID()
    const storedFileName = `${id}.${extension}`
    const targetPath = join(this.videosDir, storedFileName)
    await copyFile(sourcePath, targetPath)

    const video: StageVideo = {
      id,
      originalName: basename(sourcePath),
      storedFileName,
      extension,
      sizeBytes: fileStat.size,
      sha256,
      importedAt: nowIso(),
    }

    this.state.videos.unshift(video)
    await this.save()
    return { state: this.getState(), importedVideoId: id }
  }

  async deleteVideo(videoId: string): Promise<AppState> {
    if (this.state.reminders.some(reminder => reminder.stageVideoId === videoId)) {
      throw new Error('큐에 연결된 영상은 삭제할 수 없습니다.')
    }

    this.state.videos = this.state.videos.filter(video => video.id !== videoId)
    await this.save()
    return this.getState()
  }

  async createReminder(): Promise<AppState> {
    const defaultVideo = this.state.videos[0]
    const reminder: Reminder = {
      id: randomUUID(),
      title: '새 큐',
      enabled: Boolean(defaultVideo),
      repeatType: 'weekdays',
      triggerType: 'time',
      startDate: defaultOnceDate(),
      weekdays: weekdaysForRepeatType({ repeatType: 'weekdays', weekdays: [] }),
      localTime: nextFiveMinuteTime(),
      stageVideoId: defaultVideo?.id,
      loop: false,
      audioEnabled: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }

    this.state.reminders.unshift(reminder)
    await this.save()
    return this.getState()
  }

  async updateReminder(reminder: Reminder): Promise<AppState> {
    const index = this.state.reminders.findIndex(item => item.id === reminder.id)
    const clean = sanitizeReminder(reminder)
    if (index === -1) {
      this.state.reminders.unshift(clean)
    }
    else {
      this.state.reminders[index] = clean
    }
    await this.save()
    return this.getState()
  }

  async deleteReminder(reminderId: string): Promise<AppState> {
    this.state.reminders = this.state.reminders.filter(reminder => reminder.id !== reminderId)
    await this.save()
    return this.getState()
  }

  async updateStageSettings(settings: StageSettings): Promise<AppState> {
    this.state.stageSettings = sanitizeStageSettings(settings)
    app.setLoginItemSettings({ openAtLogin: this.state.stageSettings.launchAtLogin })
    await this.save()
    return this.getState()
  }

  async updateCalendarConnection(metadata: GoogleCalendarConnectionMetadata | undefined): Promise<AppState> {
    this.state.calendarConnection = sanitizeCalendarConnection(metadata)
    await this.save()
    return this.getState()
  }

  async setOnboardingSeen(onboardingSeen: boolean): Promise<AppState> {
    this.state.onboardingSeen = onboardingSeen
    await this.save()
    return this.getState()
  }

  async resetStagePosition(): Promise<AppState> {
    this.state.stageSettings.position = {
      anchor: 'bottom-right',
      relativeX: 1,
      relativeY: 1,
    }
    await this.save()
    return this.getState()
  }

  async recordVideoError(videoId: string, message: string): Promise<void> {
    const video = this.state.videos.find(item => item.id === videoId)
    if (!video) {
      return
    }

    video.lastError = {
      message,
      occurredAt: nowIso(),
    }
    await this.save()
  }

  private async migrateLegacyData(): Promise<void> {
    if (this.rootDir === this.legacyRootDir || await pathExists(this.settingsPath)) {
      return
    }

    const legacySettingsPath = join(this.legacyRootDir, 'settings.json')
    if (!await pathExists(legacySettingsPath)) {
      return
    }

    await mkdir(this.rootDir, { recursive: true })
    await copyFile(legacySettingsPath, this.settingsPath)

    const legacyVideosDir = join(this.legacyRootDir, 'videos')
    if (await pathExists(legacyVideosDir) && !await pathExists(this.videosDir)) {
      await cp(legacyVideosDir, this.videosDir, { recursive: true, force: false })
    }
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const parsed = JSON.parse(raw) as AppState
      this.state = {
        ...defaultState(),
        ...parsed,
        videos: Array.isArray(parsed.videos) ? parsed.videos : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders.map(sanitizeReminder) : [],
        stageSettings: sanitizeStageSettings({
          ...defaultState().stageSettings,
          ...(parsed.stageSettings ?? {}),
          position: {
            ...defaultState().stageSettings.position,
            ...(parsed.stageSettings?.position ?? {}),
          },
        }),
        onboardingSeen: Boolean(parsed.onboardingSeen),
        calendarConnection: sanitizeCalendarConnection(parsed.calendarConnection),
      }
    }
    catch {
      this.state = defaultState()
      await this.save()
    }
  }

  private async save(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const tempPath = `${this.settingsPath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.settingsPath)
  }
}
