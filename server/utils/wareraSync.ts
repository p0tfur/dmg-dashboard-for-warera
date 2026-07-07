import { trpcGet, waitForBudget } from './wareraClient'
import {
  getBattlesNeedingMoneyBackfill,
  markBattleMoneySynced,
  markSyncFailure,
  markSyncSuccess,
  needsBattleDetailsSync,
  needsBattleMoneySync,
  needsUserProfileEnrichment,
  recordAllianceMembershipSnapshot,
  recordCitizenshipSnapshot,
  upsertAlliance,
  upsertBattle,
  upsertBattleLoot,
  upsertBattleRankings,
  upsertCountries,
  upsertMuMembers,
  upsertMus,
  upsertTrackedEntity,
  upsertUsers,
  type AllianceSnapshot,
  type BattleLootSnapshot,
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
const FED_BATTLE_PAGE_LIMIT = 15
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
  const rankings = raw?.rankings ?? {}
  return {
    id: userId,
    name: raw?.username ?? raw?.name ?? userId,
    avatarUrl: raw?.avatar_url ?? raw?.avatarUrl ?? null,
    country: raw?.country ?? raw?.citizenship ?? raw?.countryId ?? null,
    muId: raw?.mu ?? null,
    isActive: raw?.is_active ?? raw?.isActive ?? null,
    militaryRank: raw?.military_rank ?? raw?.militaryRank ?? null,
    createdAt: raw?.created_at ?? raw?.createdAt ?? null,
    updatedAt: raw?.updated_at ?? raw?.updatedAt ?? null,
    level: raw?.leveling?.level ?? null,
    totalXp: raw?.leveling?.total_xp ?? raw?.leveling?.totalXp ?? null,
    totalDamages: raw?.stats?.damages_count ?? raw?.stats?.damagesCount ?? null,
    weeklyDamage: rankings?.weekly_user_damages?.value ?? rankings?.weeklyUserDamages?.value ?? null,
    totalDamageRank: rankings?.user_damages?.rank ?? rankings?.userDamages?.rank ?? null,
    weeklyDamageRank: rankings?.weekly_user_damages?.rank ?? rankings?.weeklyUserDamages?.rank ?? null,
    dates: raw?.dates ?? null,
    stats: raw?.stats ?? null,
    rankings: raw?.rankings ?? null,
    skills: raw?.skills ?? null,
    infos: raw?.infos ?? null,
    fullRaw: raw?.skills || raw?.missions || raw?.equipment || raw?.preferences ? raw : null,
    raw,
  }
}

/**
 * Pulls `dates.lastCitizenshipChangeAt` out of a raw user profile. The game
 * exposes only this single marker (no full citizenship history), so we treat
 * it as "the country changed to the current one at this UTC timestamp".
 */
function extractLastCitizenshipChangeAt(raw: any): string | null {
  const dates = raw?.dates ?? {}
  return (
    dates?.lastCitizenshipChangeAt
    ?? dates?.last_citizenship_change_at
    ?? null
  )
}

/**
 * Lightweight per-user context used by the battle-ranking attribution pass:
 *   • currentCountry   — `user.country` from the latest profile
 *   • lastChangeAt     — `dates.lastCitizenshipChangeAt` (game-side marker)
 */
interface UserContextEntry {
  currentCountry: string | null
  lastChangeAt: string | null
}
type UserContext = Map<string, UserContextEntry>

