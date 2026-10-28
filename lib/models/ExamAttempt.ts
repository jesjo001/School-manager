import mongoose, { Schema } from 'mongoose'

const AnswerSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    response: { type: String, default: '' },
    isCorrect: { type: Boolean, default: null },
    marksAwarded: { type: Number, default: null },
    feedback: { type: String, default: '' },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false },
)

/**
 * One sitting of an exam by one student.
 *
 * `deadlineAt` = min(startedAt + exam.durationMinutes, exam.endTime) and is
 * computed once at start; the server enforces it on every write (late writes
 * are ignored) and lazily finalises expired attempts.
 */
const ExamAttemptSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    startedAt: { type: Date, required: true },
    deadlineAt: { type: Date, required: true },
    submittedAt: { type: Date },
    autoSubmitted: { type: Boolean, default: false },
    status: { type: String, enum: ['in_progress', 'submitted', 'graded'], default: 'in_progress' },
    answers: { type: [AnswerSchema], default: [] },
    totalScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    tabSwitchCount: { type: Number, default: 0 },
    flagged: { type: Boolean, default: false },
    gradedAt: { type: Date },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

// Hard guarantee: one attempt per student per exam.
ExamAttemptSchema.index({ examId: 1, studentId: 1 }, { unique: true })
// Grading queue + late-submission sweep.
ExamAttemptSchema.index({ status: 1, submittedAt: 1 })
ExamAttemptSchema.index({ schoolId: 1, createdAt: -1 })

export type ExamAttemptDoc = mongoose.InferSchemaType<typeof ExamAttemptSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const ExamAttempt =
  (mongoose.models.ExamAttempt as mongoose.Model<ExamAttemptDoc>) ||
  mongoose.model<ExamAttemptDoc>('ExamAttempt', ExamAttemptSchema, 'examattempts')
