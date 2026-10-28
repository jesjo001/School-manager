import type mongoose from 'mongoose'
import { requireAuth, type DbRole, type SessionPayload } from '@/lib/auth'
import { forbidden, unauthorized } from '@/lib/api'
import { School, Student, User, type SchoolDoc, type StudentDoc, type UserDoc } from '@/lib/models'

/**
 * Tenant resolution for API routes.
 *
 * `withTenant` is the ONLY way a handler learns which tenant/school to work
 * with: the school id comes from the signed session and is re-validated against
 * the database record on every request. Nothing sent in a body, query string,
 * or header is ever trusted for scoping (see `scopedFilter`).
 */
export type TenantContext = {
  session: SessionPayload
  tenantId: string
  /** Authoritative school id for this request (validated against the DB). */
  schoolId: string
  role: DbRole
  user: mongoose.HydratedDocument<UserDoc> | null
  student: mongoose.HydratedDocument<StudentDoc> | null
  school: mongoose.HydratedDocument<SchoolDoc> | null
  /** True when the session's active school was corrected (caller should re-issue the cookie). */
  sessionRefreshed: boolean
}

export type WithTenantOptions = {
  /** Lowercase DB roles allowed to call the route (omit for "any signed-in user"). */
  roles?: DbRole[]
}

export async function withTenant(
  req: Request,
  options: WithTenantOptions = {},
): Promise<TenantContext> {
  // Spec gate: `requireAuth(roles[])` runs first — tenant resolution only
  // happens for a session that already passed it.
  const session = await requireAuth(req, options.roles)

  let tenantId = session.tenantId
  let schoolId = session.activeSchoolId
  let schoolIds = session.schoolIds
  let user: mongoose.HydratedDocument<UserDoc> | null = null
  let student: mongoose.HydratedDocument<StudentDoc> | null = null
  let refreshed = false

  if (session.kind === 'staff') {
    user = await User.findById(session.sub)
    if (!user || user.status === 'suspended') throw unauthorized('Your account is no longer active')

    tenantId = String(user.tenantId)
    if (tenantId !== session.tenantId) throw unauthorized('Please sign in again')

    // The database is the authority for which schools this user may act for.
    schoolIds = (user.schoolIds ?? []).map(String)
    if (!schoolIds.includes(session.activeSchoolId)) {
      schoolId = schoolIds[0] ?? ''
      refreshed = true
    } else {
      schoolId = session.activeSchoolId
    }
  } else {
    student = await Student.findById(session.sub)
    if (!student || student.status === 'inactive' || student.status === 'graduated') {
      throw unauthorized('Your student account is no longer active')
    }
    tenantId = String(student.tenantId)
    schoolId = String(student.schoolId)
    schoolIds = [schoolId]
    if (session.activeSchoolId !== schoolId) refreshed = true
  }

  if (!schoolId) throw forbidden('Your account is not attached to a school yet')

  const school = await School.findOne({ _id: schoolId, tenantId })
  if (!school) throw unauthorized('School not found. Please sign in again.')

  return {
    session: { ...session, tenantId, schoolIds, activeSchoolId: schoolId },
    tenantId,
    schoolId,
    role: session.role,
    user,
    student,
    school,
    sessionRefreshed: refreshed,
  }
}

/**
 * Build a query filter that is always tenant + school scoped.
 * Handlers must spread this instead of reading schoolId/tenantId from input.
 */
export function scopedFilter(
  ctx: TenantContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { tenantId: ctx.tenantId, schoolId: ctx.schoolId, ...extra }
}

/** Current user id for audit fields (`createdBy`, `markedBy`, …). */
export const actorId = (ctx: TenantContext) =>
  ctx.user?._id ?? ctx.student?._id ?? ctx.session.sub
