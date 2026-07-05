import type { ResultSetHeader } from 'mysql2/promise'
import { fromMysqlDate, jsonParam, toMysqlDate, withWareraDb, withWareraDbConnection, type DbRow } from './wareraDb'
import type { DailyDamagePoint, DamageRow, Period, PlayerRow, SupportRecipientRow } from '~~/shared/types/warera'

export interface CountrySnapshot {
  id: string
  name: string
  code: string | null
  weekly: number
  total: number
  raw?: unknown
}

export interface AllianceSnapshot {
  id: string
  name: string
  avatarUrl: string | null
  memberCountryIds: string[]
  weeklyDamage: number
  totalDamage: number
  globalWeeklyRank: number | null
  globalTotalRank: number | null
  population: number | null
  raw?: unknown
}

export interface MuSnapshot {
  id: string
  name: string
  country: string | null
  avatarUrl: string | null
  weekly: number
  total: number
  level: number | null
  globalWeeklyRank?: number | null
  globalTotalRank?: number | null
  raw?: unknown
}

export interface MuMemberSnapshot {
  muId: string
  userId: string
  weekly: number
  monthly: number
  total: number
  weeklyHelp: number
  monthlyHelp: number
  totalHelp: number
  raw?: unknown
}

export interface UserSnapshot {
  id: string
  name: string
  avatarUrl: string | null
  country: string | null
  muId?: string | null
  isActive?: boolean | null
  militaryRank?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  level?: number | null
  totalXp?: number | null
  totalDamages?: number | null
  weeklyDamage?: number | null
  totalDamageRank?: number | null
  weeklyDamageRank?: number | null
  dates?: unknown
  stats?: unknown
  rankings?: unknown
  skills?: unknown
  infos?: unknown
  fullRaw?: unknown
  raw?: unknown
}

export interface BattleSnapshot {
  id: string
  warId?: string | null
  regionId?: string | null
  isActive: boolean
  attackerCountryId: string | null
  defenderCountryId: string | null
  winnerCountryId?: string | null
  attackerScore?: number | null
  defenderScore?: number | null
  attackerDamage?: number | null
  defenderDamage?: number | null
  currentRound?: unknown
  rounds?: unknown
  roundsHistory?: unknown
  battleType?: string | null
  totalRounds?: number | null
  roundsToWin?: number | null
  detailsRaw?: unknown
  createdAt: string | null
  endedAt: string | null
  raw?: unknown
}

export type AttributionConfidence = 'certain' | 'probable' | 'unknown'

export interface BattleRankingSnapshot {
  battleId: string
  entityType: 'user' | 'country' | 'mu'
  entityId: string
  attributedCountryId?: string | null
  attributionConfidence?: AttributionConfidence
  side: 'attacker' | 'defender' | 'merged'
  damage: number
  rank: number | null
  raw?: unknown
}

/** Single row of the append-only citizenship history. */
export interface CitizenshipHistoryEntry {
  userId: string
  countryId: string
  /** Inclusive UTC timestamp; the country is treated as valid starting here. */
  validFrom: string
  /** Exclusive UTC timestamp; null means the entry is currently open. */
  validTo: string | null
  source: 'profile' | 'inferred'
  confidence: 'certain' | 'probable'
  /** Game-side marker (`dates.lastCitizenshipChangeAt`) for when it took effect. */
  lastChangeAt: string | null
}

export interface DbFreshness {
  updatedAt: string | null
  lagSeconds: number | null
}

const periodColumn = (period: Period) => (period === 'all' ? 'total_damage' : 'weekly_damage')

export async function upsertTrackedEntity(
  key: string,
  entityType: string,
  entityId: string,
  name: string | null,
  metadata?: unknown,
): Promise<void> {
  await withWareraDb('upsertTrackedEntity', async (db) => {
    await db.execute(
      `INSERT INTO warera_tracked_entities (entity_key, entity_type, entity_id, name, metadata_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE entity_type = VALUES(entity_type), entity_id = VALUES(entity_id),
         name = VALUES(name), metadata_json = VALUES(metadata_json)`,
      [key, entityType, entityId, name, jsonParam(metadata)],
    )
  })
}

export async function upsertCountries(countries: CountrySnapshot[]): Promise<void> {
  if (!countries.length) return
  await withWareraDbConnection('upsertCountries', async (db) => {
    for (const c of countries) {
      await db.execute(
        `INSERT INTO warera_countries (country_id, name, code, weekly_damage, total_damage, raw_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), code = VALUES(code),
           weekly_damage = VALUES(weekly_damage), total_damage = VALUES(total_damage), raw_json = VALUES(raw_json)`,
        [c.id, c.name, c.code, c.weekly, c.total, jsonParam(c.raw)],
      )
    }
  })
}

export async function upsertAlliance(alliance: AllianceSnapshot): Promise<void> {
  await withWareraDb('upsertAlliance', async (db) => {
    await db.execute(
      `INSERT INTO warera_alliances
       (alliance_id, name, avatar_url, member_country_ids, weekly_damage, total_damage,
        global_weekly_rank, global_total_rank, population, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), avatar_url = VALUES(avatar_url),
         member_country_ids = VALUES(member_country_ids), weekly_damage = VALUES(weekly_damage),
         total_damage = VALUES(total_damage), global_weekly_rank = VALUES(global_weekly_rank),
         global_total_rank = VALUES(global_total_rank), population = VALUES(population),
         raw_json = VALUES(raw_json)`,
      [
        alliance.id,
        alliance.name,
        alliance.avatarUrl,
        jsonParam(alliance.memberCountryIds),
        alliance.weeklyDamage,
        alliance.totalDamage,
        alliance.globalWeeklyRank,
        alliance.globalTotalRank,
        alliance.population,
        jsonParam(alliance.raw),
      ],
    )
  })
}

