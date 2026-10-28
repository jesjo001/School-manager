import { apiHandler, notFound, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { examQuestions, finalizeIfExpired, requireAttempt } from '@/lib/exams'
import { Exam, Student } from '@/lib/models'
import {
  serializeResultRow,
  serializeStartedAttempt,
} from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

/**
 * GET /api/attempts/:id — resume payload while the sitting is open, result
 * payload once it has been submitted. The `status` branch keeps one URL for
 * both client views (`getAttempt` and `getAttemptDetail`) without ever
 * sending the answer key to a learner.
 */
export const GET = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req)
  const isLearner = tenant.session.kind === 'student' && !!tenant.student

  const attempt = await requireAttempt(
    {
      tenantId: tenant.tenantId,
      schoolId: tenant.schoolId,
      studentId: isLearner ? String(tenant.student!._id) : undefined,
    },
    await param(ctx, 'id'),
  )

  const fresh = await finalizeIfExpired(attempt)
  const exam = await Exam.findOne({
    _id: fresh.examId,
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
  })
  if (!exam) throw notFound('Exam not found')

  const questions = await examQuestions(exam._id)
  const payload = serializeStartedAttempt(fresh, exam, questions)

  if (fresh.status === 'in_progress') return payload

  const student = await Student.findById(fresh.studentId)
  return {
    ...payload,
    rows: [
      serializeResultRow({ attempt: fresh, studentName: student?.name ?? 'Learner' }),
    ],
  }
})
