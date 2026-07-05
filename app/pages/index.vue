<script setup lang="ts">
import {
  Swords, Globe2, Users, Trophy, Shield, Layers, Activity, Crosshair,
  HeartHandshake, Loader2, Info,
} from 'lucide-vue-next'
import { formatDamage, formatFull, formatPeriodRange, PERIOD_LABEL } from '~/utils/format'
import type { DamageRow, FederationSupportBreakdownResponse, JusticePlayerDailyResponse, PlayerRow } from '~~/shared/types/warera'

const { period, fedPeriod, live, lastUpdated, meta, federation, federationSupport, justice, refresh } = useDashboard()

const fed = computed(() => federation.data.value)
const fedSup = computed(() => federationSupport.data.value)
const jus = computed(() => justice.data.value)
const fedLoading = computed(() => federation.status.value === 'pending')
const fedSupLoading = computed(() => federationSupport.status.value === 'pending')
const jusLoading = computed(() => justice.status.value === 'pending')
const fedErr = computed(() => federation.error.value as (Error & { statusMessage?: string }) | null)
const fedSupErr = computed(() => federationSupport.error.value as (Error & { statusMessage?: string }) | null)
const jusErr = computed(() => justice.error.value as (Error & { statusMessage?: string }) | null)

// Federation membership legend helpers
const RECENT_JOINER_DAYS = 30
function isRecentJoiner(isoDate: string): boolean {
  if (!isoDate) return false
  return Date.now() - new Date(isoDate).getTime() < RECENT_JOINER_DAYS * 24 * 60 * 60 * 1000
}
function formatJoinDate(isoDate: string): string {
  if (!isoDate) return ''
  const d = new Date(isoDate)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
function getCountryName(cid: string): string {
  return fed.value?.byCountry?.find((c) => c.id === cid)?.name ?? cid
}

// Total "own" DMG across all Federation countries for comparison KPI.
const fedSupOwnTotal = computed(() =>
  (fedSup.value?.byCountry ?? []).reduce(
    (s, r) => s + (typeof r.meta?.ownDamage === 'number' ? (r.meta.ownDamage as number) : 0),
    0,
  ),
)

const selectedJusticePlayer = ref<PlayerRow | null>(null)
const selectedJusticeCountry = ref<DamageRow | null>(null)
const justicePlayerDaily = ref<JusticePlayerDailyResponse | null>(null)
const justicePlayerDailyLoading = ref(false)
const justicePlayerDailyError = ref<string | null>(null)
let justicePlayerDailyRequest = 0
let justicePlayerDailyTimer: ReturnType<typeof setInterval> | null = null

const selectedJusticeCountryPlayers = computed(() => {
  if (!selectedJusticeCountry.value) return []
  return [...(jus.value?.byPlayer ?? [])]
    .filter((player) => player.countryId === selectedJusticeCountry.value?.id && player.damage > 0)
    .sort((a, b) => b.damage - a.damage)
})

function stopJusticePlayerDailyPolling() {
  if (justicePlayerDailyTimer) {
    clearInterval(justicePlayerDailyTimer)
    justicePlayerDailyTimer = null
  }
}

function startJusticePlayerDailyPolling(playerId: string, requestId: number) {
  if (justicePlayerDailyTimer) return
  justicePlayerDailyTimer = setInterval(async () => {
    if (!selectedJusticePlayer.value || selectedJusticePlayer.value.id !== playerId || requestId !== justicePlayerDailyRequest) {
      stopJusticePlayerDailyPolling()
      return
    }

    try {
      const data = await $fetch<JusticePlayerDailyResponse>('/api/justicePlayerDaily', {
        query: { userId: playerId, days: 7 },
      })
      if (requestId !== justicePlayerDailyRequest) return
      if (data.building) {
        justicePlayerDailyLoading.value = true
        return
      }
      justicePlayerDaily.value = data
      justicePlayerDailyLoading.value = false
      stopJusticePlayerDailyPolling()
    } catch {
      // Keep polling; transient upstream/rate-limit errors are expected here.
    }
  }, 10_000)
}

async function selectJusticePlayer(player: PlayerRow) {
  if (selectedJusticePlayer.value?.id === player.id) {
    justicePlayerDailyRequest++
    stopJusticePlayerDailyPolling()
    selectedJusticePlayer.value = null
    justicePlayerDaily.value = null
    justicePlayerDailyError.value = null
    justicePlayerDailyLoading.value = false
    return
  }

  const requestId = ++justicePlayerDailyRequest
  let keepLoading = false
  stopJusticePlayerDailyPolling()
  selectedJusticePlayer.value = player
  justicePlayerDaily.value = null
  justicePlayerDailyLoading.value = true
  justicePlayerDailyError.value = null

  try {
    const data = await $fetch<JusticePlayerDailyResponse>('/api/justicePlayerDaily', {
      query: { userId: player.id, days: 7 },
    })
    if (requestId !== justicePlayerDailyRequest) return
    if (data.building) {
      justicePlayerDaily.value = null
      justicePlayerDailyLoading.value = true
      keepLoading = true
      startJusticePlayerDailyPolling(player.id, requestId)
      return
    }
    stopJusticePlayerDailyPolling()
    justicePlayerDaily.value = data
  } catch (error: any) {
    if (requestId !== justicePlayerDailyRequest) return
    stopJusticePlayerDailyPolling()
    justicePlayerDaily.value = null
    justicePlayerDailyError.value = error?.data?.statusMessage ?? error?.message ?? 'Unknown error'
  } finally {
    if (requestId === justicePlayerDailyRequest) {
      justicePlayerDailyLoading.value = keepLoading
    }
  }
}

function selectJusticeCountry(country: DamageRow) {
  if (selectedJusticeCountry.value?.id === country.id) {
    selectedJusticeCountry.value = null
    return
  }
  selectedJusticeCountry.value = country
}

// ---- Federation support breakdown (expand a country to see recipients) ----
const selectedSupportCountry = ref<DamageRow | null>(null)
const supportBreakdown = ref<FederationSupportBreakdownResponse | null>(null)
const supportBreakdownLoading = ref(false)
const supportBreakdownError = ref<string | null>(null)

async function selectSupportCountry(country: DamageRow) {
  if (selectedSupportCountry.value?.id === country.id) {
    selectedSupportCountry.value = null
    supportBreakdown.value = null
    supportBreakdownError.value = null
    supportBreakdownLoading.value = false
    return
  }

  selectedSupportCountry.value = country
  supportBreakdown.value = null
  supportBreakdownLoading.value = true
  supportBreakdownError.value = null

  try {
    supportBreakdown.value = await $fetch<FederationSupportBreakdownResponse>(
      '/api/federationSupportBreakdown',
      { query: { countryId: country.id, period: fedPeriod.value } },
    )
  } catch (error: any) {
    supportBreakdown.value = null
    supportBreakdownError.value = error?.data?.statusMessage ?? error?.message ?? 'Unknown error'
  } finally {
    supportBreakdownLoading.value = false
  }
}

watch(period, () => {
  justicePlayerDailyRequest++
  stopJusticePlayerDailyPolling()
  selectedJusticePlayer.value = null
  selectedJusticeCountry.value = null
  justicePlayerDaily.value = null
  justicePlayerDailyError.value = null
  justicePlayerDailyLoading.value = false
  selectedSupportCountry.value = null
  supportBreakdown.value = null
  supportBreakdownError.value = null
  supportBreakdownLoading.value = false
})

onBeforeUnmount(() => {
  stopJusticePlayerDailyPolling()
})

useHead({ title: 'WarEra DMG — The Federation & Justice' })
</script>

<template>
  <div class="min-h-screen">
    <TopBar
      :period="period"
      :live="live"
      :last-updated="lastUpdated"
      :loading="fedLoading || fedSupLoading || jusLoading"
      :rate-limit="fed?.rateLimit ?? jus?.rateLimit ?? null"
      :meta-ok="meta.data.value?.ok ?? false"
      @update:period="period = $event"
      @update:live="live = $event"
      @refresh="refresh"
    />

    <main class="mx-auto max-w-[1400px] px-4 sm:px-6 py-6 sm:py-8 space-y-10">
      <!-- ============ FEDERATION ============ -->
      <section>
        <!-- Panel header -->
        <div class="flex items-center gap-4 mb-4 animate-fade-up">
          <img
            v-if="fed?.avatarUrl"
            :src="fed.avatarUrl"
            :alt="fed?.allianceName"
            class="h-12 w-12 rounded-sm object-cover border border-fed/30 shadow-glow-fed"
          />
          <div v-else class="h-12 w-12 rounded-sm grid place-items-center bg-fed/10 border border-fed/20">
            <Shield class="h-6 w-6 text-fed-glow" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="heading-display text-xl sm:text-2xl text-zinc-100">{{ fed?.allianceName ?? 'The Federation' }}</h2>
              <span class="chip border-fed/30 bg-fed/10 text-fed-glow">Alliance</span>
              <span v-if="fed?.globalRank" class="chip border-white/10 bg-white/5 text-zinc-400">
                <Trophy class="h-3 w-3 text-fed" /> #{{ fed.globalRank }} global
              </span>
            </div>
            <p class="text-xs text-zinc-500 mt-0.5">
              Damage {{ PERIOD_LABEL[fedPeriod] }}
              <span v-if="formatPeriodRange(fed?.periodRange)" class="data-mono text-zinc-600">· {{ formatPeriodRange(fed?.periodRange) }}</span>
              ·
              <span class="data-mono">{{ fed ? formatFull(fed.totalDamage) : '…' }}</span> total
              <span
                class="ml-1 text-[10px] text-zinc-600 cursor-help border-b border-dotted border-zinc-700"
                title="Sum of all member country damage since each country joined The Federation. Based on our own tracked battle history, not the game's lifetime stats.">
                ?
              </span>
            </p>
          </div>
        </div>

        <!-- Error -->
        <div v-if="fedErr" class="panel clip-corner p-4 mb-4 border-danger/30">
          <p class="text-sm text-danger">Failed to load alliance: {{ fedErr.statusMessage || fedErr.message }}</p>
        </div>

        <!-- KPIs -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <KpiCard label="Total DMG" :value="fed?.totalDamage" :icon="Swords" accent="fed" :loading="fedLoading"
            tooltip="Sum of member country damage from our tracked battle history. Counted only from battles after each country joined The Federation." />
          <KpiCard label="Member Countries" :value="fed?.memberCountryCount" :icon="Globe2" accent="fed" :loading="fedLoading"
            tooltip="Current number of countries in The Federation. See membership legend below for join dates." />
          <KpiCard label="Military Units" :value="fed?.muCount" :icon="Layers" accent="fed" :loading="fedLoading" />
          <KpiCard label="Global Rank" :value="fed?.globalRank" :icon="Trophy" accent="fed" :loading="fedLoading" />
        </div>

        <!-- Tables -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div class="panel clip-corner panel-glow-fed">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                <Globe2 class="h-4 w-4 text-fed" /> DMG per country
                <span
                  class="text-[10px] text-zinc-600 font-normal normal-case tracking-normal cursor-help border-b border-dotted border-zinc-700"
                  title="Cumulative damage dealt by each member country in battles since joining The Federation. Based on our own tracked battle history.">
                  ?
                </span>
              </h3>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[fedPeriod] }}</span>
            </div>
            <div class="px-2 py-1">
              <DamageTable :rows="fed?.byCountry ?? []" :loading="fedLoading" accent="fed" show-flag />
            </div>

            <!-- Membership legend -->
            <div v-if="fed?.memberJoinedAts && Object.keys(fed.memberJoinedAts).length" class="px-3 pb-3">
              <div class="flex items-center gap-1.5 mb-1.5">
                <Info class="h-3 w-3 text-zinc-600" />
                <span class="text-[10px] font-medium uppercase tracking-widest text-zinc-600">Membership</span>
                <span
                  class="text-[10px] text-zinc-600 cursor-help border-b border-dotted border-zinc-700"
                  title="Damage for each country is counted only from battles after its join date. Amber dot = joined within the last 30 days.">
                  ?
                </span>
              </div>
              <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                <span v-for="(date, cid) in fed.memberJoinedAts" :key="cid" class="inline-flex items-center gap-1">
                  <span class="h-1.5 w-1.5 rounded-full"
                    :class="isRecentJoiner(date) ? 'bg-amber-500/80' : 'bg-zinc-700'" />
                  {{ getCountryName(cid) }}
                  <span class="text-zinc-600">joined {{ formatJoinDate(date) }}</span>
                </span>
              </div>
            </div>
          </div>

          <div class="panel clip-corner panel-glow-fed">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                <Layers class="h-4 w-4 text-fed" /> DMG per military unit
              </h3>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[fedPeriod] }}</span>
            </div>
            <div class="px-2 py-1">
              <DamageTable :rows="fed?.byMu ?? []" :loading="fedLoading" accent="fed" :collapsed-limit="15" />
            </div>
          </div>
        </div>

        <!-- Ally support DMG (full width) -->
        <div class="panel clip-corner panel-glow-fed mt-5">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/5 gap-3 flex-wrap">
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <HeartHandshake class="h-4 w-4 text-fed-glow shrink-0" />
                <h3 class="heading-display text-sm text-zinc-200">Ally support DMG per country</h3>
                <span
                  class="hidden md:inline text-[11px] text-zinc-500 truncate"
                  title="Support = DMG in OTHER allies' battles. Own = DMG in this country's own battles (attacker or defender)."
                >
                  · Support vs Own battles
                </span>
              </div>
              <p class="mt-1 text-[11px] text-zinc-500">
                Click a country to see which allies it supported and how much damage it dealt.
              </p>
            </div>
            <div class="flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-600">
              <span>
                Scanned <span class="data-mono text-zinc-400">{{ fedSup?.battlesScanned ?? '…' }}</span>
              </span>
              <span>
                Ally battles <span class="data-mono text-zinc-400">{{ fedSup?.allyBattlesCount ?? '…' }}</span>
              </span>
              <span>
                {{ PERIOD_LABEL[fedPeriod] }}
                <span v-if="formatPeriodRange(fedSup?.periodRange)" class="normal-case data-mono text-zinc-500">· {{ formatPeriodRange(fedSup?.periodRange) }}</span>
              </span>
            </div>
          </div>

          <div v-if="fedSupErr" class="px-4 py-3 border-b border-danger/20">
            <p class="text-sm text-danger">Failed to load ally support: {{ fedSupErr.statusMessage || fedSupErr.message }}</p>
          </div>

          <!-- Building state: scan runs in background on the server, can take minutes -->
          <div v-if="fedSup?.building" class="px-4 py-6 border-b border-fed/20 flex items-center gap-3">
            <Loader2 class="h-5 w-5 text-fed-glow animate-spin shrink-0" />
            <div class="min-w-0">
              <p class="text-sm text-zinc-200">Building ally-support ranking in the background…</p>
              <p class="text-xs text-zinc-500 mt-0.5">
                Scanning each Federation member's battles. This can take a few minutes on the
                first load — the panel refreshes automatically when data is ready.
              </p>
            </div>
          </div>

          <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x divide-white/5">
            <!-- Two side-by-side KPIs: support vs own -->
            <div class="px-4 py-4 flex flex-col justify-center">
              <div class="flex items-end gap-4 flex-wrap">
                <div>
                  <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-fed" /> Support
                  </p>
                  <p class="mt-1 text-2xl sm:text-3xl data-mono font-bold text-fed-glow">
                    {{ fedSup ? formatFull(fedSup.totalSupportDamage) : '…' }}
                  </p>
                </div>
                <div>
                  <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-danger" /> Own
                  </p>
                  <p class="mt-1 text-xl sm:text-2xl data-mono font-bold text-danger">
                    {{ fedSup ? formatFull(fedSupOwnTotal) : '…' }}
                  </p>
                </div>
              </div>
              <p class="mt-2 text-xs text-zinc-500">
                {{ fedSup ? formatDamage(fedSup.totalSupportDamage) : '—' }} support ·
                {{ fedSup ? formatDamage(fedSupOwnTotal) : '—' }} own ·
                {{ fedSup?.byCountry?.length ?? 0 }} countries
              </p>
              <p class="mt-2 text-[11px] text-zinc-600 flex items-start gap-1.5">
                <Info class="h-3 w-3 text-zinc-500 shrink-0 mt-0.5" />
                <span>
                  <span class="text-fed-glow font-semibold">Support</span> = DMG in OTHER allies' battles.
                  <span class="text-danger font-semibold">Own</span> = DMG in this country's own battles (attacker or defender).
                </span>
              </p>
            </div>

            <!-- Ranking table -->
            <div class="lg:col-span-2 px-2 py-1">
              <DamageTable
                :rows="fedSup?.byCountry ?? []"
                :loading="fedSupLoading"
                accent="fed"
                show-flag
                :limit="50"
                :secondary="{ key: 'ownDamage', label: 'Own DMG', accent: 'danger' }"
                :selected-id="selectedSupportCountry?.id ?? null"
                @select="selectSupportCountry"
              >
                <template #expanded="{ row }">
                  <SupportBreakdownCard
                    v-if="selectedSupportCountry?.id === row.id"
                    :country="row"
                    :data="supportBreakdown"
                    :loading="supportBreakdownLoading"
                    :error="supportBreakdownError"
                  />
                </template>
              </DamageTable>
            </div>
          </div>
        </div>
      </section>

      <!-- Divider -->
      <div class="relative h-px">
        <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <!-- ============ JUSTICE ============ -->
      <section>
        <div class="flex items-center gap-4 mb-4 animate-fade-up" style="animation-delay: 80ms">
          <img
            v-if="jus?.avatarUrl"
            :src="jus.avatarUrl"
            :alt="jus?.muName"
            class="h-12 w-12 rounded-sm object-cover border border-just/30 shadow-glow-just"
          />
          <div v-else class="h-12 w-12 rounded-sm grid place-items-center bg-just/10 border border-just/20">
            <Crosshair class="h-6 w-6 text-just-glow" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="heading-display text-xl sm:text-2xl text-zinc-100">{{ jus?.muName ?? 'Justice' }}</h2>
              <span class="chip border-just/30 bg-just/10 text-just-glow">Military Unit</span>
              <span v-if="jus?.globalRank" class="chip border-white/10 bg-white/5 text-zinc-400">
                <Trophy class="h-3 w-3 text-just" /> #{{ jus.globalRank }} global
              </span>
            </div>
            <p class="text-xs text-zinc-500 mt-0.5">
              Damage {{ PERIOD_LABEL[period] }}
              <span v-if="formatPeriodRange(jus?.periodRange)" class="data-mono text-zinc-600">· {{ formatPeriodRange(jus?.periodRange) }}</span>
              ·
              <span class="data-mono">{{ jus ? formatFull(jus.totalDamage) : '…' }}</span> total
            </p>
          </div>
        </div>

        <div v-if="jusErr" class="panel clip-corner p-4 mb-4 border-danger/30">
          <p class="text-sm text-danger">Failed to load MU: {{ jusErr.statusMessage || jusErr.message }}</p>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <KpiCard label="Total DMG" :value="jus?.totalDamage" :icon="Swords" accent="just" :loading="jusLoading" />
          <KpiCard label="Members" :value="jus?.memberCount" :icon="Users" accent="just" :loading="jusLoading" />
          <KpiCard label="MU Level" :value="jus?.level" :icon="Activity" accent="just" :loading="jusLoading" />
          <KpiCard label="Global Rank" :value="jus?.globalRank" :icon="Trophy" accent="just" :loading="jusLoading" />
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div class="panel clip-corner panel-glow-just">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div class="min-w-0">
                <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                  <Globe2 class="h-4 w-4 text-just" /> DMG per country
                </h3>
                <p class="mt-1 text-[11px] text-zinc-500">
                  Click a country to see which Justice players contributed damage.
                </p>
              </div>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[period] }}</span>
            </div>
            <div class="px-2 py-1">
              <DamageTable
                :rows="jus?.byCountry ?? []"
                :loading="jusLoading"
                accent="just"
                show-flag
                :selected-id="selectedJusticeCountry?.id ?? null"
                @select="selectJusticeCountry"
              >
                <template #expanded="{ row }">
                  <CountryPlayerBreakdown
                    :country="row"
                    :players="selectedJusticeCountry?.id === row.id ? selectedJusticeCountryPlayers : []"
                  />
                </template>
              </DamageTable>
            </div>
          </div>

          <div class="panel clip-corner panel-glow-just">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div class="min-w-0">
                <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                  <Users class="h-4 w-4 text-just" /> DMG per player
                </h3>
                <p class="mt-1 text-[11px] text-zinc-500">
                  Click a player to view day-by-day DMG for the last 7 days.
                </p>
              </div>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[period] }}</span>
            </div>
            <div class="px-2 py-1">
              <PlayerTable
                :rows="jus?.byPlayer ?? []"
                :loading="jusLoading"
                :selected-id="selectedJusticePlayer?.id ?? null"
                @select="selectJusticePlayer"
              >
                <template #expanded>
                  <PlayerDailyCard
                    :player="selectedJusticePlayer"
                    :data="justicePlayerDaily"
                    :loading="justicePlayerDailyLoading"
                    :error="justicePlayerDailyError"
                  />
                </template>
              </PlayerTable>
            </div>
          </div>
        </div>
      </section>

      <footer class="pt-4 pb-8 text-center text-[11px] text-zinc-600">
        Data: <span class="data-mono">api2.warera.io</span> · auto-refresh 60 s ·
        <span v-if="fed?.fromCache || fedSup?.fromCache || jus?.fromCache">cache</span><span v-else>live</span>
      </footer>
    </main>
  </div>
</template>
