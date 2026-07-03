// Formatowanie liczb, dat i flag

/** Formatuje obrażenia w notacji skróconej: 1.23M, 45.6K, 789. */
export function formatDamage(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.round(n).toString()
}

/** Pełna liczba z separatorami tysięcy. */
export function formatFull(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  return Math.round(n).toLocaleString('en-US')
}

/** 2-litery kod kraju (np. "bg") → emoji flagi. */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return ''
  const cc = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  const A = 0x1f1e6
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65))
}

/** Czas HH:MM:SS dla timestampa ISO. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const PERIOD_LABEL: Record<string, string> = {
  week: 'Ten tydzień',
  month: 'Ten miesiąc',
  all: 'Cały czas',
}
