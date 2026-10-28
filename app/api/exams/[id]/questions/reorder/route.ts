import { z } from 'zod'
import { apiHandler, badRequest, conflict, param, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { examQuestions, requireExam } from '@/lib/exams'
import { ExamAttempt, Question } from '@/lib/models'
import { serializeQuestion } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

const STAFF_ROLES = ['proprietor', 'admin', 'teacher'] as const

const Body = z.object({
  orderedIds: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
})

/** POST /api/exams/:id/questions/reorder */
export const POST = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const input = await parseBody(req, Body)
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  const existing = await examQuestions(exam._id)
  const known = new Set(existing.map((doc) => String(doc._id)))
  for (const id of input.orderedIds) {
    if (!known.has(id)) throw badRequest('That question is not part of this exam')
  }

  const sat = await ExamAttempt.countDocuments({ examId: exam._id })
  if (sat > 0) throw conflict('Learners have already sat this exam — its questions are locked')

  for (const [index, id] of input.orderedIds.entries()) {
    await Question.updateOne({ _id: id, examId: exam._id }, { $set: { order: index } })
  }

  const docs = await examQuestions(exam._id)
  return docs.map((doc) => serializeQuestion(doc, { includeAnswers: true }))
})
