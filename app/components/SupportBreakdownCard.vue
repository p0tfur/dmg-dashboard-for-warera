<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { formatDamage, formatFull, flagEmoji } from '~/utils/format'
import type { DamageRow, FederationSupportBreakdownResponse } from '~~/shared/types/warera'

const props = defineProps<{
  country: DamageRow
  data: FederationSupportBreakdownResponse | null
  loading?: boolean
  error?: string | null
}>()

const code = computed(() => (props.country.meta?.code as string) ?? null)
const recipients = computed(() => props.data?.recipients ?? [])
const total = computed(() => props.data?.totalSupportDamage ?? 0)
const maxDamage = computed(() => recipients.value.reduce((m, r) => Math.max(m, r.damage), 0) || 1)
</script>

<template>
  <div class="px-4 py-4 border-t border-white/5">
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
          Support recipients
        </p>
        <h4 class="mt-1 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <span class="text-base leading-none">{{ flagEmoji(code) }}</span>
          <span class="truncate">{{ country.name }}</span>
        </h4>
        <p class="mt-1 text-xs text-zinc-500">
          Which allies this country supported, and how much damage it dealt in their battles.
        </p>
      </div>

      <div class="text-right">
        <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">Total support</p>
        <p class="mt-1 data-mono text-lg font-bold text-fed-glow">{{ formatFull(total) }}</p>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="mt-4 flex items-center gap-2 text-zinc-500">
      <Loader2 class="h-4 w-4 animate-spin" />
      <span class="text-xs">Loading recipient breakdown…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="mt-4 text-xs text-danger">
      Failed to load breakdown: {{ error }}
    </div>

    <!-- Empty -->
    <div v-else-if="!recipients.length" class="mt-4 py-4 text-center text-xs text-zinc-600">
      No ally-support damage recorded for this country in this period.
    </div>

    <!-- Recipient list -->
    <div v-else class="mt-4 space-y-2">
      <div
        v-for="r in recipients"
        :key="r.id"
        class="grid grid-cols-[minmax(0,1fr),72px,56px] items-center gap-3 rounded-sm bg-white/[0.02] px-3 py-2"
      >
        <div class="min-w-0 flex items-center gap-2">
          <span class="text-base leading-none shrink-0">{{ flagEmoji(r.code) }}</span>
          <span class="truncate text-sm font-medium text-zinc-100">{{ r.name }}</span>
        </div>
        <div class="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            class="h-full rounded-full bg-fed transition-all duration-500"
            :style="{ width: Math.max(4, (r.damage / maxDamage) * 100) + '%' }"
          />
        </div>
        <div class="text-right">
          <p class="data-mono text-sm font-semibold text-fed-glow" :title="formatFull(r.damage)">
            {{ formatDamage(r.damage) }}
          </p>
          <p class="data-mono text-[10px] text-zinc-500">
            {{ (r.share * 100).toFixed(1) }}%
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
