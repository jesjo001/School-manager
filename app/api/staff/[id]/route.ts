import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, conflict, forbidden, notFound, parseBody, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { TeacherAssignment, User } from '@/lib/models'
import { staffRoleToDb, staffStatusToDb } from '@/lib/serialize'
import { decorateStaff } from '@/lib/staff'
import { scopedFilter, withTenant, type TenantContext } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin'] as const

const namesList = z.array(z.string().trim().min(1).max(60)).max(30).optional()

const PatchBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email('Enter a valid email address').max(200).optional(),
  role: z.string().trim().max(60).optional(),
  status: z.string().trim().max(40).optional(),
  subjects: namesList,
  classes: namesList,
})

const scope = (tenant: TenantContext, id: string) => {
  if (!mongoose.isValidObjectId(id)) throw notFound('Staff member not found')
  return scopedFilter(tenant, { _id: id })
}

/** PATCH /api/staff/[id] */
export const PATCH = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, PatchBody)

  const filter = scope(tenant, id)
  const doc = await User.findOne(filter)
  if (!doc) throw notFound('Staff member not found')

  // Owners outrank admins: only a proprietor may re-role or suspend one.
  if (doc.role === 'proprietor' && tenant.role !== 'proprietor') {
    throw forbidden('Only the proprietor can change an owner account')
  }

  const set: Record<string, unknown> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.email !== undefined) {
    const email = input.email.toLowerCase()
    if (email !== doc.email && (await User.exists({ email }))) {
      throw conflict('An account with that email already exists')
    }
    set.email = email
  }
  if (input.role !== undefined) set.role = staffRoleToDb(input.role)
  if (input.status !== undefined) set.status = staffStatusToDb(input.status)
  if (input.subjects !== undefined) set.subjectNames = input.subjects
  if (input.classes !== undefined) set.classNames = input.classes

  if (Object.keys(set).length) await User.updateOne(filter, { $set: set })

  const updated = await User.findOne(filter)
  if (!updated) throw notFound('Staff member not found')
  return (await decorateStaff(tenant, [updated]))[0]
})

/** DELETE /api/staff/[id] — removes the account and its teaching assignments. */
export const DELETE = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  if (id === tenant.session.sub) throw badRequest('You cannot remove your own account')

  const filter = scope(tenant, id)
  const doc = await User.findOne(filter)
  if (!doc) throw notFound('Staff member not found')
  if (doc.role === 'proprietor' && tenant.role !== 'proprietor') {
    throw forbidden('Only the proprietor can remove an owner account')
  }

  await User.deleteOne(filter)
  await TeacherAssignment.deleteMany({ ...scopedFilter(tenant), teacherId: doc._id })
  return { ok: true as const }
})
