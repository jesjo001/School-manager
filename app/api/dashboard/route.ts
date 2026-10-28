import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, parseQuery } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { toDateKey } from '@/lib/dates'
import { effectiveStatus, participantCounts, questionCounts } from '@/lib/exams'
import { Attendance, Exam, Invoice, Payment, School, Student } from '@/lib/models'
import { examStatusToUi, serializeExam } from '@/lib/serialize'
import { loadSchoolStats } from '@/lib/stats'
import { scopedFilter, withTenant } from '@/lib/tenant'
import type { DashboardStats } from '@/services/types'

const DAY = 86_400_000
const TZ = { timeZone: 'UTC' } as const

const Query = z.object({ period: z.enum(['week', 'month', 'term']).optional() })

type Bucket = { name: string; from: Date; to: Date }
type Activity = DashboardStats['recentActivity'][number]

const utcMidnight = (value: Date | number) => {
  const date = new Date(value)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/**
 * Buckets for the chart series: daily for the week, 5-day slices for the
 * month, and calendar months for the term.
 */
function buildBuckets(period: 'week' | 'month' | 'term', now: Date): Bucket[] {
  if (period === 'month') {
    const start = utcMidnight(now.getTime() - 29 * DAY)
    return Array.from({ length: 6 }, (_, index) => {
      const from = new Date(start.getTime() + index * 5 * DAY)
      const to = index === 5 ? new Date(now.getTime() + DAY) : new Date(from.getTime() + 5 * DAY)
      return {
        name: from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...TZ }),
        from,
        to,
      }
    })
  }
  if (period === 'term') {
    return Array.from({ length: 3 }, (_, index) => {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (2 - index), 1))
      const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
      return {
        name: from.toLocaleDateString('en-GB', { month: 'short', ...TZ }),
        from,
        to: to.getTime() > now.getTime() ? new Date(now.getTime() + DAY) : to,
      }
    })
  }
  return Array.from({ length: 7 }, (_, index) => {
    const from = utcMidnight(now.getTime() - (6 - index) * DAY)
    return {
      name: from.toLocaleDateString('en-GB', { weekday: 'short', ...TZ }),
      from,
      to: new Date(from.getTime() + DAY),
    }
  })
}

const relative = (value: Date, now: Date) => {
  const days = Math.floor((utcMidnight(now).getTime() - utcMidnight(value).getTime()) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...TZ })
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('') || '··'

