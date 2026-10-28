import { z } from 'zod'
import { apiHandler, conflict, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { SchoolClass, User } from '@/lib/models'
import { serializeClassRow } from '@/lib/serialize'
import { loadClassStats } from '@/lib/stats'
import { scopedFilter, withTenant } from '@/lib/tenant'
import { sectionLetters } from '@/lib/validate'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const CreateBody = z.object({
  name: z.string().trim().min(1, 'Enter a class name').max(60),
  /** Number of sections — the UI renders `sections` as a count. */
  sections: z.coerce.number().int().min(1).max(26).optional(),
  classTeacherId: z.string().trim().optional(),
})

/** GET /api/classes — every class in the active school, with roll-ups. */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const docs = await SchoolClass.find(scopedFilter(tenant)).collation({ locale: 'en', strength: 1 })
    .sort({ name: 1 })
  const stats = await loadClassStats(tenant.schoolId, docs)

  return docs.map((doc) => serializeClassRow(doc, stats.get(String(doc._id)) ?? { subjects: [] }))
})

/** POST /api/classes */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, CreateBody)

  if (await SchoolClass.exists({ ...scopedFilter(tenant), name: input.name })) {
    throw conflict(`A class named “${input.name}” already exists`)
  }

  let classTeacherId
  if (input.classTeacherId) {
    const teacher = await User.findOne({
      _id: input.classTeacherId,
      tenantId: tenant.tenantId,
      schoolIds: tenant.schoolId,
      role: { $in: ['teacher', 'admin', 'proprietor'] },
    })
    if (!teacher) throw conflict('That teacher is not part of this school')
    classTeacherId = teacher._id
  }

  const doc = await SchoolClass.create({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    name: input.name,
    sections: sectionLetters(input.sections ?? 1),
    classTeacherId,
  })

  const stats = await loadClassStats(tenant.schoolId, [doc])
  return serializeClassRow(doc, stats.get(String(doc._id)) ?? { subjects: [] })
})
