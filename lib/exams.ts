import mongoose from 'mongoose'
import { notFound } from '@/lib/api'
import {
  Exam,
  ExamAttempt,
  Question,
  Student,
  type ExamAttemptDoc,
  type ExamDoc,
  type QuestionDoc,
} from '@/lib/models'
import type { GradingItem } from '@/services/types'

/**
 * CBT domain logic: exam windows, deadlines, automatic grading and the manual
 * grading queue. Route handlers stay thin — they resolve the tenant, call into
 * this module and serialize the result.
 */

/* --------------------------------- windows -------------------------------- */

/**
 * A scheduled exam inside its window behaves as live, and one past its end
 * behaves as completed — the stored status only records the teacher's intent
 * (draft vs scheduled) plus any explicit close.
 */
export function effectiveStatus(
  exam: ExamDoc,
  now: Date = new Date(),
): 'draft' | 'scheduled' | 'live' | 'closed' {
  if (exam.status === 'draft' || exam.status === 'closed') return exam.status
  if (now.getTime() < exam.startTime.getTime()) return 'scheduled'
  // Half-open window: at the end instant the paper is closed, which matches
  // `isExpired` (a sitting is expired exactly at its deadline).
  if (now.getTime() >= exam.endTime.getTime()) return 'closed'
  return 'live'
}

/** Learners may only begin a sitting while the exam is effectively live. */
export const canStart = (exam: ExamDoc, now: Date = new Date()) =>
  effectiveStatus(exam, now) === 'live'

/**
 * Deadline = min(startedAt + duration, exam end). Computed once at start and
 * enforced on every subsequent write.
 */
export function examDeadline(exam: ExamDoc, startedAt: Date): Date {
  const byDuration = new Date(startedAt.getTime() + exam.durationMinutes * 60_000)
  return byDuration.getTime() < exam.endTime.getTime() ? byDuration : new Date(exam.endTime)
}

export const isExpired = (attempt: { deadlineAt: Date }, now: Date = new Date()) =>
  now.getTime() >= attempt.deadlineAt.getTime()

/** Display label used by the exams grid: `Today · 10:30 AM`, `12 Apr · 11:00 AM`. */
export function examDateLabel(start: Date, now: Date = new Date()): string {
  const time = start.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const DAY = 86_400_000
  if (day === today) return `Today · ${time}`
  if (day === today + DAY) return `Tomorrow · ${time}`
  if (day === today - DAY) return `Yesterday · ${time}`
  return `${start.getDate()} ${start.toLocaleString('en-GB', { month: 'short' })} · ${time}`
}

/* --------------------------------- grading -------------------------------- */

export type GradeOutcome = { isCorrect: boolean | null; marksAwarded: number | null }

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Grade one response. `null` means "needs a human" (no answer key, or a free
 * text answer that does not match the accepted answer exactly) — those become
 * grading-queue items.
 */
export function gradeOne(question: QuestionDoc, response: string | undefined): GradeOutcome {
  const answer = (response ?? '').trim()

  if (question.type === 'mcq') {
    if (!question.correctOptionId) return { isCorrect: null, marksAwarded: null }
    const correct = answer === question.correctOptionId
    return { isCorrect: correct, marksAwarded: correct ? question.marks : 0 }
  }

  if (!question.acceptedAnswer?.trim()) return { isCorrect: null, marksAwarded: null }
  const correct = normalizeText(answer) === normalizeText(question.acceptedAnswer)
  return { isCorrect: correct, marksAwarded: correct ? question.marks : 0 }
}

export const pendingCount = (attempt: ExamAttemptDoc) =>
  (attempt.answers ?? []).filter((answer) => answer.marksAwarded == null).length

/**
 * A stored answer is a mongoose subdocument: spreading it copies its internals
 * (`_doc`, `$__`, `__parentArray`) instead of its fields, and the write then
 * silently keeps the old values. Copy the field values first.
 */
