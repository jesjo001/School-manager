import { z } from 'zod'
import { apiHandler, badRequest, conflict, notFound, parseQuery } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { Invoice, Payment, Student } from '@/lib/models'
import { getPaymentProvider } from '@/lib/payments/provider'
import { settleFailed, settlePaid } from '@/lib/payments/service'
import { serializeInvoice, serializePayment } from '@/lib/serialize'
import { scopedFilter, withTenant } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin'] as const

const Query = z.object({
  reference: z.string().trim().min(6, 'Missing payment reference').max(80),
})

/**
 * GET /api/payments/verify?reference=…
 * Pull-based confirmation: ask the gateway, settle if it says the money landed,
 * then return the invoice + payment pair the receipt screen renders.
 */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const { reference } = parseQuery(req, Query)

  const payment = await Payment.findOne({ ...scopedFilter(tenant), paystackRef: reference })
  if (!payment) throw notFound('Payment not found')
  const invoice = await Invoice.findOne({ _id: payment.invoiceId, ...scopedFilter(tenant) })
  if (!invoice) throw notFound('Invoice not found')

  if (payment.status !== 'paid') {
    const provider = getPaymentProvider()
    let result
    try {
      result = await provider.verify(reference)
    } catch (err) {
      throw badRequest(
        err instanceof Error ? err.message : 'The payment gateway is unavailable right now',
      )
    }

    if (result.status === 'success') {
      // Never settle money that does not match the bill it claims to pay.
      if (result.amount != null && Math.abs(result.amount - invoice.amount) > 0.01) {
        throw conflict('The amount received does not match this invoice')
      }
      await settlePaid({
        payment,
        invoice,
        channel: result.channel,
        paidAt: result.paidAt,
        payload: result.raw,
      })
    } else if (result.status === 'failed') {
      await settleFailed(payment, result.raw)
    }
    // 'pending' / 'abandoned' leave the attempt open so it can be retried.
  }

  const [freshPayment, freshInvoice] = await Promise.all([
    Payment.findOne({ _id: payment._id }),
    Invoice.findOne({ _id: invoice._id }),
  ])
  if (!freshPayment || !freshInvoice) throw notFound('Payment not found')

  const student = await Student.findOne({
    _id: freshInvoice.studentId,
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
  }).select('name')

  return {
    invoice: serializeInvoice(freshInvoice, student?.name ?? 'Unknown student'),
    payment: serializePayment(freshPayment),
  }
})
