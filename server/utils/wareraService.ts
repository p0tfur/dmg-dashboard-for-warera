import { trpcGet, getRateLimitState, waitForBudget } from './wareraClient'
import {
  getDbFederation,
  getDbFederationSupport,
  getDbFederationSupportBreakdown,
  getDbJustice,
  getDbJusticePlayerDaily,
  getFederationMemberJoinedAts,
  getSyncFreshness,
} from './wareraRepository'
import { ensureWareraDbSyncStarted } from './wareraSync'
import type {
  DailyDamagePoint,
  DamageRow,
  FederationResponse,
  FederationSupportBreakdownResponse,
  FederationSupportResponse,
  GameDates,
  JusticeResponse,
  JusticePlayerDailyResponse,
  MetaResponse,
  Period,
  PeriodRange,
  PlayerRow,
} from '~~/shared/types/warera'

// Target entity names (can be overridden via env).
const FEDERATION_NAME = (process.env.WARERA_ALLIANCE_NAME as string) || 'The Federation'
const JUSTICE_NAME = (process.env.WARERA_NAME as string) || 'Justice'
const FEDERATION_ID = process.env.WARERA_ALLIANCE_ID as string | undefined
// Pinned: there are two MUs named "Justice" in the game, so name search would
// resolve to the wrong one. Override with WARERA_MU_ID if this ever changes.
const JUSTICE_ID = (process.env.WARERA_MU_ID as string | undefined) ?? '687633b772c4886cc6fa3d56'
// MUs to always include in the Federation "DMG per military unit" ranking even
// if their founding country is not an alliance member or pagination misses them.
// Both "Justice" MUs: Sweden (the real one, 76.2M) + Philippines (the alt one).
const FED_EXTRA_MU_IDS = new Set(
  ((process.env.WARERA_FED_EXTRA_MU_IDS as string | undefined) ||
    '687633b772c4886cc6fa3d56,698ca55790b70ac76de933c5')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

// ---------------- SWR cache (in-memory) ----------------
interface CacheEntry<T> {
  data: T
  expiry: number
}
const cache = new Map<string, CacheEntry<unknown>>()

async function swr<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean }> {
  const hit = cache.get(key)
  const now = Date.now()
  if (hit && hit.expiry > now) {
    return { data: hit.data as T, fromCache: true }
  }
  // Cache is stale (or absent): try to revalidate.
  try {
    const data = await fn()
    cache.set(key, { data, expiry: now + ttlMs })
    return { data, fromCache: false }
  } catch (err) {
    // Stale-while-revalidate: serve the last-known value when upstream fails
    // (e.g. transient 503). Only propagate the error if we have nothing cached.
    if (hit) {
      console.warn(
        `[warera] revalidate "${key}" failed; serving stale cache (${(err as Error)?.message ?? err})`,
      )
      return { data: hit.data as T, fromCache: true }
    }
    throw err
  }
}

// ---------------- Helpers ----------------

/** Extracts an array from a response: array | {items} | {data} | {<first-key>: array}. */
function asArray<T = any>(raw: any): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) return raw.items as T[]
    if (Array.isArray(raw.data)) return raw.data as T[]
    // e.g. ranking returns {[rankingType]: [...], tierValues: {...}}
    for (const v of Object.values(raw)) {
      if (Array.isArray(v)) return v as T[]
    }
  }
  return []
}

function rankValue(rank: any, type: 'user' | 'country' | 'mu'): string | null {
  if (type === 'user') return rank?.user ?? rank?.entityId ?? null
  if (type === 'country') return rank?.country ?? rank?.entityId ?? null
  return rank?.mu ?? rank?.entityId ?? null
}

function finalizeRows(rows: DamageRow[]): DamageRow[] {
  const total = rows.reduce((s, r) => s + r.damage, 0) || 1
  for (const r of rows) r.share = r.damage / total
  rows.sort((a, b) => b.damage - a.damage)
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

// ---------------- Game dates (calendar windows for period labels) ----------------
//
// The upstream weekly/monthly DMG counters (`weeklyDamagesCount`,
// `monthlyDamagesCount`, `rankings.*WeeklyDamages`, etc.) are pre-aggregated
// by the game — we never tell the upstream which window we want, it just
// returns its own buckets. `gameConfig.getDates` exposes the in-game
// boundaries (UTC ISO timestamps) that those buckets reset on, so we can
// derive a calendar window to show next to "This week" / "This month".

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** SWR-cached `gameConfig.getDates` (5 min TTL — values change at most daily). Best-effort: returns null on failure. */
async function getGameDates(): Promise<GameDates | null> {
  try {
    const { data } = await swr<GameDates | null>(
      'gameConfig.getDates',
      5 * 60 * 1000,
      async () => {
        const raw = await trpcGet<any>('gameConfig.getDates', {})
        return (raw as GameDates | null) ?? null
      },
    )
    return data
  } catch (err) {
    console.warn(
      `[warera] getGameDates failed; period ranges will be hidden (${(err as Error)?.message ?? err})`,
    )
    return null
  }
}

/**
 * Derives the calendar window `[start, end)` that the upstream DMG bucket for
 * `period` most likely covers, based on `gameConfig.getDates`.
 *
 * - `week`:  `[weeklyMissionRegenAt - 7d, weeklyMissionRegenAt)` — the game's
 *   weekly reset (Monday 00:00 UTC, observed live) is the upper bound. We
 *   assume the weekly DMG counter resets on the same boundary as weekly
 *   missions (strongly suggested by the field name; not yet empirically
 *   verified at the time of writing).
 * - `month`: `[first day of current UTC month 00:00, nextMonthAt)` —
 *   `nextMonthAt` is the next month boundary (e.g. 2026-08-01T00:00:00.000Z),
 *   so the current month started at the previous boundary.
 * - `all`:   `null` (unbounded).
 *
 * Returns `null` if `dates` is missing or the required boundary is absent /
 * unparseable — the UI then simply hides the date-range chip.
 */
function computePeriodRange(
  period: Period,
  dates: GameDates | null,
): PeriodRange | null {
  if (!dates || period === 'all') return null

  if (period === 'week') {
    const end = dates.weeklyMissionRegenAt
    if (!end) return null
    const endTs = Date.parse(end)
    if (isNaN(endTs)) return null
    return { start: new Date(endTs - WEEK_MS).toISOString(), end }
  }

  // period === 'month'
  const end = dates.nextMonthAt
  if (!end) return null
  const e = new Date(end)
  if (isNaN(e.getTime())) return null
  // First day of the month that `end` falls in is the *next* month's start;
  // the current month therefore started at the previous month's first day.
  // Date.UTC handles year rollover when month index is negative.
  const start = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 1, 1))
  if (isNaN(start.getTime())) return null
  return { start: start.toISOString(), end }
}

