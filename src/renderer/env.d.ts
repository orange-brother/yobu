import type { StageApi } from '../preload'

declare global {
  interface Window {
    stageApi: StageApi
  }
}
