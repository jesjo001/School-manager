import { z } from 'zod'
import { apiHandler, badRequest, conflict, param, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { examQuestions, pendingCount, plainAnswer, requireAttempt } from '@/lib/exams'
import { serializeAttempt } from '@/lib/serialize'
import { actorId, withTenant } from '@/lib/tenant'
import type mongoose from 'mongoose'

/** Grading sits with the teaching team (RoleGuard: /grading). */
const STAFF_ROLES = ['proprietor', 'admin', 'teacher'] as const

const Body = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1).max(64),
        marksAwarded: z.number().int().min(0, 'Marks cannot be negative'),
        feedback: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1, 'Grade at least one answer')
    .max(200),
})

/**
 * PATCH /api/attempts/:id/grade — record marks for the manual (short answer)
 * responses of one sitting. When nothing is left ungraded the attempt flips to
 * `graded`; otherwise it stays in the queue and `pending` reports what remains.
 */
export const PATCH = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const input = await parseBody(req, Body)
  const attempt = await requireAttempt(
    { tenantId: tenant.tenantId, schoolId: tenant.schoolId },
    await param(ctx, 'id'),
  )

  if (attempt.status === 'in_progress') {
    throw conflict('This attempt is still in progress and cannot be graded yet')
  }

  const questions = await examQuestions(attempt.examId)
  const questionById = new Map(questions.map((question) => [String(question._id), question]))
  const answerById = new Map(
    (attempt.answers ?? []).map((answer) => [String(answer.questionId), answer]),
  )

  const next = (attempt.answers ?? []).map((value) => {
    // Subdocuments must be copied to plain fields before rewriting them.
    const answer = plainAnswer(value)
    const item = input.answers.find((entry) => entry.questionId === String(answer.questionId))
    if (!item) return answer
    const question = questionById.get(String(answer.questionId))
    if (!question) throw badRequest('That question no longer exists')
    if (item.marksAwarded > question.marks) {
      throw badRequest(`Marks cannot exceed ${question.marks} for this question`)
    }
    return {
      ...answer,
      marksAwarded: item.marksAwarded,
      isCorrect:
        item.marksAwarded >= question.marks
          ? true
          : item.marksAwarded <= 0
            ? false
            : null,
      feedback: item.feedback ?? answer.feedback ?? '',
      gradedBy: actorId(tenant) as unknown as mongoose.Types.ObjectId,
    }
  })

  // Every graded entry must belong to this sitting.
  for (const item of input.answers) {
    if (!answerById.has(item.questionId)) {
      throw badRequest('That question was not answered in this attempt')
    }
  }

  attempt.set('answers', next)
  attempt.totalScore = next.reduce((sum, answer) => sum + (answer.marksAwarded ?? 0), 0)
  attempt.maxScore = questions.reduce((sum, question) => sum + question.marks, 0)

  const pending = pendingCount(attempt)
  if (pending === 0) {
    attempt.status = 'graded'
    attempt.gradedAt = new Date()
    attempt.gradedBy = actorId(tenant) as unknown as mongoose.Types.ObjectId
  } else {
    attempt.status = 'submitted'
  }
  await attempt.save()

  return { attempt: serializeAttempt(attempt), pending }
})
