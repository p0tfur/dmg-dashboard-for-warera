<script setup lang="ts">
import {
  Swords, Globe2, Users, Trophy, Shield, Layers, Activity, Crosshair,
  HeartHandshake,
} from 'lucide-vue-next'
import { formatDamage, formatFull, PERIOD_LABEL } from '~/utils/format'

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
              Damage {{ PERIOD_LABEL[fedPeriod] }} ·
              <span class="data-mono">{{ fed ? formatFull(fed.totalDamage) : '…' }}</span> total
            </p>
          </div>
        </div>

        <!-- Error -->
        <div v-if="fedErr" class="panel clip-corner p-4 mb-4 border-danger/30">
          <p class="text-sm text-danger">Failed to load alliance: {{ fedErr.statusMessage || fedErr.message }}</p>
        </div>

        <!-- KPIs -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <KpiCard label="Total DMG" :value="fed?.totalDamage" :icon="Swords" accent="fed" :loading="fedLoading" />
          <KpiCard label="Member Countries" :value="fed?.memberCountryCount" :icon="Globe2" accent="fed" :loading="fedLoading" />
          <KpiCard label="Military Units" :value="fed?.muCount" :icon="Layers" accent="fed" :loading="fedLoading" />
          <KpiCard label="Global Rank" :value="fed?.globalRank" :icon="Trophy" accent="fed" :loading="fedLoading" />
        </div>

        <!-- Tables -->
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div class="panel clip-corner panel-glow-fed">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                <Globe2 class="h-4 w-4 text-fed" /> DMG per country
              </h3>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[fedPeriod] }}</span>
            </div>
            <div class="px-2 py-1">
              <DamageTable :rows="fed?.byCountry ?? []" :loading="fedLoading" accent="fed" show-flag />
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
              <DamageTable :rows="fed?.byMu ?? []" :loading="fedLoading" accent="fed" />
            </div>
          </div>
        </div>

        <!-- Ally support DMG (full width) -->
        <div class="panel clip-corner panel-glow-fed mt-5">
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/5 gap-3 flex-wrap">
            <div class="flex items-center gap-2 min-w-0">
              <HeartHandshake class="h-4 w-4 text-fed-glow shrink-0" />
              <h3 class="heading-display text-sm text-zinc-200">Ally support DMG per country</h3>
              <span
                class="hidden md:inline text-[11px] text-zinc-500 truncate"
                title="DMG dealt by each Federation member in OTHER allies' battles (own battles excluded). Internal Fed-vs-Fed wars are skipped."
              >
                · DMG in allies' battles (own battles excluded)
              </span>
            </div>
            <div class="flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-600">
              <span>
                Scanned <span class="data-mono text-zinc-400">{{ fedSup?.battlesScanned ?? '…' }}</span>
              </span>
              <span>
                Ally battles <span class="data-mono text-zinc-400">{{ fedSup?.allyBattlesCount ?? '…' }}</span>
              </span>
              <span>{{ PERIOD_LABEL[fedPeriod] }}</span>
            </div>
          </div>

          <div v-if="fedSupErr" class="px-4 py-3 border-b border-danger/20">
            <p class="text-sm text-danger">Failed to load ally support: {{ fedSupErr.statusMessage || fedSupErr.message }}</p>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x divide-white/5">
            <!-- Total support KPI -->
            <div class="px-4 py-4 flex flex-col justify-center">
              <p class="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">Total Support DMG</p>
              <p class="mt-1 text-2xl sm:text-3xl data-mono font-bold text-fed-glow">
                {{ fedSup ? formatFull(fedSup.totalSupportDamage) : '…' }}
              </p>
              <p class="mt-1 text-xs text-zinc-500">
                {{ fedSup ? formatDamage(fedSup.totalSupportDamage) : '—' }} ·
                {{ fedSup?.byCountry?.length ?? 0 }} contributors
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
              />
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
              Damage {{ PERIOD_LABEL[period] }} ·
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
              <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                <Globe2 class="h-4 w-4 text-just" /> DMG per country
              </h3>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[period] }}</span>
            </div>
            <div class="px-2 py-1">
              <DamageTable :rows="jus?.byCountry ?? []" :loading="jusLoading" accent="just" show-flag />
            </div>
          </div>

          <div class="panel clip-corner panel-glow-just">
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <h3 class="heading-display text-sm text-zinc-200 flex items-center gap-2">
                <Users class="h-4 w-4 text-just" /> DMG per player
              </h3>
              <span class="text-[10px] uppercase tracking-wider text-zinc-600">{{ PERIOD_LABEL[period] }}</span>
            </div>
            <div class="px-2 py-1">
              <PlayerTable :rows="jus?.byPlayer ?? []" :loading="jusLoading" />
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
