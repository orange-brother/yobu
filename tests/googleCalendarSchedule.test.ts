import type { GoogleCalendarEvent } from '../src/shared/googleCalendarSchedule'
import type { Reminder } from '../src/shared/types'

import { describe, expect, it } from 'vitest'

import { resolveDueCalendarReminder, resolveDueCalendarReminders } from '../src/shared/googleCalendarSchedule'

function calendarReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: overrides.id ?? 'cue-1',
    title: overrides.title ?? '회의 준비',
    enabled: overrides.enabled ?? true,
    scheduleSource: 'google_calendar',
    repeatType: 'once',
    triggerType: 'time',
    startDate: '2026-06-05',
    weekdays: [],
    localTime: { hour: 9, minute: 0 },
    googleCalendar: overrides.googleCalendar ?? {
      calendarId: 'primary',
      calendarName: '기본',
      offsetMinutes: 10,
      excludeAllDay: true,
    },
    stageVideoId: overrides.stageVideoId ?? 'video-1',
    bubbleText: overrides.bubbleText,
    bubbleMode: overrides.bubbleMode ?? 'event_title',
    loop: overrides.loop ?? false,
    audioEnabled: overrides.audioEnabled ?? false,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
  }
}

function eventsByCalendar(events: GoogleCalendarEvent[]): Map<string, GoogleCalendarEvent[]> {
  return new Map([['primary', events]])
}

describe('googleCalendarSchedule', () => {
  it('matches a calendar cue at the configured offset before the event start', () => {
    const due = resolveDueCalendarReminder(
      [calendarReminder()],
      eventsByCalendar([
        {
          id: 'event-1',
          summary: '주간 회의',
          start: { dateTime: '2026-06-05T13:30:00+09:00' },
        },
      ]),
      new Date('2026-06-05T13:20:15+09:00'),
    )

    expect(due?.reminder.id).toBe('cue-1')
    expect(due?.bubbleText).toBe('주간 회의')
    expect(due?.occurrenceKey).toContain('calendar:cue-1:primary:event-1')
  })

  it('skips all-day events when the cue excludes them', () => {
    const due = resolveDueCalendarReminder(
      [calendarReminder()],
      eventsByCalendar([
        {
          id: 'event-1',
          summary: '종일 일정',
          start: { date: '2026-06-05' },
        },
      ]),
      new Date('2026-06-04T23:50:00+09:00'),
    )

    expect(due).toBeUndefined()
  })

  it('skips cancelled events', () => {
    const due = resolveDueCalendarReminder(
      [calendarReminder()],
      eventsByCalendar([
        {
          id: 'event-1',
          status: 'cancelled',
          summary: '취소된 일정',
          start: { dateTime: '2026-06-05T13:30:00+09:00' },
        },
      ]),
      new Date('2026-06-05T13:20:00+09:00'),
    )

    expect(due).toBeUndefined()
  })

  it('uses the first active cue in list order when multiple calendar cues are due', () => {
    const due = resolveDueCalendarReminder(
      [
        calendarReminder({ id: 'first', title: '먼저 표시' }),
        calendarReminder({ id: 'second', title: '나중 표시' }),
      ],
      eventsByCalendar([
        {
          id: 'event-1',
          summary: '겹친 일정',
          start: { dateTime: '2026-06-05T13:30:00+09:00' },
        },
      ]),
      new Date('2026-06-05T13:20:00+09:00'),
    )

    expect(due?.reminder.id).toBe('first')
  })

  it('returns all due calendar cues by list order for a sequential batch', () => {
    const due = resolveDueCalendarReminders(
      [
        calendarReminder({ id: 'first', title: '먼저 표시' }),
        calendarReminder({ id: 'second', title: '나중 표시' }),
      ],
      eventsByCalendar([
        {
          id: 'event-1',
          summary: '겹친 일정',
          start: { dateTime: '2026-06-05T13:30:00+09:00' },
        },
      ]),
      new Date('2026-06-05T13:20:00+09:00'),
    )

    expect(due.map(item => item.reminder.id)).toEqual(['first', 'second'])
  })

  it('can suppress the bubble text per cue', () => {
    const due = resolveDueCalendarReminder(
      [calendarReminder({ bubbleMode: 'none' })],
      eventsByCalendar([
        {
          id: 'event-1',
          summary: '숨길 제목',
          start: { dateTime: '2026-06-05T13:30:00+09:00' },
        },
      ]),
      new Date('2026-06-05T13:20:00+09:00'),
    )

    expect(due?.bubbleText).toBeUndefined()
  })
})
