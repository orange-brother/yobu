import type { GoogleCalendarOffsetMinutes, Reminder } from './types'

export interface GoogleCalendarEventDate {
  date?: string
  dateTime?: string
}

export interface GoogleCalendarEvent {
  id: string
  status?: string
  summary?: string
  start?: GoogleCalendarEventDate
}

export interface CalendarDueCue {
  reminder: Reminder
  event: GoogleCalendarEvent
  eventStart: Date
  occurrenceKey: string
  bubbleText?: string
}

function startOfMinute(date: Date): number {
  const minute = new Date(date)
  minute.setSeconds(0, 0)
  return minute.getTime()
}

function eventStartDate(event: GoogleCalendarEvent, excludeAllDay: boolean): Date | undefined {
  if (event.status === 'cancelled') {
    return undefined
  }

  if (event.start?.dateTime) {
    const parsed = new Date(event.start.dateTime)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  if (!excludeAllDay && event.start?.date) {
    const parsed = new Date(`${event.start.date}T00:00:00`)
    return Number.isNaN(parsed.getTime()) ? undefined : parsed
  }

  return undefined
}

function isCalendarReminder(reminder: Reminder): boolean {
  return (reminder.scheduleSource ?? 'manual') === 'google_calendar'
}

export function calendarOccurrenceKey(
  reminder: Reminder,
  event: GoogleCalendarEvent,
  eventStart: Date,
  offsetMinutes: GoogleCalendarOffsetMinutes,
): string {
  return `calendar:${reminder.id}:${reminder.googleCalendar?.calendarId ?? ''}:${event.id}:${eventStart.toISOString()}:${offsetMinutes}`
}

export function resolveDueCalendarReminder(
  reminders: Reminder[],
  eventsByCalendarId: Map<string, GoogleCalendarEvent[]>,
  now: Date,
): CalendarDueCue | undefined {
  return resolveDueCalendarReminders(reminders, eventsByCalendarId, now)[0]
}

export function resolveDueCalendarReminders(
  reminders: Reminder[],
  eventsByCalendarId: Map<string, GoogleCalendarEvent[]>,
  now: Date,
): CalendarDueCue[] {
  const nowMinute = startOfMinute(now)
  const dueCues: CalendarDueCue[] = []

  for (const reminder of reminders) {
    if (!reminder.enabled || !reminder.stageVideoId || !isCalendarReminder(reminder) || !reminder.googleCalendar?.calendarId) {
      continue
    }

    const config = reminder.googleCalendar
    const events = eventsByCalendarId.get(config.calendarId) ?? []
    for (const event of events) {
      const eventStart = eventStartDate(event, config.excludeAllDay)
      if (!eventStart) {
        continue
      }

      const dueAt = eventStart.getTime() - config.offsetMinutes * 60_000
      if (startOfMinute(new Date(dueAt)) !== nowMinute) {
        continue
      }

      const bubbleText = reminder.bubbleMode === 'none'
        ? undefined
        : reminder.bubbleMode === 'event_title'
          ? event.summary?.trim() || undefined
          : reminder.bubbleText?.trim() || undefined

      dueCues.push({
        reminder,
        event,
        eventStart,
        occurrenceKey: calendarOccurrenceKey(reminder, event, eventStart, config.offsetMinutes),
        bubbleText,
      })
      break
    }
  }

  return dueCues
}
