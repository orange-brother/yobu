import type { AppState, Reminder, StageVideo } from '../shared/types'
import type { AppStore } from './store'
import type { StageWindowController } from './stageWindow'
import type { McpCreateCueInput } from '../shared/mcpCue'

import { buildMcpCueReminder } from '../shared/mcpCue'
import { findNextReminderOccurrence } from '../shared/schedule'

export interface YobuControlServiceOptions {
  store: AppStore
  stage: StageWindowController
  onStateChanged: () => void
}

export interface ShowVideoNowInput {
  videoId?: string
  filePath?: string
  bubbleText?: string
  loop?: boolean
  audioEnabled?: boolean
}

export interface CreateCueInput extends McpCreateCueInput {
  filePath?: string
}

function stateVideoById(state: AppState, videoId: string): StageVideo {
  const video = state.videos.find(item => item.id === videoId)
  if (!video) {
    throw new Error('영상을 찾을 수 없습니다.')
  }
  return video
}

function stateReminderById(state: AppState, cueId: string): Reminder {
  const reminder = state.reminders.find(item => item.id === cueId)
  if (!reminder) {
    throw new Error('큐를 찾을 수 없습니다.')
  }
  return reminder
}

function cueSummary(reminder: Reminder) {
  const next = findNextReminderOccurrence(reminder)
  return {
    id: reminder.id,
    title: reminder.title,
    enabled: reminder.enabled,
    scheduleSource: reminder.scheduleSource ?? 'manual',
    googleCalendar: reminder.googleCalendar,
    videoId: reminder.stageVideoId,
    repeatType: reminder.repeatType,
    triggerType: reminder.triggerType,
    startDate: reminder.startDate,
    endDate: reminder.endDate,
    weekdays: reminder.weekdays,
    localTime: reminder.localTime,
    intervalMinutes: reminder.intervalMinutes,
    bubbleText: reminder.bubbleText,
    bubbleMode: reminder.bubbleMode ?? 'custom',
    loop: reminder.loop,
    audioEnabled: reminder.audioEnabled,
    nextDisplayAt: next?.toISOString(),
  }
}

function videoSummary(video: StageVideo) {
  return {
    id: video.id,
    originalName: video.originalName,
    extension: video.extension,
    sizeBytes: video.sizeBytes,
    importedAt: video.importedAt,
    lastError: video.lastError,
  }
}

export class YobuControlService {
  private readonly store: AppStore
  private readonly stage: StageWindowController
  private readonly onStateChanged: () => void

  constructor(options: YobuControlServiceOptions) {
    this.store = options.store
    this.stage = options.stage
    this.onStateChanged = options.onStateChanged
  }

  listVideos() {
    return this.store.getState().videos.map(videoSummary)
  }

  async importVideo(filePath: string) {
    if (!filePath.trim()) {
      throw new Error('filePath가 필요합니다.')
    }

    const result = await this.store.importVideo(filePath)
    this.onStateChanged()

    const videoId = result.importedVideoId ?? result.duplicateVideoId
    const video = videoId ? stateVideoById(result.state, videoId) : undefined
    return {
      importedVideoId: result.importedVideoId,
      duplicateVideoId: result.duplicateVideoId,
      video: video ? videoSummary(video) : undefined,
    }
  }

  async showVideoNow(input: ShowVideoNowInput) {
    const video = await this.resolveVideo(input, true)
    await this.stage.showVideoNow(video, {
      bubbleText: input.bubbleText?.trim() || undefined,
      loop: input.loop ?? false,
      audioEnabled: input.audioEnabled ?? false,
    })

    return {
      shown: true,
      video: videoSummary(video),
      oneOff: true,
    }
  }

  listCues() {
    return this.store.getState().reminders.map(cueSummary)
  }

  async createCue(input: CreateCueInput) {
    const video = await this.resolveVideo(input, false)
    const reminder = buildMcpCueReminder({
      ...input,
      videoId: video?.id ?? input.videoId,
    })
    const state = await this.store.updateReminder(reminder)
    this.onStateChanged()

    return {
      cue: cueSummary(stateReminderById(state, reminder.id)),
    }
  }

  async disableCue(cueId: string) {
    const state = this.store.getState()
    const reminder = stateReminderById(state, cueId)
    const nextState = await this.store.updateReminder({
      ...reminder,
      enabled: false,
    })
    this.onStateChanged()

    return {
      cue: cueSummary(stateReminderById(nextState, cueId)),
    }
  }

  closeStage() {
    this.stage.close()
    return this.getStageStatus()
  }

  getStageStatus() {
    const payload = this.stage.getPayload()
    return {
      visible: this.stage.hasVisibleStage(),
      preview: this.stage.hasVisiblePreview(),
      mode: payload?.mode,
      videoId: payload?.video?.id,
      videoName: payload?.video?.originalName,
      bubbleText: payload?.bubbleText,
      loop: payload?.loop,
      audioEnabled: payload?.audioEnabled,
    }
  }

  private async resolveVideo(input: { videoId?: string, filePath?: string }, required: true): Promise<StageVideo>
  private async resolveVideo(input: { videoId?: string, filePath?: string }, required: false): Promise<StageVideo | undefined>
  private async resolveVideo(input: { videoId?: string, filePath?: string }, required: boolean): Promise<StageVideo | undefined> {
    const videoId = input.videoId?.trim()
    const filePath = input.filePath?.trim()

    if (videoId && filePath) {
      throw new Error('videoId와 filePath는 동시에 지정할 수 없습니다.')
    }

    if (filePath) {
      const result = await this.importVideo(filePath)
      return stateVideoById(this.store.getState(), result.importedVideoId ?? result.duplicateVideoId ?? '')
    }

    if (videoId) {
      return stateVideoById(this.store.getState(), videoId)
    }

    if (required) {
      throw new Error('videoId 또는 filePath가 필요합니다.')
    }

    return undefined
  }
}
