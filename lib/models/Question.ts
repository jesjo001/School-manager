import mongoose, { Schema } from 'mongoose'

const OptionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
  },
  { _id: false },
)

const QuestionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    type: { type: String, enum: ['mcq', 'short_answer'], default: 'mcq' },
    text: { type: String, required: true, trim: true },
    options: { type: [OptionSchema], default: [] },
    /** Answer key — stripped by the student serializer, never sent to clients. */
    correctOptionId: { type: String, default: null },
    /** Model answer used to auto-grade short-answer questions. */
    acceptedAnswer: { type: String, default: '' },
    marks: { type: Number, default: 5, min: 0 },
    order: { type: Number, default: 0 },
    explanation: { type: String, default: '' },
  },
  { timestamps: true },
)

QuestionSchema.index({ examId: 1, order: 1 })
QuestionSchema.index({ schoolId: 1, examId: 1 })

export type QuestionDoc = mongoose.InferSchemaType<typeof QuestionSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Question =
  (mongoose.models.Question as mongoose.Model<QuestionDoc>) ||
  mongoose.model<QuestionDoc>('Question', QuestionSchema, 'questions')