export function plainAnswer<T>(value: T): T {
  const source = value as T & { toObject?: () => T }
  if (typeof source?.toObject === 'function') return source.toObject()
  return { ...value }
}

/**
 * Apply automatic grading to every not-yet-graded answer, then persist
 * total/max scores. Manually graded answers are left untouched.
 */
export async function autoGradeAttempt(
  attempt: ExamAttemptDoc,
  questions: QuestionDoc[],
): Promise<ExamAttemptDoc> {
  const byId = new Map(questions.map((question) => [String(question._id), question]))
  const current = (attempt.answers ?? []).map((answer) => plainAnswer(answer))

  const answers = current.map((answer) => {
    if (answer.marksAwarded != null) return answer
    const question = byId.get(String(answer.questionId))
    if (!question) return { ...answer, isCorrect: false, marksAwarded: 0 }
    const outcome = gradeOne(question, answer.response)
    return {
      ...answer,
      isCorrect: outcome.isCorrect,
      marksAwarded: outcome.marksAwarded,
      feedback: answer.feedback ?? '',
    }
  })

  const totalScore = answers.reduce((sum, answer) => sum + (answer.marksAwarded ?? 0), 0)
  const maxScore = questions.reduce((sum, question) => sum + question.marks, 0)
  const pending = answers.filter((answer) => answer.marksAwarded == null).length

  const status = pending === 0 ? 'graded' : 'submitted'
  await ExamAttempt.updateOne(
    { _id: attempt._id },
    {
      $set: {
        answers,
        totalScore,
        maxScore,
        status: attempt.status === 'graded' ? 'graded' : status,
        ...(pending === 0 && attempt.status !== 'graded' ? { gradedAt: new Date() } : {}),
      },
    },
  )

  const fresh = await ExamAttempt.findById(attempt._id)
  if (!fresh) throw new Error('attempt disappeared while grading')
  return fresh
}

/** Mark a sitting as submitted (used by submit + the deadline sweep). */
export async function finalizeAttempt(
  attempt: ExamAttemptDoc,
  options: { auto?: boolean; at?: Date } = {},
): Promise<ExamAttemptDoc> {
  if (attempt.status !== 'in_progress') return attempt
  await ExamAttempt.updateOne(
    { _id: attempt._id, status: 'in_progress' },
    {
      $set: {
        status: 'submitted',
        submittedAt: options.at ?? new Date(),
        ...(options.auto ? { autoSubmitted: true } : {}),
      },
    },
  )
  const fresh = await ExamAttempt.findById(attempt._id)
  if (!fresh) throw new Error('attempt disappeared while finalising')
  return fresh
}

/**
 * Finalise an attempt whose deadline has passed. Called lazily by every read
 * and write path so no background worker is needed.
 */
export async function finalizeIfExpired(
  attempt: ExamAttemptDoc,
  now: Date = new Date(),
): Promise<ExamAttemptDoc> {
  if (attempt.status !== 'in_progress' || !isExpired(attempt, now)) return attempt
  const questions = await Question.find({ examId: attempt.examId }).lean()
  const finalized = await finalizeAttempt(attempt, { auto: true, at: attempt.deadlineAt })
  return autoGradeAttempt(finalized as ExamAttemptDoc, questions as QuestionDoc[])
}

/** Questions of an exam, in display order. */
export const examQuestions = (examId: unknown) =>
  Question.find({ examId }).sort({ order: 1, createdAt: 1 })

/* --------------------------------- loaders -------------------------------- */

/** Load one exam inside the tenant/school, or 404. */
export async function requireExam(tenantId: string, schoolId: string, examId: string) {
  if (!examId.match(/^[0-9a-fA-F]{24}$/)) throw notFound('Exam not found')
  const exam = await Exam.findOne({ _id: examId, tenantId, schoolId })
  if (!exam) throw notFound('Exam not found')
  return exam
}

