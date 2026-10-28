import { apiHandler } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { loadGradingQueue } from '@/lib/exams'
import { withTenant } from '@/lib/tenant'

/** GET /api/grading/queue — ungraded answers across the school, oldest first. */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: ['proprietor', 'admin', 'teacher'] })
  return loadGradingQueue(tenant.tenantId, tenant.schoolId)
})
