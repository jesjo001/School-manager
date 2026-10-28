import mongoose, { Schema } from 'mongoose'

/**
 * A school class (JSS 1 … SS 3). `sections` holds the real section
 * identifiers (["A","B","C"]); the UI renders `sections.length`.
 */
const ClassSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true, trim: true },
    sections: { type: [String], default: ['A'] },
    classTeacherId: { type: Schema.Types.ObjectId, ref: 'User' },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
)

ClassSchema.index({ schoolId: 1, name: 1 }, { unique: true })

export type ClassDoc = mongoose.InferSchemaType<typeof ClassSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const SchoolClass =
  (mongoose.models.Class as mongoose.Model<ClassDoc>) ||
  mongoose.model<ClassDoc>('Class', ClassSchema, 'classes')
