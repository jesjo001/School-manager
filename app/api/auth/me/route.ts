import mongoose from 'mongoose'
import { cookies } from 'next/headers'
import { ApiError, apiHandler } from '@/lib/api'
import { SESSION_COOKIE, getSession, sessionCookieOptions, signSession } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { Payment, Student } from '@/lib/models'
import { serializeSession } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

/**
 * Current session, re-validated against the database on every call.
 * Returns `null` (not an error) when there is no usable session, so the client
 * can treat "signed out" as a normal state.
 */
export const GET = apiHandler(async (req) => {
  const session = await getSession(req)
  if (!session) return null

  await connectDB()
  try {
    const ctx = await withTenant(req)

    // The active school can go stale (removed school, student switched devices)
    // — withTenant corrects it, and we mirror that back into the cookie.
    if (ctx.sessionRefreshed) {
      const jar = await cookies()
      jar.set(SESSION_COOKIE, await signSession(ctx.session), sessionCookieOptions())
    }

    const [studentCount, fees] = await Promise.all([
      Student.countDocuments({ schoolId: ctx.schoolId }),
      Payment.aggregate<{ total: number }>([
        {
          $match: {
            schoolId: new mongoose.Types.ObjectId(ctx.schoolId),
            status: 'paid',
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ])

    return serializeSession(ctx.session, ctx.school, {
      studentCount,
      feesCollected: fees[0]?.total ?? 0,
    })
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null
    throw err
  }
})
