import { apiHandler, badRequest, unauthorized } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { Invoice, Payment } from '@/lib/models'
import { getPaymentProvider } from '@/lib/payments/provider'
import { settleFailed, settlePaid } from '@/lib/payments/service'

const HANDLED = new Set(['charge.success', 'payment.success', 'charge.failed'])

/**
 * POST /api/payments/webhook — Paystack push confirmation.
 *
 * This is the one route without a session: the caller is the gateway, so the
 * only trust anchor is the HMAC signature over the *raw* body (verified with
 * `PAYSTACK_SECRET_KEY`). Unknown references and repeated deliveries are
 * acknowledged without side effects, which is what makes retries safe.
 */
export const POST = apiHandler(async (req) => {
  await connectDB()

  const raw = await req.text()
  const signature = req.headers.get('x-paystack-signature')
  if (!getPaymentProvider().verifyWebhookSignature(raw, signature)) {
    throw unauthorized('Invalid webhook signature')
  }

  let event: { event?: unknown; data?: Record<string, unknown> }
  try {
    event = JSON.parse(raw) as { event?: unknown; data?: Record<string, unknown> }
  } catch {
    throw badRequest('Malformed webhook payload')
  }

  const type = String(event.event ?? '')
  const data = event.data ?? {}
  const reference = String(data.reference ?? '')
  if (!reference || !HANDLED.has(type)) return { received: true, ignored: type || 'no event' }

  const payment = await Payment.findOne({ paystackRef: reference })
  if (!payment) return { received: true, ignored: 'unknown reference' }
  const invoice = await Invoice.findById(payment.invoiceId)
  if (!invoice) return { received: true, ignored: 'missing invoice' }

  if (payment.status === 'paid') return { received: true, duplicate: true }

  if (type === 'charge.failed') {
    await settleFailed(payment, data)
    return { received: true }
  }

  const amount = typeof data.amount === 'number' ? data.amount / 100 : null
  if (amount != null && Math.abs(amount - invoice.amount) > 0.01) {
    // A payment that does not cover the invoice is recorded, never settled.
    await settleFailed(payment, data)
    return { received: true, ignored: 'amount mismatch' }
  }

  await settlePaid({
    payment,
    invoice,
    channel: String(data.channel ?? 'paystack'),
    paidAt: data.paid_at ? new Date(String(data.paid_at)) : new Date(),
    payload: data,
  })
  return { received: true }
})
