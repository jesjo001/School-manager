/**
 * Date helpers shared by attendance, invoices, and the exam window logic.
 * Dates are stored normalised to UTC midnight so (classId, date) uniqueness
 * and equality queries behave predictably across time zones.
 */

/** Normalise anything date-like to UTC midnight of that calendar day. */
export function toUtcMidnight(value: Date | string | number): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${String(value)}`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** `'2026-10-26'` → Date at UTC midnight (accepts full ISO strings too). */
export function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return toUtcMidnight(value)
}

/** Anything date-like → `'YYYY-MM-DD'` (the shape the UI renders). */
export function toDateKey(value: Date | string | number): string {
  return toUtcMidnight(value).toISOString().slice(0, 10)
}

/** `'YYYY-MM-DD'` at UTC midnight, or `null` for empty/invalid input. */
export function optionalDateOnly(value?: string | null): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}
