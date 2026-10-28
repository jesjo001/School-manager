import { apiHandler, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { finalizeIfExpired, requireAttempt } from '@/lib/exams'
import { ExamAttempt } from '@/lib/models'
import { withTenant } from '@/lib/tenant'

/** Integrity signal: three or more window switches flags the sitting. */
const FLAG_AFTER = 3

/**
 * POST /api/attempts/:id/tab-switch — integrity counter. Counts are returned
 * (rather than rejected) after the deadline so the runner can still report.
 */
export const POST = apiHandler(async (req, ctx) => {
  await connectDB()
  const tenant = await withTenant(req)
  if (tenant.session.kind !== 'student' || !tenant.student) {
    return { tabSwitchCount: 0, flagged: false }
  }

  const attempt = await requireAttempt(
    { tenantId: tenant.tenantId, schoolId: tenant.schoolId, studentId: String(tenant.student._id) },
    await param(ctx, 'id'),
  )

  const fresh = await finalizeIfExpired(attempt)
  if (fresh.status !== 'in_progress') {
    return { tabSwitchCount: fresh.tabSwitchCount ?? 0, flagged: Boolean(fresh.flagged) }
  }

  const count = (fresh.tabSwitchCount ?? 0) + 1
  await ExamAttempt.updateOne(
    { _id: fresh._id, status: 'in_progress' },
    { $set: { tabSwitchCount: count, flagged: fresh.flagged || count >= FLAG_AFTER } },
  )

  return { tabSwitchCount: count, flagged: fresh.flagged || count >= FLAG_AFTER }
})
