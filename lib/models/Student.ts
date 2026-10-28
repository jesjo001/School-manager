import mongoose, { Schema } from 'mongoose'

const StudentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    admissionNumber: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    /** Free-text class label kept alongside classId so queries can fall back to it. */
    className: { type: String, default: '', trim: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class' },
    section: { type: String, default: 'A' },
    gender: { type: String, enum: ['Male', 'Female', ''], default: '' },
    dob: { type: Date },
    avatar: { type: String, default: '' },
    status: { type: String, enum: ['active', 'on_leave', 'graduated', 'inactive'], default: 'active' },
    guardian: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '', lowercase: true },
      relation: { type: String, default: '' },
    },
    /** Optional school e-mail issued to the learner (used for student sign-in). */
    email: { type: String, default: '', lowercase: true },
    passwordHash: { type: String, select: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
)

StudentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true })
StudentSchema.index({ schoolId: 1, classId: 1 })
StudentSchema.index({ schoolId: 1, name: 1 })
// Hot path: the dashboard counts active learners and the list filters by status.
StudentSchema.index({ schoolId: 1, status: 1 })
// Global lookup path used by student sign-in (admission number alone).
StudentSchema.index({ admissionNumber: 1 })

export type StudentDoc = mongoose.InferSchemaType<typeof StudentSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const Student =
  (mongoose.models.Student as mongoose.Model<StudentDoc>) ||
  mongoose.model<StudentDoc>('Student', StudentSchema, 'students')
