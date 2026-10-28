import mongoose, { Schema } from 'mongoose'

const TenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    settings: {
      currency: { type: String, default: 'NGN' },
      brandColor: { type: String, default: '#7479e8' },
      logo: { type: String, default: '' },
      contactEmail: { type: String, default: '' },
      contactPhone: { type: String, default: '' },
    },
  },
  { timestamps: true },
)

export type TenantDoc = mongoose.InferSchemaType<typeof TenantSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Tenant =
  (mongoose.models.Tenant as mongoose.Model<TenantDoc>) ||
  mongoose.model<TenantDoc>('Tenant', TenantSchema, 'tenants')