/**
 * GET /api/dashboard — every number on the landing screen, computed from the
 * school's own data for the selected period (week | month | term).
 */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req)
  const { period = 'week' } = parseQuery(req, Query)

  const now = new Date()
  const span = period === 'week' ? 7 : period === 'month' ? 30 : 90
  const since = new Date(now.getTime() - span * DAY)
  const scope = scopedFilter(ctx)
  const buckets = buildBuckets(period, now)
  const bucketFrom = buckets[0]!.from
  const asId = (value: string) => new mongoose.Types.ObjectId(value)
  const aggregateScope = { tenantId: asId(ctx.tenantId), schoolId: asId(ctx.schoolId) }

  const [
    totalStudents,
    todayRegisters,
    registerDocs,
    paymentsInRange,
    recentPayments,
    outstandingRows,
    liveExamCount,
    upcomingDocs,
    recentStudents,
    recentExams,
    latestRegister,
  ] = await Promise.all([
    Student.countDocuments({ ...scope, status: 'active' }),
    Attendance.find({ ...scope, date: toDateKey(now) }),
    Attendance.find({ ...scope, date: { $gte: bucketFrom, $lte: now } }).sort({ date: 1 }),
    Payment.find({ ...scope, status: 'paid', paidAt: { $gte: since } }),
    Payment.find({ ...scope, status: 'paid' }).sort({ paidAt: -1, createdAt: -1 }).limit(3),
    Invoice.aggregate([
      { $match: { ...aggregateScope, status: { $in: ['pending', 'overdue'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Exam.countDocuments({
      ...scope,
      status: { $nin: ['draft', 'closed'] },
      startTime: { $lte: now },
      endTime: { $gte: now },
    }),
    Exam.find({ ...scope, status: { $ne: 'draft' }, endTime: { $gte: now } })
      .sort({ startTime: 1 })
      .limit(5),
    Student.find(scope).sort({ createdAt: -1 }).limit(2),
    Exam.find(scope).sort({ createdAt: -1 }).limit(2),
    Attendance.find(scope).sort({ createdAt: -1 }).limit(1),
  ])

  /* ------------------------------- attendance ------------------------------ */

  const todayMarked = todayRegisters.reduce((sum, doc) => sum + doc.records.length, 0)
  const todayPresent = todayRegisters.reduce(
    (sum, doc) => sum + doc.records.filter((record) => record.status !== 'absent').length,
    0,
  )

  let markedInRange = 0
  let presentInRange = 0
  const attendanceSeries = buckets.map((bucket) => {
    let present = 0
    let marked = 0
    for (const doc of registerDocs) {
      if (doc.date < bucket.from || doc.date >= bucket.to) continue
      marked += doc.records.length
      // Late learners attended, so they count towards the present line.
      present += doc.records.filter((record) => record.status !== 'absent').length
    }
    markedInRange += marked
    presentInRange += present
    return { name: bucket.name, present, absent: marked - present }
  })

  /* ---------------------------------- fees --------------------------------- */

  const feesSeries = buckets.map((bucket) => ({
    name: bucket.name,
    value: paymentsInRange
      .filter(
        (payment) => payment.paidAt && payment.paidAt >= bucket.from && payment.paidAt < bucket.to,
      )
      .reduce((sum, payment) => sum + payment.amount, 0),
  }))

  const feesCollected = paymentsInRange.reduce((sum, payment) => sum + payment.amount, 0)
  const feesOutstanding = outstandingRows[0]?.total ?? 0

  /* --------------------------------- exams --------------------------------- */

  const upcomingIds = upcomingDocs.map((doc) => String(doc._id))
  const [questionTotals, participantTotals] = await Promise.all([
    questionCounts(upcomingIds),
    participantCounts(upcomingIds),
  ])
  const upcomingExams = upcomingDocs.map((doc) =>
    serializeExam(doc, {
      questions: questionTotals.get(String(doc._id)) ?? 0,
      participants: participantTotals.get(String(doc._id)) ?? 0,
      status: examStatusToUi(effectiveStatus(doc, now)),
    }),
  )

  /* --------------------------- schools (proprietor) ------------------------ */

  let schools: DashboardStats['schools']
  if (ctx.role === 'proprietor') {
    const docs = await School.find({ tenantId: ctx.tenantId }).sort({ name: 1 })
    const stats = await loadSchoolStats(
      ctx.tenantId,
      docs.map((doc) => String(doc._id)),
    )
    schools = docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      location: doc.location ?? '',
      studentCount: stats.get(String(doc._id))?.studentCount ?? 0,
      feesCollected: stats.get(String(doc._id))?.feesCollected ?? 0,
    }))
  }

  /* --------------------------- recent activity ----------------------------- */

  const activity: { when: Date; item: Activity }[] = []

  for (const payment of recentPayments) {
    const student = await Student.findById(payment.studentId)
    const when = payment.paidAt ?? payment.createdAt
    activity.push({
      when,
      item: {
        initial: initials(student?.name ?? '··'),
        text: `${student?.name ?? 'A learner'} paid school fees`,
        meta: `Fees · ${relative(when, now)}`,
        color: 'green',
      },
    })
  }
  for (const doc of recentExams) {
    const live = effectiveStatus(doc, now) === 'live'
    activity.push({
      when: doc.createdAt,
      item: {
        initial: 'EX',
        text: live ? `${doc.title} is now live` : `${doc.title} was added to the timetable`,
        meta: `CBT · ${relative(doc.createdAt, now)}`,
        color: 'purple',
      },
    })
  }
  for (const doc of recentStudents) {
    activity.push({
      when: doc.createdAt,
      item: {
        initial: initials(doc.name),
        text: `${doc.name} joined ${doc.className}`,
        meta: `Students · ${relative(doc.createdAt, now)}`,
        color: 'blue',
      },
    })
  }
  if (latestRegister[0]) {
    const register = latestRegister[0]
    activity.push({
      when: register.createdAt,
      item: {
        initial: 'AT',
        text: `Attendance marked for ${register.records.length} learners`,
        meta: `Attendance · ${relative(register.date, now)}`,
        color: 'orange',
      },
    })
  }

  const stats: DashboardStats = {
    totalStudents,
    presentToday: todayPresent,
    presentTodayRate: todayMarked ? Math.round((todayPresent / todayMarked) * 100) : 0,
    attendanceRate: markedInRange ? Math.round((presentInRange / markedInRange) * 100) : 0,
    feesCollected,
    feesOutstanding,
    activeExams: liveExamCount,
    ...(schools ? { schools } : {}),
    attendanceSeries,
    feesSeries,
    upcomingExams,
    recentActivity: activity
      .sort((a, b) => b.when.getTime() - a.when.getTime())
      .slice(0, 5)
      .map((entry) => entry.item),
  }
  return stats
})
