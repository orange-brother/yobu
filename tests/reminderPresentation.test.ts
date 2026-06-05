import type { Reminder } from '../src/shared/types'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { activationLabel, cueIntentSummary, reminderMenuLabel, reminderScheduleSummary, remainingTimeLabel } from '../src/shared/reminderPresentation'

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  const hasStageVideoOverride = Object.prototype.hasOwnProperty.call(overrides, 'stageVideoId')
  return {
    id: overrides.id ?? 'reminder-1',
    title: overrides.title ?? '스트레칭',
    enabled: overrides.enabled ?? true,
    scheduleSource: overrides.scheduleSource,
    repeatType: overrides.repeatType ?? 'daily',
    triggerType: overrides.triggerType ?? 'time',
    startDate: overrides.startDate ?? '2026-06-10',
    endDate: overrides.endDate,
    intervalMinutes: overrides.intervalMinutes,
    weekdays: overrides.weekdays ?? ['mon', 'wed', 'fri'],
    localTime: overrides.localTime ?? { hour: 22, minute: 25 },
    googleCalendar: overrides.googleCalendar,
    bubbleMode: overrides.bubbleMode,
    stageVideoId: hasStageVideoOverride ? overrides.stageVideoId : 'video-1',
    bubbleText: overrides.bubbleText,
    loop: overrides.loop ?? false,
    audioEnabled: overrides.audioEnabled ?? false,
    createdAt: overrides.createdAt ?? '2026-06-04T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-04T00:00:00.000Z',
  }
}

describe('reminder presentation', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 9, 12, 0, 0))
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  it('summarizes simple repeating reminders without a date range', () => {
    expect(reminderScheduleSummary(reminder({ repeatType: 'daily' }))).toBe('6월 10일부터 · 22:25 · 매일')
    expect(reminderScheduleSummary(reminder({ repeatType: 'weekdays' }))).toBe('6월 10일부터 · 22:25 · 평일')
  })

  it('summarizes one-time reminders with a single date', () => {
    expect(reminderScheduleSummary(reminder({ repeatType: 'once', startDate: '2026-06-10' }))).toBe('6월 10일 · 22:25 · 한 번만')
  })

  it('summarizes interval reminders by minute interval', () => {
    expect(reminderScheduleSummary(reminder({ repeatType: 'once', triggerType: 'interval', intervalMinutes: 20 }))).toBe('6월 10일 · 매 20분 · 한 번만')
    expect(reminderScheduleSummary(reminder({ repeatType: 'daily', triggerType: 'interval', intervalMinutes: 20 }))).toBe('6월 10일부터 · 매 20분 · 매일')
    expect(reminderScheduleSummary(reminder({ repeatType: 'weekdays', triggerType: 'interval', intervalMinutes: 20 }))).toBe('6월 10일부터 · 매 20분 · 평일')
  })

  it('summarizes custom reminders with date range and selected weekdays', () => {
    const summary = reminderScheduleSummary(reminder({
      repeatType: 'custom',
      startDate: '2026-04-20',
      endDate: '2026-04-25',
      weekdays: ['mon', 'wed', 'fri'],
    }))

    expect(summary).toBe('4월 20일-4월 25일 · 22:25 · 월 수 금')
  })

  it('summarizes custom interval reminders with date range and selected weekdays', () => {
    const summary = reminderScheduleSummary(reminder({
      repeatType: 'custom',
      triggerType: 'interval',
      intervalMinutes: 15,
      startDate: '2026-04-20',
      endDate: '2026-04-25',
      weekdays: ['mon', 'wed', 'fri'],
    }))

    expect(summary).toBe('4월 20일-4월 25일 · 매 15분 · 월 수 금')
  })

  it('turns cue timing into a natural language confirmation', () => {
    expect(cueIntentSummary(reminder({
      title: '물 드세요',
      repeatType: 'weekdays',
      startDate: '2026-06-10',
    }))).toBe('6월 10일부터 평일마다 22:25에 "물 드세요"를 표시합니다.')

    expect(cueIntentSummary(reminder({
      title: '',
      repeatType: 'once',
      triggerType: 'interval',
      intervalMinutes: 20,
      startDate: '2026-06-10',
    }))).toBe('6월 10일 매 20분에 "이 큐"를 표시합니다.')

    expect(cueIntentSummary(reminder({
      title: '회의 준비',
      scheduleSource: 'google_calendar',
      googleCalendar: {
        calendarId: 'primary',
        calendarName: '업무',
        offsetMinutes: 10,
        excludeAllDay: true,
      },
    }))).toBe('Google Calendar의 업무 일정 10분 전에 "회의 준비"를 표시합니다.')
  })

  it('adds inactive state to tray menu labels', () => {
    expect(reminderMenuLabel(reminder({ enabled: false }))).toBe('스트레칭 · 6월 10일부터 · 22:25 · 매일 (꺼짐)')
    expect(reminderMenuLabel(reminder({ stageVideoId: undefined }))).toBe('스트레칭 · 6월 10일부터 · 22:25 · 매일 (영상 필요)')
    expect(activationLabel(reminder())).toBe('활성화')
  })

  it('adds next occurrence timing to active tray menu labels', () => {
    const now = new Date(2026, 5, 10, 22, 0, 30)

    expect(reminderMenuLabel(reminder(), now)).toBe('스트레칭 · 6월 10일부터 · 22:25 · 매일 · 다음 표시 25분 후')
  })

  it('formats remaining time for tray menu labels', () => {
    const now = new Date(2026, 5, 10, 22, 0, 30)

    expect(remainingTimeLabel(new Date(2026, 5, 10, 22, 0, 0), now)).toBe('곧')
    expect(remainingTimeLabel(new Date(2026, 5, 10, 22, 12, 0), now)).toBe('12분 후')
    expect(remainingTimeLabel(new Date(2026, 5, 10, 23, 25, 0), now)).toBe('1시간 25분 후')
    expect(remainingTimeLabel(new Date(2026, 5, 12, 0, 0, 0), now)).toBe('1일 2시간 후')
  })
})
