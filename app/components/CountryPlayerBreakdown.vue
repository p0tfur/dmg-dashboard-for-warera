<script setup lang="ts">
import { computed } from 'vue'
import { formatDamage, formatFull, flagEmoji } from '~/utils/format'
import type { PlayerRow } from '~~/shared/types/warera'

const props = defineProps<{
  country: {
    id: string
    name: string
    meta?: Record<string, string | number | null> | null
  }
  players: PlayerRow[]
}>()

const totalDamage = computed(() => props.players.reduce((sum, player) => sum + player.damage, 0))
const maxDamage = computed(() => props.players.reduce((sum, player) => Math.max(sum, player.damage), 0) || 1)
</script>

<template>
  <div class="px-4 py-4 border-t border-white/5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
          Country Breakdown
        </p>
        <h4 class="mt-1 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <span class="text-base leading-none">{{ flagEmoji((country.meta?.code as string) ?? null) }}</span>
          <span class="truncate">{{ country.name }}</span>
        </h4>
        <p class="mt-1 text-xs text-zinc-500">
          Which Justice players contributed damage for this country.
        </p>
      </div>

      <div class="text-right">
        <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">Total</p>
        <p class="mt-1 data-mono text-lg font-bold text-just-glow">{{ formatFull(totalDamage) }}</p>
      </div>
    </div>

    <div class="mt-4 space-y-2">
      <div
        v-for="player in players"
        :key="player.id"
        class="grid grid-cols-[minmax(0,1fr),72px,56px] items-center gap-3 rounded-sm bg-white/[0.02] px-3 py-2"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-zinc-100">{{ player.name }}</p>
          <p class="text-[10px] text-zinc-500">
            {{ player.help ?? 0 }} help
          </p>
        </div>
        <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            class="h-full rounded-full bg-just transition-all duration-500"
            :style="{ width: Math.max(4, (player.damage / maxDamage) * 100) + '%' }"
          />
        </div>
        <div class="text-right">
          <p class="data-mono text-sm font-semibold text-zinc-100" :title="formatFull(player.damage)">
            {{ formatDamage(player.damage) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
