<script setup lang="ts">
import { ref, watch, computed, type Component } from 'vue'
import { formatDamage } from '~/utils/format'

const props = withDefaults(
  defineProps<{
    label: string
    value: number | null | undefined
    icon?: Component
    accent?: 'fed' | 'just'
    suffix?: string
    loading?: boolean
  }>(),
  { accent: 'fed', loading: false },
)

// count-up animation (client-side only — rAF doesn't exist in SSR)
const display = ref(props.value ?? 0)
let raf = 0
function animate(to: number) {
  if (!import.meta.client) {
    display.value = to
    return
  }
  cancelAnimationFrame(raf)
  const from = display.value
  const start = performance.now()
  const dur = 700
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / dur)
    const eased = 1 - Math.pow(1 - t, 3)
    display.value = from + (to - from) * eased
    if (t < 1) raf = requestAnimationFrame(step)
    else display.value = to
  }
  raf = requestAnimationFrame(step)
}

watch(
  () => props.value,
  (v) => animate(v ?? 0),
  { immediate: true },
)

const accentText = computed(() =>
  props.accent === 'fed' ? 'text-fed-glow' : 'text-just-glow',
)
const accentRing = computed(() =>
  props.accent === 'fed' ? 'shadow-glow-fed' : 'shadow-glow-just',
)
</script>

<template>
  <div class="panel clip-corner-sm px-4 py-3 relative overflow-hidden">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
          {{ label }}
        </div>
        <div v-if="loading" class="skel h-7 w-24 mt-1.5 rounded-sm" />
        <div
          v-else
          class="data-mono text-2xl sm:text-3xl font-bold mt-0.5 leading-none"
          :class="accentText"
        >
          {{ formatDamage(display) }}<span v-if="suffix" class="text-base ml-0.5 opacity-70">{{ suffix }}</span>
        </div>
      </div>
      <div
        v-if="icon"
        class="shrink-0 grid place-items-center h-9 w-9 rounded-sm bg-white/5 border border-white/5"
        :class="accentRing"
      >
        <component :is="icon" class="h-4 w-4" :class="accentText" />
      </div>
    </div>
    <div
      class="absolute -bottom-px left-0 h-px w-full"
      :class="accent === 'fed' ? 'bg-fed/30' : 'bg-just/30'"
    />
  </div>
</template>
