import { trpcGet, waitForBudget } from './wareraClient'
import {
  getSyncCheckpoint,
  markSyncFailure,
  markSyncSuccess,
  upsertAlliance,
  upsertBattle,
  upsertBattleRankings,
  upsertCountries,
  upsertMuMembers,
  upsertMus,
  upsertTrackedEntity,
  upsertUsers,
  type AllianceSnapshot,
  type BattleRankingSnapshot,
  type BattleSnapshot,
  type CountrySnapshot,
  type MuMemberSnapshot,
  type MuSnapshot,
  type UserSnapshot,
} from './wareraRepository'
import { isWareraDbEnabled } from './wareraDb'

const FEDERATION_NAME = (process.env.WARERA_ALLIANCE_NAME as string) || 'The Federation'
const JUSTICE_NAME = (process.env.WARERA_NAME as string) || 'Justice'
const FEDERATION_ID = process.env.WARERA_ALLIANCE_ID as string | undefined
const JUSTICE_ID = (process.env.WARERA_MU_ID as string | undefined) ?? '687633b772c4886cc6fa3d56'
const FED_EXTRA_MU_IDS = ((process.env.WARERA_FED_EXTRA_MU_IDS as string | undefined) ||
  '687633b772c4886cc6fa3d56,698ca55790b70ac76de933c5')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const SYNC_INTERVAL_MS = 2 * 60 * 1000
const REFERENCE_INTERVAL_MS = 10 * 60 * 1000
const FED_BATTLE_PAGE_LIMIT = 8
const FED_COUNTRY_CONCURRENCY = 2

let started = false
let running = false
let timer: ReturnType<typeof setInterval> | null = null
let lastReferenceSync = 0

interface BattleListItem {
  _id: string
  isActive?: boolean
  createdAt?: string | null
  endedAt?: string | null
  defender?: { country?: string | null }
  attacker?: { country?: string | null }
}

function asArray<T = any>(raw: any): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.items)) return raw.items as T[]
    if (Array.isArray(raw.data)) return raw.data as T[]
    for (const value of Object.values(raw)) {
      if (Array.isArray(value)) return value as T[]
    }
  }
  return []
}

async function resolveAllianceId(): Promise<string | null> {
  if (FEDERATION_ID) return FEDERATION_ID
  const raw = await trpcGet<any>('search.searchAnything', { searchText: FEDERATION_NAME })
  return (raw?.allianceIds?.[0] as string | undefined) ?? null
}

async function resolveJusticeMuId(): Promise<string | null> {
  if (JUSTICE_ID) return JUSTICE_ID
  const raw = await trpcGet<any>('search.searchAnything', { searchText: JUSTICE_NAME })
  return (raw?.muIds?.[0] as string | undefined) ?? null
}

function mapCountry(raw: any): CountrySnapshot | null {
  if (!raw?._id) return null
  return {
    id: raw._id,
    name: raw.name ?? raw._id,
    code: raw.code ?? null,
    weekly: Number(raw?.rankings?.weeklyCountryDamages?.value ?? 0),
    total: Number(raw?.rankings?.countryDamages?.value ?? 0),
    raw,
  }
}

function mapAlliance(raw: any, id: string): AllianceSnapshot {
  const ranks = raw?.rankings ?? {}
  return {
    id,
    name: raw?.name ?? FEDERATION_NAME,
    avatarUrl: raw?.avatarUrl ?? null,
    memberCountryIds: (raw?.memberCountries ?? [])
      .map((member: any) => member?.country)
      .filter((country: any): country is string => Boolean(country)),
    weeklyDamage: Number(ranks?.allianceWeeklyDamages?.value ?? 0),
    totalDamage: Number(ranks?.allianceDamages?.value ?? 0),
    globalWeeklyRank: ranks?.allianceWeeklyDamages?.rank ?? null,
    globalTotalRank: ranks?.allianceDamages?.rank ?? null,
    population: ranks?.alliancePopulation?.value ?? null,
    raw,
  }
}

function mapMu(raw: any, idFallback?: string): MuSnapshot | null {
  const id = raw?._id ?? idFallback
  if (!id) return null
  const ranks = raw?.rankings ?? {}
  return {
    id,
    name: raw?.name ?? id,
    country: raw?.country ?? raw?.countryId ?? null,
    avatarUrl: raw?.avatarUrl ?? null,
    weekly: Number(ranks?.muWeeklyDamages?.value ?? 0),
    total: Number(ranks?.muDamages?.value ?? 0),
    level: raw?.leveling?.level ?? null,
    globalWeeklyRank: ranks?.muWeeklyDamages?.rank ?? null,
    globalTotalRank: ranks?.muDamages?.rank ?? null,
    raw,
  }
}

