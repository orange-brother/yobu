import type { BrowserWindow, Display, Rectangle } from 'electron'
import type { AppStore } from './store'
import type { Reminder, StagePayload, StageResizePoint, StageVideo, StageVideoMetrics } from '../shared/types'

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { app, BrowserWindow as ElectronBrowserWindow, screen } from 'electron'

import { clampStageSizeRatio, stageMaxSizeRatio, stageMinSizeRatio } from '../shared/schedule'
import { resolveStageRelativePosition } from '../shared/stageSettings'

export interface StageWindowController {
  openLibraryPreview: (video: StageVideo) => Promise<void>
  showVideoNow: (video: StageVideo, options: { bubbleText?: string, loop: boolean, audioEnabled: boolean }) => Promise<void>
  openReminderPreview: (reminder: Reminder, video: StageVideo) => Promise<void>
  openDueReminder: (reminder: Reminder, video: StageVideo) => Promise<void>
  openPlacementEditor: (videoId?: string) => Promise<void>
  close: () => void
  getPayload: () => StagePayload | null
  hasVisibleStage: () => boolean
  hasVisiblePreview: () => boolean
  setInputPassthrough: (passthrough: boolean) => void
  syncBoundsToSettings: () => void
  beginMove: (point: StageResizePoint) => void
  updateMove: (point: StageResizePoint) => void
  endMove: () => Promise<void>
  beginResize: (point: StageResizePoint) => void
  updateResize: (point: StageResizePoint) => void
  endResize: () => Promise<void>
  setVideoMetrics: (metrics: StageVideoMetrics) => void
}

type StageWindowClosedCallback = (closedPayload: StagePayload) => void

const defaultVideoAspectRatio = 1
const stageHorizontalInset = 36
const stageVerticalInset = 74

function isTransparentVideo(video: StageVideo): boolean {
  return video.extension === 'webm'
}

function sanitizeVideoAspectRatio(aspectRatio: number): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return defaultVideoAspectRatio
  }

  return Math.min(4, Math.max(0.25, aspectRatio))
}

function createPayload(mode: StagePayload['mode'], video: StageVideo, videoUrl: string, options: {
  bubbleText?: string
  loop: boolean
  audioEnabled: boolean
  closeAfterVideoDuration?: boolean
  sizeRatio: number
}): StagePayload {
  return {
    mode,
    video,
    videoUrl,
    bubbleText: options.bubbleText,
    loop: options.loop,
    audioEnabled: options.audioEnabled,
    closeAfterVideoDuration: options.closeAfterVideoDuration,
    transparent: isTransparentVideo(video),
    sizeRatio: options.sizeRatio,
  }
}

function createPlacementPayload(state: ReturnType<AppStore['getState']>, video?: StageVideo, videoUrl?: string): StagePayload {
  return {
    mode: 'placement',
    video,
    videoUrl,
    loop: true,
    audioEnabled: false,
    transparent: video ? isTransparentVideo(video) : false,
    sizeRatio: state.stageSettings.sizeRatio,
  }
}

function resolveStageBounds(store: AppStore, display?: Display, videoAspectRatio = defaultVideoAspectRatio): Rectangle {
  const targetDisplay = display ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const area = targetDisplay.workArea
  const settings = store.getState().stageSettings
  const { width, height } = resolveStageSize(area, settings.sizeRatio, videoAspectRatio)
  const availableX = Math.max(1, area.width - width)
  const availableY = Math.max(1, area.height - height)
  const { relativeX, relativeY } = resolveStageRelativePosition(settings)

  return {
    x: Math.round(area.x + availableX * relativeX),
    y: Math.round(area.y + availableY * relativeY),
    width,
    height,
  }
}

function resolveStageSize(area: Rectangle, sizeRatio: number, videoAspectRatio: number): Pick<Rectangle, 'width' | 'height'> {
  const aspectRatio = sanitizeVideoAspectRatio(videoAspectRatio)
  const maxOuterHeight = Math.round(area.height * 0.92)
  let width = Math.round(area.width * clampStageSizeRatio(sizeRatio))
  let videoWidth = Math.max(1, width - stageHorizontalInset)
  let videoHeight = Math.round(videoWidth / aspectRatio)
  let height = videoHeight + stageVerticalInset

  if (height > maxOuterHeight) {
    videoHeight = Math.max(1, maxOuterHeight - stageVerticalInset)
    videoWidth = Math.round(videoHeight * aspectRatio)
    width = videoWidth + stageHorizontalInset
    height = maxOuterHeight
  }

  return { width, height }
}

function persistRelativePosition(store: AppStore, bounds: Rectangle, onStageSettingsChanged: () => void): void {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const relativeX = Math.min(1, Math.max(0, (bounds.x - area.x) / Math.max(1, area.width - bounds.width)))
  const relativeY = Math.min(1, Math.max(0, (bounds.y - area.y) / Math.max(1, area.height - bounds.height)))
  const current = store.getState().stageSettings
  void store.updateStageSettings({
    ...current,
    position: {
      anchor: 'custom',
      relativeX,
      relativeY,
    },
  }).then(onStageSettingsChanged)
}

