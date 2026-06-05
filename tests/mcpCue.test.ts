import { describe, expect, it } from 'vitest'

import { buildMcpCueReminder } from '../src/shared/mcpCue'

const now = new Date(2026, 5, 4, 10, 1, 0)

describe('MCP cue contract', () => {
  it('builds a one-time fixed-time cue', () => {
    const reminder = buildMcpCueReminder({
      title: '집중',
      videoId: 'video-1',
      date: '2026-06-04',
      time: '13:30',
      repeat: 'none',
    }, { id: 'cue-1', now })

    expect(reminder).toMatchObject({
      id: 'cue-1',
      title: '집중',
      enabled: true,
      repeatType: 'once',
      triggerType: 'time',
      startDate: '2026-06-04',
      localTime: { hour: 13, minute: 30 },
      weekdays: [],
      stageVideoId: 'video-1',
    })
  })

  it('builds a ranged custom interval cue', () => {
    const reminder = buildMcpCueReminder({
      videoId: 'video-1',
      date: '2026-04-20',
      endDate: '2026-04-25',
      everyMinutes: 20,
      repeat: 'custom',
      weekdays: ['mon', 'wed', 'fri'],
      bubbleText: '스트레칭',
      loop: true,
      audioEnabled: true,
    }, { id: 'cue-2', now })

    expect(reminder).toMatchObject({
      id: 'cue-2',
      enabled: true,
      repeatType: 'custom',
      triggerType: 'interval',
      startDate: '2026-04-20',
      endDate: '2026-04-25',
      intervalMinutes: 20,
      weekdays: ['mon', 'wed', 'fri'],
      bubbleText: '스트레칭',
      loop: true,
      audioEnabled: true,
    })
  })

  it('keeps cues without video inactive', () => {
    const reminder = buildMcpCueReminder({
      date: '2026-06-04',
      time: '13:30',
      enabled: true,
    }, { now })

    expect(reminder.stageVideoId).toBeUndefined()
    expect(reminder.enabled).toBe(false)
  })

  it('rejects ambiguous time modes', () => {
    expect(() => buildMcpCueReminder({
      videoId: 'video-1',
      date: '2026-06-04',
      time: '13:30',
      everyMinutes: 20,
    }, { now })).toThrow('time 또는 everyMinutes 중 하나만 지정해야 합니다.')
  })

  it('rejects custom repeats without weekdays', () => {
    expect(() => buildMcpCueReminder({
      videoId: 'video-1',
      date: '2026-06-04',
      time: '13:30',
      repeat: 'custom',
    }, { now })).toThrow('weekdays')
  })
})
