import type { Reminder, ReminderRepeatType, Weekday } from './types'

import { randomUUID } from 'node:crypto'

import { intervalMinuteOptions, weekdays } from './types'
import { localDateKey, normalizeIntervalMinutes, weekdaysForRepeatType } from './schedule'

export type McpCueRepeat = 'none' | 'daily' | 'weekdays' | 'weekends' | 'custom'

export interface McpCreateCueInput {
  title?: string
  videoId?: string
  date?: string
  endDate?: string
  time?: string
  everyMinutes?: number
  repeat?: McpCueRepeat
  weekdays?: Weekday[]
  bubbleText?: string
  loop?: boolean
  audioEnabled?: boolean
  enabled?: boolean
}

export interface BuildMcpCueReminderOptions {
  id?: string
  now?: Date
}

function nowIso(now: Date): string {
  return now.toISOString()
}

function parseDateKey(value: string, fieldName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName}는 YYYY-MM-DD 형식이어야 합니다.`)
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${fieldName}가 올바른 날짜가 아닙니다.`)
  }

  return value
}

function parseTime(value: string | undefined): Reminder['localTime'] {
  if (!value) {
    return { hour: 0, minute: 0 }
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) {
    throw new Error('time은 HH:mm 형식이어야 합니다.')
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  }
}

function repeatTypeFor(input: McpCreateCueInput): ReminderRepeatType {
  switch (input.repeat ?? 'none') {
    case 'none':
      return 'once'
    case 'daily':
      return 'daily'
    case 'weekdays':
      return 'weekdays'
    case 'weekends':
      return 'weekends'
    case 'custom':
      return 'custom'
  }
}

function normalizeWeekdays(input: McpCreateCueInput, repeatType: ReminderRepeatType): Weekday[] {
  if (repeatType === 'once') {
    return []
  }

  if (repeatType !== 'custom') {
    return weekdaysForRepeatType({ repeatType, weekdays: [] })
  }

  const selected = weekdays.filter(day => input.weekdays?.includes(day))
  if (selected.length === 0) {
    throw new Error('repeat가 custom이면 weekdays를 하나 이상 지정해야 합니다.')
  }
  return selected
}

function validateTimeMode(input: McpCreateCueInput): Reminder['triggerType'] {
  const hasTime = Boolean(input.time)
  const hasInterval = input.everyMinutes !== undefined
  if (hasTime === hasInterval) {
    throw new Error('time 또는 everyMinutes 중 하나만 지정해야 합니다.')
  }

  if (!hasInterval) {
    return 'time'
  }

  if (!intervalMinuteOptions.includes(Number(input.everyMinutes) as typeof intervalMinuteOptions[number])) {
    throw new Error(`everyMinutes는 ${intervalMinuteOptions.join(', ')} 중 하나여야 합니다.`)
  }

  return 'interval'
}

export function buildMcpCueReminder(input: McpCreateCueInput, options: BuildMcpCueReminderOptions = {}): Reminder {
  const now = options.now ?? new Date()
  const repeatType = repeatTypeFor(input)
  const triggerType = validateTimeMode(input)
  const startDate = parseDateKey(input.date ?? localDateKey(now), 'date')
  const endDate = input.endDate ? parseDateKey(input.endDate, 'endDate') : undefined

  if (repeatType === 'once' && endDate) {
    throw new Error('endDate는 반복 큐에서만 사용할 수 있습니다.')
  }

  if (endDate && endDate < startDate) {
    throw new Error('endDate는 date보다 빠를 수 없습니다.')
  }

  const stageVideoId = input.videoId?.trim() || undefined
  const reminder: Reminder = {
    id: options.id ?? randomUUID(),
    title: input.title?.trim() || '새 큐',
    enabled: input.enabled ?? Boolean(stageVideoId),
    scheduleSource: 'manual',
    repeatType,
    triggerType,
    startDate,
    endDate: repeatType === 'once' ? undefined : endDate,
    intervalMinutes: triggerType === 'interval' ? normalizeIntervalMinutes(input.everyMinutes) : undefined,
    weekdays: normalizeWeekdays(input, repeatType),
    localTime: parseTime(input.time),
    stageVideoId,
    bubbleText: input.bubbleText?.trim() || undefined,
    bubbleMode: 'custom',
    loop: input.loop ?? false,
    audioEnabled: input.audioEnabled ?? false,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
  }

  if (!stageVideoId) {
    reminder.enabled = false
  }

  return reminder
}
