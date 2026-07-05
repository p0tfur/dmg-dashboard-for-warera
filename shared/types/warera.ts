// Shared WarEra types (frontend + server)

export type Period = 'week' | 'month' | 'all'

/**
 * Subset of `gameConfig.getDates` (UTC ISO timestamps of in-game boundaries).
 * Used to derive the calendar window covered by the upstream weekly/monthly
 * DMG buckets, so the UI can show e.g. "Jun 29 – Jul 6" next to "This week".
 */
export interface GameDates {
  nextDayAt?: string | null
  previousDayAt?: string | null
  nextRegenAt?: string | null
  nextMonthAt?: string | null
  dailyMissionRegenAt?: string | null
  weeklyMissionRegenAt?: string | null
  gameDay?: number | null
  gameMonth?: number | null
  gameYear?: number | null
  realDate?: string | null
  [key: string]: unknown
}

/** Calendar window [start, end) covered by a period's DMG bucket. Null for "all". */
export interface PeriodRange {
  start: string
  end: string
}

/** Single record returned by ranking.getRanking / battleRanking.getRanking. */
export interface RankingEntry {
  rank?: number | null
  // API uses different keys depending on type: user | country | mu | entityId
  user?: string | null
  country?: string | null
  mu?: string | null
  entityId?: string | null
  name?: string | null
  // citizenship (user) or home country (MU)
  countryId?: string | null
  value?: number | null
  tier?: string | null
  image?: string | null
  username?: string | null
  avatarUrl?: string | null
  [key: string]: unknown
}

/** MU member with damage stats (muMember.getByMu). */
export interface MuMember {
  mu?: string | null
  user?: string | null
  totalDamagesCount?: number | null
  monthlyDamagesCount?: number | null
  weeklyDamagesCount?: number | null
  totalHelpCount?: number | null
  monthlyHelpCount?: number | null
  weeklyHelpCount?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  [key: string]: unknown
}

export interface AllianceMemberCountry {
  country?: string | null
  coreDevelopment?: number | null
  averageDevelopment?: number | null
  suspended?: boolean | null
}

export interface Alliance {
  _id?: string | null
  name?: string | null
  leader?: string | null
  memberCountries?: AllianceMemberCountry[] | null
  currentDevelopment?: number | null
  avatarUrl?: string | null
  rankings?: {
    allianceWeeklyDamages?: { value?: number | null; rank?: number | null } | null
    allianceDamages?: { value?: number | null; rank?: number | null } | null
    alliancePopulation?: { value?: number | null; rank?: number | null } | null
  } | null
}

export interface MilitaryUnit {
  _id?: string | null
  name?: string | null
  countryId?: string | null
  ownerId?: string | null
  members?: string[] | null
  damage?: number | null
  image?: string | null
  avatarUrl?: string | null
  description?: string | null
  region?: string | null
  rankings?: {
    muWeeklyDamages?: { value?: number | null; rank?: number | null } | null
    muDamages?: { value?: number | null; rank?: number | null } | null
  } | null
  leveling?: { level?: number | null } | null
}

export interface Country {
  _id?: string | null
  name?: string | null
  flagUrl?: string | null
  [key: string]: unknown
}

export interface SearchHit {
  _id?: string | null
  type?: string | null
  name?: string | null
  [key: string]: unknown
}

// --- API response shape for frontend ---

export interface DamageRow {
  id: string
  name: string
  damage: number
  share: number // 0..1 share of total
  rank?: number | null
  meta?: Record<string, string | number | null>
}

export interface PlayerRow {
  id: string
  name: string
  avatarUrl?: string | null
  countryId?: string | null
  countryName?: string | null
  damage: number
  help?: number | null
  rank?: number | null
}

export interface DailyDamagePoint {
  date: string
  damage: number
  battles: number
}

export interface FederationResponse {
  allianceName: string
  avatarUrl?: string | null
  totalDamage: number
  globalRank?: number | null
  memberCountryCount: number
  muCount: number
  byCountry: DamageRow[]
  byMu: DamageRow[]
  period: Period
  /** Calendar window for `period` (null for "all"). Best-effort, derived from gameConfig.getDates. */
  periodRange?: PeriodRange | null
  updatedAt: string
  fromCache: boolean
  dataSource?: 'api' | 'db' | 'mixed'
  syncLagSeconds?: number | null
  rateLimit?: { remaining?: number | null; limit?: number | null } | null
}

/**
 * "Ally support" ranking: damage done by each Federation country in battles
 * fought by OTHER Federation members (either as attacker or defender). Each
 * country's "own" battles are excluded, so we only count DMG spent helping
 * allies. Internal Federation-vs-Federation wars are skipped entirely.
 */
export interface FederationSupportResponse {
  allianceName: string
  totalSupportDamage: number
  byCountry: DamageRow[]
  battlesScanned: number
  allyBattlesCount: number
  period: Period
  /** Calendar window for `period` (null for "all"). Best-effort, derived from gameConfig.getDates. */
  periodRange?: PeriodRange | null
  updatedAt: string
  fromCache: boolean
  dataSource?: 'api' | 'db' | 'mixed'
  syncLagSeconds?: number | null
  /**
   * True when the aggregate is still being built in the background (the
   * expensive per-country scan can take minutes for "all"). The frontend
   * should poll until `building` flips to false/undefined.
   */
  building?: boolean
  rateLimit?: { remaining?: number | null; limit?: number | null } | null
}

export interface JusticeResponse {
  muName: string
  avatarUrl?: string | null
  totalDamage: number
  globalRank?: number | null
  memberCount: number
  level?: number | null
  byCountry: DamageRow[]
  byPlayer: PlayerRow[]
  period: Period
  /** Calendar window for `period` (null for "all"). Best-effort, derived from gameConfig.getDates. */
  periodRange?: PeriodRange | null
  updatedAt: string
  fromCache: boolean
  dataSource?: 'api' | 'db' | 'mixed'
  syncLagSeconds?: number | null
  rateLimit?: { remaining?: number | null; limit?: number | null } | null
}

export interface JusticePlayerDailyResponse {
  userId: string
  playerName: string
  avatarUrl?: string | null
  countryId?: string | null
  countryName?: string | null
  days: DailyDamagePoint[]
  totalDamage: number
  daysRequested: number
  battlesScanned: number
  updatedAt: string
  fromCache: boolean
  dataSource?: 'api' | 'db' | 'mixed'
  syncLagSeconds?: number | null
  building?: boolean
  rateLimit?: { remaining?: number | null; limit?: number | null } | null
}

export interface MetaResponse {
  allianceId?: string | null
  allianceName?: string | null
  muId?: string | null
  muName?: string | null
  ok: boolean
}
