import { z } from 'zod'
import mongoose from 'mongoose'
import { apiHandler, badRequest, conflict, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { SchoolClass, Subject } from '@/lib/models'
import { serializeSubjectRow } from '@/lib/serialize'
import { scopedFilter, withTenant } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const CreateBody = z.object({
  name: z.string().trim().min(1, 'Enter a subject name').max(80),
  classIds: z.array(z.string().trim()).max(60).optional(),
})

async function classNamesFor(schoolId: string, tenantId: string, classIds: mongoose.Types.ObjectId[]) {
  if (!classIds.length) return [] as { id: string; name: string }[]
  const docs = await SchoolClass.find({ _id: { $in: classIds }, schoolId, tenantId }).select('name')
  return docs.map((doc) => ({ id: String(doc._id), name: doc.name }))
}

/** GET /api/subjects */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const docs = await Subject.find(scopedFilter(tenant)).collation({ locale: 'en', strength: 1 })
    .sort({ name: 1 })

  const allClassIds = [...new Set(docs.flatMap((doc) => (doc.classIds ?? []).map(String)))]
    .filter((value) => mongoose.isValidObjectId(value))
    .map((value) => new mongoose.Types.ObjectId(value))
  const classes = await classNamesFor(tenant.schoolId, tenant.tenantId, allClassIds)
  const namesById = new Map(classes.map((entry) => [entry.id, entry.name]))

  return docs.map((doc) =>
    serializeSubjectRow(
      doc,
      (doc.classIds ?? []).map(String).map((classId) => namesById.get(classId) ?? '').filter(Boolean),
    ),
  )
})

/** POST /api/subjects */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, CreateBody)

  if (await Subject.exists({ ...scopedFilter(tenant), name: input.name })) {
    throw conflict(`A subject named “${input.name}” already exists`)
  }

  const classIds: mongoose.Types.ObjectId[] = []
  for (const classId of input.classIds ?? []) {
    if (!mongoose.isValidObjectId(classId)) throw badRequest('That class does not exist')
    const klass = await SchoolClass.findOne({ _id: classId, tenantId: tenant.tenantId, schoolId: tenant.schoolId })
    if (!klass) throw badRequest('That class does not belong to this school')
    classIds.push(klass._id)
  }

  const doc = await Subject.create({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    name: input.name,
    classIds,
  })

  const classNames = (await classNamesFor(tenant.schoolId, tenant.tenantId, classIds)).map((entry) => entry.name)
  return serializeSubjectRow(doc, classNames)
})