function mapBattle(raw: BattleListItem): BattleSnapshot | null {
  if (!raw?._id) return null
  return {
    id: raw._id,
    warId: (raw as any).war ?? (raw as any).warId ?? (raw as any).war_id ?? null,
    regionId: (raw as any).region ?? (raw as any).regionId ?? (raw as any).region_id ?? null,
    isActive: Boolean((raw as any).is_active ?? raw.isActive),
    attackerCountryId: raw.attacker?.country ?? null,
    defenderCountryId: raw.defender?.country ?? null,
    winnerCountryId: (raw as any).winnerCountry ?? (raw as any).winner_country ?? (raw as any).winner_country_id ?? null,
    attackerScore: (raw as any).attacker_score ?? (raw as any).attackerScore ?? null,
    defenderScore: (raw as any).defender_score ?? (raw as any).defenderScore ?? null,
    attackerDamage: raw.attacker?.damages ?? null,
    defenderDamage: raw.defender?.damages ?? null,
    currentRound: (raw as any).current_round ?? (raw as any).currentRound ?? null,
    rounds: (raw as any).rounds ?? null,
    roundsHistory: (raw as any).rounds_history ?? (raw as any).roundsHistory ?? null,
    battleType: (raw as any).type ?? null,
    totalRounds: (raw as any).total_rounds ?? (raw as any).totalRounds ?? null,
    roundsToWin: (raw as any).rounds_to_win ?? (raw as any).roundsToWin ?? null,
    createdAt: (raw as any).created_at ?? raw.createdAt ?? null,
    endedAt: (raw as any).ended_at ?? raw.endedAt ?? (raw as any).end_time ?? null,
    raw,
  }
}

function mapBattleDetails(raw: any): BattleSnapshot | null {
  const battle = mapBattle(raw as BattleListItem)
  if (!battle) return null
  return {
    ...battle,
    warId: raw?.war ?? raw?.warId ?? raw?.war_id ?? battle.warId ?? null,
    regionId: raw?.region ?? raw?.regionId ?? raw?.region_id ?? battle.regionId ?? null,
    winnerCountryId: raw?.winnerCountry ?? raw?.winner_country ?? raw?.winner_country_id ?? battle.winnerCountryId ?? null,
    attackerScore: raw?.attacker_score ?? raw?.attackerScore ?? battle.attackerScore ?? null,
    defenderScore: raw?.defender_score ?? raw?.defenderScore ?? battle.defenderScore ?? null,
    attackerDamage: raw?.attacker?.damages ?? battle.attackerDamage ?? null,
    defenderDamage: raw?.defender?.damages ?? battle.defenderDamage ?? null,
    currentRound: raw?.current_round ?? raw?.currentRound ?? battle.currentRound ?? null,
    rounds: raw?.rounds ?? battle.rounds ?? null,
    roundsHistory: raw?.rounds_history ?? raw?.roundsHistory ?? battle.roundsHistory ?? null,
    battleType: raw?.type ?? battle.battleType ?? null,
    totalRounds: raw?.total_rounds ?? raw?.totalRounds ?? battle.totalRounds ?? null,
    roundsToWin: raw?.rounds_to_win ?? raw?.roundsToWin ?? battle.roundsToWin ?? null,
    detailsRaw: raw,
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

  // Track membership changes (new joiners, leavers) so the dashboard can
  // filter pre-membership damage from aggregations.
  await recordAllianceMembershipSnapshot(allianceId, alliance.memberCountryIds)

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

async function syncJusticeMembers(muId: string): Promise<{ userIds: string[]; userContext: UserContext }> {
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
  const userContext: UserContext = new Map()
  for (const member of members) {
    await waitForBudget(20)
    try {
      const needsFull = await needsUserProfileEnrichment(member.userId)
      const rawUser = await trpcGet<any>(
        needsFull ? 'user.getUserById' : 'user.getUserLite',
        { userId: member.userId },
        1,
      )
      users.push(mapUser(member.userId, rawUser))

      const country = rawUser?.country ?? rawUser?.citizenship ?? rawUser?.countryId ?? null
      const lastChangeAt = extractLastCitizenshipChangeAt(rawUser)
      userContext.set(member.userId, { currentCountry: country, lastChangeAt })

      // Append-only citizenship snapshot: only records a new row when the
      // country actually changes vs. the previous open entry.
      if (country) {
        await recordCitizenshipSnapshot({
          userId: member.userId,
          countryId: country,
          lastChangeAt,
        })
      }
    } catch {
      users.push({ id: member.userId, name: member.userId, avatarUrl: null, country: null })
    }
  }
  await upsertUsers(users)
  return { userIds: members.map((member) => member.userId), userContext }
}

async function syncBattleRankings(battleId: string, battleEndedAt: string | null, userContext?: UserContext): Promise<Set<string>> {
  const requests: Array<Promise<BattleRankingSnapshot[]>> = [
    fetchBattleRankings(battleId, 'country', 'merged', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'country', 'attacker', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'country', 'defender', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'user', 'merged', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'user', 'attacker', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'user', 'defender', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'mu', 'merged', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'mu', 'attacker', battleEndedAt, userContext),
    fetchBattleRankings(battleId, 'mu', 'defender', battleEndedAt, userContext),
  ]
  const results = await Promise.all(requests)
  const rankings = results.flat()
  await upsertBattleRankings(rankings)
  await markBattleMoneySynced(battleId)

  // Collect user entity IDs that appeared in the merged ranking — used by
  // the caller to drive targeted loot-summary fetches (only for users who
  // actually fought, not every MU member).
  const userIds = new Set<string>()
  for (const r of results[3] ?? []) {
    if (r.entityType === 'user') userIds.add(r.entityId)
  }
  return userIds
}

/**
 * Fetches bounty vs contract loot summaries for a set of users in a single
 * battle. Called during the Justice MU battle scan to populate the
 * `warera_battle_loot` table used for hover tooltips.
 */
async function syncBattleLoot(battleId: string, userIds: string[]): Promise<void> {
  if (!userIds.length) return
  const loot: BattleLootSnapshot[] = []
  const CONCURRENCY = 5
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (userId): Promise<BattleLootSnapshot | null> => {
      await waitForBudget(10)
      try {
        const raw = await trpcGet<any>('battleLootSummary.getByBattleAndUser', {
          battleId,
          userId,
        }, 1)
        if (!raw) return null
        const bounty = Number(raw.total_money_from_bounty ?? raw.totalMoneyFromBounty ?? 0)
        const contract = Number(raw.total_money_from_contract ?? raw.totalMoneyFromContract ?? 0)
        // Skip users with no earnings at all.
        if (bounty === 0 && contract === 0) return null
        return {
          battleId,
          userId,
          moneyFromBounty: bounty,
          moneyFromContract: contract,
          totalDmg: Number(raw.total_dmg ?? raw.totalDmg ?? 0),
          hits: Number(raw.hits ?? 0),
          raw,
        }
      } catch {
        return null
      }
    }))
    for (const r of results) {
      if (r) loot.push(r)
    }
  }
  if (loot.length) await upsertBattleLoot(loot)
}