// ---------------- Base entities (long-term cache) ----------------

interface CountryInfo {
  name: string
  code: string | null
  weekly: number
  total: number
}

async function getCountries(): Promise<{
  byId: Map<string, CountryInfo>
}> {
  const { data } = await swr('countries', 10 * 60 * 1000, async () => {
    const raw = await trpcGet('country.getAllCountries', {})
    const list = asArray<any>(raw)
    const byId = new Map<string, CountryInfo>()
    for (const c of list) {
      if (!c?._id) continue
      byId.set(c._id, {
        name: c.name ?? c._id,
        code: c.code ?? null,
        weekly: Number(c?.rankings?.weeklyCountryDamages?.value ?? 0),
        total: Number(c?.rankings?.countryDamages?.value ?? 0),
      })
    }
    return { byId }
  })
  return data
}

interface AllianceInfo {
  id: string
  name: string
  avatarUrl: string | null
  memberCountryIds: string[]
  weeklyDamage: number
  totalDamage: number
  globalWeeklyRank: number | null
  globalTotalRank: number | null
  population: number | null
}

async function getAlliance(id: string): Promise<AllianceInfo> {
  const { data } = await swr(`alliance:${id}`, 60 * 1000, async () => {
    const raw = await trpcGet<any>('alliance.getById', { allianceId: id })
    const ranks = raw?.rankings ?? {}
    return {
      id,
      name: raw?.name ?? FEDERATION_NAME,
      avatarUrl: raw?.avatarUrl ?? null,
      memberCountryIds: (raw?.memberCountries ?? [])
        .map((m: any) => m?.country)
        .filter((c: any): c is string => !!c),
      weeklyDamage: Number(ranks?.allianceWeeklyDamages?.value ?? 0),
      totalDamage: Number(ranks?.allianceDamages?.value ?? 0),
      globalWeeklyRank: ranks?.allianceWeeklyDamages?.rank ?? null,
      globalTotalRank: ranks?.allianceDamages?.rank ?? null,
      population: ranks?.alliancePopulation?.value ?? null,
    }
  })
  return data
}

interface MuInfo {
  id: string
  name: string
  country: string | null
  avatarUrl: string | null
  weekly: number
  total: number
  level: number | null
}

/** Paginates mu.getManyPaginated until exhausted (cache 5 min). */
async function getAllMus(): Promise<MuInfo[]> {
  const { data } = await swr('mus:all', 5 * 60 * 1000, async () => {
    const out: MuInfo[] = []
    let cursor: string | undefined
    let guard = 0
    do {
      const raw = await trpcGet<any>('mu.getManyPaginated', {
        limit: 100,
        cursor,
      })
      const items = asArray<any>(raw?.items ? raw : raw)
      const nextCursor = raw?.nextCursor ?? null
      for (const m of items) {
        if (!m?._id) continue
        out.push({
          id: m._id,
          name: m.name ?? m._id,
          country: m.country ?? null,
          avatarUrl: m.avatarUrl ?? null,
          weekly: Number(m?.rankings?.muWeeklyDamages?.value ?? 0),
          total: Number(m?.rankings?.muDamages?.value ?? 0),
          level: m?.leveling?.level ?? null,
        })
      }
      cursor = nextCursor ?? undefined
      guard++
    } while (cursor && guard < 30)
    return out
  })
  return data
}

/** Fetches a single MU by ID (used as a fallback when pagination misses it). */
async function getMuById(id: string): Promise<MuInfo | null> {
  const { data } = await swr(`mu:info:${id}`, 60 * 1000, async () => {
    const m = await trpcGet<any>('mu.getById', { muId: id })
    if (!m?._id) return null
    return {
      id: m._id,
      name: m.name ?? m._id,
      country: m.country ?? null,
      avatarUrl: m.avatarUrl ?? null,
      weekly: Number(m?.rankings?.muWeeklyDamages?.value ?? 0),
      total: Number(m?.rankings?.muDamages?.value ?? 0),
      level: m?.leveling?.level ?? null,
    }
  })
  return data
}

interface JusticeMu {
  id: string
  name: string
  avatarUrl: string | null
  country: string | null
  level: number | null
  weekly: number
  total: number
  globalWeeklyRank: number | null
  globalTotalRank: number | null
}

async function getJusticeMu(id: string): Promise<JusticeMu> {
  const { data } = await swr(`mu:${id}`, 60 * 1000, async () => {
    const raw = await trpcGet<any>('mu.getById', { muId: id })
    const ranks = raw?.rankings ?? {}
    return {
      id,
      name: raw?.name ?? JUSTICE_NAME,
      avatarUrl: raw?.avatarUrl ?? null,
      country: raw?.country ?? null,
      level: raw?.leveling?.level ?? null,
      weekly: Number(ranks?.muWeeklyDamages?.value ?? 0),
      total: Number(ranks?.muDamages?.value ?? 0),
      globalWeeklyRank: ranks?.muWeeklyDamages?.rank ?? null,
      globalTotalRank: ranks?.muDamages?.rank ?? null,
    }
  })
  return data
}

