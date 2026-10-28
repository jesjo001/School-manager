import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, conflict, parseBody, parseQuery } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { SchoolClass, Subject, TeacherAssignment, User, type TeacherAssignmentDoc } from '@/lib/models'
import { serializeAssignment } from '@/lib/serialize'
import { scopedFilter, withTenant } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

const Query = z.object({ teacherId: z.string().trim().optional() })

const CreateBody = z.object({
  teacherId: z.string().trim().min(1, 'Choose a teacher'),
  subjectId: z.string().trim().min(1, 'Choose a subject'),
  classId: z.string().trim().min(1, 'Choose a class'),
})

const objectIds = (values: string[]) =>
  [...new Set(values.filter((value) => mongoose.isValidObjectId(value)))].map(
    (value) => new mongoose.Types.ObjectId(value),
  )

/** Resolve the display names an assignment row needs in one round trip. */
async function decorate(
  tenantId: string,
  schoolId: string,
  docs: TeacherAssignmentDoc[],
) {
  const teacherIds = objectIds(docs.map((doc) => String(doc.teacherId)))
  const subjectIds = objectIds(docs.map((doc) => String(doc.subjectId)))
  const classIds = objectIds(docs.map((doc) => String(doc.classId)))

  const [teachers, subjects, classes] = await Promise.all([
    User.find({ _id: { $in: teacherIds }, tenantId }).select('name').lean(),
    Subject.find({ _id: { $in: subjectIds }, schoolId, tenantId }).select('name').lean(),
    SchoolClass.find({ _id: { $in: classIds }, schoolId, tenantId }).select('name').lean(),
  ])

  const teacherNames = new Map(teachers.map((doc) => [String(doc._id), doc.name]))
  const subjectNames = new Map(subjects.map((doc) => [String(doc._id), doc.name]))
  const classNames = new Map(classes.map((doc) => [String(doc._id), doc.name]))

  return docs.map((doc) =>
    serializeAssignment(doc, {
      teacherName: teacherNames.get(String(doc.teacherId)) ?? '',
      subjectName: subjectNames.get(String(doc.subjectId)) ?? '',
      className: classNames.get(String(doc.classId)) ?? '',
    }),
  )
}

/** GET /api/teacher-assignments?teacherId=… */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const { teacherId } = parseQuery(req, Query)

  const filter = scopedFilter(tenant)
  if (teacherId) {
    if (!mongoose.isValidObjectId(teacherId)) throw badRequest('That teacher does not exist')
    filter.teacherId = teacherId
  }

  const docs = await TeacherAssignment.find(filter)
  return decorate(tenant.tenantId, tenant.schoolId, docs)
})

/** POST /api/teacher-assignments */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, CreateBody)

  const teacher = await User.findOne({
    _id: input.teacherId,
    tenantId: tenant.tenantId,
    schoolIds: tenant.schoolId,
    role: { $in: ['teacher', 'admin', 'proprietor'] },
  })
  if (!teacher) throw badRequest('That teacher is not part of this school')

  const subject = await Subject.findOne({
    _id: input.subjectId,
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
  })
  if (!subject) throw badRequest('That subject does not belong to this school')

  const klass = await SchoolClass.findOne({
    _id: input.classId,
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
  })
  if (!klass) throw badRequest('That class does not belong to this school')

  const duplicate = await TeacherAssignment.exists({
    ...scopedFilter(tenant),
    teacherId: teacher._id,
    subjectId: subject._id,
    classId: klass._id,
  })
  if (duplicate) throw conflict('That assignment already exists')

  const doc = await TeacherAssignment.create({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    teacherId: teacher._id,
    subjectId: subject._id,
    classId: klass._id,
  })

  return (await decorate(tenant.tenantId, tenant.schoolId, [doc]))[0]
})
