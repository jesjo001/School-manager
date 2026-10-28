import { z } from 'zod'
import { apiHandler, badRequest, conflict, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { Payment, Student } from '@/lib/models'
import { appBaseUrl, getPaymentProvider, newReference } from '@/lib/payments/provider'
import { actorId, scopedFilter, withTenant } from '@/lib/tenant'
import { requireInvoice } from '@/lib/validate'

/** /fees is admin/proprietor territory in the original route table. */
const ROLES = ['proprietor', 'admin'] as const

const Body = z.object({ invoiceId: z.string().trim().min(1, 'Missing invoice id') })

/**
 * POST /api/payments/initialize
 * Creates (or reuses) a pending payment for the invoice and asks the provider
 * for a checkout URL. Never trusts an amount from the client — it is always the
 * invoice's own amount.
 */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, Body)

  const invoice = await requireInvoice(tenant.tenantId, tenant.schoolId, input.invoiceId)
  if (invoice.status === 'paid') throw conflict('This invoice has already been paid')

  const student = await Student.findOne({
    _id: invoice.studentId,
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
  })
  if (!student) throw badRequest('The student on this invoice no longer exists')

  const provider = getPaymentProvider()

  // Retry-safe: a pending attempt keeps its reference so two clicks cannot
  // create two open transactions for one invoice.
  let payment = await Payment.findOne({
    ...scopedFilter(tenant),
    invoiceId: invoice._id,
    status: 'pending',
  })
  if (!payment) {
    payment = await Payment.create({
      tenantId: tenant.tenantId,
      schoolId: tenant.schoolId,
      invoiceId: invoice._id,
      studentId: student._id,
      amount: invoice.amount,
      paystackRef: newReference(),
      status: 'pending',
      channel: provider.live ? 'paystack' : 'test',
      createdBy: actorId(tenant),
    })
  }

  const email =
    student.email?.trim() ||
    student.guardian?.email?.trim() ||
    `${student.admissionNumber || 'learner'}@campusflow.app`

  let authorizationUrl: string
  try {
    const result = await provider.initialize({
      reference: payment.paystackRef,
      amount: invoice.amount,
      email,
      callbackUrl: appBaseUrl('/fees'),
      metadata: { invoice: String(invoice._id), invoiceNumber: invoice.number },
    })
    authorizationUrl = result.authorizationUrl
  } catch (err) {
    throw badRequest(
      err instanceof Error ? err.message : 'The payment gateway is unavailable right now',
    )
  }

  return {
    reference: payment.paystackRef,
    authorizationUrl,
    amount: invoice.amount,
    live: provider.live,
  }
})
