import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, conflict, parseBody, parseQuery } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { Student } from '@/lib/models'
import { optionalDateOnly } from '@/lib/dates'
import { serializeStudent, studentStatusToDb } from '@/lib/serialize'
import { loadStudentStats } from '@/lib/stats'
import { actorId, scopedFilter, withTenant } from '@/lib/tenant'
import {
  nextAdmissionNumber,
  paginated,
  paginationSchema,
  requireClass,
  searchRegex,
} from '@/lib/validate'

/** Route access mirrors RoleGuard: /students is teacher/admin/proprietor only. */
const ROLES = ['proprietor', 'admin', 'teacher'] as const

const Query = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  classId: z.string().trim().max(64).optional(),
  status: z.string().trim().max(40).optional(),
})

const guardianSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(200).optional(),
})

const CreateBody = z.object({
  name: z.string().trim().min(2, 'Enter the student name').max(120),
  classId: z.string().trim().min(1, 'Choose a class'),
  section: z.string().trim().min(1, 'Choose a section').max(10),
  gender: z.string().trim().max(20).optional(),
  admissionNumber: z.string().trim().max(40).optional(),
  dob: z.string().trim().max(40).optional(),
  guardian: guardianSchema.optional(),
})

/** GET /api/students — paginated, searchable, school-scoped. */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const query = parseQuery(req, Query)

  const filter: Record<string, unknown> = scopedFilter(tenant)
  if (query.q) {
    filter.$or = [{ name: searchRegex(query.q) }, { admissionNumber: searchRegex(query.q) }]
  }
  if (query.classId) {
    if (!mongoose.isValidObjectId(query.classId)) throw badRequest('That class does not exist')
    filter.classId = query.classId
  }
  if (query.status) filter.status = studentStatusToDb(query.status)

  const total = await Student.countDocuments(filter)
  const docs = await Student.find(filter)
    .collation({ locale: 'en', strength: 1 })
    .sort({ name: 1 })
    .skip((query.page - 1) * query.limit)
    .limit(query.limit)

  const stats = await loadStudentStats(
    tenant.schoolId,
    docs.map((doc) => String(doc._id)),
  )

  return paginated(
    docs.map((doc) => serializeStudent(doc, stats.get(String(doc._id)) ?? {})),
    total,
    query.page,
    query.limit,
  )
})

/** POST /api/students */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, CreateBody)

  const klass = await requireClass(tenant.tenantId, tenant.schoolId, input.classId)
  const admissionNumber =
    input.admissionNumber?.trim() || (await nextAdmissionNumber(tenant.tenantId, tenant.schoolId))

  // Checked in the application as well as by the unique index, so the contract
  // holds even while index builds are still catching up.
  const clash = await Student.exists({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    admissionNumber,
  })
  if (clash) throw conflict('That admission number is already in use')

  const doc = await Student.create({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    admissionNumber,
    name: input.name,
    className: klass.name,
    classId: klass._id,
    section: input.section,
    gender: input.gender ?? '',
    dob: optionalDateOnly(input.dob) ?? undefined,
    guardian: {
      name: input.guardian?.name ?? '',
      phone: input.guardian?.phone ?? '',
      email: input.guardian?.email ?? '',
      relation: '',
    },
    status: 'active',
    createdBy: actorId(tenant),
  })

  const stats = await loadStudentStats(tenant.schoolId, [String(doc._id)])
  return serializeStudent(doc, stats.get(String(doc._id)) ?? {})
})