function mapUser(userId: string, raw: any): UserSnapshot {
  return {
    id: userId,
    name: raw?.username ?? raw?.name ?? userId,
    avatarUrl: raw?.avatarUrl ?? null,
    country: raw?.country ?? raw?.citizenship ?? raw?.countryId ?? null,
    raw,
  }
}

function mapBattle(raw: BattleListItem): BattleSnapshot | null {
  if (!raw?._id) return null
  return {
    id: raw._id,
    isActive: Boolean(raw.isActive),
    attackerCountryId: raw.attacker?.country ?? null,
    defenderCountryId: raw.defender?.country ?? null,
    createdAt: raw.createdAt ?? null,
    endedAt: raw.endedAt ?? null,
    raw,
  }
}

async function syncReferences(allianceId: string, justiceMuId: string): Promise<AllianceSnapshot> {
  const [countriesRaw, allianceRaw, justiceRaw] = await Promise.all([
    trpcGet<any>('country.getAllCountries', {}),
    trpcGet<any>('alliance.getById', { allianceId }),
    trpcGet<any>('mu.getById', { muId: justiceMuId }),
  ])

  const countries = asArray<any>(countriesRaw).map(mapCountry).filter((c): c is CountrySnapshot => Boolean(c))
  const alliance = mapAlliance(allianceRaw, allianceId)
  const justice = mapMu(justiceRaw, justiceMuId)

  await Promise.all([
    upsertCountries(countries),
    upsertAlliance(alliance),
    justice ? upsertMus([justice]) : Promise.resolve(),
    upsertTrackedEntity('federation', 'alliance', allianceId, alliance.name, { source: 'env-or-search' }),
    upsertTrackedEntity('justice', 'mu', justiceMuId, justice?.name ?? JUSTICE_NAME, { source: 'env-or-search' }),
    ...FED_EXTRA_MU_IDS.map((id) => upsertTrackedEntity(`extra_mu:${id}`, 'extra_mu', id, null)),
  ])

  await syncAllMus()
  return alliance
}

async function syncAllMus(): Promise<void> {
  const out: MuSnapshot[] = []
  let cursor: string | undefined
  let guard = 0
  do {
    await waitForBudget(20)
    const raw = await trpcGet<any>('mu.getManyPaginated', { limit: 100, cursor })
    out.push(...asArray<any>(raw?.items ? raw : raw).map((m) => mapMu(m)).filter((m): m is MuSnapshot => Boolean(m)))
    cursor = raw?.nextCursor ?? undefined
    guard++
  } while (cursor && guard < 30)

  const known = new Set(out.map((mu) => mu.id))
  for (const id of FED_EXTRA_MU_IDS) {
    if (known.has(id)) continue
    const raw = await trpcGet<any>('mu.getById', { muId: id })
    const mu = mapMu(raw, id)
    if (mu) out.push(mu)
  }
  await upsertMus(out)
}

async function syncJusticeMembers(muId: string): Promise<string[]> {
  const raw = await trpcGet<any>('muMember.getByMu', { muId })
  const members: MuMemberSnapshot[] = asArray<any>(raw).map((m) => ({
    muId,
    userId: m?.user,
    weekly: Number(m?.weeklyDamagesCount ?? 0),
    monthly: Number(m?.monthlyDamagesCount ?? 0),
    total: Number(m?.totalDamagesCount ?? 0),
    weeklyHelp: Number(m?.weeklyHelpCount ?? 0),
    monthlyHelp: Number(m?.monthlyHelpCount ?? 0),
    totalHelp: Number(m?.totalHelpCount ?? 0),
    raw: m,
  })).filter((m) => Boolean(m.userId))
  await upsertMuMembers(members)

  const users: UserSnapshot[] = []
  for (const member of members) {
    await waitForBudget(20)
    try {
      const rawUser = await trpcGet<any>('user.getUserLite', { userId: member.userId }, 1)
      users.push(mapUser(member.userId, rawUser))
    } catch {
      users.push({ id: member.userId, name: member.userId, avatarUrl: null, country: null })
    }
  }
  await upsertUsers(users)
  return members.map((member) => member.userId)
}

async function syncBattleRankings(battleId: string): Promise<void> {
  const requests: Array<Promise<BattleRankingSnapshot[]>> = [
    fetchBattleRankings(battleId, 'country'),
    fetchBattleRankings(battleId, 'user'),
    fetchBattleRankings(battleId, 'mu'),
  ]
  const rankings = (await Promise.all(requests)).flat()
  await upsertBattleRankings(rankings)
}

