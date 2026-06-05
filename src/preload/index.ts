import type {
  AppState,
  GoogleCalendarConnectionStatus,
  GoogleCalendarListItem,
  ImportVideoResult,
  Reminder,
  StagePayload,
  StageResizePoint,
  StageSettings,
  StageVideoMetrics,
} from '../shared/types'
import type { IpcRendererEvent } from 'electron'

import { contextBridge, ipcRenderer } from 'electron'

export interface McpStatus {
  url: string
  running: boolean
}

function cloneForIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const api = {
  getState: () => ipcRenderer.invoke('app:get-state') as Promise<AppState>,
  setOnboardingSeen: (seen: boolean) => ipcRenderer.invoke('onboarding:set-seen', seen) as Promise<AppState>,
  getMcpStatus: () => ipcRenderer.invoke('mcp:get-status') as Promise<McpStatus>,
  getCalendarStatus: () => ipcRenderer.invoke('calendar:get-status') as Promise<GoogleCalendarConnectionStatus>,
  connectGoogleCalendar: () => ipcRenderer.invoke('calendar:connect') as Promise<GoogleCalendarConnectionStatus>,
  disconnectGoogleCalendar: () => ipcRenderer.invoke('calendar:disconnect') as Promise<GoogleCalendarConnectionStatus>,
  listGoogleCalendars: () => ipcRenderer.invoke('calendar:list-calendars') as Promise<GoogleCalendarListItem[]>,
  importVideo: () => ipcRenderer.invoke('video:import') as Promise<ImportVideoResult>,
  deleteVideo: (videoId: string) => ipcRenderer.invoke('video:delete', videoId) as Promise<AppState>,
  getVideoUrl: (videoId: string) => ipcRenderer.invoke('video:url', videoId) as Promise<string>,
  createReminder: () => ipcRenderer.invoke('reminder:create') as Promise<AppState>,
  updateReminder: (reminder: Reminder) => ipcRenderer.invoke('reminder:update', cloneForIpc(reminder)) as Promise<AppState>,
  deleteReminder: (reminderId: string) => ipcRenderer.invoke('reminder:delete', reminderId) as Promise<AppState>,
  updateStageSettings: (settings: StageSettings) => ipcRenderer.invoke('settings:update-stage', cloneForIpc(settings)) as Promise<AppState>,
  previewVideo: (videoId: string) => ipcRenderer.invoke('stage:preview-video', videoId) as Promise<void>,
  previewReminder: (reminderId: string) => ipcRenderer.invoke('stage:preview-reminder', reminderId) as Promise<void>,
  openStagePlacementEditor: (videoId?: string) => ipcRenderer.invoke('stage:open-placement-editor', videoId) as Promise<void>,
  resetStagePosition: () => ipcRenderer.invoke('stage:reset-position') as Promise<AppState>,
  getStagePayload: () => ipcRenderer.invoke('stage:get-payload') as Promise<StagePayload | null>,
  closeStage: () => ipcRenderer.invoke('stage:close') as Promise<void>,
  setStageInputPassthrough: (passthrough: boolean) => ipcRenderer.invoke('stage:set-input-passthrough', passthrough) as Promise<void>,
  setStageVideoMetrics: (metrics: StageVideoMetrics) => ipcRenderer.invoke('stage:set-video-metrics', cloneForIpc(metrics)) as Promise<void>,
  beginStageMove: (point: StageResizePoint) => ipcRenderer.invoke('stage:begin-move', cloneForIpc(point)) as Promise<void>,
  updateStageMove: (point: StageResizePoint) => ipcRenderer.invoke('stage:update-move', cloneForIpc(point)) as Promise<void>,
  endStageMove: () => ipcRenderer.invoke('stage:end-move') as Promise<void>,
  beginStageResize: (point: StageResizePoint) => ipcRenderer.invoke('stage:begin-resize', cloneForIpc(point)) as Promise<void>,
  updateStageResize: (point: StageResizePoint) => ipcRenderer.invoke('stage:update-resize', cloneForIpc(point)) as Promise<void>,
  endStageResize: () => ipcRenderer.invoke('stage:end-resize') as Promise<void>,
  onSelectReminder: (callback: (reminderId: string) => void) => {
    const listener = (_event: IpcRendererEvent, reminderId: string) => callback(reminderId)
    ipcRenderer.on('settings:select-reminder', listener)
    return () => ipcRenderer.removeListener('settings:select-reminder', listener)
  },
  onStateChanged: (callback: (state: AppState) => void) => {
    const listener = (_event: IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on('settings:state-changed', listener)
    return () => ipcRenderer.removeListener('settings:state-changed', listener)
  },
}

contextBridge.exposeInMainWorld('stageApi', api)

export type StageApi = typeof api