/**
 * Load one attempt inside the tenant/school. Learners may only ever load
 * their own sitting — anything else is a 404 (no existence leak).
 */
export async function requireAttempt(
  ctx: { tenantId: string; schoolId: string; studentId?: string },
  attemptId: string,
): Promise<mongoose.HydratedDocument<ExamAttemptDoc>> {
  if (!attemptId.match(/^[0-9a-fA-F]{24}$/)) throw notFound('Attempt not found')
  const attempt = await ExamAttempt.findOne({
    _id: attemptId,
    tenantId: ctx.tenantId,
    schoolId: ctx.schoolId,
  })
  if (!attempt) throw notFound('Attempt not found')
  if (ctx.studentId && String(attempt.studentId) !== ctx.studentId) throw notFound('Attempt not found')
  return attempt
}

const countBy = async (
  model: mongoose.Model<any>,
  ids: string[],
): Promise<Map<string, number>> => {
  const map = new Map<string, number>()
  if (!ids.length) return map
  // Aggregations never cast, so the match stage gets real ObjectIds.
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id))
  const rows = await model.aggregate<{ _id: unknown; n: number }>([
    { $match: { examId: { $in: objectIds } } },
    { $group: { _id: '$examId', n: { $sum: 1 } } },
  ])
  for (const row of rows) map.set(String(row._id), row.n)
  return map
}

/** Question totals per exam (exams grid column). */
export const questionCounts = (ids: string[]) => countBy(Question, ids)

/** Sittings per exam (exams grid column). */
export const participantCounts = (ids: string[]) => countBy(ExamAttempt, ids)

/* ------------------------------ grading queue ------------------------------ */

/**
 * Every answer that still needs a human: submitted attempts with ungraded
 * (short-answer / unkeyed) responses, oldest sitting first.
 */
export async function loadGradingQueue(
  tenantId: string,
  schoolId: string,
): Promise<GradingItem[]> {
  const attempts = await ExamAttempt.find({
    tenantId,
    schoolId,
    status: 'submitted',
    'answers.marksAwarded': null,
  })
    .sort({ submittedAt: 1, createdAt: 1 })
    .limit(200)

  const pending = attempts.filter((attempt) =>
    (attempt.answers ?? []).some((answer) => answer.marksAwarded == null),
  )
  if (!pending.length) return []

  const examIds = [...new Set(pending.map((attempt) => String(attempt.examId)))]
  const studentIds = [...new Set(pending.map((attempt) => String(attempt.studentId)))]
  const questionIds = [
    ...new Set(
      pending.flatMap((attempt) =>
        (attempt.answers ?? [])
          .filter((answer) => answer.marksAwarded == null)
          .map((answer) => String(answer.questionId)),
      ),
    ),
  ]

  const [exams, students, questions] = await Promise.all([
    Exam.find({ _id: { $in: examIds } }),
    Student.find({ _id: { $in: studentIds } }),
    Question.find({ _id: { $in: questionIds } }),
  ])
  const examById = new Map(exams.map((exam) => [String(exam._id), exam.title]))
  const studentById = new Map(students.map((student) => [String(student._id), student.name]))
  const questionById = new Map(questions.map((question) => [String(question._id), question]))

  const items: GradingItem[] = []
  for (const attempt of pending) {
    for (const answer of attempt.answers ?? []) {
      if (answer.marksAwarded != null) continue
      const question = questionById.get(String(answer.questionId))
      items.push({
        attemptId: String(attempt._id),
        examId: String(attempt.examId),
        examTitle: examById.get(String(attempt.examId)) ?? 'Exam',
        studentId: String(attempt.studentId),
        studentName: studentById.get(String(attempt.studentId)) ?? 'Learner',
        questionId: String(answer.questionId),
        questionText: question?.text ?? 'Question',
        response: answer.response ?? '',
        marks: question?.marks ?? 0,
      })
    }
  }
  return items
}
