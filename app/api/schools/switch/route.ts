import mongoose from 'mongoose'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { apiHandler, forbidden, notFound, parseBody } from '@/lib/api'
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { School } from '@/lib/models'
import { serializeSchool } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

const Body = z.object({ schoolId: z.string().trim().min(1, 'Choose a school') })

/**
 * Proprietor / admin school switcher.
 * The requested school must already be in the user's `schoolIds` — membership
 * is re-read from the database, never taken from the request.
 */
export const POST = apiHandler(async (req) => {
  const input = await parseBody(req, Body)
  await connectDB()

  const ctx = await withTenant(req, { roles: ['proprietor', 'admin', 'teacher'] })
  if (!ctx.user) throw forbidden('Staff accounts only')

  const allowed = (ctx.user.schoolIds ?? []).map(String)
  if (!allowed.includes(input.schoolId)) {
    throw forbidden('You do not have access to that school')
  }

  ctx.user.activeSchoolId = new mongoose.Types.ObjectId(input.schoolId)
  await ctx.user.save()

  const school = await School.findOne({ _id: input.schoolId, tenantId: ctx.tenantId })
  if (!school) throw notFound('School not found')

  // Keep the signed cookie in step with the new active school.
  const jar = await cookies()
  jar.set(
    SESSION_COOKIE,
    await signSession({ ...ctx.session, activeSchoolId: input.schoolId }),
    sessionCookieOptions(),
  )

  return { school: serializeSchool(school) }
})