export async function upsertMus(mus: MuSnapshot[]): Promise<void> {
  if (!mus.length) return
  await withWareraDbConnection('upsertMus', async (db) => {
    for (const mu of mus) {
      await db.execute(
        `INSERT INTO warera_mus
         (mu_id, name, country_id, avatar_url, weekly_damage, total_damage, level,
          global_weekly_rank, global_total_rank, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), country_id = VALUES(country_id),
           avatar_url = VALUES(avatar_url), weekly_damage = VALUES(weekly_damage),
           total_damage = VALUES(total_damage), level = VALUES(level),
           global_weekly_rank = VALUES(global_weekly_rank), global_total_rank = VALUES(global_total_rank),
           raw_json = VALUES(raw_json)`,
        [
          mu.id,
          mu.name,
          mu.country,
          mu.avatarUrl,
          mu.weekly,
          mu.total,
          mu.level,
          mu.globalWeeklyRank ?? null,
          mu.globalTotalRank ?? null,
          jsonParam(mu.raw),
        ],
      )
    }
  })
}

export async function upsertMuMembers(members: MuMemberSnapshot[]): Promise<void> {
  if (!members.length) return
  await withWareraDbConnection('upsertMuMembers', async (db) => {
    for (const m of members) {
      await db.execute(
        `INSERT INTO warera_mu_members
         (mu_id, user_id, weekly_damage, monthly_damage, total_damage, weekly_help,
          monthly_help, total_help, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE weekly_damage = VALUES(weekly_damage),
           monthly_damage = VALUES(monthly_damage), total_damage = VALUES(total_damage),
           weekly_help = VALUES(weekly_help), monthly_help = VALUES(monthly_help),
           total_help = VALUES(total_help), raw_json = VALUES(raw_json)`,
        [
          m.muId,
          m.userId,
          m.weekly,
          m.monthly,
          m.total,
          m.weeklyHelp,
          m.monthlyHelp,
          m.totalHelp,
          jsonParam(m.raw),
        ],
      )
    }
  })
}

export async function upsertUsers(users: UserSnapshot[]): Promise<void> {
  if (!users.length) return
  await withWareraDbConnection('upsertUsers', async (db) => {
    for (const u of users) {
      await db.execute(
        `INSERT INTO warera_users
         (user_id, username, avatar_url, country_id, mu_id, is_active, military_rank,
          game_created_at, game_updated_at, level, total_xp, total_damages, weekly_damage,
          total_damage_rank, weekly_damage_rank, raw_json, dates_json, stats_json,
          rankings_json, skills_json, infos_json, full_profile_json, full_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(3) END)
         ON DUPLICATE KEY UPDATE username = VALUES(username), avatar_url = VALUES(avatar_url),
           country_id = VALUES(country_id), mu_id = COALESCE(VALUES(mu_id), mu_id),
           is_active = COALESCE(VALUES(is_active), is_active),
           military_rank = COALESCE(VALUES(military_rank), military_rank),
           game_created_at = COALESCE(VALUES(game_created_at), game_created_at),
           game_updated_at = COALESCE(VALUES(game_updated_at), game_updated_at),
           level = COALESCE(VALUES(level), level),
           total_xp = COALESCE(VALUES(total_xp), total_xp),
           total_damages = COALESCE(VALUES(total_damages), total_damages),
           weekly_damage = COALESCE(VALUES(weekly_damage), weekly_damage),
           total_damage_rank = COALESCE(VALUES(total_damage_rank), total_damage_rank),
           weekly_damage_rank = COALESCE(VALUES(weekly_damage_rank), weekly_damage_rank),
           raw_json = VALUES(raw_json),
           dates_json = COALESCE(VALUES(dates_json), dates_json),
           stats_json = COALESCE(VALUES(stats_json), stats_json),
           rankings_json = COALESCE(VALUES(rankings_json), rankings_json),
           skills_json = COALESCE(VALUES(skills_json), skills_json),
           infos_json = COALESCE(VALUES(infos_json), infos_json),
           full_profile_json = COALESCE(VALUES(full_profile_json), full_profile_json),
           full_synced_at = CASE
             WHEN VALUES(full_profile_json) IS NULL THEN full_synced_at
             ELSE UTC_TIMESTAMP(3)
           END`,
        [
          u.id,
          u.name,
          u.avatarUrl,
          u.country,
          u.muId ?? null,
          u.isActive === undefined || u.isActive === null ? null : (u.isActive ? 1 : 0),
          u.militaryRank ?? null,
          toMysqlDate(u.createdAt),
          toMysqlDate(u.updatedAt),
          u.level ?? null,
          u.totalXp ?? null,
          u.totalDamages ?? null,
          u.weeklyDamage ?? null,
          u.totalDamageRank ?? null,
          u.weeklyDamageRank ?? null,
          jsonParam(u.raw),
          jsonParam(u.dates),
          jsonParam(u.stats),
          jsonParam(u.rankings),
          jsonParam(u.skills),
          jsonParam(u.infos),
          jsonParam(u.fullRaw),
          jsonParam(u.fullRaw),
        ],
      )
    }
  })
}

