import { cookies } from 'next/headers'
import { forbidden, unauthorized } from '@/lib/api'
import {
  SESSION_COOKIE,
  verifySessionToken,
  type DbRole,
  type SessionPayload,
} from './session-token'

/**
 * Auth entry points for route handlers and server code.
 *
 * The signed-token layer lives in `lib/session-token.ts` (edge safe); this
 * module adds cookie helpers and `requireAuth`, which is the guard every
 * protected endpoint uses before doing any work.
 */

export * from './session-token'

/** Read + verify the session cookie from any Request. */
export async function getSession(req: Request): Promise<SessionPayload | null> {
  const header = req.headers.get('cookie')
  if (!header) return null
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(header)
  if (!match) return null
  return verifySessionToken(decodeURIComponent(match[1]))
}

/** Drop the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

/**
 * Require a signed-in session, optionally restricted to a set of roles.
 * Throws an `ApiError` (401/403) which `apiHandler` converts to an envelope.
 */
export async function requireAuth(req: Request, roles?: DbRole[]): Promise<SessionPayload> {
  const session = await getSession(req)
  if (!session) throw unauthorized()
  if (roles?.length && !roles.includes(session.role)) {
    throw forbidden('You do not have permission to do that')
  }
  return session
}
