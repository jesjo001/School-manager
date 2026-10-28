import { z } from 'zod'
import { apiHandler, badRequest, conflict, notFound, param, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import {
  effectiveStatus,
  finalizeAttempt,
  participantCounts,
  questionCounts,
  requireExam,
} from '@/lib/exams'
import { Exam, ExamAttempt, Question, Subject, type ExamDoc } from '@/lib/models'
import { examStatusToDb, examStatusToUi, serializeAttempt, serializeExam } from '@/lib/serialize'
import { withTenant } from '@/lib/tenant'
import { requireClass } from '@/lib/validate'

const STAFF_ROLES = ['proprietor', 'admin', 'teacher'] as const

const isoDate = z
  .string()
  .trim()
  .min(4)
  .max(60)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Use a valid date and time')

const PatchBody = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  subjectId: z.string().trim().max(64).optional(),
  classId: z.string().trim().max(64).optional(),
  startTime: isoDate.optional(),
  endTime: isoDate.optional(),
  durationMinutes: z.number().int().min(1).max(600).optional(),
  status: z.enum(['draft', 'scheduled', 'live', 'closed']).optional(),
  instructions: z.string().trim().max(2000).optional(),
})

const serializeOne = async (doc: ExamDoc) => {
  const id = String(doc._id)
  const [questions, participants] = await Promise.all([questionCounts([id]), participantCounts([id])])
  return serializeExam(doc, {
    questions: questions.get(id) ?? 0,
    participants: participants.get(id) ?? 0,
    status: examStatusToUi(effectiveStatus(doc)),
  })
}

/** GET /api/exams/:id */
export const GET = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req)
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  // Learners may only open exams scheduled for their own class.
  if (tenant.session.kind === 'student') {
    if (!tenant.student || String(exam.classId) !== String(tenant.student.classId)) {
      throw notFound('Exam not found')
    }
  }

  return serializeOne(exam)
})

/** PATCH /api/exams/:id — edit details/status. Closing finalises open sittings. */
export const PATCH = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const input = await parseBody(req, PatchBody)
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  const update: Record<string, unknown> = {}
  if (input.title !== undefined) update.title = input.title
  if (input.instructions !== undefined) update.instructions = input.instructions
  if (input.durationMinutes !== undefined) update.durationMinutes = input.durationMinutes
  if (input.status !== undefined) {
    update.status = examStatusToDb(input.status)
    // A closed exam may not be reopened once learners have sat it.
    if (update.status !== 'closed' && exam.status === 'closed') {
      const sat = await ExamAttempt.exists({ examId: exam._id, status: { $ne: 'in_progress' } })
      if (sat) throw conflict('This exam has closed results and can no longer be reopened')
    }
  }

  const startTime = input.startTime ? new Date(input.startTime) : new Date(exam.startTime)
  const durationMinutes = input.durationMinutes ?? exam.durationMinutes
  // The editor exposes a single date field: the window closes one duration later.
  const endTime = input.endTime
    ? new Date(input.endTime)
    : input.startTime
      ? new Date(startTime.getTime() + durationMinutes * 60_000)
      : new Date(exam.endTime)
  if (endTime.getTime() <= startTime.getTime()) throw badRequest('The exam must end after it starts')
  update.startTime = startTime
  update.endTime = endTime

  if (input.classId) {
    const klass = await requireClass(tenant.tenantId, tenant.schoolId, input.classId)
    update.classId = klass._id
    update.className = klass.name
  }
  if (input.subjectId) {
    const subject = await Subject.findOne({
      _id: input.subjectId,
      tenantId: tenant.tenantId,
      schoolId: tenant.schoolId,
    })
    if (!subject) throw badRequest('That subject does not exist')
    update.subjectId = subject._id
    update.subjectName = subject.name
  }

  const doc = await Exam.findOneAndUpdate({ _id: exam._id }, { $set: update }, { new: true })
  if (!doc) throw notFound('Exam not found')

  // Closing the window ends every open sitting immediately.
  if (update.status === 'closed') {
    const open = await ExamAttempt.find({ examId: doc._id, status: 'in_progress' })
    for (const attempt of open) {
      await finalizeAttempt(attempt, { auto: true, at: new Date() })
    }
  }

  return serializeOne(doc)
})

/** DELETE /api/exams/:id — removes the exam, its questions and its sittings. */
export const DELETE = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...STAFF_ROLES] })
  const exam = await requireExam(tenant.tenantId, tenant.schoolId, await param(ctx, 'id'))

  const attempts = await ExamAttempt.countDocuments({ examId: exam._id })
  if (attempts > 0) {
    throw conflict('This exam already has submitted results and cannot be deleted')
  }

  await Promise.all([
    Exam.deleteOne({ _id: exam._id }),
    Question.deleteMany({ examId: exam._id }),
    ExamAttempt.deleteMany({ examId: exam._id }),
  ])

  return { ok: true as const }
})
