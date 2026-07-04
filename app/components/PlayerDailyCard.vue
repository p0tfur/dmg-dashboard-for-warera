<script setup lang="ts">
import { computed } from 'vue'
import { formatDamage, formatFull } from '~/utils/format'
import type { JusticePlayerDailyResponse, PlayerRow } from '~~/shared/types/warera'

const props = withDefaults(
  defineProps<{
    player?: PlayerRow | null
    data?: JusticePlayerDailyResponse | null
    loading?: boolean
    error?: string | null
  }>(),
  {
    player: null,
    data: null,
    loading: false,
    error: null,
  },
)

const days = computed(() => props.data?.days ?? [])
const maxDamage = computed(() => days.value.reduce((max, day) => Math.max(max, day.damage), 0) || 1)
const averageDamage = computed(() =>
  days.value.length ? Math.round((props.data?.totalDamage ?? 0) / days.value.length) : 0,
)

function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
</script>

<template>
  <div class="px-4 py-4 border-t border-white/5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
          Player Breakdown
        </p>
        <h4 class="mt-1 text-sm font-semibold text-zinc-100 truncate">
          {{ player?.name ?? 'Last 7 days' }}
        </h4>
        <p class="text-xs text-zinc-500 mt-1">
          <template v-if="player">
            Daily DMG for the last 7 days{{ player.countryName ? ` · ${player.countryName}` : '' }}
          </template>
          <template v-else>
            Click a player above to view daily DMG.
          </template>
        </p>
      </div>

      <div v-if="data && !loading" class="text-right">
        <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">7D Total</p>
        <p class="mt-1 data-mono text-lg font-bold text-just-glow">{{ formatFull(data.totalDamage) }}</p>
      </div>
    </div>

    <div v-if="loading" class="mt-4 space-y-3">
      <div v-for="i in 7" :key="i" class="grid grid-cols-[92px,1fr,72px] items-center gap-3">
        <div class="skel h-4 w-20 rounded-sm" />
        <div class="skel h-2.5 w-full rounded-full" />
        <div class="skel h-4 w-16 ml-auto rounded-sm" />
      </div>
    </div>

    <p v-else-if="error" class="mt-4 text-sm text-danger">
      Failed to load daily DMG: {{ error }}
    </p>

    <div v-else-if="data" class="mt-4 space-y-3">
      <div
        v-for="day in days"
        :key="day.date"
        class="grid grid-cols-[92px,1fr,72px] items-center gap-3"
      >
        <div class="min-w-0">
          <p class="text-xs text-zinc-300">{{ formatDayLabel(day.date) }}</p>
          <p class="text-[10px] text-zinc-500">{{ day.battles }} battles</p>
        </div>
        <div class="h-2.5 rounded-full bg-white/5 overflow-hidden">
          <div
            class="h-full rounded-full bg-just transition-all duration-500"
            :style="{ width: Math.max(4, (day.damage / maxDamage) * 100) + '%' }"
          />
        </div>
        <div class="text-right">
          <p class="data-mono text-sm font-semibold text-zinc-100">{{ formatDamage(day.damage) }}</p>
        </div>
      </div>

      <p class="pt-1 text-xs text-zinc-500">
        {{ formatDamage(averageDamage) }} avg/day · {{ data.battlesScanned }} battles scanned
      </p>
    </div>
  </div>
</template>
