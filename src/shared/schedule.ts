import type { Reminder, ReminderRepeatType, Weekday } from './types'

import { intervalMinuteOptions, weekdays } from './types'

const weekdayRepeatTypes = {
  daily: weekdays,
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weekends: ['sat', 'sun'],
} satisfies Record<Exclude<ReminderRepeatType, 'once' | 'custom'>, Weekday[]>

export const stageMinSizeRatio = 0.08
export const stageMaxSizeRatio = 0.8

export function weekdayFromDate(date: Date): Weekday {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()] as Weekday
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isReminderDraft(reminder: Reminder): boolean {
  return !reminder.stageVideoId
}

export function canReminderBeActive(reminder: Reminder): boolean {
  if (!reminder.stageVideoId) {
    return false
  }
  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    return Boolean(reminder.googleCalendar?.calendarId)
  }
  return true
}

export function normalizeIntervalMinutes(value: unknown): number {
  const minutes = Number(value)
  return intervalMinuteOptions.includes(minutes as typeof intervalMinuteOptions[number]) ? minutes : 20
}

export function isDateInReminderRange(reminder: Reminder, date: Date): boolean {
  const dateKey = localDateKey(date)
  if (dateKey < reminder.startDate) {
    return false
  }
  if (reminder.endDate && dateKey > reminder.endDate) {
    return false
  }
  return true
}

export function hasExactWeekdays(current: readonly Weekday[], target: readonly Weekday[]): boolean {
  return current.length === target.length && target.every(day => current.includes(day))
}

export function inferRepeatType(selectedWeekdays: Weekday[]): ReminderRepeatType {
  if (hasExactWeekdays(selectedWeekdays, weekdayRepeatTypes.daily)) {
    return 'daily'
  }
  if (hasExactWeekdays(selectedWeekdays, weekdayRepeatTypes.weekdays)) {
    return 'weekdays'
  }
  if (hasExactWeekdays(selectedWeekdays, weekdayRepeatTypes.weekends)) {
    return 'weekends'
  }
  return 'custom'
}

export function weekdaysForRepeatType(reminder: Pick<Reminder, 'repeatType' | 'weekdays'>): Weekday[] {
  if (reminder.repeatType === 'custom') {
    return reminder.weekdays
  }
  if (reminder.repeatType === 'once') {
    return []
  }
  return [...weekdayRepeatTypes[reminder.repeatType]]
}

function dateAtLocalStart(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0)
}

function startOfLocalMinute(date: Date): Date {
  const minute = new Date(date)
  minute.setSeconds(0, 0)
  return minute
}

function isReminderInDateScope(reminder: Reminder, date: Date): boolean {
  if (reminder.repeatType === 'once') {
    return reminder.startDate === localDateKey(date)
  }

  if (!isDateInReminderRange(reminder, date)) {
    return false
  }

  if (reminder.repeatType === 'custom') {
    return reminder.weekdays.includes(weekdayFromDate(date))
  }

  return weekdaysForRepeatType(reminder).includes(weekdayFromDate(date))
}

function nextOccurrenceOnDate(reminder: Reminder, date: Date, from: Date): Date | undefined {
  const fromMinute = startOfLocalMinute(from)
  const dateKey = localDateKey(date)
  const isFromDate = dateKey === localDateKey(fromMinute)

  if (reminder.triggerType === 'interval') {
    const interval = normalizeIntervalMinutes(reminder.intervalMinutes)
    const startMinute = isFromDate ? fromMinute.getHours() * 60 + fromMinute.getMinutes() : 0
    const remainder = startMinute % interval
    const candidateMinute = remainder === 0 ? startMinute : startMinute + interval - remainder
    if (candidateMinute >= 24 * 60) {
      return undefined
    }
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      Math.floor(candidateMinute / 60),
      candidateMinute % 60,
      0,
      0,
    )
  }

  const candidate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    reminder.localTime.hour,
    reminder.localTime.minute,
    0,
    0,
  )

  return candidate.getTime() >= fromMinute.getTime() ? candidate : undefined
}

export function isReminderDue(reminder: Reminder, date: Date): boolean {
  if ((reminder.scheduleSource ?? 'manual') !== 'manual') {
    return false
  }

  if (!reminder.enabled || isReminderDraft(reminder)) {
    return false
  }

  if (!isReminderInDateScope(reminder, date)) {
    return false
  }

  if (reminder.triggerType === 'interval') {
    return date.getMinutes() % normalizeIntervalMinutes(reminder.intervalMinutes) === 0
  }

  return reminder.localTime.hour === date.getHours() && reminder.localTime.minute === date.getMinutes()
}

export function resolveDueReminder(reminders: Reminder[], date: Date): Reminder | undefined {
  return reminders.find(reminder => isReminderDue(reminder, date))
}

export function resolveDueReminders(reminders: Reminder[], date: Date): Reminder[] {
  return reminders.filter(reminder => isReminderDue(reminder, date))
}

export function findNextReminderOccurrence(reminder: Reminder, from = new Date()): Date | undefined {
  if ((reminder.scheduleSource ?? 'manual') !== 'manual') {
    return undefined
  }

  if (!reminder.enabled || isReminderDraft(reminder)) {
    return undefined
  }

  const fromMinute = startOfLocalMinute(from)
  const fromDateKey = localDateKey(fromMinute)

  if (reminder.repeatType === 'once') {
    if (reminder.startDate < fromDateKey) {
      return undefined
    }
    const date = dateAtLocalStart(reminder.startDate)
    if (!isReminderInDateScope(reminder, date)) {
      return undefined
    }
    return nextOccurrenceOnDate(reminder, date, fromMinute)
  }

  const searchStartKey = reminder.startDate > fromDateKey ? reminder.startDate : fromDateKey
  const searchStart = dateAtLocalStart(searchStartKey)
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const date = addDays(searchStart, dayOffset)
    if (reminder.endDate && localDateKey(date) > reminder.endDate) {
      return undefined
    }
    if (!isReminderInDateScope(reminder, date)) {
      continue
    }
    const occurrence = nextOccurrenceOnDate(reminder, date, fromMinute)
    if (occurrence) {
      return occurrence
    }
  }

  return undefined
}

export function occurrenceKey(reminder: Reminder, date: Date): string {
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${reminder.id}:${localDateKey(date)}T${hour}:${minute}`
}

export function clampStageSizeRatio(value: number): number {
  return Math.min(stageMaxSizeRatio, Math.max(stageMinSizeRatio, value))
}