export async function upsertBattle(battle: BattleSnapshot): Promise<boolean | null> {
  return withWareraDb('upsertBattle', async (db) => {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO warera_battles
       (battle_id, war_id, region_id, is_active, attacker_country_id, defender_country_id, winner_country_id,
        attacker_score, defender_score, attacker_damage, defender_damage, current_round_json,
        rounds_json, rounds_history_json, battle_type, total_rounds, rounds_to_win,
        created_at, ended_at, raw_json, details_json, details_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN ? IS NULL THEN NULL ELSE UTC_TIMESTAMP(3) END)
       ON DUPLICATE KEY UPDATE war_id = COALESCE(VALUES(war_id), war_id),
         region_id = COALESCE(VALUES(region_id), region_id),
         is_active = VALUES(is_active),
         attacker_country_id = VALUES(attacker_country_id),
         defender_country_id = VALUES(defender_country_id),
         winner_country_id = COALESCE(VALUES(winner_country_id), winner_country_id),
         attacker_score = COALESCE(VALUES(attacker_score), attacker_score),
         defender_score = COALESCE(VALUES(defender_score), defender_score),
         attacker_damage = COALESCE(VALUES(attacker_damage), attacker_damage),
         defender_damage = COALESCE(VALUES(defender_damage), defender_damage),
         current_round_json = COALESCE(VALUES(current_round_json), current_round_json),
         rounds_json = COALESCE(VALUES(rounds_json), rounds_json),
         rounds_history_json = COALESCE(VALUES(rounds_history_json), rounds_history_json),
         battle_type = COALESCE(VALUES(battle_type), battle_type),
         total_rounds = COALESCE(VALUES(total_rounds), total_rounds),
         rounds_to_win = COALESCE(VALUES(rounds_to_win), rounds_to_win),
         created_at = VALUES(created_at), ended_at = VALUES(ended_at), raw_json = VALUES(raw_json),
         details_json = COALESCE(VALUES(details_json), details_json),
         details_synced_at = CASE
           WHEN VALUES(details_json) IS NULL THEN details_synced_at
           ELSE UTC_TIMESTAMP(3)
         END`,
      [
        battle.id,
        battle.warId ?? null,
        battle.regionId ?? null,
        battle.isActive ? 1 : 0,
        battle.attackerCountryId,
        battle.defenderCountryId,
        battle.winnerCountryId ?? null,
        battle.attackerScore ?? null,
        battle.defenderScore ?? null,
        battle.attackerDamage ?? null,
        battle.defenderDamage ?? null,
        jsonParam(battle.currentRound),
        jsonParam(battle.rounds),
        jsonParam(battle.roundsHistory),
        battle.battleType ?? null,
        battle.totalRounds ?? null,
        battle.roundsToWin ?? null,
        toMysqlDate(battle.createdAt),
        toMysqlDate(battle.endedAt),
        jsonParam(battle.raw),
        jsonParam(battle.detailsRaw),
        jsonParam(battle.detailsRaw),
      ],
    )
    return result.affectedRows > 0
  })
}

export async function upsertBattleRankings(rankings: BattleRankingSnapshot[]): Promise<void> {
  if (!rankings.length) return
  await withWareraDbConnection('upsertBattleRankings', async (db) => {
    for (const r of rankings) {
      await db.execute(
        `INSERT INTO warera_battle_rankings
         (battle_id, entity_type, entity_id, attributed_country_id, attribution_confidence,
          side, damage, ranking_position, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE damage = VALUES(damage), ranking_position = VALUES(ranking_position),
           attributed_country_id = COALESCE(VALUES(attributed_country_id), attributed_country_id),
           attribution_confidence = VALUES(attribution_confidence),
           raw_json = VALUES(raw_json)`,
        [
          r.battleId,
          r.entityType,
          r.entityId,
          r.attributedCountryId ?? null,
          r.attributionConfidence ?? 'unknown',
          r.side,
          r.damage,
          r.rank,
          jsonParam(r.raw),
        ],
      )
    }
  })
}

export async function markSyncSuccess(jobName: string, checkpoint?: string | null): Promise<void> {
  await withWareraDb('markSyncSuccess', async (db) => {
    await db.execute(
      `INSERT INTO warera_sync_state (job_name, checkpoint_value, last_success_at, last_error)
       VALUES (?, ?, UTC_TIMESTAMP(3), NULL)
       ON DUPLICATE KEY UPDATE checkpoint_value = COALESCE(VALUES(checkpoint_value), checkpoint_value),
         last_success_at = VALUES(last_success_at), last_error = NULL, locked_at = NULL`,
      [jobName, checkpoint ?? null],
    )
  })
}

export async function markSyncFailure(jobName: string, error: unknown): Promise<void> {
  await withWareraDb('markSyncFailure', async (db) => {
    await db.execute(
      `INSERT INTO warera_sync_state (job_name, last_failure_at, last_error)
       VALUES (?, UTC_TIMESTAMP(3), ?)
       ON DUPLICATE KEY UPDATE last_failure_at = VALUES(last_failure_at), last_error = VALUES(last_error), locked_at = NULL`,
      [jobName, error instanceof Error ? error.message : String(error)],
    )
  })
}

export async function getSyncCheckpoint(jobName: string): Promise<string | null> {
  const result = await withWareraDb('getSyncCheckpoint', async (db) => {
    const [rows] = await db.execute<DbRow<{ checkpoint_value: string | null }>[]> (
      'SELECT checkpoint_value FROM warera_sync_state WHERE job_name = ?',
      [jobName],
    )
    return rows[0]?.checkpoint_value ?? null
  })
  return result ?? null
}

export async function getSyncFreshness(jobName: string): Promise<DbFreshness> {
  const result = await withWareraDb('getSyncFreshness', async (db) => {
    const [rows] = await db.execute<DbRow<{ last_success_at: string | null; lag_seconds: number | null }>[]> (
      `SELECT last_success_at, TIMESTAMPDIFF(SECOND, last_success_at, UTC_TIMESTAMP(3)) AS lag_seconds
       FROM warera_sync_state WHERE job_name = ?`,
      [jobName],
    )
    return {
      updatedAt: fromMysqlDate(rows[0]?.last_success_at),
      lagSeconds: rows[0]?.lag_seconds === null || rows[0]?.lag_seconds === undefined
        ? null
        : Number(rows[0].lag_seconds),
    }
  })
  return result ?? { updatedAt: null, lagSeconds: null }
}

export async function needsBattleDetailsSync(battleId: string): Promise<boolean> {
  const result = await withWareraDb('needsBattleDetailsSync', async (db) => {
    const [rows] = await db.execute<DbRow<{ details_json: string | null }>[]> (
      'SELECT details_json FROM warera_battles WHERE battle_id = ?',
      [battleId],
    )
    return !rows[0]?.details_json
  })
  return result ?? true
}

export async function needsUserProfileEnrichment(userId: string): Promise<boolean> {
  const result = await withWareraDb('needsUserProfileEnrichment', async (db) => {
    const [rows] = await db.execute<DbRow<{ full_profile_json: string | null }>[]> (
      'SELECT full_profile_json FROM warera_users WHERE user_id = ?',
      [userId],
    )
    return !rows[0]?.full_profile_json
  })
  return result ?? true
}

export async function getDbFederation(period: Period): Promise<{
  allianceName: string
  avatarUrl: string | null
  totalDamage: number
  globalRank: number | null
  memberCountryCount: number
  byCountry: DamageRow[]
  byMu: DamageRow[]
  memberJoinedAts: Record<string, string>
  updatedAt: string | null
} | null> {
  if (period === 'month') return null
  return withWareraDb('getDbFederation', async (db) => {
    const [alliances] = await db.execute<DbRow<{
      alliance_id: string
      name: string
      avatar_url: string | null
      member_country_ids: string | string[] | null
      weekly_damage: number
      total_damage: number
      global_weekly_rank: number | null
      global_total_rank: number | null
      updated_at: string | null
    }>[]>('SELECT * FROM warera_alliances ORDER BY updated_at DESC LIMIT 1')
    const alliance = alliances[0]
    if (!alliance) return null

    const memberIds = Array.isArray(alliance.member_country_ids)
      ? alliance.member_country_ids
      : JSON.parse(String(alliance.member_country_ids || '[]')) as string[]
    if (!memberIds.length) return null

    // Damage computed from our own battle rankings, filtered by membership
    // join date. This excludes pre-membership damage that the game's
    // country.total_damage would include.
    //
    // NOTE: uses EARLIEST join_date as a simple cutoff. If a country left
    // and later rejoined, damage during the gap is still included. This is
    // a known limitation that requires multi-interval membership tracking.
    const dateFilter = period === 'week'
      ? 'AND COALESCE(b.ended_at, b.created_at) >= NOW() - INTERVAL 7 DAY'
      : ''
    const allianceId = alliance.alliance_id

    const [countryRows] = await db.query<DbRow<{
      country_id: string
      name: string
      code: string | null
      damage: number
    }>[]>(
      `SELECT c.country_id, c.name, c.code, SUM(r.damage) AS damage
       FROM warera_battle_rankings r
       JOIN warera_battles b ON b.battle_id = r.battle_id
       JOIN warera_countries c ON c.country_id = r.entity_id
       JOIN warera_alliance_membership_history mh
         ON mh.alliance_id = ? AND mh.country_id = r.entity_id
       WHERE r.entity_type = 'country' AND r.side = 'merged'
         AND COALESCE(b.ended_at, b.created_at) >= mh.joined_at
         ${dateFilter}
       GROUP BY c.country_id, c.name, c.code
       HAVING SUM(r.damage) > 0
       ORDER BY damage DESC`,
      [allianceId],
    )

    const [muRows] = await db.query<DbRow<{
      mu_id: string
      name: string
      country_id: string | null
      country_name: string | null
      code: string | null
      damage: number
    }>[]>(
      `SELECT m.mu_id, m.name, m.country_id, c.name AS country_name, c.code,
         SUM(r.damage) AS damage
       FROM warera_battle_rankings r
       JOIN warera_battles b ON b.battle_id = r.battle_id
       JOIN warera_mus m ON m.mu_id = r.entity_id
       LEFT JOIN warera_countries c ON c.country_id = m.country_id
       LEFT JOIN warera_alliance_membership_history mh
         ON mh.alliance_id = ? AND mh.country_id = m.country_id
       WHERE r.entity_type = 'mu' AND r.side = 'merged'
         AND (
           (mh.country_id IS NOT NULL
             AND COALESCE(b.ended_at, b.created_at) >= mh.joined_at)
           OR EXISTS (
             SELECT 1 FROM warera_tracked_entities te
             WHERE te.entity_type = 'extra_mu' AND te.entity_id = m.mu_id
           )
         )
         ${dateFilter}
       GROUP BY m.mu_id, m.name, m.country_id, c.name, c.code
       HAVING SUM(r.damage) > 0
       ORDER BY damage DESC`,
      [allianceId],
    )

    // Membership join dates for the UI legend (new joiners badge).
    const [joinedRows] = await db.query<DbRow<{ country_id: string; joined_at: string }>[]>(
      `SELECT country_id, joined_at
       FROM warera_alliance_membership_history
       WHERE alliance_id = ? AND left_at IS NULL`,
      [allianceId],
    )
    const memberJoinedAts: Record<string, string> = {}
    for (const row of joinedRows) {
      memberJoinedAts[row.country_id] = fromMysqlDate(row.joined_at) ?? row.joined_at
    }

    return {
      allianceName: alliance.name,
      avatarUrl: alliance.avatar_url,
      totalDamage: Number(period === 'all' ? alliance.total_damage : alliance.weekly_damage),
      globalRank: period === 'all' ? alliance.global_total_rank : alliance.global_weekly_rank,
      memberCountryCount: memberIds.length,
      byCountry: finalizeDamageRows(countryRows.map((row) => ({
        id: row.country_id,
        name: row.name,
        damage: Number(row.damage),
        share: 0,
        rank: null,
        meta: { code: row.code },
      }))),
      byMu: finalizeDamageRows(muRows.map((row) => ({
        id: row.mu_id,
        name: row.name,
        damage: Number(row.damage),
        share: 0,
        rank: null,
        meta: { country: row.country_name ?? row.country_id, code: row.code },
      }))),
      memberJoinedAts,
      updatedAt: fromMysqlDate(alliance.updated_at),
    }
  })
}

export async function getDbJustice(muId: string, period: Period): Promise<{
  muName: string
  avatarUrl: string | null
  totalDamage: number
  globalRank: number | null
  memberCount: number
  level: number | null
  byCountry: DamageRow[]
  byPlayer: PlayerRow[]
  updatedAt: string | null
} | null> {
  return withWareraDb('getDbJustice', async (db) => {
    const [muRows] = await db.execute<DbRow<{
      name: string
      avatar_url: string | null
      weekly_damage: number
      total_damage: number
      level: number | null
      global_weekly_rank: number | null
      global_total_rank: number | null
      updated_at: string | null
    }>[]>('SELECT * FROM warera_mus WHERE mu_id = ?', [muId])
    const mu = muRows[0]
    if (!mu) return null

    const damageColumn =
      period === 'all' ? 'm.total_damage' : period === 'month' ? 'm.monthly_damage' : 'm.weekly_damage'
    const [playerRows] = await db.execute<DbRow<{
      user_id: string
      username: string | null
      avatar_url: string | null
      country_id: string | null
      country_name: string | null
      country_code: string | null
      damage: number
      help: number
    }>[]>(
      `SELECT m.user_id, u.username, u.avatar_url, u.country_id, c.name AS country_name, c.code AS country_code,
        ${damageColumn} AS damage,
        ${period === 'all' ? 'm.total_help' : period === 'month' ? 'm.monthly_help' : 'm.weekly_help'} AS help
       FROM warera_mu_members m
       LEFT JOIN warera_users u ON u.user_id = m.user_id
       LEFT JOIN warera_countries c ON c.country_id = u.country_id
       WHERE m.mu_id = ?
       ORDER BY ${damageColumn} DESC`,
      [muId],
    )

    const players = playerRows.map((row) => ({
      id: row.user_id,
      name: row.username ?? row.user_id,
      avatarUrl: row.avatar_url,
      countryId: row.country_id,
      countryName: row.country_name,
      damage: Number(row.damage),
      help: Number(row.help),
      rank: null,
    }))
    players.forEach((p, i) => (p.rank = i + 1))

    const countryAgg = new Map<string, { name: string; code: string | null; damage: number }>()
    for (const row of playerRows) {
      if (!row.country_id || Number(row.damage) <= 0) continue
      const current = countryAgg.get(row.country_id)
      countryAgg.set(row.country_id, {
        name: row.country_name ?? row.country_id,
        code: current?.code ?? row.country_code ?? null,
        damage: (current?.damage ?? 0) + Number(row.damage),
      })
    }

    return {
      muName: mu.name,
      avatarUrl: mu.avatar_url,
      totalDamage: Number(period === 'all' ? mu.total_damage : mu.weekly_damage),
      globalRank: period === 'all' ? mu.global_total_rank : mu.global_weekly_rank,
      memberCount: players.length,
      level: mu.level,
      byCountry: finalizeDamageRows([...countryAgg.entries()].map(([id, row]) => ({
        id,
        name: row.name,
        damage: row.damage,
        share: 0,
        rank: null,
        meta: { code: row.code },
      }))),
      byPlayer: players,
      updatedAt: fromMysqlDate(mu.updated_at),
    }
  })
}

export async function getDbFederationSupport(period: Period): Promise<{
  totalSupportDamage: number
  byCountry: DamageRow[]
  battlesScanned: number
  allyBattlesCount: number
  updatedAt: string | null
} | null> {
  return withWareraDb('getDbFederationSupport', async (db) => {
    const [alliances] = await db.execute<DbRow<{
      alliance_id: string
      member_country_ids: string | string[] | null
    }>[]> (
      'SELECT alliance_id, member_country_ids FROM warera_alliances ORDER BY updated_at DESC LIMIT 1',
    )
    const alliance = alliances[0]
    if (!alliance) return null
    const memberIds = Array.isArray(alliance.member_country_ids)
      ? alliance.member_country_ids
      : JSON.parse(String(alliance.member_country_ids || '[]')) as string[]
    if (!memberIds.length) return null
    const allianceId = alliance.alliance_id

    const since = period === 'week'
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : null

    // LEFT JOIN so every member country appears (even with 0 support damage).
    // The previous approach used an inner join + HAVING, which dropped countries
    // that never participated in an ally battle.
    const [rows] = await db.query<DbRow<{
      country_id: string
      name: string | null
      code: string | null
      support_damage: number
      own_damage: number
    }>[]>(
      `SELECT mc.country_id, c.name, c.code,
         COALESCE(agg.support_damage, 0) AS support_damage,
         COALESCE(agg.own_damage, 0) AS own_damage
       FROM (
         SELECT DISTINCT country_id FROM warera_alliance_membership_history
         WHERE alliance_id = ? AND left_at IS NULL
       ) mc
       LEFT JOIN warera_countries c ON c.country_id = mc.country_id
       LEFT JOIN (
         SELECT r.entity_id AS country_id,
           SUM(CASE
             WHEN r.entity_id <> CASE
               WHEN b.defender_country_id IN (?) AND b.attacker_country_id NOT IN (?) THEN b.defender_country_id
               WHEN b.attacker_country_id IN (?) AND b.defender_country_id NOT IN (?) THEN b.attacker_country_id
               ELSE NULL
             END THEN r.damage ELSE 0 END) AS support_damage,
           SUM(CASE
             WHEN r.entity_id = b.defender_country_id OR r.entity_id = b.attacker_country_id THEN r.damage ELSE 0 END) AS own_damage
         FROM warera_battles b
         JOIN warera_battle_rankings r ON r.battle_id = b.battle_id AND r.entity_type = 'country' AND r.side = 'merged'
         JOIN warera_alliance_membership_history mh
           ON mh.alliance_id = ? AND mh.country_id = r.entity_id
         WHERE ((b.defender_country_id IN (?) AND b.attacker_country_id NOT IN (?))
            OR (b.attacker_country_id IN (?) AND b.defender_country_id NOT IN (?)))
           AND r.entity_id IN (?)
           AND COALESCE(b.ended_at, b.created_at) >= mh.joined_at
           ${since ? 'AND COALESCE(b.ended_at, b.created_at) >= ?' : ''}
         GROUP BY r.entity_id
       ) agg ON agg.country_id = mc.country_id
       ORDER BY support_damage DESC`,
      [
        allianceId,
        memberIds, memberIds, memberIds, memberIds,
        allianceId,
        memberIds, memberIds, memberIds, memberIds,
        memberIds,
        ...(since ? [toMysqlDate(since)] : []),
      ],
    )

    const [counts] = await db.query<DbRow<{ battles_scanned: number; ally_battles_count: number; updated_at: string | null }>[]> (
      `SELECT COUNT(*) AS battles_scanned,
        SUM(CASE WHEN ((defender_country_id IN (?) AND attacker_country_id NOT IN (?))
          OR (attacker_country_id IN (?) AND defender_country_id NOT IN (?))) THEN 1 ELSE 0 END) AS ally_battles_count,
        MAX(synced_at) AS updated_at
       FROM warera_battles
       WHERE (defender_country_id IN (?) OR attacker_country_id IN (?))
         ${since ? 'AND COALESCE(ended_at, created_at) >= ?' : ''}`,
      [memberIds, memberIds, memberIds, memberIds, memberIds, memberIds, ...(since ? [toMysqlDate(since)] : [])],
    )

    const byCountry = finalizeDamageRows(rows.map((row) => ({
      id: row.country_id,
      name: row.name ?? row.country_id,
      damage: Number(row.support_damage),
      share: 0,
      rank: null,
      meta: { code: row.code, ownDamage: Number(row.own_damage) },
    })))

    return {
      totalSupportDamage: byCountry.reduce((sum, row) => sum + row.damage, 0),
      byCountry,
      battlesScanned: Number(counts[0]?.battles_scanned ?? 0),
      allyBattlesCount: Number(counts[0]?.ally_battles_count ?? 0),
      updatedAt: fromMysqlDate(counts[0]?.updated_at),
    }
  })
}

/**
 * Per-recipient breakdown of one Federation member's ally-support damage:
 * for the given supporter `countryId`, how much damage it dealt in each
 * OTHER ally's battles, grouped by the recipient (owner) country.
 * Mirrors the `support_damage` semantics of `getDbFederationSupport` but for
 * a single supporter, grouped by recipient.
 */
export async function getDbFederationSupportBreakdown(
  countryId: string,
  period: Period,
): Promise<{
  totalSupportDamage: number
  recipients: SupportRecipientRow[]
  battlesScanned: number
  updatedAt: string | null
} | null> {
  return withWareraDb('getDbFederationSupportBreakdown', async (db) => {
    const [alliances] = await db.execute<DbRow<{
      alliance_id: string
      member_country_ids: string | string[] | null
    }>[]>(
      'SELECT alliance_id, member_country_ids FROM warera_alliances ORDER BY updated_at DESC LIMIT 1',
    )
    const alliance = alliances[0]
    if (!alliance) return null
    const memberIds = Array.isArray(alliance.member_country_ids)
      ? alliance.member_country_ids
      : (JSON.parse(String(alliance.member_country_ids || '[]')) as string[])
    if (!memberIds.length) return null
    const allianceId = alliance.alliance_id

    const since = period === 'week'
      ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      : null

    // One grouped query: determine the Fed "owner" of each ally battle the
    // supporter participated in, exclude battles where the supporter IS the
    // owner, then sum the supporter's damage grouped by recipient.
    const [rows] = await db.query<DbRow<{
      recipient_id: string
      recipient_name: string | null
      recipient_code: string | null
      support_damage: number
    }[]>>(
      `SELECT o.owner_country_id AS recipient_id, rc.name AS recipient_name, rc.code AS recipient_code,
         SUM(o.damage) AS support_damage
       FROM (
         SELECT
           CASE
             WHEN b.defender_country_id IN (?) AND b.attacker_country_id NOT IN (?) THEN b.defender_country_id
             WHEN b.attacker_country_id IN (?) AND b.defender_country_id NOT IN (?) THEN b.attacker_country_id
           END AS owner_country_id,
           r.damage AS damage
         FROM warera_battles b
         JOIN warera_battle_rankings r
           ON r.battle_id = b.battle_id AND r.entity_type = 'country' AND r.side = 'merged'
         JOIN warera_alliance_membership_history mh
           ON mh.alliance_id = ? AND mh.country_id = r.entity_id
         WHERE r.entity_id = ?
           AND COALESCE(b.ended_at, b.created_at) >= mh.joined_at
           AND ((b.defender_country_id IN (?) AND b.attacker_country_id NOT IN (?))
              OR (b.attacker_country_id IN (?) AND b.defender_country_id NOT IN (?)))
           ${since ? 'AND COALESCE(b.ended_at, b.created_at) >= ?' : ''}
       ) o
       LEFT JOIN warera_countries rc ON rc.country_id = o.owner_country_id
       WHERE o.owner_country_id IS NOT NULL AND o.owner_country_id <> ?
       GROUP BY o.owner_country_id, rc.name, rc.code
       ORDER BY support_damage DESC`,
      [
        memberIds, memberIds, memberIds, memberIds,
        allianceId,
        countryId,
        memberIds, memberIds, memberIds, memberIds,
        ...(since ? [toMysqlDate(since)] : []),
        countryId,
      ],
    )

    const [counts] = await db.query<DbRow<{ battles_scanned: number; updated_at: string | null }>[]>(
      `SELECT COUNT(*) AS battles_scanned, MAX(synced_at) AS updated_at
       FROM warera_battles
       WHERE (defender_country_id IN (?) OR attacker_country_id IN (?))
         ${since ? 'AND COALESCE(ended_at, created_at) >= ?' : ''}`,
      [memberIds, memberIds, ...(since ? [toMysqlDate(since)] : [])],
    )

    const recipients: SupportRecipientRow[] = rows.map((row) => ({
      id: row.recipient_id,
      name: row.recipient_name ?? row.recipient_id,
      code: row.recipient_code ?? null,
      damage: Number(row.support_damage),
      share: 0,
    }))
    const totalSupportDamage = recipients.reduce((sum, r) => sum + r.damage, 0) || 1
    recipients.forEach((r) => {
      r.share = r.damage / totalSupportDamage
    })

    const realTotal = recipients.reduce((sum, r) => sum + r.damage, 0)

    return {
      totalSupportDamage: realTotal,
      recipients,
      battlesScanned: Number(counts[0]?.battles_scanned ?? 0),
      updatedAt: fromMysqlDate(counts[0]?.updated_at),
    }
  })
}

export async function getDbJusticePlayerDaily(userId: string, days: number): Promise<{
  playerName: string
  avatarUrl: string | null
  countryId: string | null
  countryName: string | null
  days: DailyDamagePoint[]
  totalDamage: number
  battlesScanned: number
  updatedAt: string | null
} | null> {
  return withWareraDb('getDbJusticePlayerDaily', async (db) => {
    const safeDays = Math.min(Math.max(Math.floor(days || 7), 1), 7)
    const since = new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000)
    since.setUTCHours(0, 0, 0, 0)

    const [users] = await db.execute<DbRow<{
      username: string
      avatar_url: string | null
      country_id: string | null
      country_name: string | null
    }>[]>(
      `SELECT u.username, u.avatar_url, u.country_id, c.name AS country_name
       FROM warera_users u LEFT JOIN warera_countries c ON c.country_id = u.country_id
       WHERE u.user_id = ?`,
      [userId],
    )
    if (!users[0]) return null

    const [rows] = await db.execute<DbRow<{ date_key: string; damage: number; battles: number }>[]> (
      `SELECT DATE(COALESCE(b.ended_at, b.created_at)) AS date_key,
        SUM(r.damage) AS damage, COUNT(*) AS battles
       FROM warera_battle_rankings r
       JOIN warera_battles b ON b.battle_id = r.battle_id
       WHERE r.entity_type = 'user' AND r.entity_id = ? AND r.side = 'merged'
         AND COALESCE(b.ended_at, b.created_at) >= ?
       GROUP BY DATE(COALESCE(b.ended_at, b.created_at))
       ORDER BY date_key ASC`,
      [userId, toMysqlDate(since.toISOString())],
    )

    const byDate = new Map(rows.map((row) => [
      String(row.date_key),
      { damage: Number(row.damage), battles: Number(row.battles) },
    ]))
    const dayKeys = Array.from({ length: safeDays }, (_, i) => {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000)
      return d.toISOString().slice(0, 10)
    })
    const points = dayKeys.map((date) => ({
      date,
      damage: byDate.get(date)?.damage ?? 0,
      battles: byDate.get(date)?.battles ?? 0,
    }))

    const [freshness] = await db.execute<DbRow<{ updated_at: string | null; battles_scanned: number }>[]> (
      `SELECT MAX(b.synced_at) AS updated_at, COUNT(DISTINCT b.battle_id) AS battles_scanned
       FROM warera_battles b
       JOIN warera_battle_rankings r ON r.battle_id = b.battle_id
       WHERE r.entity_type = 'user' AND r.entity_id = ?`,
      [userId],
    )

    return {
      playerName: users[0].username,
      avatarUrl: users[0].avatar_url,
      countryId: users[0].country_id,
      countryName: users[0].country_name,
      days: points,
      totalDamage: points.reduce((sum, point) => sum + point.damage, 0),
      battlesScanned: Number(freshness[0]?.battles_scanned ?? 0),
      updatedAt: fromMysqlDate(freshness[0]?.updated_at),
    }
  })
}

// ---------------------------------------------------------------------------
// Citizenship history (append-only)
// ---------------------------------------------------------------------------

/**
 * Returns the country the user most likely held citizenship of at the given
 * UTC timestamp, based on the append-only history table. Used by the sync
 * layer to set `attributed_country_id` / `attribution_confidence` on battle
 * rankings. Returns null when the user has no recorded history at that time.
 */
export async function getCitizenshipAtTime(
  userId: string,
  isoDate: string,
): Promise<{ countryId: string; confidence: 'certain' | 'probable' } | null> {
  const result = await withWareraDb('getCitizenshipAtTime', async (db) => {
    const [rows] = await db.execute<DbRow<{
      country_id: string
      confidence: 'certain' | 'probable'
    }>[]>(
      `SELECT country_id, confidence FROM warera_user_citizenship_history
       WHERE user_id = ? AND valid_from <= ?
         AND (valid_to IS NULL OR valid_to > ?)
       ORDER BY valid_from DESC LIMIT 1`,
      [userId, toMysqlDate(isoDate), toMysqlDate(isoDate)],
    )
    return rows[0]
      ? { countryId: rows[0].country_id, confidence: rows[0].confidence }
      : null
  })
  return result ?? null
}

/**
 * Append-only upsert for citizenship history.
 *
 * Logic:
 *   • If the user already has an OPEN entry with the same country_id → refresh
 *     `last_change_at` only (no new row).
 *   • If the user has an OPEN entry with a DIFFERENT country_id → close it
 *     (valid_to = validFrom of new entry) and insert a new OPEN entry.
 *   • If no open entry → insert a new OPEN entry.
 *
 * `validFrom` should be the moment we observed the change (now). Pass the
 * game-side `lastCitizenshipChangeAt` as `lastChangeAt` for traceability.
 */
export async function recordCitizenshipSnapshot(args: {
  userId: string
  countryId: string
  validFrom?: string
  lastChangeAt?: string | null
  source?: 'profile' | 'inferred'
  confidence?: 'certain' | 'probable'
}): Promise<void> {
  const {
    userId,
    countryId,
    validFrom = new Date().toISOString(),
    lastChangeAt = null,
    source = 'profile',
    confidence = 'certain',
  } = args
  if (!countryId) return

  await withWareraDb('recordCitizenshipSnapshot', async (db) => {
    const validFromMysql = toMysqlDate(validFrom)
    const lastChangeMysql = toMysqlDate(lastChangeAt)

    const [open] = await db.execute<DbRow<{ country_id: string; valid_from: string }>[]> (
      `SELECT country_id, valid_from FROM warera_user_citizenship_history
       WHERE user_id = ? AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1`,
      [userId],
    )
    const openRow = open[0]

    if (openRow && openRow.country_id === countryId) {
      // Same country — just refresh last_change_at marker if a newer one arrived.
      if (lastChangeMysql) {
        await db.execute(
          `UPDATE warera_user_citizenship_history
             SET last_change_at = COALESCE(?, last_change_at)
           WHERE user_id = ? AND valid_from = ?`,
          [lastChangeMysql, userId, openRow.valid_from],
        )
      }
      return
    }

    // Close the previous open entry at the new entry's start, then insert.
    if (openRow) {
      await db.execute(
        `UPDATE warera_user_citizenship_history
            SET valid_to = ?
          WHERE user_id = ? AND valid_from = ?`,
        [validFromMysql, userId, openRow.valid_from],
      )
    }

    await db.execute(
      `INSERT INTO warera_user_citizenship_history
         (user_id, country_id, valid_from, valid_to, source, confidence, last_change_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
      [userId, countryId, validFromMysql, source, confidence, lastChangeMysql],
    )
  })
}

// ---------------------------------------------------------------------------
// Alliance membership history (append-only)
// ---------------------------------------------------------------------------

/**
 * Records membership changes for an alliance. Call after every
 * `alliance.getById` refresh with the current list of member country IDs.
 *
 * New countries → INSERT with joined_at = now.
 * Missing countries (were in the previous open set but not in currentIds)
 *   → UPDATE left_at = now.
 */
export async function recordAllianceMembershipSnapshot(
  allianceId: string,
  currentIds: string[],
): Promise<void> {
  if (!currentIds.length) return
  await withWareraDb('recordAllianceMembership', async (db) => {
    const now = new Date().toISOString()
    const nowMysql = toMysqlDate(now)

    // Get currently open members (left_at IS NULL)
    const [prev] = await db.execute<DbRow<{ country_id: string }>[]>(
      `SELECT country_id FROM warera_alliance_membership_history
       WHERE alliance_id = ? AND left_at IS NULL`,
      [allianceId],
    )
    const prevSet = new Set(prev.map((r) => r.country_id))
    const currSet = new Set(currentIds)

    // Insert new members
    for (const cid of currentIds) {
      if (!prevSet.has(cid)) {
        await db.execute(
          `INSERT INTO warera_alliance_membership_history
             (alliance_id, country_id, joined_at)
           VALUES (?, ?, ?)`,
          [allianceId, cid, nowMysql],
        )
      }
    }

    // Mark leavers
    for (const cid of prevSet) {
      if (!currSet.has(cid)) {
        await db.execute(
          `UPDATE warera_alliance_membership_history
             SET left_at = ?
           WHERE alliance_id = ? AND country_id = ? AND left_at IS NULL`,
          [nowMysql, allianceId, cid],
        )
      }
    }
  })
}

/**
 * Returns the join date of a country into an alliance, or null if never a member.
 */
export async function getMembershipJoinDate(
  allianceId: string,
  countryId: string,
): Promise<string | null> {
  const result = await withWareraDb('getMembershipJoinDate', async (db) => {
    const [rows] = await db.execute<DbRow<{ joined_at: string }>[]>(
      `SELECT joined_at FROM warera_alliance_membership_history
       WHERE alliance_id = ? AND country_id = ?
       ORDER BY joined_at ASC LIMIT 1`,
      [allianceId, countryId],
    )
    return fromMysqlDate(rows[0]?.joined_at)
  })
  return result ?? null
}

/**
 * Cheap standalone query: returns current member country → join date map
 * for the Federation alliance. Safe to call from non-sync paths (no side effects).
 */
export async function getFederationMemberJoinedAts(): Promise<Record<string, string>> {
  return withWareraDb('getFedMemberJoinedAts', async (db) => {
    const [alliance] = await db.execute<DbRow<{ alliance_id: string }>[]>(
      `SELECT alliance_id FROM warera_alliances ORDER BY updated_at DESC LIMIT 1`,
    )
    if (!alliance[0]) return {}
    const [rows] = await db.execute<DbRow<{ country_id: string; joined_at: string }>[]>(
      `SELECT country_id, joined_at
       FROM warera_alliance_membership_history
       WHERE alliance_id = ? AND left_at IS NULL`,
      [alliance[0].alliance_id],
    )
    const map: Record<string, string> = {}
    for (const r of rows) {
      map[r.country_id] = fromMysqlDate(r.joined_at) ?? r.joined_at
    }
    return map
  })
}

function finalizeDamageRows<T extends DamageRow>(rows: T[]): T[] {
  const total = rows.reduce((sum, row) => sum + row.damage, 0) || 1
  rows.sort((a, b) => b.damage - a.damage)
  rows.forEach((row, i) => {
    row.rank = i + 1
    row.share = row.damage / total
  })
  return rows
}
