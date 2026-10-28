import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, conflict, parseBody, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { examQuestions, requireExam } from '@/lib/exams'
import { ExamAttempt, Question, type QuestionDoc } from '@/lib/models'
import { serializeQuestion } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'

/** Question authoring is staff-only — the payload carries the answer key. */
const STAFF_ROLES = ['proprietor', 'admin', 'teacher'] as const

const OptionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1, 'Each option needs text').max(500),
})

const QuestionSchema = z.object({
  id: z.string().trim().max(64).optional(),
  type: z.enum(['mcq', 'short_answer']),
  text: z.string().trim().min(1, 'Each question needs text').max(2000),
  options: z.array(OptionSchema).max(6).optional(),
  correctOptionId: z.string().trim().max(64).nullable().optional(),
  marks: z.number().int().min(0, 'Marks cannot be negative').max(100),
  order: z.number().int().min(0).max(999).optional(),
})

const PutBody = z.object({
  questions: z.array(QuestionSchema).min(1, 'Add at least one question').max(200),
})

type QuestionInput = z.infer<typeof QuestionSchema>

/** Business rules the shape alone cannot express. */
function validateQuestion(input: QuestionInput, index: number) {
  const at = `questions.${index}`
  if (input.type === 'mcq') {
    const options = input.options ?? []
    if (options.length < 2) throw badRequest(`${at}: multiple choice needs at least two options`)
    const ids = new Set(options.map((option) => option.id))
    if (ids.size !== options.length) throw badRequest(`${at}: option ids must be unique`)
    if (input.correctOptionId && !ids.has(input.correctOptionId)) {
      throw badRequest(`${at}: the correct option is not one of the choices`)
    }
    return
  }
  // Short answers are graded against a model answer (or by hand).
  if (input.correctOptionId) throw badRequest(`${at}: short answers do not use option keys`)
}

const normalize = (input: QuestionInput, index: number, previous?: QuestionDoc) => ({
  type: input.type,
  text: input.text,
  options: input.type === 'mcq' ? (input.options ?? []) : [],
  correctOptionId: input.type === 'mcq' ? (input.correctOptionId ?? null) : null,
  acceptedAnswer: previous?.acceptedAnswer ?? '',
  marks: input.marks,
  order: input.order ?? index,
})

async function listFor(examId: unknown) {
  const docs = await examQuestions(examId)
  return docs.map((doc) => serializeQuestion(doc, { includeAnswers: true }))
}

/** GET /api/exams/:id/questions — teacher view (includes the answer key). */
export const GET = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))
  return listFor(exam._id)
})

/**
 * PUT /api/exams/:id/questions — replaces the whole question set (the builder
 * edits a complete draft). Locked once a learner has started sitting.
 */
export const PUT = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const input = await parseBody(req, PutBody)
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  input.questions.forEach(validateQuestion)

  const sat = await ExamAttempt.countDocuments({ examId: exam._id })
  if (sat > 0) {
    throw conflict('Learners have already sat this exam — its questions are locked')
  }

  const existing = await Question.find({ examId: exam._id })
  const owned = new Map(existing.map((doc) => [String(doc._id), doc]))
  const keep: string[] = []

  input.questions.forEach((item, index) => {
    const id = item.id && owned.has(item.id) ? item.id : null
    if (id) keep.push(id)
  })

  // Drop removed questions first, then update/insert.
  await Question.deleteMany({
    examId: exam._id,
    _id: { $nin: keep.map((id) => new mongoose.Types.ObjectId(id)) },
  })

  for (const [index, item] of input.questions.entries()) {
    const id = item.id && owned.has(item.id) ? item.id : null
    const doc = normalize(item, index, id ? owned.get(id) ?? undefined : undefined)
    if (id) {
      await Question.updateOne({ _id: id, examId: exam._id }, { $set: doc })
    } else {
      await Question.create({
        ...doc,
        tenantId: tenant.tenantId,
        schoolId: tenant.schoolId,
        examId: exam._id,
      })
    }
  }

  return listFor(exam._id)
})
