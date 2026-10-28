import mongoose, { Schema } from 'mongoose'

const SubjectSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true, trim: true },
    classIds: { type: [Schema.Types.ObjectId], ref: 'Class', default: [] },
    code: { type: String, default: '' },
  },
  { timestamps: true },
)

SubjectSchema.index({ schoolId: 1, name: 1 }, { unique: true })

export type SubjectDoc = mongoose.InferSchemaType<typeof SubjectSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Subject =
  (mongoose.models.Subject as mongoose.Model<SubjectDoc>) ||
  mongoose.model<SubjectDoc>('Subject', SubjectSchema, 'subjects')
