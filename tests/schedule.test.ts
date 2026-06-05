import type { Reminder } from '../src/shared/types'

import { describe, expect, it } from 'vitest'

import { clampStageSizeRatio, findNextReminderOccurrence, inferRepeatType, isReminderDraft, isReminderDue, resolveDueReminder, resolveDueReminders } from '../src/shared/schedule'

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  const hasStageVideoOverride = Object.prototype.hasOwnProperty.call(overrides, 'stageVideoId')
  return {
    id: overrides.id ?? 'reminder-1',
    title: overrides.title ?? '스트레칭',
    enabled: overrides.enabled ?? true,
    repeatType: overrides.repeatType ?? 'custom',
    triggerType: overrides.triggerType ?? 'time',
    startDate: overrides.startDate ?? overrides.onceDate ?? '2026-06-01',
    endDate: overrides.endDate,
    intervalMinutes: overrides.intervalMinutes,
    weekdays: overrides.weekdays ?? ['mon'],
    localTime: overrides.localTime ?? { hour: 9, minute: 30 },
    stageVideoId: hasStageVideoOverride ? overrides.stageVideoId : 'video-1',
    bubbleText: overrides.bubbleText,
    loop: overrides.loop ?? false,
    audioEnabled: overrides.audioEnabled ?? false,
    createdAt: overrides.createdAt ?? '2026-06-02T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-02T00:00:00.000Z',
  }
}

