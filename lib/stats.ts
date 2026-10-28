import mongoose from 'mongoose'
import { Attendance, ExamAttempt, Invoice, Payment, Student, Subject, User, type ClassDoc } from './models'

/**
 * Batch statistics used by the list/detail serializers.
 *
 * Everything is one aggregate per concern for the *current page* of ids, so a
 * list request never degenerates into N+1 queries.
 */

const oid = (value: unknown) => new mongoose.Types.ObjectId(String(value))

export type StudentStatEntry = {
  /** (present + late) / marked days, in percent. Late still counts as attended. */
  attendance: number
  feeBalance: number
  examScores: number[]
}

export type StudentStatsMap = Map<string, StudentStatEntry>

export async function loadStudentStats(
  schoolId: string,
  studentIds: string[],
): Promise<StudentStatsMap> {
  const map: StudentStatsMap = new Map()
  const ids = studentIds.filter((value) => mongoose.isValidObjectId(value))
  if (!ids.length) return map

  const objectIds = ids.map(oid)
  const school = oid(schoolId)

  const [attendance, balances, scores] = await Promise.all([
    Attendance.aggregate<{ _id: mongoose.Types.ObjectId; total: number; attended: number }>([
      { $match: { schoolId: school, 'records.studentId': { $in: objectIds } } },
      { $unwind: '$records' },
      { $match: { 'records.studentId': { $in: objectIds } } },
      {
        $group: {
          _id: '$records.studentId',
          total: { $sum: 1 },
          attended: {
            $sum: { $cond: [{ $in: ['$records.status', ['present', 'late']] }, 1, 0] },
          },
        },
      },
    ]),
    Invoice.aggregate<{ _id: mongoose.Types.ObjectId; due: number }>([
      {
        $match: {
          schoolId: school,
          studentId: { $in: objectIds },
          status: { $ne: 'paid' },
        },
      },
      { $group: { _id: '$studentId', due: { $sum: '$amount' } } },
    ]),
    ExamAttempt.aggregate<{ _id: mongoose.Types.ObjectId; scores: number[] }>([
      { $match: { schoolId: school, studentId: { $in: objectIds }, status: { $ne: 'in_progress' } } },
      { $sort: { submittedAt: 1 } },
      {
        $group: {
          _id: '$studentId',
          scores: {
            $push: {
              $cond: [
                { $gt: ['$maxScore', 0] },
                { $round: [{ $multiply: [{ $divide: ['$totalScore', '$maxScore'] }, 100] }, 0] },
                0,
              ],
            },
          },
        },
      },
      { $project: { scores: { $slice: ['$scores', -5] } } },
    ]),
  ])

  for (const row of attendance) {
    const entry = map.get(String(row._id)) ?? { attendance: 0, feeBalance: 0, examScores: [] }
    entry.attendance = row.total ? Math.round((row.attended / row.total) * 100) : 0
    map.set(String(row._id), entry)
  }
  for (const row of balances) {
    const entry = map.get(String(row._id)) ?? { attendance: 0, feeBalance: 0, examScores: [] }
    entry.feeBalance = row.due
    map.set(String(row._id), entry)
  }
  for (const row of scores) {
    const entry = map.get(String(row._id)) ?? { attendance: 0, feeBalance: 0, examScores: [] }
    entry.examScores = row.scores
    map.set(String(row._id), entry)
  }

  return map
}

export type ClassStats = { studentCount: number; teacher: string; subjects: string[] }
export type ClassStatsMap = Map<string, ClassStats>

/** studentCount / class teacher / subject names for a batch of class docs. */
export async function loadClassStats(
  schoolId: string,
  classes: ClassDoc[],
): Promise<ClassStatsMap> {
  const map: ClassStatsMap = new Map()
  if (!classes.length) return map

  const classIds = classes.map((doc) => doc._id)
  const teacherIds = classes
    .map((doc) => doc.classTeacherId)
    .filter((value): value is mongoose.Types.ObjectId => Boolean(value))
  const school = oid(schoolId)

  const [counts, subjects, teachers] = await Promise.all([
    Student.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { schoolId: school, classId: { $in: classIds } } },
      { $group: { _id: '$classId', count: { $sum: 1 } } },
    ]),
    Subject.find({ schoolId: school, classIds: { $in: classIds } })
      .select('name classIds')
      .lean(),
    User.find(teacherIds.length ? { _id: { $in: teacherIds } } : { _id: { $in: [] } })
      .select('name')
      .lean(),
  ])

  const teacherNames = new Map(teachers.map((doc) => [String(doc._id), doc.name]))
  const subjectsByClass = new Map<string, string[]>()
  for (const subject of subjects) {
    for (const classId of (subject.classIds ?? []).map(String)) {
      const list = subjectsByClass.get(classId) ?? []
      list.push(subject.name)
      subjectsByClass.set(classId, list)
    }
  }

  for (const doc of classes) {
    const key = String(doc._id)
    map.set(key, {
      studentCount: counts.find((row) => String(row._id) === key)?.count ?? 0,
      teacher: doc.classTeacherId ? (teacherNames.get(String(doc.classTeacherId)) ?? '') : '',
      subjects: (subjectsByClass.get(key) ?? []).sort(),
    })
  }

  return map
}

export type SchoolStats = { studentCount: number; feesCollected: number }
export type SchoolStatsMap = Map<string, SchoolStats>

/** Roster size + collected fees per school (school switcher / dashboard cards). */
export async function loadSchoolStats(
  tenantId: string,
  schoolIds: string[],
): Promise<SchoolStatsMap> {
  const map: SchoolStatsMap = new Map()
  for (const schoolId of schoolIds) map.set(schoolId, { studentCount: 0, feesCollected: 0 })

  const ids = schoolIds.filter((value) => mongoose.isValidObjectId(value))
  if (!ids.length) return map
  const objectIds = ids.map(oid)
  const tenant = oid(tenantId)

  const [counts, collected] = await Promise.all([
    Student.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { tenantId: tenant, schoolId: { $in: objectIds } } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } },
    ]),
    Payment.aggregate<{ _id: mongoose.Types.ObjectId; total: number }>([
      { $match: { tenantId: tenant, schoolId: { $in: objectIds }, status: 'paid' } },
      { $group: { _id: '$schoolId', total: { $sum: '$amount' } } },
    ]),
  ])

  for (const row of counts) {
    const entry = map.get(String(row._id))
    if (entry) entry.studentCount = row.count
  }
  for (const row of collected) {
    const entry = map.get(String(row._id))
    if (entry) entry.feesCollected = row.total
  }

  return map
}
