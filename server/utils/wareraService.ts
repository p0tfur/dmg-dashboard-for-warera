import { trpcGet, getRateLimitState } from './wareraClient'
import type {
  DamageRow,
  FederationResponse,
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
  const data = await fn()
  cache.set(key, { data, expiry: now + ttlMs })
  return { data, fromCache: false }
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
  const { data, fromCache } = await swr(cacheKey, 45 * 1000, async () => {
    const [alliance, { byId: countries }, allMus] = await Promise.all([
      getAlliance(allianceId),
      getCountries(),
      getAllMus(),
    ])

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

    // per MU (alliance countries)
    const byMu: DamageRow[] = []
    for (const mu of allMus) {
      if (!mu.country || !memberSet.has(mu.country)) continue
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
  const { data, fromCache } = await swr(cacheKey, 45 * 1000, async () => {
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