/**
 * Backfills money rankings for a single battle that was synced before the
 * money stream existed. Only fetches the 3 merged variants (country/user/mu)
 * to keep the API budget low — 6 calls per battle instead of 18.
 * Also fetches loot for Justice members who fought in this battle.
 */
async function backfillBattleMoney(battleId: string, userContext?: UserContext): Promise<void> {
  const requests = [
    fetchBattleRankings(battleId, 'country', 'merged'),
    fetchBattleRankings(battleId, 'user', 'merged'),
    fetchBattleRankings(battleId, 'mu', 'merged'),
  ]
  const rankings = (await Promise.all(requests)).flat()
  await upsertBattleRankings(rankings)
  await markBattleMoneySynced(battleId)

  // Loot (bounty/contract) is only relevant for Justice members.
  if (userContext) {
    const userIds = new Set<string>()
    for (const r of rankings) {
      if (r.entityType === 'user' && userContext.has(r.entityId)) {
        userIds.add(r.entityId)
      }
    }
    if (userIds.size) {
      await syncBattleLoot(battleId, [...userIds])
    }
  }
}

async function fetchBattleRankings(
  battleId: string,
  entityType: 'user' | 'country' | 'mu',
  side: 'attacker' | 'defender' | 'merged',
  battleEndedAt?: string | null,
  userContext?: UserContext,
): Promise<BattleRankingSnapshot[]> {
  await waitForBudget(15)
  // Fetch damage and money rankings in parallel — same entity set, different metric.
  const [damageRaw, moneyRaw] = await Promise.all([
    trpcGet<any>('battleRanking.getRanking', {
      battleId,
      dataType: 'damage',
      type: entityType,
      side,
      limit: 100,
    }, 1),
    trpcGet<any>('battleRanking.getRanking', {
      battleId,
      dataType: 'money',
      type: entityType,
      side,
      limit: 100,
    }, 1),
  ])

  // Build entityId → money lookup from the money ranking response.
  const moneyByEntity = new Map<string, number>()
  for (const item of asArray<any>(moneyRaw)) {
    const eid = item?.[entityType] ?? item?.entityId
    if (eid) moneyByEntity.set(eid, Number(item?.value ?? 0))
  }

  // Build snapshots: iterate damage items, attach money from the lookup.
  const snapshots: BattleRankingSnapshot[] = []
  for (const item of asArray<any>(damageRaw)) {
    const entityId = item?.[entityType] ?? item?.entityId
    if (!entityId) continue

    // Compute attribution for user-type entries only.
    let attributedCountryId: string | null = null
    let attributionConfidence: 'certain' | 'probable' | 'unknown' = 'unknown'

    if (entityType === 'user' && userContext) {
      const context = userContext.get(entityId)
      if (context?.currentCountry) {
        const refTs = battleEndedAt ? Date.parse(battleEndedAt) : NaN
        const changeTs = context.lastChangeAt ? Date.parse(context.lastChangeAt) : NaN
        if (Number.isFinite(refTs) && Number.isFinite(changeTs)) {
          if (refTs >= changeTs) {
            attributedCountryId = context.currentCountry
            attributionConfidence = 'certain'
          } else {
            attributionConfidence = 'unknown'
          }
        } else {
          attributedCountryId = context.currentCountry
          attributionConfidence = 'unknown'
        }
      }
    }

    snapshots.push({
      battleId,
      entityType,
      entityId,
      attributedCountryId,
      attributionConfidence,
      side,
      damage: Number(item?.value ?? 0),
      money: moneyByEntity.get(entityId) ?? 0,
      rank: item?.rank ?? null,
      raw: item,
    })
  }
  return snapshots
}

