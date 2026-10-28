import { tooManyRequests } from '@/lib/api'
import { RateLimit } from '@/lib/models'

/**
 * Fixed-window rate limiter backed by MongoDB (no Redis in this stack).
 *
 * The window index is part of the key, so each window is a fresh document and
 * increments are a single atomic `$inc`. Documents expire through the TTL index
 * on `expiresAt`.
 */
export type RateLimitRule = {
  /** Maximum number of attempts allowed inside one window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export type RateLimitResult = {
  ok: boolean
  /** Attempts consumed so far in this window. */
  count: number
  /** Seconds until the window resets (0 when the limit is not exceeded). */
  retryAfter: number
}

export async function consumeRateLimit(
  namespace: string,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const now = Date.now()
  const windowIndex = Math.floor(now / rule.windowMs)
  const key = `${namespace}:${identity}:${windowIndex}`
  const windowStartedAt = new Date(windowIndex * rule.windowMs)
  const expiresAt = new Date((windowIndex + 1) * rule.windowMs)

  let count = 0
  try {
    const doc = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { windowStartedAt, expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: false },
    )
    count = doc?.count ?? 1
  } catch (err) {
    // Two requests raced the very first insert of this window — increment the
    // winner's document instead.
    if ((err as { code?: number }).code === 11000) {
      const doc = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true })
      count = doc?.count ?? 1
    } else {
      // Never block the request itself because the limiter failed open.
      console.error('[ratelimit]', (err as Error).message)
      return { ok: true, count: 0, retryAfter: 0 }
    }
  }

  const retryAfter = Math.max(
    0,
    Math.ceil(((windowIndex + 1) * rule.windowMs - now) / 1000),
  )
  return { ok: count <= rule.limit, count, retryAfter: count <= rule.limit ? 0 : retryAfter }
}

/** Login policy: 5 attempts per identifier and per IP every 15 minutes. */
export const LOGIN_RULE: RateLimitRule = { limit: 5, windowMs: 15 * 60 * 1000 }

/** Throw-shaped helper used by auth routes (throws an ApiError-shaped object). */
export async function assertRateLimit(
  namespace: string,
  identity: string,
  rule: RateLimitRule,
  message = 'Too many attempts. Please wait a moment and try again.',
): Promise<void> {
  const result = await consumeRateLimit(namespace, identity, rule)
  if (!result.ok) {
    throw tooManyRequests(`${message} You can try again in ${formatRetry(result.retryAfter)}.`)
  }
}

export function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}
