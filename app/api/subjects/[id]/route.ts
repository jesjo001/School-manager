import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, conflict, notFound, parseBody, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { SchoolClass, Subject, TeacherAssignment } from '@/lib/models'
import { serializeSubjectRow } from '@/lib/serialize'
import { scopedFilter, withTenant } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const PatchBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  classIds: z.array(z.string().trim()).max(60).optional(),
})

const scope = (tenant: Parameters<typeof scopedFilter>[0], id: string) => {
  if (!mongoose.isValidObjectId(id)) throw notFound('Subject not found')
  return scopedFilter(tenant, { _id: id })
}

const resolveClasses = async (tenantId: string, schoolId: string, values: string[]) => {
  const ids: mongoose.Types.ObjectId[] = []
  for (const value of values) {
    if (!mongoose.isValidObjectId(value)) throw badRequest('That class does not exist')
    const klass = await SchoolClass.findOne({ _id: value, tenantId, schoolId })
    if (!klass) throw badRequest('That class does not belong to this school')
    ids.push(klass._id)
  }
  return ids
}

const namesFor = async (tenantId: string, schoolId: string, ids: string[]) => {
  const valid = ids.filter((value) => mongoose.isValidObjectId(value))
  if (!valid.length) return [] as string[]
  const docs = await SchoolClass.find({
    _id: { $in: valid.map((value) => new mongoose.Types.ObjectId(value)) },
    tenantId,
    schoolId,
  }).select('name')
  return docs.map((doc) => doc.name)
}

/** PATCH /api/subjects/[id] */
export const PATCH = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, PatchBody)

  const filter = scope(tenant, id)
  const doc = await Subject.findOne(filter)
  if (!doc) throw notFound('Subject not found')

  const set: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== doc.name) {
    if (await Subject.exists({ ...scopedFilter(tenant), name: input.name })) {
      throw conflict(`A subject named “${input.name}” already exists`)
    }
    set.name = input.name
  }
  if (input.classIds !== undefined) set.classIds = await resolveClasses(tenant.tenantId, tenant.schoolId, input.classIds)
  if (Object.keys(set).length) await Subject.updateOne(filter, { $set: set })

  const updated = await Subject.findOne(filter)
  if (!updated) throw notFound('Subject not found')
  return serializeSubjectRow(
    updated,
    await namesFor(tenant.tenantId, tenant.schoolId, (updated.classIds ?? []).map(String)),
  )
})

/** DELETE /api/subjects/[id] — assignments that taught it are removed too. */
export const DELETE = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const filter = scope(tenant, id)
  const result = await Subject.deleteOne(filter)
  if (!result.deletedCount) throw notFound('Subject not found')

  await TeacherAssignment.deleteMany({ ...scopedFilter(tenant), subjectId: new mongoose.Types.ObjectId(id) })
  return { ok: true as const }
})
