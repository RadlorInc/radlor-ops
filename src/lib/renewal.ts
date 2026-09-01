/**
 * How urgent a renewal date is. Pure, and separate from the page, so it can be checked without a
 * browser — the whole value of the costs table is answering "what lapses next", and a date that is
 * seven days out must not look like one three months out.
 *
 * `today` is a parameter rather than `new Date()` inside, so a test can state the day it means
 * instead of being a different test tomorrow.
 */
export type RenewalState = 'lapsed' | 'soon' | 'upcoming' | 'ok' | 'none'

export function daysUntil(renewal: string | null, today: Date): number | null {
  if (!renewal) return null
  // Date-only strings: compare at UTC midnight so a timezone cannot move the answer by a day.
  const then = Date.parse(`${renewal}T00:00:00Z`)
  if (Number.isNaN(then)) return null
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((then - now) / 86_400_000)
}

export function renewalState(renewal: string | null, today: Date): RenewalState {
  const d = daysUntil(renewal, today)
  if (d === null) return 'none'
  if (d < 0) return 'lapsed'
  if (d <= 7) return 'soon'
  if (d <= 30) return 'upcoming'
  return 'ok'
}

export function renewalLabel(renewal: string | null, today: Date): string {
  const d = daysUntil(renewal, today)
  if (d === null) return '—'
  if (d < 0) return `lapsed ${-d}d ago`
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return `in ${d}d`
}

/** "you typed this on the 3rd" beats a stale number presented as live. */
export function freshness(iso: string, source: 'manual' | 'api', today: Date): string {
  const d = Math.floor((today.getTime() - Date.parse(iso)) / 86_400_000)
  const when = d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`
  return source === 'api' ? `refreshed ${when}` : `you typed this ${when}`
}
