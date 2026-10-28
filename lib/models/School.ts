import mongoose, { Schema } from 'mongoose'

const SchoolSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, default: '' },
    /** Short human-facing code used for school switching / student sign-in hints. */
    slug: { type: String, default: '', lowercase: true, trim: true },
    brandColor: { type: String, default: '#7479e8' },
    logo: { type: String, default: '' },
    address: { type: String, default: '' },
    phone: { type: String, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true },
)

SchoolSchema.index({ tenantId: 1, name: 1 })
SchoolSchema.index({ tenantId: 1, slug: 1 })

export type SchoolDoc = mongoose.InferSchemaType<typeof SchoolSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const School =
  (mongoose.models.School as mongoose.Model<SchoolDoc>) ||
  mongoose.model<SchoolDoc>('School', SchoolSchema, 'schools')
