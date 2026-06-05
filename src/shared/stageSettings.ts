import type { StageSettings } from './types'

export interface StageRelativePosition {
  relativeX: number
  relativeY: number
}

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

export function resolveStageRelativePosition(settings: StageSettings): StageRelativePosition {
  switch (settings.position.anchor) {
    case 'top-left':
      return { relativeX: 0, relativeY: 0 }
    case 'top-right':
      return { relativeX: 1, relativeY: 0 }
    case 'bottom-left':
      return { relativeX: 0, relativeY: 1 }
    case 'bottom-right':
      return { relativeX: 1, relativeY: 1 }
    case 'center':
      return { relativeX: 0.5, relativeY: 0.5 }
    case 'custom':
      return {
        relativeX: clampUnit(settings.position.relativeX),
        relativeY: clampUnit(settings.position.relativeY),
      }
  }
}
