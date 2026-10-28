import mongoose, { Schema } from 'mongoose'

/**
 * Staff accounts (proprietor / admin / teacher). Students authenticate through
 * the Student collection with their admission number — see Student.passwordHash.
 */
const UserSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    schoolIds: { type: [Schema.Types.ObjectId], ref: 'School', default: [], index: true },
    activeSchoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['proprietor', 'admin', 'teacher', 'student'],
      required: true,
      index: true,
    },
    status: { type: String, enum: ['active', 'invited', 'suspended'], default: 'active' },
    /**
     * Display strings for the Staff table. TeacherAssignment rows remain the
     * canonical (teacher, subject, class) relation; these hold whatever the
     * invite form captured before any assignment exists.
     */
    subjectNames: { type: [String], default: [] },
    classNames: { type: [String], default: [] },
    /** For imported/existing students that also own a staff-style account. */
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
)

UserSchema.index({ tenantId: 1, role: 1 })

export type UserDoc = mongoose.InferSchemaType<typeof UserSchema> & {
  _id: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const User =
  (mongoose.models.User as mongoose.Model<UserDoc>) ||
  mongoose.model<UserDoc>('User', UserSchema, 'users')
