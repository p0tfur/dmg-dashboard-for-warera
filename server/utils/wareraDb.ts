import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'

let pool: Pool | null = null
let warnedMissing = false
let mysqlPromise: Promise<typeof import('mysql2/promise')> | null = null

interface MysqlLikeError {
  message?: string
  code?: string
  errno?: number
  sqlState?: string
  sqlMessage?: string
  cause?: unknown
}

export function getDatabaseUrl(): string {
  const config = useRuntimeConfig()
  return (config.databaseUrl as string | undefined) || ''
}

export function isWareraDbEnabled(): boolean {
  return Boolean(getDatabaseUrl())
}

async function getMysql() {
  mysqlPromise ||= import('mysql2/promise')
  return mysqlPromise
}

export async function getWareraDbPool(): Promise<Pool | null> {
  const url = getDatabaseUrl()
  if (!url) {
    if (!warnedMissing) {
      warnedMissing = true
      console.info('[warera-db] NUXT_DATABASE_URL not configured; using WarEra API fallback')
    }
    return null
  }
  if (!pool) {
    const mysql = await getMysql()
    pool = mysql.createPool({
      uri: url,
      waitForConnections: true,
      connectionLimit: 5,
      namedPlaceholders: true,
      dateStrings: true,
      enableKeepAlive: true,
    })
  }
  return pool
}

export async function withWareraDb<T>(
  context: string,
  fn: (db: Pool) => Promise<T>,
): Promise<T | null> {
  const db = await getWareraDbPool()
  if (!db) return null
  try {
    return await fn(db)
  } catch (err) {
    logWareraDbError(context, err)
    return null
  }
}

export async function withWareraDbConnection<T>(
  context: string,
  fn: (db: PoolConnection) => Promise<T>,
): Promise<T | null> {
  const pool = await getWareraDbPool()
  if (!pool) return null
  let conn: PoolConnection | null = null
  try {
    conn = await pool.getConnection()
    return await fn(conn)
  } catch (err) {
    logWareraDbError(context, err)
    return null
  } finally {
    conn?.release()
  }
}

function logWareraDbError(context: string, err: unknown) {
  const details = formatWareraDbError(err)
  console.warn(`[warera-db] ${context}: ${details}`)
}

function formatWareraDbError(err: unknown): string {
  if (err instanceof Error) {
    const mysqlErr = err as Error & MysqlLikeError
    const parts = [mysqlErr.message || 'Unknown database error']
    if (mysqlErr.code) parts.push(`code=${mysqlErr.code}`)
    if (typeof mysqlErr.errno === 'number') parts.push(`errno=${mysqlErr.errno}`)
    if (mysqlErr.sqlState) parts.push(`sqlState=${mysqlErr.sqlState}`)
    if (mysqlErr.sqlMessage && mysqlErr.sqlMessage !== mysqlErr.message) {
      parts.push(`sqlMessage=${mysqlErr.sqlMessage}`)
    }
    if (mysqlErr.cause) {
      parts.push(`cause=${formatWareraDbError(mysqlErr.cause)}`)
    }
    return parts.join(' | ')
  }

  if (err && typeof err === 'object') {
    const mysqlErr = err as MysqlLikeError
    const parts = [
      mysqlErr.message ||
      mysqlErr.sqlMessage ||
      (() => {
        try {
          return JSON.stringify(err)
        } catch {
          return String(err)
        }
      })(),
    ]
    if (mysqlErr.code) parts.push(`code=${mysqlErr.code}`)
    if (typeof mysqlErr.errno === 'number') parts.push(`errno=${mysqlErr.errno}`)
    if (mysqlErr.sqlState) parts.push(`sqlState=${mysqlErr.sqlState}`)
    return parts.join(' | ')
  }

  return String(err)
}

export function jsonParam(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

export function toMysqlDate(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 23).replace('T', ' ')
}

export function fromMysqlDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const raw = String(value)
  if (!raw) return null
  return raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
}

export type DbRow<T = Record<string, unknown>> = RowDataPacket & T