async function fetchBattleRankings(
  battleId: string,
  entityType: 'user' | 'country' | 'mu',
): Promise<BattleRankingSnapshot[]> {
  await waitForBudget(15)
  const raw = await trpcGet<any>('battleRanking.getRanking', {
    battleId,
    dataType: 'damage',
    type: entityType,
    side: 'merged',
    limit: 100,
  }, 1)
  return asArray<any>(raw).map((item) => {
    const entityId = item?.[entityType] ?? item?.entityId
    if (!entityId) return null
    return {
      battleId,
      entityType,
      entityId,
      side: 'merged' as const,
      damage: Number(item?.value ?? 0),
      rank: item?.rank ?? null,
      raw: item,
    }
  }).filter((item): item is BattleRankingSnapshot => Boolean(item))
}

async function scanFederationBattles(memberCountryIds: string[]): Promise<void> {
  const checkpoint = await getSyncCheckpoint('federation-battles')
  let newestSeen: string | null = null

  for (let i = 0; i < memberCountryIds.length; i += FED_COUNTRY_CONCURRENCY) {
    const batch = memberCountryIds.slice(i, i + FED_COUNTRY_CONCURRENCY)
    await Promise.all(batch.map(async (countryId) => {
      let cursor: string | undefined
      let guard = 0
      while (guard < FED_BATTLE_PAGE_LIMIT) {
        await waitForBudget(20)
        const raw = await trpcGet<any>('battle.getBattles', {
          countryId,
          isActive: false,
          limit: 100,
          direction: 'backward',
          cursor,
        })
        const items = asArray<BattleListItem>(raw?.items ? raw : raw)
        if (!items.length) break

        for (const item of items) {
          const battle = mapBattle(item)
          if (!battle) continue
          newestSeen ||= battle.id
          if (checkpoint && battle.id === checkpoint) return
          await upsertBattle(battle)
          await syncBattleRankings(battle.id)
        }

        cursor = raw?.nextCursor ?? undefined
        if (!cursor) break
        guard++
      }
    }))
  }

  await markSyncSuccess('federation-battles', newestSeen)
}

export function ensureWareraDbSyncStarted(): void {
  if (!isWareraDbEnabled() || started) return
  started = true
  void runWareraDbSyncOnce()
  timer = setInterval(() => {
    void runWareraDbSyncOnce()
  }, SYNC_INTERVAL_MS)
  timer.unref?.()
}

export async function runWareraDbSyncOnce(): Promise<void> {
  if (!isWareraDbEnabled() || running) return
  running = true
  try {
    const [allianceId, justiceMuId] = await Promise.all([resolveAllianceId(), resolveJusticeMuId()])
    if (!allianceId || !justiceMuId) return

    let alliance: AllianceSnapshot | null = null
    if (Date.now() - lastReferenceSync > REFERENCE_INTERVAL_MS) {
      alliance = await syncReferences(allianceId, justiceMuId)
      lastReferenceSync = Date.now()
      await markSyncSuccess('references')
    }

    const userIds = await syncJusticeMembers(justiceMuId)
    await markSyncSuccess('justice-members')

    if (!alliance) {
      const rawAlliance = await trpcGet<any>('alliance.getById', { allianceId })
      alliance = mapAlliance(rawAlliance, allianceId)
      await upsertAlliance(alliance)
    }
    await scanFederationBattles(alliance.memberCountryIds)

    // Justice daily charts need user-level rankings; Federation battle sync already
    // captures most member activity, but this small pass fills gaps for active members.
    await syncJusticeUserBattles(userIds)
  } catch (err) {
    await markSyncFailure('main', err)
  } finally {
    running = false
  }
}

async function syncJusticeUserBattles(userIds: string[]): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const userId of userIds) {
    let cursor: string | undefined
    let guard = 0
    while (guard < 3) {
      await waitForBudget(15)
      const raw = await trpcGet<any>('battle.getBattles', {
        userId,
        isActive: false,
        limit: 100,
        direction: 'backward',
        cursor,
      }, 1)
      const items = asArray<BattleListItem>(raw?.items ? raw : raw)
      if (!items.length) break
      let hitCutoff = false
      for (const item of items) {
        const refIso = item.endedAt ?? item.createdAt ?? null
        const refTs = refIso ? Date.parse(refIso) : NaN
        if (Number.isFinite(refTs) && refTs < cutoff) {
          hitCutoff = true
          break
        }
        const battle = mapBattle(item)
        if (!battle) continue
        await upsertBattle(battle)
        await syncBattleRankings(battle.id)
      }
      if (hitCutoff) break
      cursor = raw?.nextCursor ?? undefined
      if (!cursor) break
      guard++
    }
  }
  await markSyncSuccess('justice-user-battles')
}