interface MuMemberRaw {
  user: string
  weekly: number
  monthly: number
  total: number
  weeklyHelp: number
  monthlyHelp: number
  totalHelp: number
}

async function getMuMembers(muId: string): Promise<MuMemberRaw[]> {
  const { data } = await swr(`muMembers:${muId}`, 45 * 1000, async () => {
    const raw = await trpcGet('muMember.getByMu', { muId })
    return asArray<any>(raw).map((m) => ({
      user: m?.user,
      weekly: Number(m?.weeklyDamagesCount ?? 0),
      monthly: Number(m?.monthlyDamagesCount ?? 0),
      total: Number(m?.totalDamagesCount ?? 0),
      weeklyHelp: Number(m?.weeklyHelpCount ?? 0),
      monthlyHelp: Number(m?.monthlyHelpCount ?? 0),
      totalHelp: Number(m?.totalHelpCount ?? 0),
    }))
  })
  return data
}

interface UserProfile {
  name: string
  avatarUrl: string | null
  country: string | null
}

const profileCache = new Map<string, { profile: UserProfile; expiry: number }>()

async function getUserProfile(userId: string): Promise<UserProfile> {
  const hit = profileCache.get(userId)
  if (hit && hit.expiry > Date.now()) return hit.profile
  try {
    const raw = await trpcGet<any>('user.getUserLite', { userId })
    const profile: UserProfile = {
      name: raw?.username ?? raw?.name ?? userId,
      avatarUrl: raw?.avatarUrl ?? null,
      country: raw?.country ?? raw?.citizenship ?? raw?.countryId ?? null,
    }
    profileCache.set(userId, { profile, expiry: Date.now() + 10 * 60 * 1000 })
    return profile
  } catch {
    const fallback: UserProfile = { name: userId, avatarUrl: null, country: null }
    profileCache.set(userId, { profile: fallback, expiry: Date.now() + 60 * 1000 })
    return fallback
  }
}

// ---------------- ID resolution ----------------

async function resolveAllianceId(): Promise<string | null> {
  if (FEDERATION_ID) return FEDERATION_ID
  const key = `id:alliance:${FEDERATION_NAME}`
  const { data } = await swr(key, 60 * 60 * 1000, async () => {
    const raw = await trpcGet<any>('search.searchAnything', { searchText: FEDERATION_NAME })
    return (raw?.allianceIds?.[0] as string | undefined) ?? null
  })
  return data
}

async function resolveMuId(): Promise<string | null> {
  if (JUSTICE_ID) return JUSTICE_ID
  const key = `id:mu:${JUSTICE_NAME}`
  const { data } = await swr(key, 60 * 60 * 1000, async () => {
    const raw = await trpcGet<any>('search.searchAnything', { searchText: JUSTICE_NAME })
    return (raw?.muIds?.[0] as string | undefined) ?? null
  })
  return data
}

// ---------------- FEDERATION ----------------

export async function getFederationData(period: Period): Promise<FederationResponse> {
  ensureWareraDbSyncStarted()
  const dbData = await getDbFederation(period)
  if (dbData && (dbData.byCountry.length || dbData.byMu.length)) {
    const freshness = await getSyncFreshness('references')
    return {
      allianceName: dbData.allianceName,
      avatarUrl: dbData.avatarUrl,
      totalDamage: dbData.totalDamage,
      totalMoney: dbData.totalMoney,
      globalRank: dbData.globalRank,
      memberCountryCount: dbData.memberCountryCount,
      muCount: dbData.byMu.length,
      byCountry: dbData.byCountry,
      byMu: dbData.byMu,
      memberJoinedAts: dbData.memberJoinedAts,
      period,
      updatedAt: dbData.updatedAt ?? new Date().toISOString(),
      fromCache: false,
      dataSource: 'db',
      syncLagSeconds: freshness.lagSeconds,
      periodRange: computePeriodRange(period, await getGameDates()),
      rateLimit: getRateLimitState(),
    }
  }

  const allianceId = await resolveAllianceId()
  if (!allianceId) {
    throw createError({
      statusCode: 404,
      statusMessage: `Alliance "${FEDERATION_NAME}" not found`,
    })
  }

  const cacheKey = `fed:${period}`
  // "all" damage is cumulative and barely moves — cache aggressively to save
  // API quota. "week" resets every week and grows actively, so keep it short.
  const fedTtl = period === 'all' ? 30 * 60 * 1000 : 45 * 1000
  const { data, fromCache } = await swr(cacheKey, fedTtl, async () => {
    const [alliance, { byId: countries }, allMusBase] = await Promise.all([
      getAlliance(allianceId),
      getCountries(),
      getAllMus(),
    ])

    // Ensure force-included extra MUs are present even if pagination missed them
    const haveIds = new Set(allMusBase.map((m) => m.id))
    const missing = [...FED_EXTRA_MU_IDS].filter((id) => !haveIds.has(id))
    const extra = (await Promise.all(missing.map((id) => getMuById(id)))).filter(
      (m): m is MuInfo => !!m,
    )
    const allMus = extra.length ? [...allMusBase, ...extra] : allMusBase

    const memberSet = new Set(alliance.memberCountryIds)

    // per country
    const byCountry: DamageRow[] = []
    for (const cid of alliance.memberCountryIds) {
      const c = countries.get(cid)
      const damage = period === 'all' ? c?.total ?? 0 : c?.weekly ?? 0
      if (damage <= 0) continue
      byCountry.push({
        id: cid,
        name: c?.name ?? cid,
        damage,
        share: 0,
        rank: null,
        meta: { code: c?.code ?? null },
      })
    }
    finalizeRows(byCountry)

    // per MU (alliance countries + force-included extras)
    const byMu: DamageRow[] = []
    for (const mu of allMus) {
      const isExtra = FED_EXTRA_MU_IDS.has(mu.id)
      if (!mu.country || (!isExtra && !memberSet.has(mu.country))) continue
      const damage = period === 'all' ? mu.total : mu.weekly
      if (damage <= 0) continue
      byMu.push({
        id: mu.id,
        name: mu.name,
        damage,
        share: 0,
        rank: null,
        meta: {
          country: countries.get(mu.country)?.name ?? mu.country,
          code: countries.get(mu.country)?.code ?? null,
        },
      })
    }
    finalizeRows(byMu)

    const totalDamage = period === 'all' ? alliance.totalDamage : alliance.weeklyDamage
    const globalRank = period === 'all' ? alliance.globalTotalRank : alliance.globalWeeklyRank

    return {
      allianceName: alliance.name,
      avatarUrl: alliance.avatarUrl,
      totalDamage,
      globalRank,
      memberCountryCount: alliance.memberCountryIds.length,
      muCount: byMu.length,
      byCountry,
      byMu,
      period,
      updatedAt: new Date().toISOString(),
      fromCache: false,
      rateLimit: getRateLimitState(),
    }
  })

  return {
    ...(data as FederationResponse),
    memberJoinedAts: await getFederationMemberJoinedAts(),
    fromCache,
    updatedAt: new Date().toISOString(),
    // Range is computed outside the SWR callback so a briefly-stale DMG cache
    // still shows the *current* week/month window (TTL is only 45s for "week").
    periodRange: computePeriodRange(period, await getGameDates()),
  }
}

