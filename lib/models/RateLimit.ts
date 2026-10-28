import mongoose, { Schema } from 'mongoose'

/**
 * Fixed-window counter stored in MongoDB (no Redis in this stack) — used for
 * login attempts and other throttled endpoints. Documents expire via TTL.
 */
const RateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    windowStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
)

RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export type RateLimitDoc = mongoose.InferSchemaType<typeof RateLimitSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const RateLimit =
  (mongoose.models.RateLimit as mongoose.Model<RateLimitDoc>) ||
  mongoose.model<RateLimitDoc>('RateLimit', RateLimitSchema, 'ratelimits')
