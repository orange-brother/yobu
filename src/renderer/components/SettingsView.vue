<script setup lang="ts">
import type {
  AppState,
  GoogleCalendarConnectionStatus,
  GoogleCalendarListItem,
  GoogleCalendarOffsetMinutes,
  Reminder,
  ReminderBubbleMode,
  ReminderRepeatType,
  ReminderScheduleSource,
  ReminderTriggerType,
  StageSettings,
  StageVideo,
  Weekday,
} from '../../shared/types'

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import appIconUrl from '../../../assets/app-icon.png'
import onboardingCueUrl from '../../../assets/onboarding-cue.svg'
import onboardingIntroUrl from '../../../assets/onboarding-intro.svg'
import onboardingLibraryUrl from '../../../assets/onboarding-library.svg'
import onboardingPlacementUrl from '../../../assets/onboarding-placement.svg'
import packageMetadata from '../../../package.json'
import { cueIntentSummary, formatTwoDigits, reminderScheduleSummary, repeatLabels, timeModeLabels } from '../../shared/reminderPresentation'
import { localDateKey, normalizeIntervalMinutes, weekdaysForRepeatType } from '../../shared/schedule'
import { googleCalendarOffsetMinuteOptions, intervalMinuteOptions, weekdayLabels, weekdays } from '../../shared/types'

type Tab = 'reminders' | 'videos' | 'settings'
type EditorMode = 'new' | 'existing'
type FieldErrors = Partial<Record<'dateRange' | 'video' | 'weekdays' | 'calendar', string>>
type McpStatus = {
  url: string
  running: boolean
}
type ConfirmDialog = {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}

const recurrenceRepeatOptions: ReminderRepeatType[] = ['once', 'daily', 'weekdays', 'weekends', 'custom']
const timeModeOptions: ReminderTriggerType[] = ['time', 'interval']
const scheduleSourceOptions: Array<{ value: ReminderScheduleSource, label: string }> = [
  { value: 'manual', label: '직접 설정' },
  { value: 'google_calendar', label: 'Google Calendar 연동' },
]
const bubbleModeOptions: Array<{ value: ReminderBubbleMode, label: string }> = [
  { value: 'event_title', label: '일정 제목 사용' },
  { value: 'custom', label: '직접 입력' },
  { value: 'none', label: '없음' },
]
const onboardingSlides = [
  {
    eyebrow: '소개',
    title: '놓치기 쉬운 순간을 더 분명하게.',
    body: 'Yobu는 해야 할 순간을 영상으로 알려주는 리마인더입니다.',
    imageUrl: onboardingIntroUrl,
    imageAlt: 'Yobu 앱 소개 화면 예시',
  },
  {
    eyebrow: '사용법 1',
    title: '영상을 추가합니다.',
    body: '알림에 사용할 영상을 영상 보관함에 추가합니다.',
    imageUrl: onboardingLibraryUrl,
    imageAlt: '영상 보관함에서 영상을 추가하는 화면 예시',
  },
  {
    eyebrow: '사용법 2',
    title: '큐를 설정합니다.',
    body: '날짜, 반복, 호출 조건을 정하고 사용할 영상을 연결합니다.',
    imageUrl: onboardingCueUrl,
    imageAlt: '큐 시트에서 큐 타이밍과 소스 영상을 설정하는 화면 예시',
  },
  {
    eyebrow: '사용법 3',
    title: '위치를 확인합니다.',
    body: '영상이 보일 위치를 화면에서 조정하고 저장합니다.',
    imageUrl: onboardingPlacementUrl,
    imageAlt: '화면에서 영상 위치와 크기를 조정하는 화면 예시',
  },
]

const state = ref<AppState | null>(null)
const activeTab = ref<Tab>('reminders')
const selectedReminderId = ref<string | null>(null)
const editorReminder = ref<Reminder | null>(null)
const editorMode = ref<EditorMode | null>(null)
const editorSnapshot = ref('')
const editorEndDateEnabled = ref(false)
const queueSearchQuery = ref('')
const fieldErrors = ref<FieldErrors>({})
const confirmDialog = ref<ConfirmDialog | null>(null)
const busy = ref(false)
const notice = ref('')
const error = ref('')
const mcpStatus = ref<McpStatus>({
  url: 'http://127.0.0.1:37373/mcp',
  running: false,
})
const calendarStatus = ref<GoogleCalendarConnectionStatus>({
  configured: false,
  connected: false,
})
const googleCalendars = ref<GoogleCalendarListItem[]>([])
const calendarSearchQuery = ref('')
const calendarPickerOpen = ref(false)
const calendarConnecting = ref(false)
const onboardingOpen = ref(false)
const onboardingStep = ref(0)
const pendingReminderId = ref<string | null>(null)
const editorVideoUrl = ref('')
const libraryVideoUrls = ref<Record<string, string>>({})
const libraryThumbnailFailures = ref<Record<string, boolean>>({})
const inlinePreviewAspectRatio = ref(16 / 9)
const hourOptions = Array.from({ length: 24 }, (_item, hour) => hour)
const minuteOptions = Array.from({ length: 60 }, (_item, minute) => minute)
const appVersion = packageMetadata.version
let removeSelectReminderListener: (() => void) | null = null
let removeStateChangedListener: (() => void) | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let libraryVideoUrlLoadToken = 0
let calendarConnectAttempt = 0

const selectedReminder = computed(() => {
  if (!state.value || !selectedReminderId.value) {
    return null
  }
  return state.value.reminders.find(reminder => reminder.id === selectedReminderId.value) ?? null
})

const editorVideo = computed(() => {
  if (!state.value || !editorReminder.value?.stageVideoId) {
    return null
  }
  return state.value.videos.find(video => video.id === editorReminder.value?.stageVideoId) ?? null
})

const isEditorDirty = computed(() => {
  if (!editorReminder.value) {
    return false
  }
  return serializeReminder(editorReminder.value) !== editorSnapshot.value
})

const editorVideoPreviewKey = computed(() => editorReminder.value?.stageVideoId ?? '')
const draftReminder = computed(() => editorMode.value === 'new' ? editorReminder.value : null)
const queueListReminders = computed(() => {
  const reminders = state.value?.reminders ?? []
  if (!draftReminder.value) {
    return reminders
  }

  return [
    draftReminder.value,
    ...reminders.filter(reminder => reminder.id !== draftReminder.value?.id),
  ]
})
const visibleQueueReminders = computed(() => {
  const reminders = queueListReminders.value
  const query = queueSearchQuery.value.trim().toLocaleLowerCase('ko-KR')
  return reminders.filter((reminder) => {
    if (isDraftReminder(reminder)) {
      return true
    }

    if (!query) {
      return true
    }

    return `${queueRowTitle(reminder)} ${reminderScheduleSummary(reminder)} ${isDraftReminder(reminder) ? '초안 저장 전' : ''}`
      .toLocaleLowerCase('ko-KR')
      .includes(query)
  })
})
const inlinePreviewStyle = computed(() => ({
  '--inline-preview-aspect': String(inlinePreviewAspectRatio.value),
}))
const inlinePreviewBubbleText = computed(() => {
  const reminder = editorReminder.value
  if (!reminder) {
    return ''
  }
  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    if (reminder.bubbleMode === 'none') {
      return ''
    }
    if ((reminder.bubbleMode ?? 'event_title') === 'event_title') {
      return '일정 제목'
    }
  }
  return reminder.bubbleText?.trim() ?? ''
})
const editorCueIntentSummary = computed(() => {
  if (!editorReminder.value) {
    return ''
  }
  return cueIntentSummary(editorReminder.value)
})
const mcpUrl = computed(() => mcpStatus.value.url)
const claudeCodeCommand = computed(() => `claude mcp add --transport http yobu ${mcpUrl.value}`)
const claudeDesktopConfig = computed(() => JSON.stringify({
  mcpServers: {
    yobu: {
      command: 'npx',
      args: ['-y', 'mcp-remote', mcpUrl.value],
    },
  },
}, null, 2))
const codexCommand = computed(() => `codex mcp add yobu --url ${mcpUrl.value}`)
const codexConfig = computed(() => `[mcp_servers.yobu]\nurl = "${mcpUrl.value}"`)
const sortedGoogleCalendars = computed(() => [...googleCalendars.value].sort(compareGoogleCalendars))
const filteredGoogleCalendars = computed(() => {
  const query = calendarSearchQuery.value.trim().toLocaleLowerCase('ko-KR')
  if (!query) {
    return sortedGoogleCalendars.value
  }

  return sortedGoogleCalendars.value.filter(calendar =>
    `${calendar.summary} ${calendar.id}`.toLocaleLowerCase('ko-KR').includes(query),
  )
})
const selectedEditorGoogleCalendar = computed(() => {
  const configured = editorReminder.value?.googleCalendar
  if (!configured?.calendarId) {
    return null
  }

  const calendar = googleCalendars.value.find(item => item.id === configured.calendarId)
  return {
    id: configured.calendarId,
    summary: calendar?.summary || configured.calendarName || configured.calendarId,
    primary: Boolean(calendar?.primary),
  }
})
const currentOnboardingSlide = computed(() => onboardingSlides[onboardingStep.value] ?? onboardingSlides[0])
const isLastOnboardingStep = computed(() => onboardingStep.value === onboardingSlides.length - 1)

