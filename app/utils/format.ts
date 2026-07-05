// Number, date and flag formatting helpers

/** Formats damage in short notation: 1.23M, 45.6K, 789. */
export function formatDamage(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.round(n).toString()
}

/** Full number with thousands separators. */
export function formatFull(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** 2-letter country code (e.g. "bg") → flag emoji. */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return ''
  const cc = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  const A = 0x1f1e6
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65))
}

/** HH:MM:SS time from an ISO timestamp. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const PERIOD_LABEL: Record<string, string> = {
  week: 'This week',
  month: 'This month',
  all: 'All time',
}

/**
 * Formats a `[start, end)` calendar window as a compact range like
 * "Jun 29 – Jul 6" (UTC, short month + day). Returns an empty string when
 * the range is missing or unparseable, so callers can use it inline without
 * conditional wrappers. The window comes from `gameConfig.getDates` and is
 * always UTC midnight boundaries, so we format in UTC for consistency.
 */
export function formatPeriodRange(
  r: { start?: string | null; end?: string | null } | null | undefined,
): string {
  if (!r?.start || !r?.end) return ''
  const s = new Date(r.start)
  const e = new Date(r.end)
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`
}
