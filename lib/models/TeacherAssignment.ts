import mongoose, { Schema } from 'mongoose'

/** Which teacher teaches which subject in which class (formerly "TeacherAttendance"). */
const TeacherAssignmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  },
  { timestamps: true },
)

TeacherAssignmentSchema.index(
  { schoolId: 1, teacherId: 1, subjectId: 1, classId: 1 },
  { unique: true },
)
TeacherAssignmentSchema.index({ schoolId: 1, classId: 1 })
TeacherAssignmentSchema.index({ schoolId: 1, teacherId: 1 })

export type TeacherAssignmentDoc = mongoose.InferSchemaType<typeof TeacherAssignmentSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const TeacherAssignment =
  (mongoose.models.TeacherAssignment as mongoose.Model<TeacherAssignmentDoc>) ||
  mongoose.model<TeacherAssignmentDoc>(
    'TeacherAssignment',
    TeacherAssignmentSchema,
    'teacherassignments',
  )