function compareGoogleCalendars(a: GoogleCalendarListItem, b: GoogleCalendarListItem): number {
  if (a.primary !== b.primary) {
    return a.primary ? -1 : 1
  }

  return a.summary.localeCompare(b.summary, 'ko-KR', { numeric: true, sensitivity: 'base' })
    || a.id.localeCompare(b.id, 'ko-KR', { numeric: true, sensitivity: 'base' })
}

function videoLabel(video: StageVideo): string {
  return `${video.originalName} · ${formatBytes(video.sizeBytes)}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function calendarOffsetLabel(offsetMinutes: GoogleCalendarOffsetMinutes): string {
  return offsetMinutes === 0 ? '일정 시작 시' : `일정 ${offsetMinutes}분 전`
}

function isDraftReminder(reminder: Reminder): boolean {
  return editorMode.value === 'new' && editorReminder.value?.id === reminder.id
}

function queueRowTitle(reminder: Reminder): string {
  return reminder.title.trim() || '제목 없음'
}

function todayKey(): string {
  return localDateKey(new Date())
}

function nextFiveMinuteTime(): Reminder['localTime'] {
  const date = new Date()
  date.setSeconds(0, 0)
  date.setMinutes(Math.ceil((date.getMinutes() + 1) / 5) * 5)
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

function newReminderId(): string {
  return window.crypto?.randomUUID?.() ?? `reminder-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function toPlainReminder(reminder: Reminder): Reminder {
  const scheduleSource = reminder.scheduleSource ?? 'manual'
  const plain: Reminder = {
    id: reminder.id,
    title: reminder.title,
    enabled: reminder.enabled,
    scheduleSource,
    repeatType: reminder.repeatType,
    triggerType: reminder.triggerType ?? 'time',
    startDate: reminder.startDate || reminder.onceDate || todayKey(),
    endDate: reminder.endDate || undefined,
    intervalMinutes: reminder.intervalMinutes,
    weekdays: [...reminder.weekdays],
    localTime: {
      hour: Number(reminder.localTime.hour),
      minute: Number(reminder.localTime.minute),
    },
    googleCalendar: scheduleSource === 'google_calendar' && reminder.googleCalendar
      ? {
          calendarId: reminder.googleCalendar.calendarId,
          calendarName: reminder.googleCalendar.calendarName,
          offsetMinutes: reminder.googleCalendar.offsetMinutes,
          excludeAllDay: reminder.googleCalendar.excludeAllDay,
        }
      : undefined,
    bubbleMode: reminder.bubbleMode ?? (scheduleSource === 'google_calendar' ? 'event_title' : 'custom'),
    loop: reminder.loop,
    audioEnabled: reminder.audioEnabled,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  }

  if (reminder.stageVideoId) {
    plain.stageVideoId = reminder.stageVideoId
  }

  if (reminder.bubbleText) {
    plain.bubbleText = reminder.bubbleText
  }

  return plain
}

function normalizeReminderForSave(reminder: Reminder): Reminder {
  const plain = toPlainReminder(reminder)
  const scheduleSource = plain.scheduleSource ?? 'manual'
  const normalized: Reminder = {
    ...plain,
    scheduleSource,
    enabled: Boolean(plain.stageVideoId && plain.enabled),
    weekdays: weekdaysForRepeatType(plain),
    onceDate: undefined,
    startDate: plain.startDate || todayKey(),
    endDate: plain.repeatType === 'once' ? undefined : plain.endDate || undefined,
    intervalMinutes: plain.triggerType === 'interval' ? normalizeIntervalMinutes(plain.intervalMinutes) : undefined,
    googleCalendar: scheduleSource === 'google_calendar' ? plain.googleCalendar : undefined,
    bubbleMode: plain.bubbleMode ?? (scheduleSource === 'google_calendar' ? 'event_title' : 'custom'),
  }

  if (plain.repeatType === 'custom') {
    normalized.weekdays = plain.weekdays.length > 0 ? [...plain.weekdays] : []
  }

  if (scheduleSource === 'google_calendar') {
    normalized.enabled = Boolean(
      plain.stageVideoId
      && plain.googleCalendar?.calendarId
      && plain.enabled,
    )
  }

  return normalized
}

function serializeReminder(reminder: Reminder): string {
  const normalized = normalizeReminderForSave(reminder)
  return JSON.stringify({
    ...normalized,
    enabled: false,
  })
}

function toPlainStageSettings(settings: StageSettings): StageSettings {
  return {
    sizeRatio: Number(settings.sizeRatio),
    launchAtLogin: Boolean(settings.launchAtLogin),
    position: {
      anchor: settings.position.anchor,
      relativeX: Number(settings.position.relativeX),
      relativeY: Number(settings.position.relativeY),
    },
  }
}

function createLocalReminder(): Reminder {
  const defaultVideo = state.value?.videos[0]
  const now = new Date().toISOString()
  return {
    id: newReminderId(),
    title: '',
    enabled: Boolean(defaultVideo),
    scheduleSource: 'manual',
    repeatType: 'weekdays',
    triggerType: 'time',
    startDate: todayKey(),
    weekdays: weekdaysForRepeatType({ repeatType: 'weekdays', weekdays: [] }),
    localTime: nextFiveMinuteTime(),
    stageVideoId: defaultVideo?.id,
    bubbleMode: 'custom',
    loop: false,
    audioEnabled: false,
    createdAt: now,
    updatedAt: now,
  }
}

function setEditor(reminder: Reminder, mode: EditorMode) {
  const plain = normalizeReminderForSave(reminder)
  editorReminder.value = plain
  editorMode.value = mode
  editorSnapshot.value = serializeReminder(plain)
  editorEndDateEnabled.value = Boolean(plain.endDate)
  fieldErrors.value = {}
  calendarPickerOpen.value = false
  calendarSearchQuery.value = ''
  if ((plain.scheduleSource ?? 'manual') === 'google_calendar') {
    void loadCalendarStatus()
    void loadGoogleCalendars()
  }
}

function setMessage(message: string) {
  notice.value = message
  error.value = ''
  scheduleToastDismiss(3200)
}

function displayErrorMessage(caught: unknown, fallback: string): string {
  if (!(caught instanceof Error)) {
    return fallback
  }

  return caught.message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*Error:\s*/, '')
    .replace(/^Error:\s*/, '')
}

function setError(message: string) {
  error.value = message
  notice.value = ''
  scheduleToastDismiss(5200)
}

function clearToastTimer() {
  if (!toastTimer) {
    return
  }
  clearTimeout(toastTimer)
  toastTimer = null
}

function dismissToast() {
  clearToastTimer()
  notice.value = ''
  error.value = ''
}

function scheduleToastDismiss(delayMs: number) {
  clearToastTimer()
  toastTimer = setTimeout(() => {
    dismissToast()
  }, delayMs)
}

