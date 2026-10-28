import { apiHandler } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { examDateLabel } from '@/lib/exams'
import { Exam, ExamAttempt } from '@/lib/models'
import { gradeFor } from '@/lib/serialize'
import { scopedFilter, withTenant } from '@/lib/tenant'
import type { MyResult } from '@/services/types'

/**
 * GET /api/me/results — this learner's finished sittings (staff sessions get
 * an empty list: results belong to learners).
 */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req)
  if (ctx.session.kind !== 'student' || !ctx.student) return { items: [], average: 0 }

  const attempts = await ExamAttempt.find({
    ...scopedFilter(ctx),
    studentId: ctx.student._id,
    status: { $ne: 'in_progress' },
  })
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(100)

  const examIds = [...new Set(attempts.map((attempt) => String(attempt.examId)))]
  const exams = examIds.length ? await Exam.find({ _id: { $in: examIds } }) : []
  const examById = new Map(exams.map((exam) => [String(exam._id), exam]))

  type Entry = MyResult & { status: string }
  const entries: Entry[] = []

  for (const attempt of attempts) {
    const exam = examById.get(String(attempt.examId))
    if (!exam) continue
    const maxScore = attempt.maxScore ?? 0
    const percent = maxScore ? Math.round(((attempt.totalScore ?? 0) / maxScore) * 100) : 0
    entries.push({
      attemptId: String(attempt._id),
      examId: String(attempt.examId),
      title: exam.title,
      subject: exam.subjectName ?? '',
      date: examDateLabel(exam.startTime),
      score: attempt.totalScore ?? 0,
      maxScore,
      percent,
      grade: gradeFor(percent),
      status: attempt.status,
    })
  }

  // Prefer fully graded sittings for the headline average.
  const basis = entries.filter((entry) => entry.status === 'graded')
  const pool = basis.length ? basis : entries
  const average = pool.length
    ? Math.round(pool.reduce((sum, entry) => sum + entry.percent, 0) / pool.length)
    : 0

  const items: MyResult[] = entries.map(({ status: _status, ...item }) => item)
  return { items, average }
})