// ---------------- FEDERATION ALLY SUPPORT ----------------
//
// Why a dedicated cache layer?
// The per-country battle scan for "all" can take 2-5 minutes (hundreds of
// API calls). The HTTP request would time out at the Coolify/nginx proxy
// (~60s) long before the scan finishes. So we DON'T await the build —
// the first request returns a placeholder (`building: true`) and kicks off
// the scan in the background. Subsequent requests return cached data once
// it's ready, and a stale cache is served immediately while it revalidates.

interface BattleSide {
  country?: string | null
}
interface BattleListItem {
  _id: string
  isActive?: boolean
  createdAt?: string | null
  endedAt?: string | null
  defender?: BattleSide
  attacker?: BattleSide
}

/** Paginates battle.getBattles for ONE country (its battles as attacker or
 * defender) until the weekly cutoff is passed, the per-country page cap is
 * reached, or the cursor is exhausted. Battles are returned newest-first. */
async function scanCountryBattles(
  countryId: string,
  period: Period,
): Promise<{ battles: BattleListItem[]; scanned: number }> {
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const weekCutoff = period === 'week' ? Date.now() - weekMs : 0
  const maxPages = period === 'week' ? 10 : 30
  const pageSize = 100

  const out: BattleListItem[] = []
  let cursor: string | undefined
  let scanned = 0
  let guard = 0

  while (guard < maxPages) {
    await waitForBudget(30)
    const raw = await trpcGet<any>('battle.getBattles', {
      countryId,
      isActive: false,
      limit: pageSize,
      direction: 'backward',
      cursor,
    })
    const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : [])
    if (!items.length) break

    let hitCutoff = false
    for (const b of items) {
      if (!b?._id) continue
      scanned++
      out.push(b as BattleListItem)
      if (weekCutoff && b.createdAt && Date.parse(b.createdAt) < weekCutoff) {
        hitCutoff = true
        break
      }
    }

    if (hitCutoff) break
    cursor = raw?.nextCursor ?? undefined
    if (!cursor) break
    guard++
  }

  return { battles: out, scanned }
}

/** Scans battles for every Federation member country (bounded concurrency),
 * deduplicates by _id, returns the unique set plus the raw scan count. */
async function scanFederationBattles(
  memberCountryIds: string[],
  period: Period,
): Promise<{ battles: BattleListItem[]; scanned: number }> {
  const CONCURRENCY = 3
  const unique = new Map<string, BattleListItem>()
  let scanned = 0

  for (let i = 0; i < memberCountryIds.length; i += CONCURRENCY) {
    const batch = memberCountryIds.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map((cid) => scanCountryBattles(cid, period)),
    )
    for (const r of results) {
      scanned += r.scanned
      for (const b of r.battles) unique.set(b._id, b)
    }
  }

  return { battles: [...unique.values()], scanned }
}

/** Fetches the per-country damage ranking for a single battle (merged sides). */
async function getBattleCountryDamage(battleId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const raw = await trpcGet<any>('battleRanking.getRanking', {
    battleId,
    dataType: 'damage',
    type: 'country',
    side: 'merged',
    limit: 100,
  })
  const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : [])
  for (const it of items) {
    const cid = it?.country
    const value = Number(it?.value ?? 0)
    if (cid && value > 0) out.set(cid, value)
  }
  return out
}

interface SupportCacheEntry {
  data?: FederationSupportResponse
  promise?: Promise<void>
  expiresAt: number
}

const supportCache = new Map<Period, SupportCacheEntry>()
const SUPPORT_TTL = 2 * 60 * 60 * 1000 // 2h — scan is expensive, hold it long

function emptySupport(period: Period, building = true): FederationSupportResponse {
  return {
    allianceName: FEDERATION_NAME,
    totalSupportDamage: 0,
    byCountry: [],
    battlesScanned: 0,
    allyBattlesCount: 0,
    period,
    updatedAt: new Date().toISOString(),
    fromCache: false,
    building,
    rateLimit: getRateLimitState(),
    dataSource: 'api',
  }
}