async function run<T>(action: () => Promise<T>, options: { success?: string } = {}): Promise<T | undefined> {
  busy.value = true
  try {
    const result = await action()
    if (options.success) {
      setMessage(options.success)
    }
    return result
  }
  catch (caught) {
    setError(displayErrorMessage(caught, '처리 중 오류가 발생했습니다.'))
    return undefined
  }
  finally {
    busy.value = false
  }
}

function openConfirm(dialog: ConfirmDialog) {
  confirmDialog.value = dialog
}

async function confirmCurrentDialog() {
  const dialog = confirmDialog.value
  if (!dialog) {
    return
  }
  confirmDialog.value = null
  await dialog.onConfirm()
}

function openOnboarding() {
  onboardingStep.value = 0
  onboardingOpen.value = true
}

function previousOnboarding() {
  onboardingStep.value = Math.max(0, onboardingStep.value - 1)
}

function nextOnboarding() {
  if (isLastOnboardingStep.value) {
    void dismissOnboarding()
    return
  }
  onboardingStep.value = Math.min(onboardingSlides.length - 1, onboardingStep.value + 1)
}

async function dismissOnboarding() {
  onboardingOpen.value = false
  if (state.value?.onboardingSeen) {
    return
  }

  const next = await run(() => window.stageApi.setOnboardingSeen(true))
  if (next) {
    state.value = next
  }
}

function guardDirty(next: () => void) {
  if (!isEditorDirty.value) {
    next()
    return
  }

  openConfirm({
    title: '변경사항을 버릴까요?',
    message: '저장하지 않은 변경사항이 있습니다.',
    confirmLabel: '버리기',
    danger: true,
    onConfirm: next,
  })
}

async function loadState() {
  const loaded = await run(() => window.stageApi.getState())
  if (!loaded) {
    return
  }
  state.value = loaded
  if (!loaded.onboardingSeen) {
    openOnboarding()
  }
  if (pendingReminderId.value && selectReminderById(pendingReminderId.value, false)) {
    return
  }
  if (!editorReminder.value && loaded.reminders[0]) {
    selectedReminderId.value = loaded.reminders[0].id
    setEditor(loaded.reminders[0], 'existing')
  }
}

async function loadMcpStatus() {
  try {
    mcpStatus.value = await window.stageApi.getMcpStatus()
  }
  catch {
    mcpStatus.value = {
      ...mcpStatus.value,
      running: false,
    }
  }
}

async function loadCalendarStatus() {
  try {
    calendarStatus.value = await window.stageApi.getCalendarStatus()
  }
  catch (caught) {
    calendarStatus.value = {
      configured: false,
      connected: false,
      error: displayErrorMessage(caught, 'Google Calendar 상태를 확인할 수 없습니다.'),
    }
  }
}

async function loadGoogleCalendars() {
  if (!calendarStatus.value.connected) {
    googleCalendars.value = []
    return
  }

  try {
    googleCalendars.value = await window.stageApi.listGoogleCalendars()
  }
  catch (caught) {
    googleCalendars.value = []
    await loadCalendarStatus()
    setError(displayErrorMessage(caught, '캘린더 목록을 불러올 수 없습니다.'))
  }
}

async function connectGoogleCalendar() {
  const attemptId = calendarConnectAttempt + 1
  calendarConnectAttempt = attemptId
  calendarConnecting.value = true
  setMessage('브라우저에서 Google 인증을 완료하세요.')

  setTimeout(() => {
    if (calendarConnectAttempt === attemptId) {
      calendarConnecting.value = false
    }
  }, 1500)

  try {
    const status = await window.stageApi.connectGoogleCalendar()
    if (calendarConnectAttempt !== attemptId) {
      return
    }

    calendarStatus.value = status
    await loadGoogleCalendars()
    const loaded = await window.stageApi.getState()
    state.value = loaded
    setMessage('Google Calendar를 연결했습니다.')
  }
  catch (caught) {
    if (calendarConnectAttempt !== attemptId) {
      return
    }
    setError(displayErrorMessage(caught, 'Google Calendar를 연결할 수 없습니다.'))
  }
  finally {
    if (calendarConnectAttempt === attemptId) {
      calendarConnecting.value = false
    }
  }
}

async function disconnectGoogleCalendar() {
  const status = await run(() => window.stageApi.disconnectGoogleCalendar(), { success: 'Google Calendar 연결을 해제했습니다.' })
  if (!status) {
    return
  }

  calendarStatus.value = status
  googleCalendars.value = []
  const loaded = await window.stageApi.getState()
  state.value = loaded
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    setMessage('복사했습니다.')
  }
  catch {
    setError('복사할 수 없습니다.')
  }
}

function selectReminderById(reminderId: string, guardUnsavedChanges: boolean): boolean {
  const reminder = state.value?.reminders.find(item => item.id === reminderId)
  if (!reminder) {
    pendingReminderId.value = reminderId
    activeTab.value = 'reminders'
    return false
  }

  const select = () => {
    pendingReminderId.value = null
    activeTab.value = 'reminders'
    selectedReminderId.value = reminder.id
    setEditor(reminder, 'existing')
  }

  if (guardUnsavedChanges) {
    guardDirty(select)
  }
  else {
    select()
  }
  return true
}

function requestReminderSelection(reminderId: string) {
  pendingReminderId.value = reminderId
  selectReminderById(reminderId, true)
}

function applyExternalStateChanged(next: AppState) {
  state.value = next
}

async function importVideo() {
  const result = await run(() => window.stageApi.importVideo())
  if (!result) {
    return
  }

  state.value = result.state
  if (result.duplicateVideoId) {
    setMessage('이미 보관함에 있는 영상입니다.')
  }
  else if (result.importedVideoId) {
    setMessage('영상을 추가했습니다.')
  }
}

async function deleteVideo(videoId: string) {
  const next = await run(() => window.stageApi.deleteVideo(videoId), { success: '영상을 삭제했습니다.' })
  if (next) {
    state.value = next
  }
}

async function loadEditorVideoUrl(videoId: string | undefined) {
  editorVideoUrl.value = ''
  inlinePreviewAspectRatio.value = 16 / 9
  if (!videoId) {
    return
  }

  try {
    editorVideoUrl.value = await window.stageApi.getVideoUrl(videoId)
  }
  catch (caught) {
    setError(displayErrorMessage(caught, '영상 미리보기를 불러올 수 없습니다.'))
  }
}

async function loadLibraryVideoUrls() {
  if (activeTab.value !== 'videos' || !state.value) {
    return
  }

  const videos = state.value.videos
  const videoIds = new Set(videos.map(video => video.id))
  const nextUrls: Record<string, string> = {}
  const nextFailures: Record<string, boolean> = {}
  for (const video of videos) {
    if (libraryVideoUrls.value[video.id]) {
      nextUrls[video.id] = libraryVideoUrls.value[video.id]
    }
    if (libraryThumbnailFailures.value[video.id]) {
      nextFailures[video.id] = true
    }
  }
  libraryVideoUrls.value = nextUrls
  libraryThumbnailFailures.value = nextFailures

  const missingVideos = videos.filter(video => !libraryVideoUrls.value[video.id] && !libraryThumbnailFailures.value[video.id])
  if (missingVideos.length === 0) {
    return
  }

  const loadToken = ++libraryVideoUrlLoadToken
  const loadedEntries = await Promise.all(
    missingVideos.map(async video => {
      try {
        return [video.id, await window.stageApi.getVideoUrl(video.id)] as const
      }
      catch {
        return [video.id, ''] as const
      }
    }),
  )

  if (loadToken !== libraryVideoUrlLoadToken || activeTab.value !== 'videos') {
    return
  }

  const latestUrls = { ...libraryVideoUrls.value }
  const latestFailures = { ...libraryThumbnailFailures.value }
  for (const [videoId, url] of loadedEntries) {
    if (!videoIds.has(videoId)) {
      continue
    }
    if (url) {
      latestUrls[videoId] = url
      delete latestFailures[videoId]
    }
    else {
      delete latestUrls[videoId]
      latestFailures[videoId] = true
    }
  }
  libraryVideoUrls.value = latestUrls
  libraryThumbnailFailures.value = latestFailures
}

