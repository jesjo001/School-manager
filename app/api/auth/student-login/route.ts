import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { apiHandler, clientIp, parseBody, unauthorized } from '@/lib/api'
import { SESSION_COOKIE, sessionCookieOptions, signSession, type SessionPayload } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { School, Student } from '@/lib/models'
import { assertRateLimit, LOGIN_RULE } from '@/lib/ratelimit'
import { serializeSession } from '@/lib/serialize'

const Body = z.object({
  /** School e-mail **or** admission number. */
  identifier: z.string().trim().min(1, 'Enter your admission number or school email').max(200),
  password: z.string().min(1, 'Enter your password').max(200),
})

let dummyHash: string | null = null

/** Learner sign-in — separate session kind so students only reach CBT routes. */
export const POST = apiHandler(async (req) => {
  const input = await parseBody(req, Body)
  await connectDB()

  const identifier = input.identifier.trim()
  const ip = clientIp(req)
  await assertRateLimit('student-ip', ip, { ...LOGIN_RULE, limit: 20 }, 'Too many sign-in attempts from your network.')
  await assertRateLimit('student-id', identifier.toLowerCase(), LOGIN_RULE, 'Too many sign-in attempts for this account.')

  const student = await Student.findOne({
    $or: [{ email: identifier.toLowerCase() }, { admissionNumber: identifier }],
  }).select('+passwordHash')

  if (!student && !dummyHash) dummyHash = bcrypt.hashSync('campusflow-timing-equaliser', 10)
  const valid = await bcrypt.compare(
    input.password,
    student?.passwordHash ?? dummyHash!,
  )
  if (!student || !student.passwordHash || !valid) {
    throw unauthorized('Incorrect admission number or password')
  }
  if (student.status !== 'active' && student.status !== 'on_leave') {
    throw unauthorized('This student account is not active')
  }

  const schoolId = String(student.schoolId)
  const payload: SessionPayload = {
    sub: String(student._id),
    kind: 'student',
    role: 'student',
    tenantId: String(student.tenantId),
    schoolIds: [schoolId],
    activeSchoolId: schoolId,
    name: student.name,
    email: student.email ?? undefined,
  }

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession(payload), sessionCookieOptions())

  const school = await School.findById(schoolId)
  return serializeSession(payload, school)
})
