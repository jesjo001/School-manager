import { apiHandler, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { requireExam } from '@/lib/exams'
import { ExamAttempt, Student } from '@/lib/models'
import { serializeResultRow } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'
import type { ExamResults, ResultRow } from '@/services/types'

const STAFF_ROLES = ['proprietor', 'admin', 'teacher'] as const

const BANDS = [
  { range: '90–100%', min: 90, max: 100 },
  { range: '80–89%', min: 80, max: 89 },
  { range: '70–79%', min: 70, max: 79 },
  { range: '60–69%', min: 60, max: 69 },
  { range: 'Below 60%', min: 0, max: 59 },
]

/** GET /api/exams/:id/results — staff-only per-sitting results for one exam. */
export const GET = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  const attempts = await ExamAttempt.find({ examId: exam._id }).sort({ submittedAt: 1 })
  const studentIds = [...new Set(attempts.map((attempt) => String(attempt.studentId)))]
  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } })
    : []
  const nameById = new Map(students.map((student) => [String(student._id), student.name]))

  const rows: ResultRow[] = attempts
    .filter((attempt) => attempt.status !== 'in_progress')
    .map((attempt) =>
      serializeResultRow({
        attempt,
        studentName: nameById.get(String(attempt.studentId)) ?? 'Learner',
      }),
    )

  const distribution = BANDS.map((band) => ({
    range: band.range,
    students: rows.filter((row) => row.percent >= band.min && row.percent <= band.max).length,
  }))

  // Averages only count fully graded sittings so pending work never drags them down.
  const graded = rows.filter((row) => row.status === 'graded')
  const average = graded.length
    ? Math.round(graded.reduce((sum, row) => sum + row.percent, 0) / graded.length)
    : 0

  const results: ExamResults = {
    examId: String(exam._id),
    examTitle: exam.title,
    className: exam.className ?? '',
    rows,
    distribution,
    flaggedCount: rows.filter((row) => row.flagged).length,
    average,
  }
  return results
})
