export type StageVideoExtension = 'mp4' | 'mov' | 'm4v' | 'webm'

export type Weekday = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export type ReminderRepeatType = 'once' | 'daily' | 'weekdays' | 'weekends' | 'custom'
export type ReminderTriggerType = 'time' | 'interval'
export type ReminderScheduleSource = 'manual' | 'google_calendar'
export type ReminderBubbleMode = 'custom' | 'event_title' | 'none'
export type GoogleCalendarOffsetMinutes = 0 | 5 | 10 | 15 | 30

export const weekdays: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export const intervalMinuteOptions = [5, 10, 15, 20, 30, 60] as const
export const googleCalendarOffsetMinuteOptions = [0, 5, 10, 15, 30] as const

export const weekdayLabels: Record<Weekday, string> = {
  sun: '일',
  mon: '월',
  tue: '화',
  wed: '수',
  thu: '목',
  fri: '금',
  sat: '토',
}

export interface StageVideoError {
  message: string
  occurredAt: string
}

export interface StageVideo {
  id: string
  originalName: string
  storedFileName: string
  extension: StageVideoExtension
  sizeBytes: number
  sha256: string
  importedAt: string
  lastError?: StageVideoError
}

export interface GoogleCalendarReminderConfig {
  calendarId: string
  calendarName: string
  offsetMinutes: GoogleCalendarOffsetMinutes
  excludeAllDay: boolean
}

export interface GoogleCalendarConnectionMetadata {
  connectedAt?: string
  accountLabel?: string
  primaryCalendarId?: string
}

export interface GoogleCalendarConnectionStatus extends GoogleCalendarConnectionMetadata {
  configured: boolean
  connected: boolean
  error?: string
}

export interface GoogleCalendarListItem {
  id: string
  summary: string
  primary: boolean
}

export interface Reminder {
  id: string
  title: string
  enabled: boolean
  scheduleSource?: ReminderScheduleSource
  repeatType: ReminderRepeatType
  triggerType: ReminderTriggerType
  onceDate?: string
  startDate: string
  endDate?: string
  intervalMinutes?: number
  weekdays: Weekday[]
  localTime: {
    hour: number
    minute: number
  }
  googleCalendar?: GoogleCalendarReminderConfig
  stageVideoId?: string
  bubbleText?: string
  bubbleMode?: ReminderBubbleMode
  loop: boolean
  audioEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface StageSettings {
  position: {
    anchor: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center' | 'custom'
    relativeX: number
    relativeY: number
  }
  sizeRatio: number
  launchAtLogin: boolean
}

export interface AppState {
  videos: StageVideo[]
  reminders: Reminder[]
  stageSettings: StageSettings
  onboardingSeen: boolean
  calendarConnection?: GoogleCalendarConnectionMetadata
}

export type StageMode = 'due' | 'reminder-preview' | 'library-preview' | 'placement'

export interface StagePayload {
  mode: StageMode
  video?: StageVideo
  videoUrl?: string
  bubbleText?: string
  loop: boolean
  audioEnabled: boolean
  closeAfterVideoDuration?: boolean
  transparent: boolean
  sizeRatio: number
}

export interface StageResizePoint {
  screenX: number
  screenY: number
}

export interface StageVideoMetrics {
  width: number
  height: number
}

export interface ImportVideoResult {
  state: AppState
  duplicateVideoId?: string
  importedVideoId?: string
}
