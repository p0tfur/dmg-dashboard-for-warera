import { ofetch, type FetchOptions } from 'ofetch'

/**
 * Minimalny klient WarEra tRPC (HTTP GET).
 * Replikuje istotne fragmenty logiki klienta Python `warera`:
 *   • GET /trpc/{proc}?input={"0":{"json":{...}}}&batch=1
 *   • opcjonalny nagłówek X-API-Key (tylko serwer)
 *   • odczyt nagłówków ratelimit-* i adaptacyjne czekanie
 *   • retry z exponential backoff dla 429 / 5xx
 */

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504])

interface RateLimitState {
  remaining: number | null
  limit: number | null
  resetAt: number | null // epoch ms
}

// Stan rate-limitu współdzielony w obrębie procesu serwera.
const rl: RateLimitState = { remaining: null, limit: null, resetAt: null }

export function getRateLimitState(): {
  remaining: number | null
  limit: number | null
} {
  return { remaining: rl.remaining, limit: rl.limit }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function getApiKey(): string | undefined {
  const config = useRuntimeConfig()
  return config.wareraApiKey || undefined
}

function getBaseUrl(): string {
  const config = useRuntimeConfig()
  return (config.wareraBaseUrl as string) || 'https://api2.warera.io/trpc'
}

/** Buduje URL żądania tRPC (pojedynczy GET; args bezpośrednio w input). */
function buildUrl(procedure: string, args: Record<string, unknown>): string {
  const base = getBaseUrl().replace(/\/$/, '')
  const input = JSON.stringify(args)
  const qs = new URLSearchParams({ input })
  return `${base}/${procedure}?${qs.toString()}`
}

/**
 * Rozpakowuje odpowiedź tRPC.
 * Standard: { result: { data: { json: <payload> } } }
 * Obsługujemy też warianty bez podwójnego zagnieżdżenia oraz przekaź surowy payload.
 */
function unwrap(data: any): any {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.error) {
      const msg = data.error?.data?.path
        ? `${data.error.message ?? 'tRPC error'} (${data.error.data.path})`
        : (data.error?.message ?? 'tRPC error')
      throw new Error(`[warera] ${msg}`)
    }
    if (data.result) {
      return data.result?.data?.json ?? data.result?.data ?? null
    }
  }
  return data
}

function updateRateLimit(headers: Headers) {
  const limit = headers.get('ratelimit-limit')
  const remaining = headers.get('ratelimit-remaining')
  const reset = headers.get('ratelimit-reset')
  if (limit !== null) rl.limit = Number(limit)
  if (remaining !== null) rl.remaining = Number(remaining)
  if (reset !== null) rl.resetAt = Date.now() + Number(reset) * 1000
}

/** Czeka, jeśli okienko rate-limitu jest wyczerpane. */
async function waitIfExhausted() {
  if (rl.remaining !== null && rl.remaining <= 0 && rl.resetAt) {
    const wait = rl.resetAt - Date.now()
    if (wait > 0) {
      console.warn(`[warera] rate-limit exhausted, sleeping ${Math.round(wait)}ms`)
      await sleep(wait + 250)
    }
  }
}

export async function trpcGet<T = any>(
  procedure: string,
  args: Record<string, unknown> = {},
  retries = 3,
): Promise<T> {
  await waitIfExhausted()

  const url = buildUrl(procedure, args)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = getApiKey()
  if (key) headers['X-API-Key'] = key

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const opts: FetchOptions<any> = {
        method: 'GET',
        headers,
        timeout: 30000,
        retry: false,
        responseType: 'json',
        onResponse({ response }) {
          updateRateLimit(response.headers)
        },
      }
      const raw = await ofetch(url, opts)
      return unwrap(raw) as T
    } catch (err: any) {
      lastErr = err
      const status = err?.statusCode ?? err?.response?.status
      const hdrs = err?.response?.headers
      if (hdrs) updateRateLimit(new Headers(hdrs as Record<string, string>))

      if (status && RETRYABLE.has(status) && attempt < retries) {
        const retryAfter = hdrs?.get?.('retry-after')
        let delay = Math.min(5000, 250 * 2 ** attempt)
        if (status === 429 && retryAfter) delay = Number(retryAfter) * 1000 + 250
        const jitter = Math.random() * 200
        console.warn(
          `[warera] ${procedure} → ${status}, retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`,
        )
        await sleep(delay + jitter)
        continue
      }
      throw new Error(
        `[warera] ${procedure} failed: ${status ?? 'network'} ${err?.message ?? ''}`.trim(),
      )
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`[warera] ${procedure} failed`)
}