async function scanFederationBattles(memberCountryIds: string[], userContext: UserContext): Promise<void> {
  // Finished battles have immutable rankings — once synced (money_synced_at
  // is set), we skip them entirely. The battle list is `direction: 'backward'`
  // (newest first), so once an entire page is already synced we stop
  // paginating: everything older is already in the DB.
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

        let processedAny = false
        for (const item of items) {
          const battle = mapBattle(item)
          if (!battle) continue
          // Skip battles whose rankings are already synced.
          if (!(await needsBattleMoneySync(battle.id))) continue
          processedAny = true
          if (await needsBattleDetailsSync(battle.id)) {
            await upsertBattle(battle)
            await syncBattleDetails(battle.id)
          }
          const battleUserIds = await syncBattleRankings(battle.id, battle.endedAt, userContext)
          // Fetch bounty/contract loot for Justice members who fought in this
          // Federation battle — same pattern as syncJusticeMuBattles.
          const justiceParticipants = [...battleUserIds].filter((uid) => userContext.has(uid))
          if (justiceParticipants.length) {
            await syncBattleLoot(battle.id, justiceParticipants)
          }
        }

        // Whole page already synced — nothing older can be new.
        if (!processedAny) break

        cursor = raw?.nextCursor ?? undefined
        if (!cursor) break
        guard++
      }
    }))
  }

  await markSyncSuccess('federation-battles')
}

async function syncBattleDetails(battleId: string): Promise<void> {
  await waitForBudget(15)
  const raw = await trpcGet<any>('battle.getById', { battleId }, 1)
  const battle = mapBattleDetails(raw)
  if (!battle) return
  await upsertBattle(battle)
}

/** Backfill cap per sync cycle (each battle = 6 API calls for merged money). */
const MONEY_BACKFILL_BATCH = 10

