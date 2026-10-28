import mongoose from 'mongoose'
import { SchoolClass, Subject, TeacherAssignment, User, type UserDoc } from '@/lib/models'
import { serializeStaff } from '@/lib/serialize'
import type { TenantContext } from '@/lib/tenant'

/**
 * Staff directory rows: the account itself plus the subjects/classes it is
 * linked to — invited display names (`subjectNames`/`classNames`) merged with
 * real TeacherAssignment rows, resolved in three queries for the whole batch.
 */
const objectIds = (values: string[]) =>
  [...new Set(values.filter((value) => mongoose.isValidObjectId(value)))].map(
    (value) => new mongoose.Types.ObjectId(value),
  )

export async function decorateStaff(tenant: TenantContext, users: UserDoc[]) {
  if (!users.length) return []

  const assignments = await TeacherAssignment.find({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    teacherId: { $in: users.map((user) => user._id) },
  })
    .select('teacherId subjectId classId')
    .lean()

  const [subjects, classes] = await Promise.all([
    Subject.find({
      _id: { $in: objectIds(assignments.map((row) => String(row.subjectId))) },
      tenantId: tenant.tenantId,
      schoolId: tenant.schoolId,
    })
      .select('name')
      .lean(),
    SchoolClass.find({
      _id: { $in: objectIds(assignments.map((row) => String(row.classId))) },
      tenantId: tenant.tenantId,
      schoolId: tenant.schoolId,
    })
      .select('name')
      .lean(),
  ])

  const subjectNames = new Map(subjects.map((doc) => [String(doc._id), doc.name]))
  const classNames = new Map(classes.map((doc) => [String(doc._id), doc.name]))

  return users.map((user) => {
    const mine = assignments.filter((row) => String(row.teacherId) === String(user._id))
    const merge = (own: string[] | undefined, resolved: string[]) =>
      [...new Set([...(own ?? []), ...resolved])].filter(Boolean)

    return serializeStaff(user, {
      subjects: merge(
        user.subjectNames,
        mine.map((row) => subjectNames.get(String(row.subjectId)) ?? ''),
      ),
      classes: merge(
        user.classNames,
        mine.map((row) => classNames.get(String(row.classId)) ?? ''),
      ),
    })
  })
}
