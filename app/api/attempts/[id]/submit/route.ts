import { apiHandler, forbidden, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import {
  autoGradeAttempt,
  examQuestions,
  finalizeAttempt,
  isExpired,
  requireAttempt,
} from '@/lib/exams'
import { serializeAttempt } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

/**
 * POST /api/attempts/:id/submit — end the sitting and auto-grade it.
 * Idempotent: a second submit (double click, retry after a timeout) returns the
 * already-graded attempt instead of failing.
 */
export const POST = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req)
  if (tenant.session.kind !== 'student' || !tenant.student) {
    throw forbidden('Only a learner can submit an exam')
  }

  const attempt = await requireAttempt(
    { tenantId: tenant.tenantId, schoolId: tenant.schoolId, studentId: String(tenant.student._id) },
    await param(ctx, 'id'),
  )

  if (attempt.status !== 'in_progress') {
    return { attempt: serializeAttempt(attempt) }
  }

  const expired = isExpired(attempt)
  const submitted = await finalizeAttempt(attempt, {
    auto: expired,
    at: expired ? attempt.deadlineAt : new Date(),
  })

  const questions = await examQuestions(submitted.examId)
  const graded = await autoGradeAttempt(submitted, questions)

  return { attempt: serializeAttempt(graded) }
})
