import type { Reminder, ReminderRepeatType, ReminderTriggerType } from './types'

import { findNextReminderOccurrence, localDateKey, normalizeIntervalMinutes } from './schedule'
import { weekdayLabels } from './types'

export const repeatLabels: Record<ReminderRepeatType, string> = {
  once: '한 번만',
  daily: '매일',
  weekdays: '평일',
  weekends: '주말',
  custom: '요일 지정',
}

export const timeModeLabels: Record<ReminderTriggerType, string> = {
  time: '정해진 시간',
  interval: '간격',
}

export function formatTwoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`)
  return `${date.getMonth() + 1}월 ${date.getDate()}일`
}

export function dateRangeSummary(reminder: Pick<Reminder, 'startDate' | 'endDate'>): string {
  if (!reminder.endDate) {
    return `${formatDateLabel(reminder.startDate)}부터`
  }
  if (reminder.startDate === reminder.endDate) {
    return formatDateLabel(reminder.startDate)
  }
  return `${formatDateLabel(reminder.startDate)}-${formatDateLabel(reminder.endDate)}`
}

export function dateSummary(reminder: Pick<Reminder, 'repeatType' | 'startDate' | 'endDate'>, today = localDateKey(new Date())): string {
  if (reminder.repeatType === 'once') {
    return reminder.startDate === today ? '오늘' : formatDateLabel(reminder.startDate)
  }
  if (reminder.endDate) {
    return dateRangeSummary(reminder)
  }
  return reminder.startDate === today ? '오늘부터' : `${formatDateLabel(reminder.startDate)}부터`
}

export function repeatSummary(reminder: Pick<Reminder, 'repeatType' | 'weekdays'>): string {
  if (reminder.repeatType !== 'custom') {
    return repeatLabels[reminder.repeatType]
  }
  const selectedDays = reminder.weekdays.map(day => weekdayLabels[day]).join(' ')
  return selectedDays || '요일 없음'
}

export function timeSummary(reminder: Pick<Reminder, 'triggerType' | 'intervalMinutes' | 'localTime'>): string {
  const time = `${formatTwoDigits(reminder.localTime.hour)}:${formatTwoDigits(reminder.localTime.minute)}`
  if (reminder.triggerType === 'interval') {
    return `매 ${normalizeIntervalMinutes(reminder.intervalMinutes)}분`
  }
  return time
}

export function reminderScheduleSummary(reminder: Reminder): string {
  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    const calendarName = reminder.googleCalendar?.calendarName || '캘린더 선택 필요'
    const offset = reminder.googleCalendar?.offsetMinutes ?? 10
    const offsetLabel = offset === 0 ? '정시' : `${offset}분 전`
    return `Google Calendar · ${calendarName} · ${offsetLabel}`
  }

  return `${dateSummary(reminder)} · ${timeSummary(reminder)} · ${repeatSummary(reminder)}`
}

function recurrenceIntentPhrase(reminder: Pick<Reminder, 'repeatType' | 'weekdays'>): string {
  if (reminder.repeatType === 'daily') {
    return '매일'
  }
  if (reminder.repeatType === 'weekdays') {
    return '평일마다'
  }
  if (reminder.repeatType === 'weekends') {
    return '주말마다'
  }
  return `${repeatSummary(reminder)}마다`
}

export function cueIntentSummary(reminder: Reminder, fallbackTitle = '이 큐'): string {
  const title = reminder.title.trim() || fallbackTitle

  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    const calendarName = reminder.googleCalendar?.calendarName || '선택한 캘린더'
    const offset = reminder.googleCalendar?.offsetMinutes ?? 10
    const offsetLabel = offset === 0 ? '정시에' : `${offset}분 전에`
    return `Google Calendar의 ${calendarName} 일정 ${offsetLabel} "${title}"를 표시합니다.`
  }

  const date = dateSummary(reminder)
  const time = timeSummary(reminder)
  if (reminder.repeatType === 'once') {
    return `${date} ${time}에 "${title}"를 표시합니다.`
  }

  return `${date} ${recurrenceIntentPhrase(reminder)} ${time}에 "${title}"를 표시합니다.`
}

export function activationLabel(reminder: Reminder): string {
  if (!reminder.stageVideoId) {
    return '영상 필요'
  }
  return reminder.enabled ? '활성화' : '꺼짐'
}

export function remainingTimeLabel(target: Date, from = new Date()): string {
  const remainingMinutes = Math.max(0, Math.ceil((target.getTime() - from.getTime()) / 60_000))
  if (remainingMinutes === 0) {
    return '곧'
  }
  if (remainingMinutes < 60) {
    return `${remainingMinutes}분 후`
  }

  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60
  if (hours < 24) {
    return minutes > 0 ? `${hours}시간 ${minutes}분 후` : `${hours}시간 후`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}일 ${remainingHours}시간 후` : `${days}일 후`
}

export function nextReminderSummary(reminder: Reminder, now = new Date()): string | undefined {
  const nextOccurrence = findNextReminderOccurrence(reminder, now)
  if (!nextOccurrence) {
    return undefined
  }
  return `다음 표시 ${remainingTimeLabel(nextOccurrence, now)}`
}

export function reminderMenuLabel(reminder: Reminder, now = new Date()): string {
  const status = reminder.enabled && reminder.stageVideoId ? '' : ` (${activationLabel(reminder)})`
  const nextSummary = reminder.enabled && reminder.stageVideoId
    ? nextReminderSummary(reminder, now) ?? '다음 표시 없음'
    : undefined
  return `${reminder.title} · ${reminderScheduleSummary(reminder)}${nextSummary ? ` · ${nextSummary}` : ''}${status}`
}
