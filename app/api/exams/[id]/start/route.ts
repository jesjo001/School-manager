import { apiHandler, conflict, forbidden, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import {
  canStart,
  examDeadline,
  examQuestions,
  finalizeIfExpired,
  requireExam,
} from '@/lib/exams'
import { ExamAttempt, type ExamAttemptDoc } from '@/lib/models'
import { serializeStartedAttempt } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

/**
 * POST /api/exams/:id/start — begin (or resume) this learner's single sitting.
 * One attempt per student per exam is enforced by a unique index, so a racing
 * double-click resolves to the same attempt.
 */
export const POST = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req)
  if (tenant.session.kind !== 'student' || !tenant.student) {
    throw forbidden('Only learner accounts can sit an exam')
  }
  const student = tenant.student
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  if (String(exam.classId) !== String(student.classId)) {
    throw forbidden('This exam is not scheduled for your class')
  }

  const questions = await examQuestions(exam._id)
  const find = () =>
    ExamAttempt.findOne({ examId: exam._id, studentId: student._id }) as Promise<ExamAttemptDoc | null>

  const existing = await find()
  if (existing) {
    const fresh = await finalizeIfExpired(existing)
    return serializeStartedAttempt(fresh, exam, questions)
  }

  if (!canStart(exam)) {
    const now = new Date()
    throw conflict(
      now.getTime() < exam.startTime.getTime()
        ? 'This exam has not started yet'
        : 'This exam is closed',
    )
  }

  const startedAt = new Date()
  let created: ExamAttemptDoc | null = null
  try {
    created = await ExamAttempt.create({
      tenantId: tenant.tenantId,
      schoolId: tenant.schoolId,
      examId: exam._id,
      studentId: student._id,
      startedAt,
      deadlineAt: examDeadline(exam, startedAt),
      status: 'in_progress',
      answers: [],
      tabSwitchCount: 0,
      flagged: false,
      maxScore: 0,
      totalScore: 0,
    })
  } catch (err) {
    // Unique (examId, studentId) → someone (this tab, twice) already started.
    const code = (err as { code?: number } | null)?.code
    if (code !== 11000) throw err
    created = await find()
  }
  if (!created) throw conflict('Could not open your exam sitting')

  return serializeStartedAttempt(created, exam, questions)
})