function prepareLibraryThumbnail(event: Event) {
  const video = event.currentTarget as HTMLVideoElement | null
  if (!video) {
    return
  }
  video.pause()
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return
  }
  try {
    video.currentTime = Math.min(0.1, Math.max(0, video.duration / 2))
  }
  catch {
    // Some codecs do not allow seeking before enough data is available.
  }
}

function markLibraryThumbnailFailed(videoId: string) {
  libraryThumbnailFailures.value = {
    ...libraryThumbnailFailures.value,
    [videoId]: true,
  }
}

function canReminderUseListToggle(reminder: Reminder): boolean {
  if (!reminder.stageVideoId) {
    return false
  }
  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    return Boolean(calendarStatus.value.connected && reminder.googleCalendar?.calendarId)
  }
  return true
}

function handleInlinePreviewMetadata(event: Event) {
  const video = event.currentTarget as HTMLVideoElement | null
  if (!video?.videoWidth || !video.videoHeight) {
    return
  }
  inlinePreviewAspectRatio.value = video.videoWidth / video.videoHeight
}

async function toggleReminderEnabled(reminder: Reminder) {
  if (!reminder.stageVideoId) {
    setError('영상 연결 후 활성화할 수 있습니다.')
    return
  }
  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    if (!calendarStatus.value.connected) {
      setError('Google Calendar 연결 후 활성화할 수 있습니다.')
      return
    }
    if (!reminder.googleCalendar?.calendarId) {
      setError('캘린더 선택 후 활성화할 수 있습니다.')
      return
    }
  }

  const plain = toPlainReminder(reminder)
  const wasEditingSelected = editorReminder.value?.id === reminder.id
  const hadDirtyEditor = isEditorDirty.value
  const enabled = !plain.enabled
  const next = await run(() => window.stageApi.updateReminder({ ...plain, enabled }))
  if (!next) {
    return
  }

  state.value = next
  const saved = next.reminders.find(item => item.id === reminder.id)
  if (!saved || !wasEditingSelected || !editorReminder.value) {
    return
  }

  if (hadDirtyEditor) {
    editorReminder.value = {
      ...toPlainReminder(editorReminder.value),
      enabled: saved.enabled,
    }
    return
  }

  setEditor(saved, editorMode.value ?? 'existing')
}

async function previewVideo(videoId: string) {
  await run(() => window.stageApi.previewVideo(videoId))
}

function startCreateReminder() {
  guardDirty(() => {
    const draft = createLocalReminder()
    queueSearchQuery.value = ''
    selectedReminderId.value = draft.id
    setEditor(draft, 'new')
    activeTab.value = 'reminders'
  })
}

function selectQueueReminder(reminder: Reminder) {
  if (isDraftReminder(reminder)) {
    selectedReminderId.value = reminder.id
    return
  }

  selectReminderForEdit(reminder)
}

function selectReminderForEdit(reminder: Reminder) {
  guardDirty(() => {
    selectedReminderId.value = reminder.id
    setEditor(reminder, 'existing')
  })
}

function updateEditor(patch: Partial<Reminder>) {
  if (!editorReminder.value) {
    return
  }
  editorReminder.value = {
    ...toPlainReminder(editorReminder.value),
    ...patch,
  }
  fieldErrors.value = {}
}

function updateEditorTime(partial: Partial<Reminder['localTime']>) {
  if (!editorReminder.value) {
    return
  }
  updateEditor({
    localTime: {
      ...editorReminder.value.localTime,
      ...partial,
    },
  })
}

function defaultGoogleCalendarConfig() {
  const primary = sortedGoogleCalendars.value[0]
  return primary
    ? {
        calendarId: primary.id,
        calendarName: primary.summary,
        offsetMinutes: 10 as GoogleCalendarOffsetMinutes,
        excludeAllDay: true,
      }
    : undefined
}

function setEditorScheduleSource(scheduleSource: ReminderScheduleSource) {
  if (!editorReminder.value) {
    return
  }

  calendarPickerOpen.value = false
  calendarSearchQuery.value = ''

  if (scheduleSource === 'google_calendar') {
    void loadCalendarStatus().then(loadGoogleCalendars)
    const current = toPlainReminder(editorReminder.value)
    updateEditor({
      scheduleSource,
      googleCalendar: current.googleCalendar ?? defaultGoogleCalendarConfig(),
      bubbleMode: current.bubbleMode === 'none' ? 'none' : 'event_title',
    })
    return
  }

  updateEditor({
    scheduleSource,
    googleCalendar: undefined,
    bubbleMode: 'custom',
  })
}

function updateEditorGoogleCalendar(patch: Partial<NonNullable<Reminder['googleCalendar']>>) {
  if (!editorReminder.value) {
    return
  }

  const current = editorReminder.value.googleCalendar ?? defaultGoogleCalendarConfig() ?? {
    calendarId: '',
    calendarName: '',
    offsetMinutes: 10 as GoogleCalendarOffsetMinutes,
    excludeAllDay: true,
  }
  updateEditor({
    googleCalendar: {
      ...current,
      ...patch,
    },
  })
}

function openCalendarPicker() {
  if (!calendarStatus.value.connected) {
    return
  }

  calendarPickerOpen.value = true
  void loadGoogleCalendars()
}

function closeCalendarPicker() {
  calendarPickerOpen.value = false
  calendarSearchQuery.value = ''
}

function setEditorGoogleCalendar(calendarId: string) {
  const calendar = googleCalendars.value.find(item => item.id === calendarId)
  updateEditorGoogleCalendar({
    calendarId,
    calendarName: calendar?.summary ?? calendarId,
  })
  closeCalendarPicker()
}

function setEditorBubbleMode(bubbleMode: ReminderBubbleMode) {
  updateEditor({ bubbleMode })
}

function setEditorEndDateEnabled(enabled: boolean) {
  if (!editorReminder.value) {
    return
  }

  const current = toPlainReminder(editorReminder.value)
  editorEndDateEnabled.value = enabled
  updateEditor({
    endDate: enabled ? current.endDate || current.startDate || todayKey() : undefined,
  })
}

function setEditorRepeatType(repeatType: ReminderRepeatType) {
  if (!editorReminder.value) {
    return
  }

  const current = toPlainReminder(editorReminder.value)
  const next: Reminder = {
    ...current,
    repeatType,
    startDate: current.startDate || todayKey(),
    endDate: repeatType === 'once' ? undefined : current.endDate,
    weekdays: repeatType === 'custom' ? current.weekdays.length > 0 ? current.weekdays : [...weekdays] : weekdaysForRepeatType({ ...current, repeatType }),
  }
  editorEndDateEnabled.value = repeatType !== 'once' && Boolean(next.endDate)
  updateEditor(next)
}

function setEditorTimeMode(triggerType: ReminderTriggerType) {
  if (!editorReminder.value) {
    return
  }

  const current = toPlainReminder(editorReminder.value)
  updateEditor({
    triggerType,
    intervalMinutes: triggerType === 'interval' ? normalizeIntervalMinutes(current.intervalMinutes) : undefined,
  })
}

function setEditorWeekdays(nextWeekdays: Weekday[]) {
  updateEditor({ repeatType: 'custom', weekdays: nextWeekdays })
}

function toggleEditorWeekday(day: Weekday) {
  if (!editorReminder.value) {
    return
  }
  const current = new Set(editorReminder.value.weekdays)
  if (current.has(day)) {
    current.delete(day)
  }
  else {
    current.add(day)
  }
  setEditorWeekdays([...weekdays].filter(item => current.has(item)))
}

function setEditorVideo(videoId: string) {
  const current = editorReminder.value
  const canEnable = Boolean(
    videoId
    && (
      (current?.scheduleSource ?? 'manual') === 'manual'
      || (calendarStatus.value.connected && current?.googleCalendar?.calendarId)
    ),
  )
  updateEditor({
    stageVideoId: videoId || undefined,
    enabled: canEnable,
  })
}

