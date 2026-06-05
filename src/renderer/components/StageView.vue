<script setup lang="ts">
import type { StagePayload } from '../../shared/types'

import { computed, onMounted, onUnmounted, ref } from 'vue'

const payload = ref<StagePayload | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)
const isReady = ref(false)
const isMoving = ref(false)
const isResizing = ref(false)
const movePointerId = ref<number | null>(null)
const resizePointerId = ref<number | null>(null)

const hasBubble = computed(() => Boolean(payload.value?.bubbleText?.trim()))
const isPlacementMode = computed(() => payload.value?.mode === 'placement')
const hasStageVideo = computed(() => Boolean(payload.value?.videoUrl))
const shouldShowStageControls = computed(() => payload.value?.mode !== 'due')
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null

function clearAutoCloseTimer() {
  if (!autoCloseTimer) {
    return
  }
  clearTimeout(autoCloseTimer)
  autoCloseTimer = null
}

async function loadPayload() {
  payload.value = await window.stageApi.getStagePayload()
  isReady.value = !payload.value?.videoUrl
}

async function closeStage() {
  clearAutoCloseTimer()
  await window.stageApi.closeStage()
}

async function handleEnded() {
  if (!payload.value) {
    return
  }

  if ((payload.value.mode === 'due' || payload.value.closeAfterVideoDuration) && !payload.value.loop) {
    await closeStage()
  }
}

function handleLoadedMetadata() {
  const video = videoRef.value
  if (payload.value?.videoUrl && video?.videoWidth && video.videoHeight) {
    void window.stageApi.setStageVideoMetrics({
      width: video.videoWidth,
      height: video.videoHeight,
    })
  }

  isReady.value = true

  clearAutoCloseTimer()
  if (payload.value?.closeAfterVideoDuration && video && Number.isFinite(video.duration) && video.duration > 0) {
    autoCloseTimer = setTimeout(() => {
      void closeStage()
    }, Math.ceil(video.duration * 1000))
  }

  void video?.play().catch(() => {})
}

function resizePoint(event: PointerEvent) {
  return {
    screenX: event.screenX,
    screenY: event.screenY,
  }
}

function handleMoveMove(event: PointerEvent) {
  if (!isMoving.value || event.pointerId !== movePointerId.value) {
    return
  }

  event.preventDefault()
  void window.stageApi.updateStageMove(resizePoint(event))
}

async function finishMove(event?: PointerEvent) {
  if (!isMoving.value || (event && event.pointerId !== movePointerId.value)) {
    return
  }

  event?.preventDefault()
  isMoving.value = false
  movePointerId.value = null
  window.removeEventListener('pointermove', handleMoveMove)
  window.removeEventListener('pointerup', finishMove)
  window.removeEventListener('pointercancel', finishMove)
  await window.stageApi.endStageMove()
}

function startMove(event: PointerEvent) {
  if (isResizing.value) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  isMoving.value = true
  movePointerId.value = event.pointerId

  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleMoveMove)
  window.addEventListener('pointerup', finishMove)
  window.addEventListener('pointercancel', finishMove)
  void window.stageApi.beginStageMove(resizePoint(event))
}

function startPlacementMove(event: PointerEvent) {
  if (!isPlacementMode.value) {
    return
  }
  startMove(event)
}

function handleResizeMove(event: PointerEvent) {
  if (!isResizing.value || event.pointerId !== resizePointerId.value) {
    return
  }

  event.preventDefault()
  void window.stageApi.updateStageResize(resizePoint(event))
}

async function finishResize(event?: PointerEvent) {
  if (!isResizing.value || (event && event.pointerId !== resizePointerId.value)) {
    return
  }

  event?.preventDefault()
  isResizing.value = false
  resizePointerId.value = null
  window.removeEventListener('pointermove', handleResizeMove)
  window.removeEventListener('pointerup', finishResize)
  window.removeEventListener('pointercancel', finishResize)
  await window.stageApi.endStageResize()
}

function startResize(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
  isResizing.value = true
  resizePointerId.value = event.pointerId

  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handleResizeMove)
  window.addEventListener('pointerup', finishResize)
  window.addEventListener('pointercancel', finishResize)
  void window.stageApi.beginStageResize(resizePoint(event))
}

onMounted(async () => {
  document.documentElement.classList.add('stage-route')
  await loadPayload()
  void window.stageApi.setStageInputPassthrough(false)
})

onUnmounted(() => {
  document.documentElement.classList.remove('stage-route')
  clearAutoCloseTimer()
  void finishMove()
  void finishResize()
})
</script>

<template>
  <main
    class="stage-root"
    :class="{ transparent: payload?.transparent, framed: payload && !payload.transparent, 'placement-adjusting': isPlacementMode }"
  >
    <template v-if="payload">
      <div v-if="hasBubble" class="stage-bubble">
        {{ payload.bubbleText }}
      </div>

      <button
        data-stage-control
        class="stage-close"
        :class="{ done: isPlacementMode }"
        :aria-label="isPlacementMode ? '스테이지 조정 완료' : '스테이지 닫기'"
        @click="closeStage"
      >
        {{ isPlacementMode ? '완료' : '×' }}
      </button>
      <div
        v-if="shouldShowStageControls"
        data-stage-control
        class="stage-drag-handle"
        :class="{ placement: isPlacementMode }"
        aria-label="스테이지 이동"
        @pointerdown="startMove"
      />
      <button
        v-if="shouldShowStageControls"
        type="button"
        data-stage-control
        class="stage-resize-handle"
        :class="{ placement: isPlacementMode }"
        aria-label="스테이지 크기 조절"
        @pointerdown="startResize"
        @click.prevent.stop
      />

      <section
        v-if="hasStageVideo"
        class="stage-video-shell"
        :class="{ frame: !payload.transparent }"
        @pointerdown="startPlacementMove"
      >
        <video
          ref="videoRef"
          class="stage-video"
          :src="payload.videoUrl"
          :loop="payload.loop"
          :muted="!payload.audioEnabled"
          autoplay
          playsinline
          @loadedmetadata="handleLoadedMetadata"
          @ended="handleEnded"
        />
      </section>

      <section v-else-if="isPlacementMode" class="stage-placement-guide" @pointerdown="startPlacementMove">
        <div class="stage-placement-guide-box">
          <strong>스테이지</strong>
          <span>{{ Math.round(payload.sizeRatio * 100) }}%</span>
        </div>
      </section>

      <div v-if="!isReady" class="stage-loading">스테이지 준비 중</div>
    </template>

    <div v-else class="stage-loading">스테이지 정보를 불러오는 중</div>
  </main>
</template>
