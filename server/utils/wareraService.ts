import { trpcGet, getRateLimitState, waitForBudget } from './wareraClient'
import type {
  DamageRow,
  FederationResponse,
  FederationSupportResponse,
  JusticeResponse,
  MetaResponse,
  Period,
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
    fromCache,
    updatedAt: new Date().toISOString(),
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
  }
}

/** Builds the support aggregate and stores it in the cache. */
async function buildSupportCache(period: Period): Promise<void> {
  const allianceId = await resolveAllianceId()
  if (!allianceId) return

  const [alliance, { byId: countries }] = await Promise.all([
    getAlliance(allianceId),
    getCountries(),
  ])
  const memberSet = new Set(alliance.memberCountryIds)

  const { battles, scanned } = await scanFederationBattles(
    alliance.memberCountryIds,
    period,
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
  const entry = supportCache.get(period)
  const now = Date.now()

  // 1. Fresh cache — serve directly.
  if (entry?.data && entry.expiresAt > now) {
    return { ...entry.data, fromCache: true }
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
    return { ...entry.data, fromCache: true }
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

  return emptySupport(period, true)
}

// ---------------- JUSTICE ----------------

export async function getJusticeData(period: Period): Promise<JusticeResponse> {
  const muId = await resolveMuId()
  if (!muId) {
    throw createError({
      statusCode: 404,
      statusMessage: `Military Unit "${JUSTICE_NAME}" not found`,
    })
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
  }
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