/** Builds the support aggregate and stores it in the cache. */
async function buildSupportCache(period: Period): Promise<void> {
  const startedAt = Date.now()
  try {
    console.log(`[warera] support scan start (period=${period})`)
    const allianceId = await resolveAllianceId()
    if (!allianceId) {
      console.warn(`[warera] support scan aborted: alliance not found`)
      return
    }

    const [alliance, { byId: countries }] = await Promise.all([
      getAlliance(allianceId),
      getCountries(),
    ])
    const memberSet = new Set(alliance.memberCountryIds)
    console.log(
      `[warera] support scan: ${alliance.memberCountryIds.length} countries to scan`,
    )

    const { battles, scanned } = await scanFederationBattles(
      alliance.memberCountryIds,
      period,
    )
    console.log(
      `[warera] support scan: ${battles.length} unique battles (${scanned} raw)`,
    )

  const support = new Map<string, number>()
  const own = new Map<string, number>()
  let allyBattles = 0

  for (const b of battles) {
    const def = b.defender?.country ?? null
    const att = b.attacker?.country ?? null
    const defFed = def ? memberSet.has(def) : false
    const attFed = att ? memberSet.has(att) : false
    if (!defFed && !attFed) continue

    // Throttle: leave budget for regular (non-scan) endpoint calls.
    await waitForBudget(30)

    let ranking: Map<string, number>
    try {
      ranking = await getBattleCountryDamage(b._id)
    } catch {
      continue
    }
    if (!ranking.size) continue

    const isInternalFedWar = defFed && attFed
    if (!isInternalFedWar) {
      allyBattles++
      const owner = defFed ? def! : att!
      for (const [cid, dmg] of ranking) {
        if (cid === owner) continue
        if (!memberSet.has(cid)) continue
        support.set(cid, (support.get(cid) ?? 0) + dmg)
      }
    }
    if (defFed) {
      const ownDmg = ranking.get(def!) ?? 0
      if (ownDmg > 0) own.set(def!, (own.get(def!) ?? 0) + ownDmg)
    }
    if (attFed) {
      const ownDmg = ranking.get(att!) ?? 0
      if (ownDmg > 0) own.set(att!, (own.get(att!) ?? 0) + ownDmg)
    }
  }

  const byCountry: DamageRow[] = []
  const cids = new Set<string>([...support.keys(), ...own.keys()])
  for (const cid of cids) {
    const dmg = support.get(cid) ?? 0
    const ownDmg = own.get(cid) ?? 0
    if (dmg <= 0 && ownDmg <= 0) continue
    const c = countries.get(cid)
    byCountry.push({
      id: cid,
      name: c?.name ?? cid,
      damage: dmg,
      share: 0,
      rank: null,
      meta: { code: c?.code ?? null, ownDamage: ownDmg },
    })
  }
  finalizeRows(byCountry)

  const data: FederationSupportResponse = {
    allianceName: alliance.name,
    totalSupportDamage: byCountry.reduce((s, r) => s + r.damage, 0),
    byCountry,
    battlesScanned: scanned,
    allyBattlesCount: allyBattles,
    period,
    updatedAt: new Date().toISOString(),
    fromCache: false,
    building: false,
    rateLimit: getRateLimitState(),
  }

  supportCache.set(period, {
    data,
    expiresAt: Date.now() + SUPPORT_TTL,
  })
  console.log(
    `[warera] support scan done in ${Math.round((Date.now() - startedAt) / 1000)}s: ` +
      `${byCountry.length} countries, ${allyBattles} ally battles, ` +
      `${data.totalSupportDamage} total support DMG`,
  )
  } catch (err) {
    console.error(
      `[warera] support scan FAILED after ${Math.round((Date.now() - startedAt) / 1000)}s:`,
      (err as Error)?.message ?? err,
    )
    throw err
  }
}

/**
 * Returns the ally-support aggregate. NEVER blocks on the expensive scan:
 *   1. Fresh cache -> return immediately
 *   2. Stale cache -> return stale + trigger background rebuild
 *   3. No cache -> return `building: true` placeholder + trigger build
 * The frontend polls until `building` is false/undefined.
 */
export async function getFederationSupportData(
  period: Period,
): Promise<FederationSupportResponse> {
  ensureWareraDbSyncStarted()
  const dbData = await getDbFederationSupport(period)
  if (dbData && dbData.battlesScanned > 0) {
    const freshness = await getSyncFreshness('federation-battles')
    return {
      allianceName: FEDERATION_NAME,
      totalSupportDamage: dbData.totalSupportDamage,
      byCountry: dbData.byCountry,
      battlesScanned: dbData.battlesScanned,
      allyBattlesCount: dbData.allyBattlesCount,
      period,
      updatedAt: dbData.updatedAt ?? new Date().toISOString(),
      fromCache: false,
      building: false,
      dataSource: 'db',
      syncLagSeconds: freshness.lagSeconds,
      periodRange: computePeriodRange(period, await getGameDates()),
      rateLimit: getRateLimitState(),
    }
  }

  const entry = supportCache.get(period)
  const now = Date.now()
  // Range is computed up front (cheap, SWR-cached) so all return paths can
  // attach it — including the `building` placeholder.
  const periodRange = computePeriodRange(period, await getGameDates())

  // 1. Fresh cache — serve directly.
  if (entry?.data && entry.expiresAt > now) {
    return { ...entry.data, fromCache: true, periodRange }
  }

  // 2. Stale cache — return stale immediately, revalidate in background.
  if (entry?.data) {
    if (!entry.promise) {
      entry.promise = buildSupportCache(period)
        .catch(() => {})
        .finally(() => {
          const e = supportCache.get(period)
          if (e) e.promise = undefined
        })
    }
    return { ...entry.data, fromCache: true, periodRange }
  }

  // 3. No cache — kick off the build, return placeholder.
  if (!entry?.promise) {
    const promise = buildSupportCache(period)
      .catch(() => {})
      .finally(() => {
        const e = supportCache.get(period)
        if (e) e.promise = undefined
      })
    supportCache.set(period, { promise, expiresAt: 0 })
  }

  return { ...emptySupport(period, true), periodRange }
}

