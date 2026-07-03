// Shared WarEra types (frontend + server)

export type Period = 'week' | 'month' | 'all'

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
  updatedAt: string
  fromCache: boolean
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
  updatedAt: string
  fromCache: boolean
  rateLimit?: { remaining?: number | null; limit?: number | null } | null
}

export interface MetaResponse {
  allianceId?: string | null
  allianceName?: string | null
  muId?: string | null
  muName?: string | null
  ok: boolean
}
