<script setup lang="ts" generic="T extends { id: string; name: string; damage: number; share: number; rank?: number | null; meta?: Record<string, string | number | null> | null; money?: number | null; moneyBounty?: number | null; moneyContract?: number | null }">
import { computed, ref, useSlots } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { formatDamage, formatFull, flagEmoji } from '~/utils/format'

const props = withDefaults(
  defineProps<{
    rows: T[]
    loading?: boolean
    accent?: 'fed' | 'just'
    showFlag?: boolean
    avatarKey?: keyof T & string
    limit?: number
    collapsedLimit?: number
    selectedId?: string | null
    showMoney?: boolean
    secondary?: {
      key: string
      label: string
      accent?: 'danger' | 'fed' | 'just'
    }
  }>(),
  { accent: 'fed', showFlag: false, loading: false, limit: 50, collapsedLimit: 50, selectedId: null, showMoney: false },
)

const emit = defineEmits<{
  select: [row: T]
}>()

const slots = useSlots()
const sortDesc = ref(true)
const expanded = ref(false)

const sortedAll = computed(() => {
  const arr = [...props.rows]
  arr.sort((a, b) => (sortDesc.value ? b.damage - a.damage : a.damage - b.damage))
  return arr.slice(0, props.limit)
})

const visibleRows = computed(() => {
  if (expanded.value) return sortedAll.value
  return sortedAll.value.slice(0, props.collapsedLimit)
})

const canShowMore = computed(() => sortedAll.value.length > props.collapsedLimit)
const maxDamage = computed(() => visibleRows.value.reduce((m, r) => Math.max(m, r.damage), 0) || 1)
const barEdge = computed(() => (props.accent === 'fed' ? 'bg-fed' : 'bg-just'))
const rankText = computed(() => (props.accent === 'fed' ? 'text-fed/70' : 'text-just/70'))
const primaryAccentText = computed(() => (props.accent === 'fed' ? 'text-fed-glow' : 'text-just-glow'))
const selectedRowClass = computed(() => (props.accent === 'fed' ? 'bg-fed/10 ring-fed/25' : 'bg-just/10 ring-just/25'))
const selectedTextClass = computed(() => (props.accent === 'fed' ? 'text-fed-glow' : 'text-just-glow'))
const hasExpandedSlot = computed(() => Boolean(slots.expanded))
const colSpan = computed(() => {
  let cols = 4
  if (props.showFlag || props.avatarKey) cols += 1
  if (props.showMoney) cols += 1
  if (props.secondary) cols += 1
  return cols
})

/** Build hover tooltip showing bounty vs contract breakdown when available. */
function moneyTooltip(r: T): string {
  const total = r.money
  if (total == null || total === 0) return ''
  const parts = [`Total: ${formatFull(total)}`]
  if (r.moneyBounty != null || r.moneyContract != null) {
    parts.push(`Bounty: ${formatFull(r.moneyBounty ?? 0)}`)
    parts.push(`Contracts: ${formatFull(r.moneyContract ?? 0)}`)
  }
  if (r.damage > 0) {
    parts.push(`Per 1k dmg: ${formatPerK(total / r.damage * 1000)}`)
  }
  return parts.join('\n')
}

/** Formats money-per-1k-dmg ratio, keeping decimals for small values. */
function formatPerK(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString('en-US')
  return n.toFixed(2)
}

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

function selectRow(row: T) {
  if (!hasExpandedSlot.value) return
  emit('select', row)
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
          <th v-if="showMoney" class="py-2 px-2 w-24 text-right font-semibold text-amber-400/80">
            MONEY
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
            <td v-if="showMoney" class="py-2.5"><div class="skel h-4 w-16 ml-auto rounded-sm" /></td>
            <td v-if="secondary" class="py-2.5"><div class="skel h-4 w-16 ml-auto rounded-sm" /></td>
            <td class="py-2.5"><div class="skel h-4 w-10 ml-auto rounded-sm" /></td>
          </tr>
        </template>

        <template v-else>
          <template v-for="r in visibleRows" :key="r.id">
            <tr
              class="border-t border-white/[0.04] transition-colors"
              :class="[
                hasExpandedSlot ? 'cursor-pointer hover:bg-white/[0.025]' : 'hover:bg-white/[0.025]',
                r.id === selectedId ? ['ring-1', 'ring-inset', selectedRowClass] : '',
              ]"
              :tabindex="hasExpandedSlot ? 0 : undefined"
              :role="hasExpandedSlot ? 'button' : undefined"
              @click="selectRow(r)"
              @keydown.enter.prevent="selectRow(r)"
              @keydown.space.prevent="selectRow(r)"
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
                  <span
                    v-if="hasExpandedSlot && r.id === selectedId"
                    class="text-[10px] uppercase tracking-[0.16em]"
                    :class="selectedTextClass"
                  >
                    Expanded
                  </span>
                </div>
              </td>

              <td
                class="py-2.5 px-2 text-right data-mono font-semibold"
                :class="primaryAccentText"
                :title="formatFull(r.damage)"
              >
                {{ formatDamage(r.damage) }}
              </td>

              <td
                v-if="showMoney"
                class="py-2.5 px-2 text-right data-mono font-semibold text-amber-400/90"
                :title="moneyTooltip(r)"
              >
                {{ r.money != null && r.money > 0 ? formatDamage(r.money) : '—' }}
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

            <tr v-if="hasExpandedSlot && r.id === selectedId" class="border-t border-white/[0.04] bg-white/[0.02]">
              <td :colspan="colSpan" class="p-0">
                <slot name="expanded" :row="r" />
              </td>
            </tr>
          </template>
        </template>

        <tr v-if="!loading && visibleRows.length === 0">
          <td :colspan="colSpan" class="py-8 text-center text-zinc-600 text-sm">
            No damage data for this period.
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="!loading && canShowMore" class="flex justify-center px-3 py-3 border-t border-white/[0.04]">
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-zinc-100"
        @click="expanded = !expanded"
      >
        <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="expanded ? 'rotate-180' : ''" />
        {{ expanded ? 'Show less' : `Show more (${sortedAll.length - visibleRows.length})` }}
      </button>
    </div>
  </div>
</template>