/**
 * Per-recipient breakdown of one Federation member's ally-support damage.
 * Pure DB query (no upstream scan), so it returns immediately. Used by the
 * "Ally support DMG per country" table expand-on-click.
 */
export async function getFederationSupportBreakdown(
  countryId: string,
  period: Period,
): Promise<FederationSupportBreakdownResponse> {
  ensureWareraDbSyncStarted()
  const dbData = await getDbFederationSupportBreakdown(countryId, period)
  const freshness = await getSyncFreshness('federation-battles')
  const periodRange = computePeriodRange(period, await getGameDates())

  return {
    supporterCountryId: countryId,
    period,
    periodRange,
    totalSupportDamage: dbData?.totalSupportDamage ?? 0,
    recipients: dbData?.recipients ?? [],
    battlesScanned: dbData?.battlesScanned ?? 0,
    updatedAt: dbData?.updatedAt ?? new Date().toISOString(),
    fromCache: false,
    dataSource: 'db',
    syncLagSeconds: freshness.lagSeconds,
    rateLimit: getRateLimitState(),
  }
}

// ---------------- JUSTICE ----------------

export async function getJusticeData(period: Period): Promise<JusticeResponse> {
  ensureWareraDbSyncStarted()
  const muId = await resolveMuId()
  if (!muId) {
    throw createError({
      statusCode: 404,
      statusMessage: `Military Unit "${JUSTICE_NAME}" not found`,
    })
  }

  const dbData = await getDbJustice(muId, period)
  if (dbData && dbData.byPlayer.length) {
    const freshness = await getSyncFreshness('justice-members')
    return {
      muName: dbData.muName,
      avatarUrl: dbData.avatarUrl,
      totalDamage: dbData.totalDamage,
      totalMoney: dbData.totalMoney,
      globalRank: dbData.globalRank,
      memberCount: dbData.memberCount,
      level: dbData.level,
      byCountry: dbData.byCountry,
      byPlayer: dbData.byPlayer,
      period,
      updatedAt: dbData.updatedAt ?? new Date().toISOString(),
      fromCache: false,
      dataSource: 'db',
      syncLagSeconds: freshness.lagSeconds,
      periodRange: computePeriodRange(period, await getGameDates()),
      rateLimit: getRateLimitState(),
    }
  }

  const cacheKey = `justice:${period}`
  // "all" = cumulative (very stable). "month" resets monthly. "week" = active.
  const jusTtl =
    period === 'all' ? 30 * 60 * 1000 : period === 'month' ? 5 * 60 * 1000 : 45 * 1000
  const { data, fromCache } = await swr(cacheKey, jusTtl, async () => {
    const [mu, members, { byId: countries }] = await Promise.all([
      getJusticeMu(muId),
      getMuMembers(muId),
      getCountries(),
    ])

    // member profiles (name, avatar, citizenship)
    const profiles = await Promise.all(
      members.map((m) => getUserProfile(m.user)),
    )

    // per player
    const players: PlayerRow[] = members.map((m, i) => {
      const p = profiles[i]
      const damage =
        period === 'all' ? m.total : period === 'month' ? m.monthly : m.weekly
      const help =
        period === 'all' ? m.totalHelp : period === 'month' ? m.monthlyHelp : m.weeklyHelp
      const cid = p?.country ?? mu.country ?? null
      return {
        id: m.user,
        name: p?.name ?? m.user,
        avatarUrl: p?.avatarUrl ?? null,
        countryId: cid,
        countryName: cid ? countries.get(cid)?.name ?? null : null,
        damage,
        help,
        rank: null,
      }
    })
    players.sort((a, b) => b.damage - a.damage)
    players.forEach((p, i) => (p.rank = i + 1))

    // per country (aggregated by citizenship)
    const countryAgg = new Map<string, number>()
    for (const p of players) {
      if (!p.countryId || p.damage <= 0) continue
      countryAgg.set(p.countryId, (countryAgg.get(p.countryId) ?? 0) + p.damage)
    }
    const byCountry: DamageRow[] = []
    for (const [cid, dmg] of countryAgg) {
      byCountry.push({
        id: cid,
        name: countries.get(cid)?.name ?? cid,
        damage: dmg,
        share: 0,
        rank: null,
        meta: { code: countries.get(cid)?.code ?? null },
      })
    }
    finalizeRows(byCountry)

    const totalDamage = period === 'all' ? mu.total : mu.weekly
    const globalRank = period === 'all' ? mu.globalTotalRank : mu.globalWeeklyRank

    return {
      muName: mu.name,
      avatarUrl: mu.avatarUrl,
      totalDamage,
      globalRank,
      memberCount: players.length,
      level: mu.level,
      byCountry,
      byPlayer: players,
      period,
      updatedAt: new Date().toISOString(),
      fromCache: false,
      rateLimit: getRateLimitState(),
    }
  })

  return {
    ...(data as JusticeResponse),
    fromCache,
    updatedAt: new Date().toISOString(),
    // Range is computed outside the SWR callback so a briefly-stale DMG cache
    // still shows the *current* week/month window.
    periodRange: computePeriodRange(period, await getGameDates()),
  }
}

// ---------------- JUSTICE PLAYER DAILY ----------------

function utcDayKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildRecentUtcDayKeys(days: number): string[] {
  const today = new Date()
  const todayStart = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )
  return Array.from({ length: days }, (_, i) =>
    utcDayKey(todayStart - (days - 1 - i) * 24 * 60 * 60 * 1000),
  )
}

