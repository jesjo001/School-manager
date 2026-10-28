import { apiHandler } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { Payment } from '@/lib/models'
import { serializePayment } from '@/lib/serialize'
import { scopedFilter, withTenant } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin'] as const

/** GET /api/payments — recent payment attempts for the active school. */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  const docs = await Payment.find(scopedFilter(tenant)).sort({ createdAt: -1 }).limit(200)
  return docs.map((doc) => serializePayment(doc))
})
