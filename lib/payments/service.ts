import { Invoice, Payment, type InvoiceDoc, type PaymentDoc } from '@/lib/models'

/**
 * Shared settlement helpers so the pull-based verify route and the push-based
 * webhook can never disagree — both are idempotent on `paystackRef`.
 */

export type SettleInput = {
  payment: PaymentDoc
  invoice: InvoiceDoc
  channel?: string
  paidAt?: Date | null
  /** Gateway event snapshot (audit trail — never a secret). */
  payload?: unknown
}

/** Marks a payment (and its invoice) as paid. Safe to call more than once. */
export async function settlePaid({ payment, invoice, channel, paidAt, payload }: SettleInput) {
  if (payment.status !== 'paid') {
    await Payment.updateOne(
      { _id: payment._id, paystackRef: payment.paystackRef },
      {
        $set: {
          status: 'paid',
          channel: channel ?? payment.channel ?? 'paystack',
          paidAt: paidAt ?? new Date(),
          ...(payload === undefined ? {} : { payload }),
        },
      },
    )
  }
  if (invoice.status !== 'paid') {
    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { status: 'paid', paystackRef: payment.paystackRef } },
    )
  }
}

/** Gateway reported a failure — record it, never touch the invoice total. */
export async function settleFailed(payment: PaymentDoc, payload?: unknown) {
  if (payment.status === 'paid') return
  await Payment.updateOne(
    { _id: payment._id, paystackRef: payment.paystackRef },
    { $set: { status: 'failed', ...(payload === undefined ? {} : { payload }) } },
  )
}
