import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, conflict, param, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { isExpired, finalizeIfExpired, requireAttempt } from '@/lib/exams'
import { ExamAttempt, Question } from '@/lib/models'
import { withTenant } from '@/lib/tenant'

const Body = z.object({
  questionId: z.string().trim().min(1).max(64),
  response: z.string().max(5000, 'That answer is too long'),
})

/**
 * PATCH /api/attempts/:id/answer — autosave one response. Enforces the
 * deadline: once it passes the sitting is finalised and the write is refused.
 */
export const PATCH = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req)
  if (tenant.session.kind !== 'student' || !tenant.student) {
    throw conflict('Only a learner can save answers')
  }
  const input = await parseBody(req, Body)
  const attempt = await requireAttempt(
    { tenantId: tenant.tenantId, schoolId: tenant.schoolId, studentId: String(tenant.student._id) },
    await param(ctx, 'id'),
  )

  if (attempt.status !== 'in_progress') throw conflict('This attempt has already been submitted')
  if (isExpired(attempt)) {
    // Deadline passed: finalise + auto-grade, then refuse the late write.
    await finalizeIfExpired(attempt)
    throw conflict('The exam time is over')
  }

  const questionId = new mongoose.Types.ObjectId(input.questionId)
  const question = await Question.findOne({ _id: questionId, examId: attempt.examId })
  if (!question) throw badRequest('That question is not part of this exam')

  // Two paths: refresh an answer this learner already gave, or append the
  // first one. `modifiedCount` cannot decide this — mongoose timestamps bump
  // it even when the array filter matched nothing, so the stored attempt does.
  const stored = (attempt.answers ?? []).some(
    (answer) => String(answer.questionId) === String(questionId),
  )

  if (stored) {
    await ExamAttempt.updateOne(
      { _id: attempt._id, studentId: tenant.student._id, status: 'in_progress' },
      { $set: { 'answers.$[answer].response': input.response } },
      { arrayFilters: [{ 'answer.questionId': questionId }] },
    )
  } else {
    const appended = await ExamAttempt.updateOne(
      {
        _id: attempt._id,
        studentId: tenant.student._id,
        status: 'in_progress',
        'answers.questionId': { $ne: questionId },
      },
      {
        $push: {
          answers: {
            questionId,
            response: input.response,
            isCorrect: null,
            marksAwarded: null,
            feedback: '',
          },
        },
      },
    )
    if (appended.matchedCount === 0) {
      // Another tab pushed this answer first — update it in place instead.
      await ExamAttempt.updateOne(
        { _id: attempt._id, studentId: tenant.student._id, status: 'in_progress' },
        { $set: { 'answers.$[answer].response': input.response } },
        { arrayFilters: [{ 'answer.questionId': questionId }] },
      )
    }
  }

  return { saved: true as const }
})
