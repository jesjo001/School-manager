import { apiHandler } from '@/lib/api'
import { clearSessionCookie } from '@/lib/auth'

/** Clears the httpOnly session cookie. */
export const POST = apiHandler(async () => {
  await clearSessionCookie()
  return { ok: true as const }
})
