import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, notFound, parseBody, param } from '@/lib/api'
import { optionalDateOnly } from '@/lib/dates'
import { connectDB } from '@/lib/db'
import { Student } from '@/lib/models'
import { serializeStudent, studentStatusToDb } from '@/lib/serialize'
import { loadStudentStats } from '@/lib/stats'
import { scopedFilter, withTenant } from '@/lib/tenant'
import { requireClass } from '@/lib/validate'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const PatchBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  classId: z.string().trim().optional(),
  section: z.string().trim().max(10).optional(),
  gender: z.string().trim().max(20).optional(),
  admissionNumber: z.string().trim().max(40).optional(),
  dob: z.string().trim().max(40).optional(),
  status: z.string().trim().max(40).optional(),
  guardian: z
    .object({
      name: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(30).optional(),
      email: z.string().trim().max(200).optional(),
    })
    .optional(),
})

const scope = (tenant: Parameters<typeof scopedFilter>[0], id: string) => {
  if (!mongoose.isValidObjectId(id)) throw notFound('Student not found')
  return scopedFilter(tenant, { _id: id })
}

/** GET /api/students/[id] */
export const GET = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const doc = await Student.findOne(scope(tenant, id))
  if (!doc) throw notFound('Student not found')

  const stats = await loadStudentStats(tenant.schoolId, [String(doc._id)])
  return serializeStudent(doc, stats.get(String(doc._id)) ?? {})
})

/** PATCH /api/students/[id] */
export const PATCH = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, PatchBody)

  const filter = scope(tenant, id)
  if (!(await Student.findOne(filter))) throw notFound('Student not found')

  const set: Record<string, unknown> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.section !== undefined) set.section = input.section
  if (input.gender !== undefined) set.gender = input.gender
  if (input.admissionNumber !== undefined) set.admissionNumber = input.admissionNumber
  if (input.dob !== undefined) set.dob = optionalDateOnly(input.dob)
  if (input.status !== undefined) set.status = studentStatusToDb(input.status)
  if (input.classId !== undefined) {
    const klass = await requireClass(tenant.tenantId, tenant.schoolId, input.classId)
    set.classId = klass._id
    set.className = klass.name
  }
  if (input.guardian !== undefined) {
    set.guardian = {
      name: input.guardian.name ?? '',
      phone: input.guardian.phone ?? '',
      email: input.guardian.email ?? '',
      relation: '',
    }
  }

  if (!Object.keys(set).length) throw badRequest('Nothing to update')
  await Student.updateOne(filter, { $set: set })

  const doc = await Student.findOne(filter)
  if (!doc) throw notFound('Student not found')
  const stats = await loadStudentStats(tenant.schoolId, [String(doc._id)])
  return serializeStudent(doc, stats.get(String(doc._id)) ?? {})
})

/** DELETE /api/students/[id] */
export const DELETE = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const filter = scope(tenant, id)
  const result = await Student.deleteOne(filter)
  if (!result.deletedCount) throw notFound('Student not found')
  return { ok: true as const }
})
