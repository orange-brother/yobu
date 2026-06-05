import type { StageSettings } from '../src/shared/types'

import { describe, expect, it } from 'vitest'

import { resolveStageRelativePosition } from '../src/shared/stageSettings'

function stageSettings(overrides: Partial<StageSettings> = {}): StageSettings {
  return {
    position: overrides.position ?? {
      anchor: 'bottom-right',
      relativeX: 1,
      relativeY: 1,
    },
    sizeRatio: overrides.sizeRatio ?? 0.3,
    launchAtLogin: overrides.launchAtLogin ?? true,
  }
}

describe('stage settings', () => {
  it('maps preset anchors to relative stage positions', () => {
    expect(resolveStageRelativePosition(stageSettings({
      position: { anchor: 'top-left', relativeX: 1, relativeY: 1 },
    }))).toEqual({ relativeX: 0, relativeY: 0 })

    expect(resolveStageRelativePosition(stageSettings({
      position: { anchor: 'center', relativeX: 0, relativeY: 0 },
    }))).toEqual({ relativeX: 0.5, relativeY: 0.5 })
  })

  it('uses clamped custom relative positions', () => {
    expect(resolveStageRelativePosition(stageSettings({
      position: { anchor: 'custom', relativeX: 1.4, relativeY: -0.2 },
    }))).toEqual({ relativeX: 1, relativeY: 0 })
  })
})