/**
 * Picks the oldest battles without money data and enriches them. Runs once
 * per sync cycle (every 2 min) and processes at most MONEY_BACKFILL_BATCH
 * battles. Over time this naturally backfills the entire history.
 */
async function backfillMoneyRankings(userContext?: UserContext): Promise<void> {
  const battleIds = await getBattlesNeedingMoneyBackfill(MONEY_BACKFILL_BATCH)
  if (!battleIds.length) return
  console.log(`[warera] money backfill: enriching ${battleIds.length} battles`)
  for (const battleId of battleIds) {
    try {
      await backfillBattleMoney(battleId, userContext)
    } catch (err) {
      // Don't abort the whole batch — just log and continue.
      console.warn(`[warera] money backfill failed for ${battleId}:`, (err as Error)?.message ?? err)
    }
  }
  await markSyncSuccess('money-backfill')
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

    const { userIds: _userIds, userContext } = await syncJusticeMembers(justiceMuId)
    await markSyncSuccess('justice-members')

    if (!alliance) {
      const rawAlliance = await trpcGet<any>('alliance.getById', { allianceId })
      alliance = mapAlliance(rawAlliance, allianceId)
      await upsertAlliance(alliance)
    }
    await scanFederationBattles(alliance.memberCountryIds, userContext)

    // Justice daily charts need user-level battle rankings. Instead of
    // fetching per-user (which would re-request the same MU battles N times),
    // we fetch Justice MU battles once and sync rankings, passing userContext
    // so attribution confidence is computed on the fly.
    await syncJusticeMuBattles(justiceMuId, userContext)

    // Gradual backfill: enrich old battles that were synced before the money
    // stream existed. Processes a small batch each cycle to avoid exhausting
    // the API budget. New battles are handled inline by syncBattleRankings.
    await backfillMoneyRankings(userContext)
  } catch (err) {
    await markSyncFailure('main', err)
  } finally {
    running = false
  }
}

/**
 * Syncs recent (7-day) battles for a MU, validates that a tracked user
 * actually participated via battleRankings, and records the battle+rankings.
 *
 * Replaces the old per-user scan (`syncJusticeUserBattles`) which duplicated
 * MU-level battle lists for every member.
 */
async function syncJusticeMuBattles(muId: string, userContext: UserContext): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  // Fetch battles once per MU (not per-user), same 3-page window as before.
  let cursor: string | undefined
  let guard = 0
  while (guard < 3) {
    await waitForBudget(15)
    const raw = await trpcGet<any>('battle.getBattles', {
      muId,
      isActive: false,
      limit: 100,
      direction: 'backward',
      cursor,
    }, 1)
    const items = asArray<BattleListItem>(raw?.items ? raw : raw)
    if (!items.length) break

    let hitCutoff = false
    let processedAny = false
    for (const item of items) {
      const refIso = item.endedAt ?? item.createdAt ?? null
      const refTs = refIso ? Date.parse(refIso) : NaN
      if (Number.isFinite(refTs) && refTs < cutoff) {
        hitCutoff = true
        break
      }
      const battle = mapBattle(item)
      if (!battle) continue
      // Skip battles whose rankings are already synced (finished = immutable).
      if (!(await needsBattleMoneySync(battle.id))) continue
      processedAny = true
      await upsertBattle(battle)
      if (await needsBattleDetailsSync(battle.id)) {
        await syncBattleDetails(battle.id)
      }
      // Pass userContext so attribution confidence is populated for known users.
      const battleUserIds = await syncBattleRankings(battle.id, battle.endedAt, userContext)
      // Fetch bounty/contract loot only for Justice members who fought here.
      const justiceParticipants = [...battleUserIds].filter((uid) => userContext.has(uid))
      if (justiceParticipants.length) {
        await syncBattleLoot(battle.id, justiceParticipants)
      }
    }
    if (hitCutoff) break
    // Whole page already synced — nothing older can be new.
    if (!processedAny) break
    cursor = raw?.nextCursor ?? undefined
    if (!cursor) break
    guard++
  }
  await markSyncSuccess('justice-user-battles')
}
