<script setup lang="ts">
import { Radio, RefreshCw, CalendarClock, Zap } from 'lucide-vue-next'
import { PERIOD_LABEL } from '~/utils/format'
import type { Period } from '~~/shared/types/warera'

const props = defineProps<{
  period: Period
  live: boolean
  lastUpdated: string | null
  loading?: boolean
  rateLimit?: { remaining?: number | null; limit?: number | null } | null
  metaOk?: boolean
}>()

const emit = defineEmits<{
  'update:period': [Period]
  'update:live': [boolean]
  refresh: []
}>()

const periods: Period[] = ['week', 'month', 'all']

const rlPct = computed(() => {
  const r = props.rateLimit?.remaining
  const l = props.rateLimit?.limit
  if (r == null || l == null || l === 0) return null
  return Math.round((r / l) * 100)
})
const rlColor = computed(() => {
  const p = rlPct.value
  if (p == null) return 'text-zinc-500'
  if (p > 50) return 'text-live'
  if (p > 20) return 'text-fed'
  return 'text-danger'
})

const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<template>
  <header class="sticky top-0 z-30 backdrop-blur-md bg-base-900/75 border-b border-white/5">
    <div class="mx-auto max-w-[1400px] px-4 sm:px-6">
      <div class="flex items-center gap-3 sm:gap-5 h-16">
        <!-- Logo -->
        <div class="flex items-center gap-2.5 shrink-0">
          <div class="relative grid place-items-center h-9 w-9 clip-corner-sm bg-gradient-to-br from-fed/30 to-just/20 border border-white/10">
            <Zap class="h-4 w-4 text-fed-glow" />
          </div>
          <div class="leading-tight">
            <div class="heading-display text-base sm:text-lg text-zinc-100">
              WarEra<span class="text-fed-glow"> DMG</span>
            </div>
            <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-600 hidden sm:block">
              Command Center
            </div>
          </div>
        </div>

        <div class="flex-1" />

        <!-- Period selector -->
        <div class="hidden md:flex items-center gap-1 p-0.5 rounded-sm bg-base-800/80 border border-white/5">
          <CalendarClock class="h-3.5 w-3.5 text-zinc-600 mr-1 ml-1.5" />
          <button
            v-for="p in periods"
            :key="p"
            class="seg-btn"
            :class="period === p ? 'seg-btn-active-just' : 'text-zinc-500 hover:text-zinc-300'"
            :title="p === 'month' ? 'This month applies only to Justice. The Federation shows All time.' : undefined"
            @click="emit('update:period', p)"
          >
            {{ PERIOD_LABEL[p] }}
            <span v-if="p === 'month'" class="text-[9px] text-zinc-600 ml-0.5">Justice</span>
          </button>
        </div>

        <!-- Live toggle -->
        <button
          class="flex items-center gap-2 px-3 py-1.5 rounded-sm border text-xs font-semibold uppercase tracking-wider transition-colors"
          :class="live
            ? 'border-live/40 bg-live/10 text-live'
            : 'border-white/5 bg-base-800/60 text-zinc-500 hover:text-zinc-300'"
          @click="emit('update:live', !live)"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="live ? 'bg-live animate-pulse-dot' : 'bg-zinc-600'"
          />
          <span class="hidden sm:inline">Live</span>
        </button>

        <!-- Refresh -->
        <button
          class="grid place-items-center h-8 w-8 rounded-sm border border-white/5 bg-base-800/60 text-zinc-400 hover:text-zinc-100 hover:border-white/10 transition-colors"
          :disabled="loading"
          title="Refresh now"
          @click="emit('refresh')"
        >
          <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
        </button>

        <!-- Status -->
        <div class="hidden lg:flex flex-col items-end leading-tight">
          <div class="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Radio class="h-3 w-3" :class="metaOk ? 'text-live' : 'text-danger'" />
            <span class="data-mono">{{ fmtTime(lastUpdated) }}</span>
          </div>
          <div v-if="rlPct != null" class="text-[10px] data-mono" :class="rlColor">
            API {{ rateLimit?.remaining }}/{{ rateLimit?.limit }}
          </div>
        </div>
      </div>

      <!-- Mobile period selector -->
      <div class="md:hidden flex items-center gap-1 p-0.5 rounded-sm bg-base-800/80 border border-white/5 mb-3 overflow-x-auto">
        <CalendarClock class="h-3.5 w-3.5 text-zinc-600 shrink-0 ml-1" />
        <button
          v-for="p in periods"
          :key="p"
          class="seg-btn whitespace-nowrap"
          :class="period === p ? 'seg-btn-active-just' : 'text-zinc-500'"
          :title="p === 'month' ? 'This month applies only to Justice. The Federation shows All time.' : undefined"
          @click="emit('update:period', p)"
        >
          {{ PERIOD_LABEL[p] }}
          <span v-if="p === 'month'" class="text-[9px] text-zinc-600 ml-0.5">Justice</span>
        </button>
      </div>
    </div>
  </header>
</template>
