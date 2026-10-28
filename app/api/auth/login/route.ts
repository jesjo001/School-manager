import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { apiHandler, clientIp, parseBody, unauthorized } from '@/lib/api'
import { SESSION_COOKIE, sessionCookieOptions, signSession, type SessionPayload } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { School, User } from '@/lib/models'
import { assertRateLimit, LOGIN_RULE } from '@/lib/ratelimit'
import { serializeSession } from '@/lib/serialize'

const Body = z.object({
  email: z.string().trim().min(1, 'Enter your email').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
})

/** Cached hash used to spend the same CPU time when the account does not exist. */
let dummyHash: string | null = null

/** Staff sign-in (proprietor / admin / teacher). Learners use /api/auth/student-login. */
export const POST = apiHandler(async (req) => {
  const input = await parseBody(req, Body)
  await connectDB()

  const email = input.email.toLowerCase()
  const ip = clientIp(req)
  // Two keys: one per network so a brute-force can't spread, one per account.
  await assertRateLimit('login-ip', ip, { ...LOGIN_RULE, limit: 20 }, 'Too many sign-in attempts from your network.')
  await assertRateLimit('login-email', email, LOGIN_RULE, 'Too many sign-in attempts for this account.')

  const user = await User.findOne({ email }).select('+passwordHash')
  // Constant-ish work even when the account does not exist (timing hygiene).
  // Built lazily so cold starts are not taxed with an extra bcrypt round.
  if (!user && !dummyHash) dummyHash = bcrypt.hashSync('campusflow-timing-equaliser', 10)
  const valid = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash!)
  if (!user || !valid) throw unauthorized('Incorrect email or password')
  if (user.status === 'suspended') throw unauthorized('This account has been suspended')
  if (user.role === 'student') throw unauthorized('Learners must use student sign-in')

  const schoolIds = (user.schoolIds ?? []).map(String)
  const activeSchoolId = schoolIds.includes(String(user.activeSchoolId))
    ? String(user.activeSchoolId)
    : (schoolIds[0] ?? '')

  const payload: SessionPayload = {
    sub: String(user._id),
    kind: 'staff',
    role: user.role === 'proprietor' || user.role === 'admin' || user.role === 'teacher'
      ? user.role
      : 'teacher',
    tenantId: String(user.tenantId),
    schoolIds,
    activeSchoolId,
    name: user.name,
    email: user.email ?? undefined,
  }

  user.lastLoginAt = new Date()
  await user.save()

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession(payload), sessionCookieOptions())

  const school = activeSchoolId ? await School.findById(activeSchoolId) : null
  return serializeSession(payload, school)
})