function validateReminder(reminder: Reminder): FieldErrors {
  const nextErrors: FieldErrors = {}
  if (reminder.enabled && !reminder.stageVideoId) {
    nextErrors.video = '영상 선택 필요'
  }

  if ((reminder.scheduleSource ?? 'manual') === 'google_calendar') {
    if (!calendarStatus.value.connected) {
      nextErrors.calendar = '설정에서 Google Calendar 연결이 필요합니다.'
    }
    else if (!reminder.googleCalendar?.calendarId) {
      nextErrors.calendar = '캘린더를 선택하세요.'
    }
  }

  if ((reminder.scheduleSource ?? 'manual') === 'manual' && reminder.repeatType === 'custom' && reminder.weekdays.length === 0) {
    nextErrors.weekdays = '요일을 하나 이상 선택하세요.'
  }

  if ((reminder.scheduleSource ?? 'manual') !== 'manual') {
    return nextErrors
  }

  if (!reminder.startDate) {
    nextErrors.dateRange = '시작일을 선택하세요.'
  }
  else if (reminder.endDate && reminder.endDate < reminder.startDate) {
    nextErrors.dateRange = '종료일은 시작일 이후여야 합니다.'
  }
  else if (reminder.repeatType === 'once' && reminder.triggerType === 'time') {
    const selected = new Date(`${reminder.startDate}T${formatTwoDigits(reminder.localTime.hour)}:${formatTwoDigits(reminder.localTime.minute)}:00`)
    if (selected.getTime() < Date.now()) {
      nextErrors.dateRange = '이미 지난 시간입니다.'
    }
  }
  else if (reminder.repeatType === 'once' && reminder.startDate < todayKey()) {
    nextErrors.dateRange = '이미 지난 날짜입니다.'
  }

  return nextErrors
}

async function saveEditor() {
  if (!editorReminder.value) {
    return
  }

  const normalized = normalizeReminderForSave(editorReminder.value)
  const storedReminder = editorMode.value === 'existing'
    ? state.value?.reminders.find(item => item.id === normalized.id)
    : undefined
  const shouldUseEditorEnabled = editorMode.value === 'new'
    || !storedReminder?.stageVideoId
    || storedReminder.stageVideoId !== normalized.stageVideoId
    || storedReminder.scheduleSource !== normalized.scheduleSource
  const canBeEnabled = Boolean(
    normalized.stageVideoId
    && (
      (normalized.scheduleSource ?? 'manual') === 'manual'
      || (calendarStatus.value.connected && normalized.googleCalendar?.calendarId)
    ),
  )
  const reminder: Reminder = {
    ...normalized,
    enabled: Boolean(canBeEnabled && (shouldUseEditorEnabled ? normalized.enabled : storedReminder?.enabled)),
  }
  const nextErrors = validateReminder(reminder)
  fieldErrors.value = nextErrors
  if (Object.keys(nextErrors).length > 0) {
    setError('저장할 수 없는 항목을 확인하세요.')
    return
  }

  const successMessage = reminder.stageVideoId ? '저장했습니다.' : '저장했습니다. 영상 연결 후 리스트에서 활성화할 수 있습니다.'
  const next = await run(() => window.stageApi.updateReminder(reminder), { success: successMessage })
  if (!next) {
    return
  }

  state.value = next
  const saved = next.reminders.find(item => item.id === reminder.id)
  if (saved) {
    selectedReminderId.value = saved.id
    setEditor(saved, 'existing')
  }
}

function cancelEditor() {
  if (editorMode.value === 'new') {
    const first = state.value?.reminders[0]
    if (first) {
      selectedReminderId.value = first.id
      setEditor(first, 'existing')
    }
    else {
      editorReminder.value = null
      editorMode.value = null
      selectedReminderId.value = null
    }
    return
  }

  if (selectedReminder.value) {
    setEditor(selectedReminder.value, 'existing')
  }
}

function requestDeleteEditor() {
  if (!editorReminder.value) {
    return
  }

  if (editorMode.value === 'new') {
    cancelEditor()
    return
  }

  const reminderId = editorReminder.value.id
  openConfirm({
    title: '큐를 삭제할까요?',
    message: '삭제하면 이 큐는 목록에서 사라집니다.',
    confirmLabel: '삭제',
    danger: true,
    onConfirm: async () => {
      const next = await run(() => window.stageApi.deleteReminder(reminderId), { success: '큐를 삭제했습니다.' })
      if (!next) {
        return
      }
      state.value = next
      const first = next.reminders[0]
      if (first) {
        selectedReminderId.value = first.id
        setEditor(first, 'existing')
      }
      else {
        editorReminder.value = null
        editorMode.value = null
        selectedReminderId.value = null
      }
    },
  })
}

async function previewSelectedReminder() {
  if (!editorReminder.value || editorMode.value !== 'existing' || isEditorDirty.value || !editorReminder.value.stageVideoId) {
    return
  }
  await run(() => window.stageApi.previewReminder(editorReminder.value!.id))
}

async function openStagePlacementEditor() {
  await run(() => window.stageApi.openStagePlacementEditor(editorReminder.value?.stageVideoId), { success: '화면에서 스테이지를 조정하세요.' })
  const loaded = await window.stageApi.getState()
  state.value = loaded
}

async function updateStageSettings(settings: StageSettings) {
  const next = await run(() => window.stageApi.updateStageSettings(toPlainStageSettings(settings)))
  if (next) {
    state.value = next
  }
}

async function patchStageSettings(patch: Partial<StageSettings>) {
  if (!state.value) {
    return
  }
  await updateStageSettings({ ...toPlainStageSettings(state.value.stageSettings), ...patch })
}

onMounted(() => {
  removeSelectReminderListener = window.stageApi.onSelectReminder(requestReminderSelection)
  removeStateChangedListener = window.stageApi.onStateChanged(applyExternalStateChanged)
  void loadState()
  void loadMcpStatus()
  void loadCalendarStatus().then(loadGoogleCalendars)
})

watch(editorVideoPreviewKey, videoId => {
  void loadEditorVideoUrl(videoId || undefined)
}, { immediate: true })

watch(
  () => [activeTab.value, state.value?.videos.map(video => `${video.id}:${video.sha256}:${video.importedAt}:${video.lastError?.message ?? ''}`).join('|') ?? ''] as const,
  () => {
    void loadLibraryVideoUrls()
  },
  { immediate: true },
)

watch(activeTab, tab => {
  if (tab === 'settings') {
    void loadMcpStatus()
    void loadCalendarStatus().then(loadGoogleCalendars)
  }
})

watch(googleCalendars, calendars => {
  const reminder = editorReminder.value
  if (!reminder || (reminder.scheduleSource ?? 'manual') !== 'google_calendar' || reminder.googleCalendar?.calendarId || calendars.length === 0) {
    return
  }
  const primary = sortedGoogleCalendars.value[0]
  updateEditor({
    googleCalendar: {
      calendarId: primary.id,
      calendarName: primary.summary,
      offsetMinutes: 10,
      excludeAllDay: true,
    },
  })
})

onUnmounted(() => {
  removeSelectReminderListener?.()
  removeSelectReminderListener = null
  removeStateChangedListener?.()
  removeStateChangedListener = null
  clearToastTimer()
})
</script>

