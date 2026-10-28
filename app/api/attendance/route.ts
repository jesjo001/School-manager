import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, notFound, parseBody, parseQuery } from '@/lib/api'
import { parseDateOnly } from '@/lib/dates'
import { connectDB } from '@/lib/db'
import { Attendance, Student } from '@/lib/models'
import { serializeAttendanceDay } from '@/lib/serialize'
import { actorId, scopedFilter, withTenant } from '@/lib/tenant'
import { dateOnlySchema, requireClass } from '@/lib/validate'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const Query = z.object({
  classId: z.string().trim().min(1, 'Choose a class'),
  date: dateOnlySchema,
})

const RecordSchema = z.object({
  studentId: z.string().trim().min(1, 'Missing student id'),
  // The register UI speaks "Present"/"Absent"/"Late"; the DB speaks lowercase.
  status: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.enum(['present', 'absent', 'late'])),
})

const SaveBody = z.object({
  classId: z.string().trim().min(1, 'Choose a class'),
  date: dateOnlySchema,
  records: z.array(RecordSchema).max(300, 'That class is too large to save in one request'),
})

/**
 * GET /api/attendance?classId=…&date=YYYY-MM-DD
 * Returns `null` when the register for that day has not been taken yet.
 */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const query = parseQuery(req, Query)

  await requireClass(tenant.tenantId, tenant.schoolId, query.classId)

  const doc = await Attendance.findOne({
    ...scopedFilter(tenant),
    classId: query.classId,
    date: parseDateOnly(query.date),
  })
  if (!doc) return null
  return serializeAttendanceDay(doc)
})

/**
 * POST /api/attendance — idempotent save (one register per class per day).
 * Every student in the payload must belong to this class *and* this school.
 */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, SaveBody)

  const klass = await requireClass(tenant.tenantId, tenant.schoolId, input.classId)

  const wanted = [...new Set(input.records.map((record) => record.studentId))]
  for (const studentId of wanted) {
    if (!mongoose.isValidObjectId(studentId)) throw badRequest('The register contains an unknown student')
  }
  const objectIds = wanted.map((value) => new mongoose.Types.ObjectId(value))
  const students = await Student.find({
    ...scopedFilter(tenant),
    _id: { $in: objectIds },
    classId: klass._id,
  })
    .select('name')
    .lean()

  if (students.length !== wanted.length) {
    throw badRequest('The register contains a student who is not in this class')
  }

  const names = new Map(students.map((doc) => [String(doc._id), doc.name]))
  const markedAt = new Date()
  const records = input.records.map((record) => ({
    studentId: new mongoose.Types.ObjectId(record.studentId),
    status: record.status,
    markedAt,
    markedBy: actorId(tenant),
  }))
  // Stable, name-ordered output regardless of the order the register was saved in.
  records.sort((a, b) =>
    (names.get(String(a.studentId)) ?? '').localeCompare(names.get(String(b.studentId)) ?? ''),
  )

  const doc = await Attendance.findOneAndUpdate(
    { classId: klass._id, date: parseDateOnly(input.date) },
    {
      $set: {
        tenantId: tenant.tenantId,
        schoolId: tenant.schoolId,
        classId: klass._id,
        date: parseDateOnly(input.date),
        records,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  if (!doc) throw notFound('Register could not be saved')

  return serializeAttendanceDay(doc)
})
