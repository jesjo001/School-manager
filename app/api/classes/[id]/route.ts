import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, conflict, notFound, parseBody, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { SchoolClass, Student, Subject, TeacherAssignment, User } from '@/lib/models'
import { serializeClassRow } from '@/lib/serialize'
import { loadClassStats } from '@/lib/stats'
import { scopedFilter, withTenant } from '@/lib/tenant'
import { sectionLetters } from '@/lib/validate'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const PatchBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sections: z.coerce.number().int().min(1).max(26).optional(),
  /** Empty string clears the class teacher. */
  classTeacherId: z.string().trim().optional(),
})

const scope = (tenant: Parameters<typeof scopedFilter>[0], id: string) => {
  if (!mongoose.isValidObjectId(id)) throw notFound('Class not found')
  return scopedFilter(tenant, { _id: id })
}

/** PATCH /api/classes/[id] */
export const PATCH = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, PatchBody)

  const filter = scope(tenant, id)
  const doc = await SchoolClass.findOne(filter)
  if (!doc) throw notFound('Class not found')

  const set: Record<string, unknown> = {}
  if (input.name !== undefined && input.name !== doc.name) {
    if (await SchoolClass.exists({ ...scopedFilter(tenant), name: input.name })) {
      throw conflict(`A class named “${input.name}” already exists`)
    }
    set.name = input.name
  }
  if (input.sections !== undefined) {
    // Keep existing section letters, extend with A, B, C… when growing.
    const current = doc.sections?.length ? doc.sections : ['A']
    set.sections = sectionLetters(input.sections).map((letter, index) => current[index] ?? letter)
  }
  if (input.classTeacherId !== undefined) {
    if (!input.classTeacherId) {
      set.classTeacherId = null
    } else {
      const teacher = await User.findOne({
        _id: input.classTeacherId,
        tenantId: tenant.tenantId,
        schoolIds: tenant.schoolId,
        role: { $in: ['teacher', 'admin', 'proprietor'] },
      })
      if (!teacher) throw conflict('That teacher is not part of this school')
      set.classTeacherId = teacher._id
    }
  }

  if (Object.keys(set).length) await SchoolClass.updateOne(filter, { $set: set })

  const updated = await SchoolClass.findOne(filter)
  if (!updated) throw notFound('Class not found')
  const stats = await loadClassStats(tenant.schoolId, [updated])
  return serializeClassRow(updated, stats.get(String(updated._id)) ?? { subjects: [] })
})

/**
 * DELETE /api/classes/[id]
 * Learners are detached (they keep existing with no class), subject links and
 * teacher assignments that pointed at the class are removed with it.
 */
export const DELETE = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const filter = scope(tenant, id)
  const result = await SchoolClass.deleteOne(filter)
  if (!result.deletedCount) throw notFound('Class not found')

  const objectId = new mongoose.Types.ObjectId(id)
  await Promise.all([
    Student.updateMany({ ...scopedFilter(tenant), classId: objectId }, { $set: { classId: null, className: '' } }),
    TeacherAssignment.deleteMany({ ...scopedFilter(tenant), classId: objectId }),
    Subject.updateMany({ ...scopedFilter(tenant), classIds: objectId }, { $pull: { classIds: objectId } }),
  ])

  return { ok: true as const }
})