describe('schedule', () => {
  it('treats reminders without stage video as drafts', () => {
    expect(isReminderDraft(reminder({ stageVideoId: undefined }))).toBe(true)
  })

  it('matches due reminders by selected weekday and minute time', () => {
    const monday = new Date('2026-06-01T09:30:00')
    expect(isReminderDue(reminder(), monday)).toBe(true)
  })

  it('matches daily reminders against the machine local hour and minute', () => {
    const localDueTime = new Date(2026, 5, 4, 13, 12, 30)
    expect(isReminderDue(reminder({
      repeatType: 'daily',
      localTime: { hour: 13, minute: 12 },
      weekdays: [],
    }), localDueTime)).toBe(true)
  })

  it('matches interval reminders by local minute interval', () => {
    const intervalReminder = reminder({
      repeatType: 'daily',
      triggerType: 'interval',
      intervalMinutes: 20,
      weekdays: [],
    })

    expect(isReminderDue(intervalReminder, new Date(2026, 5, 4, 13, 0, 10))).toBe(true)
    expect(isReminderDue(intervalReminder, new Date(2026, 5, 4, 13, 20, 10))).toBe(true)
    expect(isReminderDue(intervalReminder, new Date(2026, 5, 4, 13, 40, 10))).toBe(true)
    expect(isReminderDue(intervalReminder, new Date(2026, 5, 4, 13, 10, 10))).toBe(false)
  })

  it('matches non-repeating interval reminders only on the selected date', () => {
    const todayOnlyIntervalReminder = reminder({
      repeatType: 'once',
      triggerType: 'interval',
      startDate: '2026-06-04',
      intervalMinutes: 20,
      weekdays: [],
    })

    expect(isReminderDue(todayOnlyIntervalReminder, new Date(2026, 5, 4, 13, 20, 10))).toBe(true)
    expect(isReminderDue(todayOnlyIntervalReminder, new Date(2026, 5, 4, 13, 10, 10))).toBe(false)
    expect(isReminderDue(todayOnlyIntervalReminder, new Date(2026, 5, 5, 13, 20, 10))).toBe(false)
  })

  it('combines weekday repeats with interval triggers', () => {
    const weekdayIntervalReminder = reminder({
      repeatType: 'weekdays',
      triggerType: 'interval',
      intervalMinutes: 20,
      weekdays: [],
    })

    expect(isReminderDue(weekdayIntervalReminder, new Date(2026, 5, 4, 13, 20, 10))).toBe(true)
    expect(isReminderDue(weekdayIntervalReminder, new Date(2026, 5, 6, 13, 20, 10))).toBe(false)
  })

  it('combines custom date ranges and weekdays with interval triggers', () => {
    const customIntervalReminder = reminder({
      repeatType: 'custom',
      triggerType: 'interval',
      startDate: '2026-04-20',
      endDate: '2026-04-25',
      intervalMinutes: 15,
      weekdays: ['mon', 'wed', 'fri'],
    })

    expect(isReminderDue(customIntervalReminder, new Date(2026, 3, 20, 13, 15, 10))).toBe(true)
    expect(isReminderDue(customIntervalReminder, new Date(2026, 3, 21, 13, 15, 10))).toBe(false)
    expect(isReminderDue(customIntervalReminder, new Date(2026, 3, 27, 13, 15, 10))).toBe(false)
    expect(isReminderDue(customIntervalReminder, new Date(2026, 3, 20, 13, 10, 10))).toBe(false)
  })

  it('matches one-time reminders by local date and minute time', () => {
    const dueDate = new Date('2026-06-04T09:30:00')
    expect(isReminderDue(reminder({ repeatType: 'once', startDate: '2026-06-04' }), dueDate)).toBe(true)
    expect(isReminderDue(reminder({ repeatType: 'once', startDate: '2026-06-05' }), dueDate)).toBe(false)
  })

  it('limits custom repeating reminders to the selected date range', () => {
    const monday = new Date('2026-06-01T09:30:00')
    expect(isReminderDue(reminder({ repeatType: 'custom', startDate: '2026-06-01', endDate: '2026-06-05' }), monday)).toBe(true)
    expect(isReminderDue(reminder({ repeatType: 'custom', startDate: '2026-06-02', endDate: '2026-06-05' }), monday)).toBe(false)
    expect(isReminderDue(reminder({ repeatType: 'custom', startDate: '2026-05-20', endDate: '2026-05-31' }), monday)).toBe(false)
  })

  it('applies date ranges to simple repeating reminders', () => {
    const monday = new Date('2026-06-01T09:30:00')
    const thursday = new Date('2026-06-04T09:30:00')
    const saturday = new Date('2026-06-06T09:30:00')
    const dailyReminder = reminder({ repeatType: 'daily', startDate: '2026-06-02', endDate: '2026-06-05', weekdays: [] })

    expect(isReminderDue(dailyReminder, monday)).toBe(false)
    expect(isReminderDue(dailyReminder, thursday)).toBe(true)
    expect(isReminderDue(dailyReminder, saturday)).toBe(false)
  })

  it('ignores disabled reminders and drafts', () => {
    const monday = new Date('2026-06-01T09:30:00')
    expect(isReminderDue(reminder({ enabled: false }), monday)).toBe(false)
    expect(isReminderDue(reminder({ stageVideoId: undefined }), monday)).toBe(false)
  })

  it('selects the first due reminder by list order', () => {
    const monday = new Date('2026-06-01T09:30:00')
    const first = reminder({ id: 'first' })
    const second = reminder({ id: 'second' })
    expect(resolveDueReminder([first, second], monday)?.id).toBe('first')
  })

  it('returns all due reminders by list order for a sequential batch', () => {
    const monday = new Date('2026-06-01T09:30:00')
    const first = reminder({ id: 'first' })
    const disabled = reminder({ id: 'disabled', enabled: false })
    const notDue = reminder({ id: 'not-due', localTime: { hour: 10, minute: 0 } })
    const second = reminder({ id: 'second' })

    expect(resolveDueReminders([first, disabled, notDue, second], monday).map(item => item.id)).toEqual(['first', 'second'])
  })

  it('finds the next same-day fixed-time occurrence', () => {
    const next = findNextReminderOccurrence(
      reminder({
        repeatType: 'daily',
        startDate: '2026-06-01',
        localTime: { hour: 13, minute: 12 },
        weekdays: [],
      }),
      new Date(2026, 5, 4, 13, 11, 30),
    )

    expect(next?.getTime()).toBe(new Date(2026, 5, 4, 13, 12, 0).getTime())
  })

  it('moves fixed-time occurrences to the next valid date after today has passed', () => {
    const next = findNextReminderOccurrence(
      reminder({
        repeatType: 'weekdays',
        startDate: '2026-06-01',
        localTime: { hour: 13, minute: 12 },
        weekdays: [],
      }),
      new Date(2026, 5, 4, 13, 13, 30),
    )

    expect(next?.getTime()).toBe(new Date(2026, 5, 5, 13, 12, 0).getTime())
  })

  it('finds the next interval occurrence in the current day', () => {
    const next = findNextReminderOccurrence(
      reminder({
        repeatType: 'daily',
        triggerType: 'interval',
        startDate: '2026-06-01',
        intervalMinutes: 20,
        weekdays: [],
      }),
      new Date(2026, 5, 4, 13, 21, 30),
    )

    expect(next?.getTime()).toBe(new Date(2026, 5, 4, 13, 40, 0).getTime())
  })

  it('returns the current minute when an interval occurrence is already due', () => {
    const next = findNextReminderOccurrence(
      reminder({
        repeatType: 'daily',
        triggerType: 'interval',
        startDate: '2026-06-01',
        intervalMinutes: 20,
        weekdays: [],
      }),
      new Date(2026, 5, 4, 13, 20, 30),
    )

    expect(next?.getTime()).toBe(new Date(2026, 5, 4, 13, 20, 0).getTime())
  })

  it('does not return future occurrences for inactive reminders or drafts', () => {
    const from = new Date(2026, 5, 4, 13, 11, 30)
    expect(findNextReminderOccurrence(reminder({ enabled: false }), from)).toBeUndefined()
    expect(findNextReminderOccurrence(reminder({ stageVideoId: undefined }), from)).toBeUndefined()
  })

  it('does not return future occurrences outside a date range', () => {
    const next = findNextReminderOccurrence(
      reminder({
        repeatType: 'daily',
        startDate: '2026-06-01',
        endDate: '2026-06-03',
        weekdays: [],
      }),
      new Date(2026, 5, 4, 13, 11, 30),
    )

    expect(next).toBeUndefined()
  })

  it('clamps stage size ratio to the supported range', () => {
    expect(clampStageSizeRatio(0.04)).toBe(0.08)
    expect(clampStageSizeRatio(0.4)).toBe(0.4)
    expect(clampStageSizeRatio(0.9)).toBe(0.8)
  })

  it('infers common repeat types from selected weekdays', () => {
    expect(inferRepeatType(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])).toBe('daily')
    expect(inferRepeatType(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('weekdays')
    expect(inferRepeatType(['sat', 'sun'])).toBe('weekends')
    expect(inferRepeatType(['mon', 'wed'])).toBe('custom')
  })
})
