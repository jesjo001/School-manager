/**
 * Single import point for every Mongoose model.
 *
 * Importing this module registers all schemas, so `lib/db.ts` (and tests) can
 * rely on `import './models'` having the full schema set available. Note the
 * relative form: `lib/db.ts` must stay free of `@/` aliases so plain `tsx`
 * scripts (seed, fixtures) can import it without a path-mapper.
 */
export { Tenant, type TenantDoc } from './Tenant'
export { School, type SchoolDoc } from './School'
export { User, type UserDoc } from './User'
export { Student, type StudentDoc } from './Student'
export { SchoolClass, type ClassDoc } from './Class'
export { Subject, type SubjectDoc } from './Subject'
export { TeacherAssignment, type TeacherAssignmentDoc } from './TeacherAssignment'
export { Attendance, type AttendanceDoc } from './Attendance'
export { Invoice, type InvoiceDoc } from './Invoice'
export { Payment, type PaymentDoc } from './Payment'
export { Exam, type ExamDoc } from './Exam'
export { Question, type QuestionDoc } from './Question'
export { ExamAttempt, type ExamAttemptDoc } from './ExamAttempt'
export { RateLimit, type RateLimitDoc } from './RateLimit'
