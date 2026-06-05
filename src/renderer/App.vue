<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import SettingsView from './components/SettingsView.vue'
import StageView from './components/StageView.vue'

const route = ref(window.location.hash)

function handleHashChange() {
  route.value = window.location.hash
}

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange)
})
</script>

<template>
  <StageView v-if="route.startsWith('#/stage')" />
  <SettingsView v-else />
</template>
