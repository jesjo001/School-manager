import { z } from 'zod'
import { apiHandler, badRequest, parseBody, parseQuery } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { effectiveStatus, participantCounts, questionCounts } from '@/lib/exams'
import { Exam, Subject } from '@/lib/models'
import { examStatusToDb, examStatusToUi, serializeExam } from '@/lib/serialize'
import { actorId, scopedFilter, withTenant } from '@/lib/tenant'
import { paginated, paginationSchema, requireClass, searchRegex } from '@/lib/validate'

/** Exam authoring mirrors RoleGuard: /exams is staff-only for writes. */
const STAFF_ROLES = ['proprietor', 'admin', 'teacher'] as const

const isoDate = z
  .string()
  .trim()
  .min(4)
  .max(60)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Use a valid date and time')

const Query = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
})

const CreateBody = z.object({
  title: z.string().trim().min(2, 'Enter the exam title').max(200),
  subjectId: z.string().trim().min(1, 'Choose a subject').max(64),
  classId: z.string().trim().min(1, 'Choose a class').max(64),
  startTime: isoDate,
  endTime: isoDate,
  durationMinutes: z.number().int().min(1, 'Duration must be at least 1 minute').max(600),
  status: z.enum(['draft', 'scheduled', 'live', 'closed']).optional(),
  instructions: z.string().trim().max(2000).optional(),
})

/**
 * GET /api/exams — school-scoped list. Learners only ever see non-draft exams
 * for their own class; staff see everything in the school with search/status
 * filters and per-exam question/participant counts.
 */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req)
  const query = parseQuery(req, Query)

  const filter: Record<string, unknown> = scopedFilter(ctx)

  if (ctx.session.kind === 'student') {
    if (!ctx.student) throw badRequest('Learner session is not valid')
    filter.classId = ctx.student.classId
    filter.status = { $ne: 'draft' }
  } else {
    if (query.q) filter.title = searchRegex(query.q)
    if (query.status) filter.status = examStatusToDb(query.status)
  }

  const total = await Exam.countDocuments(filter)
  const docs = await Exam.find(filter)
    .sort({ startTime: -1 })
    .skip((query.page - 1) * query.limit)
    .limit(query.limit)

  const ids = docs.map((doc) => String(doc._id))
  const [questions, participants] = await Promise.all([
    questionCounts(ids),
    participantCounts(ids),
  ])

  return paginated(
    docs.map((doc) =>
      serializeExam(doc, {
        questions: questions.get(String(doc._id)) ?? 0,
        participants: participants.get(String(doc._id)) ?? 0,
        status: examStatusToUi(effectiveStatus(doc)),
      }),
    ),
    total,
    query.page,
    query.limit,
  )
})

/** POST /api/exams — create a draft/scheduled exam for a class. */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req, { roles: [...STAFF_ROLES] })
  const input = await parseBody(req, CreateBody)

  const [klass, subject] = await Promise.all([
    requireClass(ctx.tenantId, ctx.schoolId, input.classId),
    Subject.findOne({ _id: input.subjectId, tenantId: ctx.tenantId, schoolId: ctx.schoolId }),
  ])
  if (!subject) throw badRequest('That subject does not exist')

  const startTime = new Date(input.startTime)
  const endTime = new Date(input.endTime)
  if (endTime.getTime() <= startTime.getTime()) {
    throw badRequest('The exam must end after it starts')
  }

  const now = new Date()
  const status =
    input.status ?? (now.getTime() >= startTime.getTime() ? 'live' : 'scheduled')

  const doc = await Exam.create({
    tenantId: ctx.tenantId,
    schoolId: ctx.schoolId,
    title: input.title,
    subjectId: subject._id,
    subjectName: subject.name,
    classId: klass._id,
    className: klass.name,
    status,
    startTime,
    endTime,
    durationMinutes: input.durationMinutes,
    instructions: input.instructions ?? '',
    createdBy: actorId(ctx),
  })

  return serializeExam(doc, {
    questions: 0,
    participants: 0,
    status: examStatusToUi(effectiveStatus(doc)),
  })
})
