<script setup lang="ts" generic="T extends { id: string; name: string; damage: number; share: number; rank?: number | null; meta?: Record<string, string | number | null> | null }">
import { computed, ref } from 'vue'
import { formatDamage, formatFull, flagEmoji } from '~/utils/format'

const props = withDefaults(
  defineProps<{
    rows: T[]
    loading?: boolean
    accent?: 'fed' | 'just'
    showFlag?: boolean
    avatarKey?: keyof T & string
    limit?: number
    /**
     * Optional secondary value column (e.g. "own DMG" for comparison).
     * Reads the numeric value from `row.meta[key]`.
     */
    secondary?: {
      key: string
      label: string
      accent?: 'danger' | 'fed' | 'just'
    }
  }>(),
  { accent: 'fed', showFlag: false, loading: false, limit: 50 },
)

const sortDesc = ref(true)
const sorted = computed(() => {
  const arr = [...props.rows]
  arr.sort((a, b) => (sortDesc.value ? b.damage - a.damage : a.damage - b.damage))
  return arr.slice(0, props.limit)
})

const maxDamage = computed(() =>
  sorted.value.reduce((m, r) => Math.max(m, r.damage), 0) || 1,
)

const barEdge = computed(() => (props.accent === 'fed' ? 'bg-fed' : 'bg-just'))
const rankText = computed(() => (props.accent === 'fed' ? 'text-fed/70' : 'text-just/70'))
const secondaryAccentText = computed(() => {
  const a = props.secondary?.accent ?? 'danger'
  if (a === 'fed') return 'text-fed-glow'
  if (a === 'just') return 'text-just-glow'
  return 'text-danger'
})

function secondaryValue(r: T): number | null {
  if (!props.secondary) return null
  const v = r.meta?.[props.secondary.key]
  return typeof v === 'number' ? v : null
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <th class="py-2 pr-2 w-8 text-right font-semibold">#</th>
          <th v-if="showFlag || avatarKey" class="py-2 pr-2 w-10 font-semibold" />
          <th class="py-2 pr-2 font-semibold">Name</th>
          <th
            class="py-2 px-2 font-semibold text-right cursor-pointer select-none hover:text-zinc-300"
            @click="sortDesc = !sortDesc"
          >
            DMG <span class="opacity-50">↕</span>
          </th>
          <th v-if="secondary" class="py-2 px-2 w-24 text-right font-semibold">
            {{ secondary.label }}
          </th>
          <th class="py-2 pl-2 w-24 text-right font-semibold">Share</th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="i in 6" :key="i">
            <td class="py-2.5"><div class="skel h-4 w-5 ml-auto rounded-sm" /></td>
            <td v-if="showFlag || avatarKey" class="py-2.5"><div class="skel h-6 w-6 rounded-full" /></td>
            <td class="py-2.5"><div class="skel h-4 rounded-sm" :style="{ width: 40 + i * 8 + '%' }" /></td>
            <td class="py-2.5"><div class="skel h-4 w-16 ml-auto rounded-sm" /></td>
            <td v-if="secondary" class="py-2.5"><div class="skel h-4 w-16 ml-auto rounded-sm" /></td>
            <td class="py-2.5"><div class="skel h-4 w-10 ml-auto rounded-sm" /></td>
          </tr>
        </template>

        <template v-else>
          <tr
            v-for="r in sorted"
            :key="r.id"
            class="border-t border-white/[0.04] hover:bg-white/[0.025]"
          >
            <td class="py-2.5 pr-2 text-right data-mono text-xs" :class="rankText">
              {{ r.rank ?? '—' }}
            </td>

            <td v-if="showFlag || avatarKey" class="py-2 pr-2 align-middle">
              <img
                v-if="avatarKey && (r as any)[avatarKey]"
                :src="(r as any)[avatarKey] as string"
                alt=""
                class="h-7 w-7 rounded-full object-cover border border-white/10"
                loading="lazy"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <span v-else-if="showFlag" class="text-lg leading-none">
                {{ flagEmoji((r.meta?.code as string) ?? null) }}
              </span>
            </td>

            <td class="py-2.5 pr-2 min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <span class="truncate text-zinc-100 font-medium">{{ r.name }}</span>
                <span
                  v-if="r.meta?.country"
                  class="hidden sm:inline text-[11px] text-zinc-500 truncate"
                >· {{ r.meta.country }}</span>
              </div>
            </td>

            <td
              class="py-2.5 px-2 text-right data-mono font-semibold text-zinc-100"
              :title="formatFull(r.damage)"
            >
              {{ formatDamage(r.damage) }}
            </td>

            <td
              v-if="secondary"
              class="py-2.5 px-2 text-right data-mono font-semibold"
              :class="secondaryAccentText"
              :title="secondaryValue(r) != null ? formatFull(secondaryValue(r)!) : ''"
            >
              {{ secondaryValue(r) != null ? formatDamage(secondaryValue(r)!) : '—' }}
            </td>

            <td class="py-2.5 pl-2 text-right">
              <div class="flex items-center justify-end gap-2">
                <div class="w-14 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="barEdge"
                    :style="{ width: Math.max(4, (r.damage / maxDamage) * 100) + '%' }"
                  />
                </div>
                <span class="data-mono text-[11px] text-zinc-500 w-10 text-right">
                  {{ (r.share * 100).toFixed(1) }}%
                </span>
              </div>
            </td>
          </tr>
        </template>

        <tr v-if="!loading && sorted.length === 0">
          <td :colspan="secondary ? 6 : 5" class="py-8 text-center text-zinc-600 text-sm">
            No damage data for this period.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

