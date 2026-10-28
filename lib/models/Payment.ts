import mongoose, { Schema } from 'mongoose'

const PaymentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    amount: { type: Number, required: true, min: 0 },
    /** Paystack reference — the webhook/verify path is idempotent on this value. */
    paystackRef: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    channel: { type: String, default: 'paystack' },
    paidAt: { type: Date },
    /** Raw Paystack event snapshot for audit (never contains secrets). */
    payload: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

PaymentSchema.index({ schoolId: 1, createdAt: -1 })
// Hot path: the dashboard's "paid in period" scan and recent-payments list.
PaymentSchema.index({ schoolId: 1, status: 1, paidAt: -1 })

export type PaymentDoc = mongoose.InferSchemaType<typeof PaymentSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Payment =
  (mongoose.models.Payment as mongoose.Model<PaymentDoc>) ||
  mongoose.model<PaymentDoc>('Payment', PaymentSchema, 'payments')