async function scanUserBattles(
  userId: string,
  days: number,
): Promise<{ battles: BattleListItem[]; scanned: number }> {
  const keys = buildRecentUtcDayKeys(days)
  const cutoff = Date.parse(`${keys[0]}T00:00:00.000Z`)
  const out: BattleListItem[] = []
  let cursor: string | undefined
  let scanned = 0
  let guard = 0

  while (guard < 20) {
    const raw = await trpcGet<any>('battle.getBattles', {
      userId,
      isActive: false,
      limit: 100,
      direction: 'backward',
      cursor,
    })
    const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : [])
    if (!items.length) break

    let hitCutoff = false
    for (const b of items) {
      if (!b?._id) continue
      const refIso = b?.endedAt ?? b?.createdAt ?? null
      const refTs = refIso ? Date.parse(refIso) : NaN
      if (Number.isFinite(refTs) && refTs < cutoff) {
        hitCutoff = true
        break
      }
      scanned++
      out.push(b as BattleListItem)
    }

    if (hitCutoff) break
    cursor = raw?.nextCursor ?? undefined
    if (!cursor) break
    guard++
  }

  return { battles: out, scanned }
}

async function getBattleUserDamage(battleId: string, userId: string): Promise<number> {
  let cursor: string | undefined
  let guard = 0

  while (guard < 10) {
    const raw = await trpcGet<any>('battleRanking.getRanking', {
      battleId,
      dataType: 'damage',
      type: 'user',
      side: 'merged',
      limit: 100,
      cursor,
    })
    const items: any[] = raw?.items ?? (Array.isArray(raw) ? raw : [])
    const hit = items.find((it) => it?.user === userId)
    if (hit) return Number(hit?.value ?? 0)

    cursor = raw?.nextCursor ?? undefined
    if (!cursor) break
    if (typeof raw?.itemCount === 'number' && (guard + 1) * 100 >= raw.itemCount) break
    guard++
  }

  return 0
}

export interface UserCountryAttributionDebugResponse {
  userId: string
  playerName: string
  currentCountryId: string | null
  currentCountryName: string | null
  lastCitizenshipChangeAt: string | null
  oldestFetchedBattleAt: string | null
  scannedBattles: number
  samplesBefore: Array<{
    battleId: string
    refAt: string
    countryId: string | null
    countryName: string | null
    damage: number
    rank: number | null
  }>
  samplesAfter: Array<{
    battleId: string
    refAt: string
    countryId: string | null
    countryName: string | null
    damage: number
    rank: number | null
  }>
}

async function getBattleUserAttribution(
  battleId: string,
  userId: string,
): Promise<{
  countryId: string | null
  damage: number
  rank: number | null
} | null> {
  let cursor: string | undefined
  let guard = 0

  while (guard < 20) {
    await waitForBudget(15)
    const raw = await trpcGet<any>('battleRanking.getRanking', {
      battleId,
      dataType: 'damage',
      type: 'user',
      side: 'merged',
      limit: 100,
      cursor,
    }, 1)

    const items = raw?.items ?? (Array.isArray(raw) ? raw : [])
    const hit = items.find((item: any) => item?.user === userId)
    if (hit) {
      return {
        countryId: hit?.country_id ?? hit?.countryId ?? hit?.country ?? null,
        damage: Number(hit?.value ?? 0),
        rank: hit?.rank ?? null,
      }
    }

    cursor = raw?.nextCursor ?? undefined
    if (!cursor) break
    guard++
  }

  return null
}

export async function debugUserCountryAttribution(
  userId: string,
  maxBattlePages = 50,
): Promise<UserCountryAttributionDebugResponse> {
  const safePages = Math.min(Math.max(Math.floor(maxBattlePages || 50), 1), 50)
  const [profile, { byId: countries }] = await Promise.all([
    getUserProfile(userId),
    getCountries(),
  ])
  const rawProfile = await trpcGet<any>('user.getUserLite', { userId }, 1)
  const lastCitizenshipChangeAt = rawProfile?.dates?.lastCitizenshipChangeAt ?? rawProfile?.dates?.last_citizenship_change_at ?? null
  const changeTs = lastCitizenshipChangeAt ? Date.parse(lastCitizenshipChangeAt) : NaN

  const samplesBefore: UserCountryAttributionDebugResponse['samplesBefore'] = []
  const samplesAfter: UserCountryAttributionDebugResponse['samplesAfter'] = []
  let cursor: string | undefined
  let oldestFetchedBattleAt: string | null = null
  let scannedBattles = 0

  for (let pageIndex = 0; pageIndex < safePages; pageIndex++) {
    await waitForBudget(20)
    const raw = await trpcGet<any>('battle.getBattles', {
      userId,
      isActive: false,
      limit: 100,
      direction: 'backward',
      cursor,
    }, 1)
    const items: BattleListItem[] = raw?.items ?? (Array.isArray(raw) ? raw : [])
    if (!items.length) break

    for (const battle of items) {
      const refAt = battle.endedAt ?? battle.createdAt ?? null
      if (!refAt) continue
      oldestFetchedBattleAt = refAt
      scannedBattles++

      const ts = Date.parse(refAt)
      const isBefore = Number.isFinite(changeTs) && Number.isFinite(ts) && ts < changeTs
      const target = isBefore ? samplesBefore : samplesAfter
      if (target.length >= 3) continue

      const attribution = await getBattleUserAttribution(battle._id, userId)
      if (!attribution) continue

      target.push({
        battleId: battle._id,
        refAt,
        countryId: attribution.countryId,
        countryName: attribution.countryId ? countries.get(attribution.countryId)?.name ?? null : null,
        damage: attribution.damage,
        rank: attribution.rank,
      })
    }

    if (samplesBefore.length >= 3 && samplesAfter.length >= 3) break
    cursor = raw?.nextCursor ?? undefined
    if (!cursor) break
  }

  return {
    userId,
    playerName: profile.name,
    currentCountryId: profile.country,
    currentCountryName: profile.country ? countries.get(profile.country)?.name ?? null : null,
    lastCitizenshipChangeAt,
    oldestFetchedBattleAt,
    scannedBattles,
    samplesBefore,
    samplesAfter,
  }
}