<template>
  <main class="settings-shell">
    <aside class="sidebar">
      <div class="brand">
        <img :src="appIconUrl" alt="" class="brand-icon">
      </div>

      <nav class="nav-list" aria-label="설정 메뉴">
        <button :class="{ active: activeTab === 'reminders' }" @click="activeTab = 'reminders'">
          <span class="nav-icon">⏱</span>
          <span>큐 시트</span>
          <small>{{ state?.reminders.length ?? 0 }}</small>
        </button>
        <button :class="{ active: activeTab === 'videos' }" @click="activeTab = 'videos'">
          <span class="nav-icon">▣</span>
          <span>영상 보관함</span>
          <small>{{ state?.videos.length ?? 0 }}</small>
        </button>
        <button :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
          <span class="nav-icon">⚙</span>
          <span>설정</span>
        </button>
      </nav>

    </aside>

    <section class="content">
      <header class="content-header">
        <div>
          <h1 v-if="activeTab === 'reminders'">큐 시트</h1>
          <h1 v-else-if="activeTab === 'videos'">영상 보관함</h1>
          <h1 v-else>설정</h1>
        </div>

        <div class="header-actions">
          <button v-if="activeTab === 'reminders'" class="primary-button" :disabled="busy" @click="startCreateReminder">
            + 큐 추가
          </button>
          <button v-if="activeTab === 'videos'" class="primary-button" :disabled="busy" @click="importVideo">
            + 영상 추가
          </button>
        </div>
      </header>

      <div v-if="notice || error" class="toast-layer" aria-live="polite" aria-atomic="true">
        <div class="toast" :class="{ success: notice, error: error }">
          <span>{{ notice || error }}</span>
          <button type="button" aria-label="메시지 닫기" @click="dismissToast">×</button>
        </div>
      </div>

      <div v-if="onboardingOpen" class="onboarding-backdrop">
        <section class="onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <button type="button" class="icon-button onboarding-close" aria-label="도움말 닫기" @click="dismissOnboarding">×</button>
          <div class="onboarding-shot">
            <img :src="currentOnboardingSlide.imageUrl" :alt="currentOnboardingSlide.imageAlt">
          </div>
          <div class="onboarding-copy">
            <span class="onboarding-kicker">{{ currentOnboardingSlide.eyebrow }} · {{ onboardingStep + 1 }} / {{ onboardingSlides.length }}</span>
            <h2 id="onboarding-title">{{ currentOnboardingSlide.title }}</h2>
            <p>{{ currentOnboardingSlide.body }}</p>
          </div>

          <footer class="onboarding-controls">
            <button type="button" class="icon-button" :disabled="onboardingStep === 0" aria-label="이전" @click="previousOnboarding">‹</button>
            <div class="onboarding-dots" aria-label="도움말 단계">
              <button
                v-for="(_slide, index) in onboardingSlides"
                :key="index"
                type="button"
                :class="{ active: index === onboardingStep }"
                :aria-label="`${index + 1}단계 보기`"
                @click="onboardingStep = index"
              />
            </div>
            <button v-if="!isLastOnboardingStep" type="button" class="icon-button" aria-label="다음" @click="nextOnboarding">›</button>
            <button v-else type="button" class="primary-button onboarding-done" @click="dismissOnboarding">시작하기</button>
          </footer>
        </section>
      </div>

      <div v-if="!state" class="loading-state">설정을 불러오는 중입니다.</div>

      <template v-else>
        <section v-if="activeTab === 'videos'" class="view-stack">
          <div v-if="state.videos.length === 0" class="empty-state page-empty-state">
            <strong>아직 영상이 없습니다.</strong>
            <span>영상 보관함에 추가한 영상은 큐와 연결해 화면에 표시할 수 있습니다.</span>
          </div>

          <div v-else class="video-grid">
            <article v-for="video in state.videos" :key="video.id" class="video-item">
              <div class="video-thumbnail" :class="{ transparent: video.extension === 'webm' }">
                <video
                  v-if="libraryVideoUrls[video.id] && !libraryThumbnailFailures[video.id]"
                  :src="libraryVideoUrls[video.id]"
                  muted
                  playsinline
                  preload="metadata"
                  @loadedmetadata="prepareLibraryThumbnail"
                  @error="markLibraryThumbnailFailed(video.id)"
                />
                <span v-else class="video-mark">{{ video.extension.toUpperCase() }}</span>
              </div>
              <div class="video-info">
                <strong :title="video.originalName">{{ video.originalName }}</strong>
                <span>{{ formatBytes(video.sizeBytes) }} · {{ video.extension }}</span>
                <small v-if="video.lastError">오류: {{ video.lastError.message }}</small>
              </div>
              <div class="row-actions">
                <button class="ghost-button" @click="previewVideo(video.id)">미리보기</button>
                <button class="icon-button danger" aria-label="영상 삭제" @click="deleteVideo(video.id)">×</button>
              </div>
            </article>
          </div>
        </section>

        <section v-if="activeTab === 'reminders'" class="queue-view">
          <div v-if="state.reminders.length === 0 && !editorReminder" class="empty-state page-empty-state">
            <strong>큐 시트가 비어 있습니다.</strong>
            <span>표시할 큐를 추가하면 이곳에 정리됩니다.</span>
          </div>

          <div v-else class="reminder-layout">
            <div class="reminder-list">
              <div class="queue-list-tools">
                <input
                  v-model="queueSearchQuery"
                  type="search"
                  placeholder="큐 검색"
                  aria-label="큐 검색"
                >
              </div>

              <div v-if="visibleQueueReminders.length === 0" class="queue-list-empty">
                일치하는 큐가 없습니다.
              </div>

              <article
                v-for="reminder in visibleQueueReminders"
                :key="reminder.id"
                class="reminder-row"
                :class="{ active: selectedReminderId === reminder.id, draft: isDraftReminder(reminder) }"
              >
                <button type="button" class="reminder-row-select" @click="selectQueueReminder(reminder)">
                  <span class="reminder-row-main">
                    <strong>{{ queueRowTitle(reminder) }}</strong>
                    <small>{{ reminderScheduleSummary(reminder) }}</small>
                  </span>
                </button>

                <div class="list-activation">
                  <span v-if="isDraftReminder(reminder)" class="draft-badge">초안</span>
                  <button
                    v-else
                    type="button"
                    class="list-switch-button"
                    :class="{ on: reminder.enabled && canReminderUseListToggle(reminder) }"
                    :disabled="busy || !canReminderUseListToggle(reminder)"
                    :aria-label="reminder.enabled ? '큐 끄기' : '큐 켜기'"
                    @click="toggleReminderEnabled(reminder)"
                  >
                    <span />
                  </button>
                </div>
              </article>
            </div>

            <form v-if="editorReminder" class="reminder-editor" @submit.prevent="saveEditor">
              <div class="editor-topline">
                <input
                  class="event-title-input"
                  placeholder="무엇을 떠올릴까요?"
                  :value="editorReminder.title"
                  @input="updateEditor({ title: ($event.target as HTMLInputElement).value })"
                >
              </div>

              <div class="editor-sections">
                <section class="editor-section-block">
                  <h2>큐 타이밍</h2>
                  <div class="field-stack">
                  <div class="control-field schedule-source-field">
                    <span>호출 기준</span>
                    <div class="schedule-source-row" aria-label="호출 기준">
                      <button
                        v-for="source in scheduleSourceOptions"
                        :key="source.value"
                        type="button"
                        class="time-mode-button"
                        :class="{ selected: (editorReminder.scheduleSource ?? 'manual') === source.value }"
                        @click="setEditorScheduleSource(source.value)"
                      >
                        {{ source.label }}
                      </button>
                    </div>
                  </div>

                  <div v-if="(editorReminder.scheduleSource ?? 'manual') === 'manual'" class="schedule-fields">
                    <div class="schedule-row single">
                      <label class="control-field date-field">
                        <span>시작일</span>
                        <input
                          type="date"
                          aria-label="시작일"
                          :value="editorReminder.startDate"
                          @input="updateEditor({ startDate: ($event.target as HTMLInputElement).value })"
                        >
                      </label>
                    </div>

                    <div class="schedule-row single">
                      <label class="control-field repeat-field">
                        <span>반복</span>
                        <select
                          :value="editorReminder.repeatType"
                          aria-label="반복"
                          @change="setEditorRepeatType(($event.target as HTMLSelectElement).value as ReminderRepeatType)"
                        >
                          <option v-for="repeatType in recurrenceRepeatOptions" :key="repeatType" :value="repeatType">
                            {{ repeatLabels[repeatType] }}
                          </option>
                        </select>
                      </label>
                    </div>

                    <div v-if="editorReminder.repeatType === 'custom'" class="weekday-row compact">
                      <button
                        v-for="day in weekdays"
                        :key="day"
                        type="button"
                        class="weekday-button"
                        :class="{ selected: editorReminder.weekdays.includes(day) }"
                        @click="toggleEditorWeekday(day)"
                      >
                        {{ weekdayLabels[day] }}
                      </button>
                    </div>

                    <div v-if="editorReminder.repeatType !== 'once'" class="schedule-row single">
                      <div class="control-field repeat-end-field">
                        <span>반복 종료</span>
                        <div class="repeat-end-controls">
                          <select
                            :value="editorEndDateEnabled ? 'date' : 'none'"
                            aria-label="반복 종료"
                            @change="setEditorEndDateEnabled(($event.target as HTMLSelectElement).value === 'date')"
                          >
                            <option value="none">종료일 없음</option>
                            <option value="date">종료일 선택</option>
                          </select>
                          <input
                            v-if="editorEndDateEnabled"
                            type="date"
                            aria-label="종료일"
                            :value="editorReminder.endDate ?? editorReminder.startDate"
                            @input="updateEditor({ endDate: (($event.target as HTMLInputElement).value || undefined) })"
                          >
                        </div>
                      </div>
                    </div>

                    <div class="control-field trigger-type-field">
                      <span>호출 조건</span>
                      <div class="time-mode-row" aria-label="호출 조건">
                        <button
                          v-for="timeMode in timeModeOptions"
                          :key="timeMode"
                          type="button"
                          class="time-mode-button"
                          :class="{ selected: editorReminder.triggerType === timeMode }"
                          @click="setEditorTimeMode(timeMode)"
                        >
                          {{ timeModeLabels[timeMode] }}
                        </button>
                      </div>
                    </div>

                    <div class="schedule-row single">
                      <label v-if="editorReminder.triggerType === 'interval'" class="control-field interval-field">
                        <select
                          :value="normalizeIntervalMinutes(editorReminder.intervalMinutes)"
                          aria-label="반복 간격"
                          @change="updateEditor({ intervalMinutes: Number(($event.target as HTMLSelectElement).value) })"
                        >
                          <option v-for="minute in intervalMinuteOptions" :key="minute" :value="minute">매 {{ minute }}분</option>
                        </select>
                      </label>

                      <label v-else class="control-field time-field">
                        <div class="time-selects">
                          <select :value="editorReminder.localTime.hour" aria-label="시" @change="updateEditorTime({ hour: Number(($event.target as HTMLSelectElement).value) })">
                            <option v-for="hour in hourOptions" :key="hour" :value="hour">{{ formatTwoDigits(hour) }}시</option>
                          </select>
                          <select :value="editorReminder.localTime.minute" aria-label="분" @change="updateEditorTime({ minute: Number(($event.target as HTMLSelectElement).value) })">
                            <option v-for="minute in minuteOptions" :key="minute" :value="minute">{{ formatTwoDigits(minute) }}분</option>
                          </select>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div v-else class="calendar-fields">
                    <div v-if="!calendarStatus.connected" class="calendar-callout">
                      <span>{{ calendarStatus.error || '설정에서 Google Calendar를 연결하세요.' }}</span>
                      <button type="button" class="ghost-button small" @click="activeTab = 'settings'">설정 열기</button>
                    </div>

                    <div class="control-field calendar-picker-field">
                      <span>캘린더</span>

                      <div class="calendar-selected-row" :class="{ empty: !selectedEditorGoogleCalendar }">
                        <span class="calendar-selected-copy">
                          <strong>{{ selectedEditorGoogleCalendar?.summary ?? '캘린더 선택 필요' }}</strong>
                          <small v-if="selectedEditorGoogleCalendar">
                            {{ selectedEditorGoogleCalendar.id }}
                            <em v-if="selectedEditorGoogleCalendar.primary">기본</em>
                          </small>
                          <small v-else>사용할 캘린더를 선택하세요.</small>
                        </span>
                        <button
                          type="button"
                          class="ghost-button small"
                          :disabled="!calendarStatus.connected"
                          @click="calendarPickerOpen ? closeCalendarPicker() : openCalendarPicker()"
                        >
                          {{ calendarPickerOpen ? '닫기' : selectedEditorGoogleCalendar ? '변경' : '선택' }}
                        </button>
                      </div>

                      <div v-if="calendarPickerOpen" class="calendar-picker-panel">
                        <input
                          v-model="calendarSearchQuery"
                          type="search"
                          placeholder="캘린더 검색"
                          aria-label="캘린더 검색"
                        >

                        <div
                          class="calendar-listbox"
                          role="listbox"
                          aria-label="캘린더 목록"
                        >
                          <button
                            v-for="calendar in filteredGoogleCalendars"
                            :key="calendar.id"
                            type="button"
                            class="calendar-option"
                            :class="{ selected: editorReminder.googleCalendar?.calendarId === calendar.id }"
                            role="option"
                            :aria-selected="editorReminder.googleCalendar?.calendarId === calendar.id"
                            @click="setEditorGoogleCalendar(calendar.id)"
                          >
                            <span class="calendar-option-marker" aria-hidden="true">
                              {{ editorReminder.googleCalendar?.calendarId === calendar.id ? '●' : '○' }}
                            </span>
                            <span class="calendar-option-text">
                              <span class="calendar-option-title">
                                {{ calendar.summary }}
                                <small v-if="calendar.primary">기본</small>
                              </span>
                              <span class="calendar-option-id">{{ calendar.id }}</span>
                            </span>
                          </button>

                          <div v-if="filteredGoogleCalendars.length === 0" class="calendar-empty-row">
                            일치하는 캘린더가 없습니다.
                          </div>
                        </div>
                      </div>
                    </div>

                    <label class="control-field calendar-offset-field">
                      <span>호출 조건</span>
                      <select
                        :value="editorReminder.googleCalendar?.offsetMinutes ?? 10"
                        :disabled="!calendarStatus.connected"
                        @change="updateEditorGoogleCalendar({ offsetMinutes: Number(($event.target as HTMLSelectElement).value) as GoogleCalendarOffsetMinutes })"
                      >
                        <option v-for="offset in googleCalendarOffsetMinuteOptions" :key="offset" :value="offset">
                          {{ calendarOffsetLabel(offset) }}
                        </option>
                      </select>
                    </label>

                    <label class="single-toggle compact-toggle">
                      <input
                        type="checkbox"
                        :checked="editorReminder.googleCalendar?.excludeAllDay !== false"
                        :disabled="!calendarStatus.connected"
                        @change="updateEditorGoogleCalendar({ excludeAllDay: ($event.target as HTMLInputElement).checked })"
                      >
                      종일 일정 제외
                    </label>
                  </div>
                  <small v-if="fieldErrors.dateRange" class="field-error">{{ fieldErrors.dateRange }}</small>
                  <small v-if="fieldErrors.weekdays" class="field-error">{{ fieldErrors.weekdays }}</small>
                  <small v-if="fieldErrors.calendar" class="field-error">{{ fieldErrors.calendar }}</small>
                  </div>
                </section>

                <section class="editor-section-block">
                  <h2>큐 소스</h2>
                  <div class="field-stack">
                  <div
                    v-if="editorVideo && editorVideoUrl"
                    class="inline-video-preview"
                    :class="{ transparent: editorVideo.extension === 'webm' }"
                    :style="inlinePreviewStyle"
                  >
                    <div v-if="inlinePreviewBubbleText" class="inline-preview-bubble">
                      {{ inlinePreviewBubbleText }}
                    </div>
                    <div class="inline-video-preview-fit">
                      <video
                        :key="editorVideoUrl"
                        :src="editorVideoUrl"
                        autoplay
                        loop
                        muted
                        playsinline
                        preload="metadata"
                        @loadedmetadata="handleInlinePreviewMetadata"
                      />
                    </div>
                  </div>
                  <label class="control-field video-source-field">
                    <span>소스 영상</span>
                    <select class="video-select" :value="editorReminder.stageVideoId ?? ''" @change="setEditorVideo(($event.target as HTMLSelectElement).value)">
                      <option value="">영상 선택 필요</option>
                      <option v-for="video in state.videos" :key="video.id" :value="video.id">
                        {{ videoLabel(video) }}
                      </option>
                    </select>
                  </label>
                  <small v-if="!editorVideo" class="field-error">{{ fieldErrors.video ?? '영상 선택 필요' }}</small>
                  <div class="stage-placement-field-action">
                    <span>영상이 보일 위치</span>
                    <button type="button" class="ghost-button" :disabled="busy" @click="openStagePlacementEditor">
                      화면에서 조정
                    </button>
                  </div>
                  </div>
                </section>

                <section class="editor-section-block">
                  <h2>표시 설정</h2>
                  <div class="field-stack">
                  <label v-if="(editorReminder.scheduleSource ?? 'manual') === 'google_calendar'" class="control-field bubble-mode-field">
                    <span>말풍선 설정</span>
                    <select
                      :value="editorReminder.bubbleMode ?? 'event_title'"
                      @change="setEditorBubbleMode(($event.target as HTMLSelectElement).value as ReminderBubbleMode)"
                    >
                      <option v-for="mode in bubbleModeOptions" :key="mode.value" :value="mode.value">
                        {{ mode.label }}
                      </option>
                    </select>
                  </label>

                  <label
                    v-if="(editorReminder.scheduleSource ?? 'manual') === 'manual' || editorReminder.bubbleMode === 'custom'"
                    class="control-field bubble-field"
                  >
                    <span>말풍선 설정</span>
                    <textarea
                      rows="2"
                      maxlength="140"
                      placeholder="말풍선"
                      :value="editorReminder.bubbleText ?? ''"
                      @input="updateEditor({ bubbleText: (($event.target as HTMLTextAreaElement).value || undefined) })"
                    />
                  </label>
                  <div class="playback-checkbox-row">
                    <label>
                      <input type="checkbox" :checked="editorReminder.loop" @change="updateEditor({ loop: ($event.target as HTMLInputElement).checked })">
                      반복 재생
                    </label>
                    <label>
                      <input type="checkbox" :checked="editorReminder.audioEnabled" @change="updateEditor({ audioEnabled: ($event.target as HTMLInputElement).checked })">
                      소리 재생
                    </label>
                  </div>
                  </div>
                </section>
              </div>

              <div class="intent-summary">
                <span>요약</span>
                <strong>{{ editorCueIntentSummary }}</strong>
              </div>

              <footer class="event-editor-footer">
                <button type="button" class="ghost-button danger" @click="requestDeleteEditor">
                {{ editorMode === 'new' ? '취소' : '삭제' }}
                </button>
                <div class="footer-actions">
                  <button type="button" class="ghost-button" :disabled="editorMode !== 'existing' || isEditorDirty || !editorReminder.stageVideoId" @click="previewSelectedReminder">미리보기</button>
                  <button type="submit" class="primary-button" :disabled="busy">저장</button>
                </div>
              </footer>
            </form>
          </div>
        </section>

        <section v-if="activeTab === 'settings'" class="settings-view view-stack">
          <div class="settings-panel compact-settings-panel">
            <label class="single-toggle">
              <input
                type="checkbox"
                :checked="state.stageSettings.launchAtLogin"
                @change="patchStageSettings({ launchAtLogin: ($event.target as HTMLInputElement).checked })"
              >
              로그인할 때 자동 실행
            </label>
            <div class="version-row">
              <span>버전</span>
              <strong>{{ appVersion }}</strong>
            </div>
            <div class="version-row">
              <span>도움말</span>
              <button type="button" class="ghost-button small" @click="openOnboarding">다시 보기</button>
            </div>
          </div>

          <div class="settings-panel mcp-panel">
            <div class="settings-panel-header">
              <div>
                <h2>Google Calendar</h2>
                <p>캘린더 일정 시작 전에 큐를 표시합니다.</p>
              </div>
              <span class="status-pill" :class="{ active: calendarStatus.connected }">
                {{ calendarStatus.connected ? '연결됨' : '연결 안 됨' }}
              </span>
            </div>

            <div class="mcp-detail-list">
              <div class="mcp-detail-row">
                <span>계정</span>
                <strong>{{ calendarStatus.accountLabel || '-' }}</strong>
              </div>
              <div v-if="calendarStatus.error" class="mcp-detail-row">
                <span>상태</span>
                <strong class="field-error">{{ calendarStatus.error }}</strong>
              </div>
            </div>

            <div class="settings-action-row">
              <button
                v-if="!calendarStatus.connected"
                type="button"
                class="primary-button"
                :disabled="calendarConnecting || !calendarStatus.configured"
                @click="connectGoogleCalendar"
              >
                {{ calendarConnecting ? '여는 중' : '연결' }}
              </button>
              <button
                v-else
                type="button"
                class="ghost-button danger"
                :disabled="busy"
                @click="disconnectGoogleCalendar"
              >
                해제
              </button>
              <button type="button" class="ghost-button" :disabled="busy" @click="loadCalendarStatus().then(loadGoogleCalendars)">
                새로고침
              </button>
            </div>
          </div>

          <div class="settings-panel mcp-panel">
            <div class="settings-panel-header">
              <div>
                <h2>MCP 연결</h2>
                <p>Yobu를 AI에서 제어할 수 있는 로컬 연결입니다.</p>
              </div>
              <span class="status-pill" :class="{ active: mcpStatus.running }">
                {{ mcpStatus.running ? '실행 중' : '중지됨' }}
              </span>
            </div>

            <div class="mcp-detail-list">
              <div class="mcp-detail-row">
                <span>주소</span>
                <div class="inline-copy">
                  <code>{{ mcpUrl }}</code>
                  <button type="button" class="ghost-button small" @click="copyText(mcpUrl)">복사</button>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-panel mcp-panel">
            <div class="settings-panel-header">
              <div>
                <h2>AI 연결</h2>
                <p>Yobu가 실행 중일 때 아래 설정으로 MCP 도구를 사용할 수 있습니다.</p>
              </div>
              <button type="button" class="ghost-button small" @click="loadMcpStatus">새로고침</button>
            </div>

            <div class="mcp-install-stack">
              <section class="mcp-install-card">
                <header>
                  <h3>Claude Code</h3>
                  <button type="button" class="ghost-button small" @click="copyText(claudeCodeCommand)">복사</button>
                </header>
                <pre><code>{{ claudeCodeCommand }}</code></pre>
              </section>

              <section class="mcp-install-card">
                <header>
                  <h3>Claude Desktop</h3>
                  <button type="button" class="ghost-button small" @click="copyText(claudeDesktopConfig)">복사</button>
                </header>
                <p>설정 파일에 추가한 뒤 Claude Desktop을 재시작합니다.</p>
                <code class="path-code">~/Library/Application Support/Claude/claude_desktop_config.json</code>
                <pre><code>{{ claudeDesktopConfig }}</code></pre>
              </section>

              <section class="mcp-install-card">
                <header>
                  <h3>Codex</h3>
                  <button type="button" class="ghost-button small" @click="copyText(codexCommand)">명령 복사</button>
                </header>
                <pre><code>{{ codexCommand }}</code></pre>
                <p>또는 설정 파일에 직접 추가합니다.</p>
                <div class="code-header">
                  <code class="path-code">~/.codex/config.toml</code>
                  <button type="button" class="ghost-button small" @click="copyText(codexConfig)">설정 복사</button>
                </div>
                <pre><code>{{ codexConfig }}</code></pre>
              </section>
            </div>
          </div>

        </section>
      </template>
    </section>

    <div v-if="confirmDialog" class="confirm-backdrop">
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <h2>{{ confirmDialog.title }}</h2>
        <p>{{ confirmDialog.message }}</p>
        <footer>
          <button type="button" class="ghost-button" @click="confirmDialog = null">계속 편집</button>
          <button type="button" class="primary-button" :class="{ danger: confirmDialog.danger }" @click="confirmCurrentDialog">
            {{ confirmDialog.confirmLabel }}
          </button>
        </footer>
      </section>
    </div>
  </main>
</template>
