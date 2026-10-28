import mongoose, { Schema } from 'mongoose'

/**
 * CBT exam header. `status` maps to the UI as:
 * draft → "Draft", scheduled → "Scheduled", live → "Live",
 * closed → "Completed" (see lib/serialize.ts).
 */
const ExamSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    title: { type: String, required: true, trim: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject' },
    subjectName: { type: String, default: '', trim: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    className: { type: String, default: '', trim: true },
    status: { type: String, enum: ['draft', 'scheduled', 'live', 'closed'], default: 'draft', index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    instructions: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

ExamSchema.index({ schoolId: 1, startTime: -1 })
ExamSchema.index({ classId: 1, startTime: -1 })
// Denormalised count shown on the exams grid; kept in sync by lib/exams.ts.
ExamSchema.virtual('questionCount', {
  ref: 'Question',
  localField: '_id',
  foreignField: 'examId',
  count: true,
})

export type ExamDoc = mongoose.InferSchemaType<typeof ExamSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Exam =
  (mongoose.models.Exam as mongoose.Model<ExamDoc>) ||
  mongoose.model<ExamDoc>('Exam', ExamSchema, 'exams')
