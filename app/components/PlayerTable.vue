<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'
import { formatDamage, formatFull } from '~/utils/format'
import type { PlayerRow } from '~~/shared/types/warera'

const props = withDefaults(
  defineProps<{
    rows: PlayerRow[]
    loading?: boolean
    limit?: number
    showHelp?: boolean
    showMoney?: boolean
    selectedId?: string | null
  }>(),
  { loading: false, limit: 50, showHelp: true, showMoney: false, selectedId: null },
)
const emit = defineEmits<{
  select: [row: PlayerRow]
}>()

const slots = useSlots()
const sortDesc = ref(true)
const sorted = computed(() => {
  const arr = [...props.rows]
  arr.sort((a, b) => (sortDesc.value ? b.damage - a.damage : a.damage - b.damage))
  return arr.slice(0, props.limit)
})

const colSpan = computed(() => {
  let cols = 5
  if (props.showMoney) cols += 1
  if (props.showHelp) cols += 1
  return cols
})
const hasExpandedSlot = computed(() => Boolean(slots.expanded))

/** Build hover tooltip showing bounty vs contract breakdown when available. */
function moneyTooltip(r: PlayerRow): string {
  const total = r.money
  if (total == null || total === 0) return ''
  const parts = [`Total: ${formatFull(total)}`]
  if (r.moneyBounty != null || r.moneyContract != null) {
    parts.push(`Bounty: ${formatFull(r.moneyBounty ?? 0)}`)
    parts.push(`Contracts: ${formatFull(r.moneyContract ?? 0)}`)
  }
  if (r.damage > 0) {
    parts.push(`Per 1k dmg: ${formatFull(Math.round(total / r.damage * 1000))}`)
  }
  return parts.join('\n')
}

function selectRow(row: PlayerRow) {
  emit('select', row)
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          <th class="py-2 pr-2 w-8 text-right font-semibold">#</th>
          <th class="py-2 pr-2 w-10 font-semibold" />
          <th class="py-2 pr-2 font-semibold">Player</th>
          <th class="py-2 px-2 font-semibold">Country</th>
          <th
            class="py-2 px-2 font-semibold text-right cursor-pointer select-none hover:text-zinc-300"
            @click="sortDesc = !sortDesc"
          >
            DMG <span class="opacity-50">↕</span>
          </th>
          <th v-if="showMoney" class="py-2 px-2 w-24 text-right font-semibold text-amber-400/80">
            MONEY
          </th>
          <th v-if="showHelp" class="py-2 pl-2 w-16 text-right font-semibold">Help</th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="i in 6" :key="i">
            <td class="py-2.5"><div class="skel h-4 w-5 ml-auto rounded-sm" /></td>
            <td class="py-2.5"><div class="skel h-7 w-7 rounded-full" /></td>
            <td class="py-2.5"><div class="skel h-4 rounded-sm" :style="{ width: 35 + i * 7 + '%' }" /></td>
            <td class="py-2.5"><div class="skel h-4 w-16 rounded-sm" /></td>
            <td class="py-2.5"><div class="skel h-4 w-16 ml-auto rounded-sm" /></td>
            <td v-if="showMoney" class="py-2.5"><div class="skel h-4 w-16 ml-auto rounded-sm" /></td>
            <td v-if="showHelp" class="py-2.5"><div class="skel h-4 w-8 ml-auto rounded-sm" /></td>
          </tr>
        </template>

        <template v-else>
          <template v-for="r in sorted" :key="r.id">
            <tr
              class="border-t border-white/[0.04] cursor-pointer transition-colors hover:bg-white/[0.025]"
              :class="r.id === selectedId ? 'bg-just/10 ring-1 ring-inset ring-just/25' : ''"
              tabindex="0"
              role="button"
              @click="selectRow(r)"
              @keydown.enter.prevent="selectRow(r)"
              @keydown.space.prevent="selectRow(r)"
            >
              <td class="py-2.5 pr-2 text-right data-mono text-xs text-just/70">
                {{ r.rank ?? '—' }}
              </td>
              <td class="py-2 pr-2 align-middle">
                <img
                  v-if="r.avatarUrl"
                  :src="r.avatarUrl"
                  :alt="r.name"
                  class="h-7 w-7 rounded-full object-cover border border-white/10"
                  loading="lazy"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <div
                  v-else
                  class="h-7 w-7 rounded-full grid place-items-center bg-just/10 text-just text-[10px] font-bold border border-just/20"
                >
                  {{ (r.name || '?').slice(0, 1).toUpperCase() }}
                </div>
              </td>
              <td class="py-2.5 pr-2 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="truncate text-zinc-100 font-medium">{{ r.name }}</span>
                  <span
                    v-if="r.id === selectedId"
                    class="text-[10px] uppercase tracking-[0.16em] text-just-glow"
                  >
                    Expanded
                  </span>
                </div>
              </td>
              <td class="py-2 px-2 whitespace-nowrap">
                <span class="text-zinc-400 text-xs">{{ r.countryName ?? '—' }}</span>
              </td>
              <td
                class="py-2.5 px-2 text-right data-mono font-semibold text-zinc-100"
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
              <td v-if="showHelp" class="py-2.5 pl-2 text-right data-mono text-xs text-zinc-500">
                {{ r.help ?? '—' }}
              </td>
            </tr>

            <tr v-if="hasExpandedSlot && r.id === selectedId" class="border-t border-white/[0.04] bg-white/[0.02]">
              <td :colspan="colSpan" class="p-0">
                <slot name="expanded" :row="r" />
              </td>
            </tr>
          </template>
        </template>

        <tr v-if="!loading && sorted.length === 0">
          <td :colspan="colSpan" class="py-8 text-center text-zinc-600 text-sm">
            No members in this period.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