async function buildJusticePlayerDailyData(
  userId: string,
  days: number,
): Promise<JusticePlayerDailyResponse> {
  const [profile, { byId: countries }, { battles, scanned }] = await Promise.all([
    getUserProfile(userId),
    getCountries(),
    scanUserBattles(userId, days),
  ])

  const dayKeys = buildRecentUtcDayKeys(days)
  const byDay = new Map<string, DailyDamagePoint>(
    dayKeys.map((date) => [date, { date, damage: 0, battles: 0 }]),
  )

  const relevantBattles = battles.filter((battle) => {
    const refIso = battle.endedAt ?? battle.createdAt ?? null
    if (!refIso) return false
    return byDay.has(utcDayKey(Date.parse(refIso)))
  })

  const CONCURRENCY = 3
  for (let i = 0; i < relevantBattles.length; i += CONCURRENCY) {
    const batch = relevantBattles.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (battle) => {
        await waitForBudget(10)
        const damage = await getBattleUserDamage(battle._id, userId)
        const refIso = battle.endedAt ?? battle.createdAt ?? null
        return { damage, refIso }
      }),
    )

    for (const { damage, refIso } of batchResults) {
      if (!refIso || damage <= 0) continue
      const key = utcDayKey(Date.parse(refIso))
      const bucket = byDay.get(key)
      if (!bucket) continue
      bucket.damage += damage
      bucket.battles += 1
    }
  }

  const points = dayKeys.map((date) => byDay.get(date)!)
  return {
    userId,
    playerName: profile.name,
    avatarUrl: profile.avatarUrl,
    countryId: profile.country ?? null,
    countryName: profile.country ? countries.get(profile.country)?.name ?? null : null,
    days: points,
    totalDamage: points.reduce((sum, point) => sum + point.damage, 0),
    daysRequested: days,
    battlesScanned: scanned,
    updatedAt: new Date().toISOString(),
    fromCache: false,
    building: false,
    rateLimit: getRateLimitState(),
    dataSource: 'api',
  }
}

interface JusticePlayerDailyCacheEntry {
  data?: JusticePlayerDailyResponse
  promise?: Promise<void>
  expiresAt: number
}

const justicePlayerDailyCache = new Map<string, JusticePlayerDailyCacheEntry>()
const JUSTICE_PLAYER_DAILY_TTL = 10 * 60 * 1000

function emptyJusticePlayerDaily(userId: string, days: number): JusticePlayerDailyResponse {
  return {
    userId,
    playerName: userId,
    avatarUrl: null,
    countryId: null,
    countryName: null,
    days: [],
    totalDamage: 0,
    daysRequested: days,
    battlesScanned: 0,
    updatedAt: new Date().toISOString(),
    fromCache: false,
    building: true,
    rateLimit: getRateLimitState(),
  }
}

async function buildJusticePlayerDailyCache(userId: string, days: number): Promise<void> {
  const data = await buildJusticePlayerDailyData(userId, days)
  justicePlayerDailyCache.set(`${userId}:${days}`, {
    data,
    expiresAt: Date.now() + JUSTICE_PLAYER_DAILY_TTL,
  })
}

export async function getJusticePlayerDaily(
  userId: string,
  days = 7,
): Promise<JusticePlayerDailyResponse> {
  ensureWareraDbSyncStarted()
  const safeDays = Math.min(Math.max(Math.floor(days || 7), 1), 7)
  const dbData = await getDbJusticePlayerDaily(userId, safeDays)
  if (dbData && dbData.battlesScanned > 0) {
    const freshness = await getSyncFreshness('justice-user-battles')
    return {
      userId,
      playerName: dbData.playerName,
      avatarUrl: dbData.avatarUrl,
      countryId: dbData.countryId,
      countryName: dbData.countryName,
      days: dbData.days,
      totalDamage: dbData.totalDamage,
      daysRequested: safeDays,
      battlesScanned: dbData.battlesScanned,
      updatedAt: dbData.updatedAt ?? new Date().toISOString(),
      fromCache: false,
      building: false,
      dataSource: 'db',
      syncLagSeconds: freshness.lagSeconds,
      rateLimit: getRateLimitState(),
    }
  }

  const key = `${userId}:${safeDays}`
  const entry = justicePlayerDailyCache.get(key)
  const now = Date.now()

  if (entry?.data && entry.expiresAt > now) {
    return { ...entry.data, fromCache: true, building: false }
  }

  if (entry?.data) {
    if (!entry.promise) {
      entry.promise = buildJusticePlayerDailyCache(userId, safeDays)
        .catch(() => {})
        .finally(() => {
          const current = justicePlayerDailyCache.get(key)
          if (current) current.promise = undefined
        })
    }
    return { ...entry.data, fromCache: true, building: false }
  }

  if (!entry?.promise) {
    const promise = buildJusticePlayerDailyCache(userId, safeDays)
      .catch(() => {})
      .finally(() => {
        const current = justicePlayerDailyCache.get(key)
        if (current) current.promise = undefined
      })
    justicePlayerDailyCache.set(key, { promise, expiresAt: 0 })
  }

  return emptyJusticePlayerDaily(userId, safeDays)
}

// ---------------- META ----------------

export async function getMeta(): Promise<MetaResponse> {
  const [allianceId, muId] = await Promise.all([resolveAllianceId(), resolveMuId()])
  return {
    allianceId,
    allianceName: allianceId ? FEDERATION_NAME : null,
    muId,
    muName: muId ? JUSTICE_NAME : null,
    ok: Boolean(allianceId && muId),
  }
}

// helper export for potential tests
export const __test = { rankValue, asArray }
