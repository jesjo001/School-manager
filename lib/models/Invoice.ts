import mongoose, { Schema } from 'mongoose'

const InvoiceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    number: { type: String, required: true, trim: true },
    items: {
      type: [{ _id: false, label: { type: String, default: '' }, amount: { type: Number, default: 0 } }],
      default: [],
    },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'paid', 'overdue'], default: 'pending' },
    term: { type: String, default: '' },
    paystackRef: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

// Fall back to a unique human-facing number if the caller did not supply one.
InvoiceSchema.pre('validate', function (next) {
  if (!this.number) {
    this.number = `INV-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`
  }
  next()
})

InvoiceSchema.index({ schoolId: 1, status: 1 })
InvoiceSchema.index({ schoolId: 1, dueDate: 1 })
InvoiceSchema.index({ studentId: 1, status: 1 })
// Keeps the pay-but-don't-pay dance idempotent across retries.
InvoiceSchema.index({ schoolId: 1, number: 1 }, { unique: true })

export type InvoiceDoc = mongoose.InferSchemaType<typeof InvoiceSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Invoice =
  (mongoose.models.Invoice as mongoose.Model<InvoiceDoc>) ||
  mongoose.model<InvoiceDoc>('Invoice', InvoiceSchema, 'invoices')