export function createStageWindowController(
  store: AppStore,
  onStageSettingsChanged: () => void = () => {},
  onStageWindowClosed: StageWindowClosedCallback = () => {},
): StageWindowController {
  let window: BrowserWindow | null = null
  let payload: StagePayload | null = null
  const windowsClosingForReplacement = new WeakSet<BrowserWindow>()
  let persistMoves = false
  let videoAspectRatio = defaultVideoAspectRatio
  let resizeSession: {
    startBounds: Rectangle
    startPoint: StageResizePoint
  } | null = null
  let moveSession: {
    startBounds: Rectangle
    startPoint: StageResizePoint
  } | null = null

  function loadStageRoute(stageWindow: BrowserWindow): void {
    if (process.env.ELECTRON_RENDERER_URL) {
      void stageWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/stage`)
    }
    else {
      void stageWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/stage' })
    }
  }

  async function open(payloadToShow: StagePayload): Promise<void> {
    payload = payloadToShow
    videoAspectRatio = defaultVideoAspectRatio
    persistMoves = false

    if (window && !window.isDestroyed()) {
      windowsClosingForReplacement.add(window)
      window.close()
    }

    const bounds = resolveStageBounds(store, undefined, videoAspectRatio)
    const stageWindow = new ElectronBrowserWindow({
      title: 'Yobu',
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: true,
      focusable: false,
      skipTaskbar: true,
      roundedCorners: false,
      type: 'panel',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        backgroundThrottling: false,
      },
    })
    window = stageWindow

    stageWindow.setAlwaysOnTop(true, 'screen-saver', 2)
    stageWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    stageWindow.setFullScreenable(false)

    stageWindow.on('move', () => {
      if (persistMoves && window === stageWindow && !stageWindow.isDestroyed()) {
        persistRelativePosition(store, stageWindow.getBounds(), onStageSettingsChanged)
      }
    })

    stageWindow.on('closed', () => {
      const isCurrentWindow = window === stageWindow
      const closedPayload = isCurrentWindow ? payload : null
      const shouldNotify = Boolean(closedPayload && !windowsClosingForReplacement.has(stageWindow))
      windowsClosingForReplacement.delete(stageWindow)

      if (isCurrentWindow) {
        window = null
        payload = null
        persistMoves = false
        resizeSession = null
        moveSession = null
      }

      if (closedPayload && shouldNotify) {
        onStageWindowClosed(closedPayload)
      }
    })

    stageWindow.once('ready-to-show', () => {
      if (window === stageWindow) {
        stageWindow.showInactive()
      }
      persistMoves = true
    })

    loadStageRoute(stageWindow)
  }

  function videoUrlFor(video: StageVideo): string {
    const filePath = store.getVideoFilePath(video)
    if (!existsSync(filePath)) {
      throw new Error('영상 파일을 찾을 수 없습니다.')
    }
    return pathToFileURL(filePath).toString()
  }

  function syncBoundsToSettings(): void {
    if (!window || window.isDestroyed()) {
      return
    }

    const display = screen.getDisplayMatching(window.getBounds())
    const nextBounds = resolveStageBounds(store, display, videoAspectRatio)
    persistMoves = false
    window.setBounds(nextBounds)

    if (payload) {
      payload = {
        ...payload,
        sizeRatio: store.getState().stageSettings.sizeRatio,
      }
    }

    setTimeout(() => {
      if (window && !window.isDestroyed()) {
        persistMoves = true
      }
    }, 100)
  }

  function beginResize(point: StageResizePoint): void {
    if (!window || window.isDestroyed()) {
      return
    }

    resizeSession = {
      startBounds: window.getBounds(),
      startPoint: point,
    }
    persistMoves = false
  }

  function beginMove(point: StageResizePoint): void {
    if (!window || window.isDestroyed()) {
      return
    }

    moveSession = {
      startBounds: window.getBounds(),
      startPoint: point,
    }
    persistMoves = false
  }

  function updateMove(point: StageResizePoint): void {
    if (!window || window.isDestroyed() || !moveSession) {
      return
    }

    const deltaX = point.screenX - moveSession.startPoint.screenX
    const deltaY = point.screenY - moveSession.startPoint.screenY
    window.setBounds({
      ...moveSession.startBounds,
      x: Math.round(moveSession.startBounds.x + deltaX),
      y: Math.round(moveSession.startBounds.y + deltaY),
    })
  }

  async function endMove(): Promise<void> {
    if (!window || window.isDestroyed()) {
      moveSession = null
      return
    }

    const bounds = window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const area = display.workArea
    const current = store.getState().stageSettings
    const relativeX = Math.min(1, Math.max(0, (bounds.x - area.x) / Math.max(1, area.width - bounds.width)))
    const relativeY = Math.min(1, Math.max(0, (bounds.y - area.y) / Math.max(1, area.height - bounds.height)))

    await store.updateStageSettings({
      ...current,
      position: {
        anchor: 'custom',
        relativeX,
        relativeY,
      },
    })
    onStageSettingsChanged()

    moveSession = null
    persistMoves = true
  }

  function updateResize(point: StageResizePoint): void {
    if (!window || window.isDestroyed() || !resizeSession) {
      return
    }

    const display = screen.getDisplayMatching(resizeSession.startBounds)
    const area = display.workArea
    const deltaX = point.screenX - resizeSession.startPoint.screenX
    const deltaY = point.screenY - resizeSession.startPoint.screenY
    const aspectRatio = sanitizeVideoAspectRatio(videoAspectRatio)
    const dominantDelta = Math.abs(deltaY * aspectRatio) > Math.abs(deltaX) ? deltaY * aspectRatio : deltaX
    const minWidth = area.width * stageMinSizeRatio
    const maxWidth = Math.max(minWidth, area.width * stageMaxSizeRatio)
    const requestedWidth = resizeSession.startBounds.width + dominantDelta
    const width = Math.min(maxWidth, Math.max(minWidth, requestedWidth))
    const nextSizeRatio = clampStageSizeRatio(width / area.width)
    const nextSize = resolveStageSize(area, nextSizeRatio, videoAspectRatio)
    const nextX = Math.min(
      Math.max(area.x, resizeSession.startBounds.x),
      area.x + area.width - nextSize.width,
    )
    const nextY = Math.min(
      Math.max(area.y, resizeSession.startBounds.y),
      area.y + area.height - nextSize.height,
    )

    window.setBounds({
      x: Math.round(nextX),
      y: Math.round(nextY),
      width: nextSize.width,
      height: nextSize.height,
    })
  }

  async function endResize(): Promise<void> {
    if (!window || window.isDestroyed()) {
      resizeSession = null
      return
    }

    const bounds = window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const area = display.workArea
    const current = store.getState().stageSettings
    const relativeX = Math.min(1, Math.max(0, (bounds.x - area.x) / Math.max(1, area.width - bounds.width)))
    const relativeY = Math.min(1, Math.max(0, (bounds.y - area.y) / Math.max(1, area.height - bounds.height)))

    await store.updateStageSettings({
      ...current,
      sizeRatio: bounds.width / area.width,
      position: {
        anchor: 'custom',
        relativeX,
        relativeY,
      },
    })
    onStageSettingsChanged()

    if (payload) {
      payload = {
        ...payload,
        sizeRatio: store.getState().stageSettings.sizeRatio,
      }
    }

    resizeSession = null
    persistMoves = true
  }

  function setVideoMetrics(metrics: StageVideoMetrics): void {
    const nextAspectRatio = sanitizeVideoAspectRatio(metrics.width / metrics.height)
    if (Math.abs(nextAspectRatio - videoAspectRatio) < 0.01) {
      return
    }

    videoAspectRatio = nextAspectRatio
    if (resizeSession || moveSession) {
      return
    }
    syncBoundsToSettings()
  }

  return {
    async openLibraryPreview(video) {
      await open(createPayload('library-preview', video, videoUrlFor(video), {
        loop: false,
        audioEnabled: false,
        sizeRatio: store.getState().stageSettings.sizeRatio,
      }))
    },
    async showVideoNow(video, options) {
      await open(createPayload('library-preview', video, videoUrlFor(video), {
        bubbleText: options.bubbleText,
        loop: options.loop,
        audioEnabled: options.audioEnabled,
        closeAfterVideoDuration: true,
        sizeRatio: store.getState().stageSettings.sizeRatio,
      }))
    },
    async openReminderPreview(reminder, video) {
      await open(createPayload('reminder-preview', video, videoUrlFor(video), {
        bubbleText: reminder.bubbleText,
        loop: reminder.loop,
        audioEnabled: reminder.audioEnabled,
        sizeRatio: store.getState().stageSettings.sizeRatio,
      }))
    },
    async openDueReminder(reminder, video) {
      await open(createPayload('due', video, videoUrlFor(video), {
        bubbleText: reminder.bubbleText,
        loop: reminder.loop,
        audioEnabled: reminder.audioEnabled,
        sizeRatio: store.getState().stageSettings.sizeRatio,
      }))
    },
    async openPlacementEditor(videoId?: string) {
      const state = store.getState()
      const video = videoId
        ? state.videos.find(item => item.id === videoId)
        : state.videos[0]
      if (!video) {
        await open(createPlacementPayload(state))
        return
      }

      try {
        await open(createPlacementPayload(state, video, videoUrlFor(video)))
      }
      catch {
        await open(createPlacementPayload(state))
      }
    },
    close() {
      window?.close()
    },
    getPayload() {
      return payload
    },
    hasVisibleStage() {
      return Boolean(window && !window.isDestroyed() && window.isVisible())
    },
    hasVisiblePreview() {
      return Boolean(payload && payload.mode !== 'due' && window && !window.isDestroyed() && window.isVisible())
    },
    setInputPassthrough(passthrough) {
      if (!window || window.isDestroyed()) {
        return
      }

      window.setIgnoreMouseEvents(passthrough, { forward: true })
    },
    syncBoundsToSettings,
    beginMove,
    updateMove,
    endMove,
    beginResize,
    updateResize,
    endResize,
    setVideoMetrics,
  }
}
