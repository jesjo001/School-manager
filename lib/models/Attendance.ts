import mongoose, { Schema } from 'mongoose'

/** One attendance sheet per class per date — the (classId, date) pair is unique. */
const AttendanceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
    /** Always stored normalised to UTC midnight (see lib/dates.ts). */
    date: { type: Date, required: true },
    records: [
      {
        _id: false,
        studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
        status: { type: String, enum: ['present', 'absent', 'late'], required: true },
      },
    ],
    markedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, default: '' },
  },
  { timestamps: true },
)

AttendanceSchema.index({ classId: 1, date: 1 }, { unique: true })
AttendanceSchema.index({ schoolId: 1, date: 1 })
// Per-student attendance roll-up (lib/stats.ts) scans one school's register.
AttendanceSchema.index({ schoolId: 1, 'records.studentId': 1 })

export type AttendanceDoc = mongoose.InferSchemaType<typeof AttendanceSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Attendance =
  (mongoose.models.Attendance as mongoose.Model<AttendanceDoc>) ||
  mongoose.model<AttendanceDoc>('Attendance', AttendanceSchema, 'attendance')
