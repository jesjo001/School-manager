import { toUiRole, type SessionPayload, type UiRole } from '@/lib/auth'
import { toDateKey } from '@/lib/dates'
import { isRemoteImageUrl } from '@/lib/storage'
import type {
  AttendanceDoc,
  ClassDoc,
  ExamAttemptDoc,
  ExamDoc,
  InvoiceDoc,
  PaymentDoc,
  QuestionDoc,
  SchoolDoc,
  StudentDoc,
  SubjectDoc,
  TeacherAssignmentDoc,
  UserDoc,
} from '@/lib/models'
import type {
  AttendanceDay,
  ClassRow,
  Exam as ExamView,
  ExamAttempt as ExamAttemptView,
  ExamQuestion,
  Invoice,
  ResultRow,
  School,
  Session,
  Staff,
  Student,
  SubjectRow,
} from '@/services/types'
// `PaymentRecord` lives with the fees client module (type-only import — erased).
import type { PaymentRecord } from '@/services/fees'
import type { StartedAttempt } from '@/services/exams'
import { examDateLabel } from '@/lib/exams'

/**
 * View-model serializers.
 *
 * Mongo documents (lowercase enums, ObjectId fields, denormalised counts) are
 * mapped onto the exact shapes the existing UI already renders, so no component
 * ever has to know about Mongoose.
 */

export const id = (value: unknown): string => String(value ?? '')

/** 'Chidinma Okeke' → 'CO' (matches the `initials()` helper in the UI). */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '—'

/* ------------------------------- enum labels ------------------------------ */

const STUDENT_STATUS: Record<string, string> = {
  active: 'Active',
  on_leave: 'On leave',
  graduated: 'Graduated',
  inactive: 'Inactive',
}

export const studentStatusToUi = (status?: string | null): string =>
  STUDENT_STATUS[status ?? 'active'] ?? 'Active'

export const studentStatusToDb = (value: string): StudentDoc['status'] => {
  const key = value.trim().toLowerCase().replace(/\s+/g, '_')
  return key === 'on_leave' || key === 'graduated' || key === 'inactive' ? key : 'active'
}

const STAFF_ROLE: Record<string, string> = {
  proprietor: 'Head of School',
  admin: 'Admin',
  teacher: 'Teacher',
}

export const staffRoleToUi = (role?: string | null): string => STAFF_ROLE[role ?? 'teacher'] ?? 'Teacher'

/**
 * Display label → permission role. The prototype's invite drawer offers
 * "Bursar" / "Support staff", which are not permission tiers in the spec —
 * they are mapped onto the two staff tiers the spec defines (flagged change).
 */
export const staffRoleToDb = (value: string): 'admin' | 'teacher' => {
  const normalized = value.trim().toLowerCase()
  return normalized.includes('admin') || normalized.includes('bursar') ? 'admin' : 'teacher'
}

const STAFF_STATUS: Record<string, string> = {
  active: 'Active',
  invited: 'Invited',
  suspended: 'Suspended',
}

export const staffStatusToUi = (status?: string | null): string =>
  STAFF_STATUS[status ?? 'active'] ?? 'Active'

export const staffStatusToDb = (value: string): UserDoc['status'] => {
  const key = value.trim().toLowerCase()
  return key === 'invited' || key === 'suspended' ? key : 'active'
}

const ATTENDANCE_STATUS: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
}

export const attendanceStatusToUi = (status: string): string =>
  ATTENDANCE_STATUS[status] ?? 'Present'

export const attendanceStatusToDb = (value: string): 'present' | 'absent' | 'late' => {
  const key = value.trim().toLowerCase()
  return key === 'absent' || key === 'late' ? key : 'present'
}

/* -------------------------------- school ---------------------------------- */

export function serializeSchool(
  doc: SchoolDoc | null | undefined,
  stats: { studentCount?: number; feesCollected?: number } = {},
): School {
  return {
    id: id(doc?._id),
    name: doc?.name ?? '',
    location: doc?.location ?? '',
    brandColor: doc?.brandColor ?? '#7479e8',
    logo: doc?.logo ?? '',
    logoUrl: isRemoteImageUrl(doc?.logo ?? '') ? (doc?.logo ?? '') : '',
    studentCount: stats.studentCount ?? 0,
    feesCollected: stats.feesCollected ?? 0,
  }
}

export function serializeSession(
  session: SessionPayload,
  school: SchoolDoc | null | undefined,
  stats: { studentCount?: number; feesCollected?: number } = {},
): Session {
  return {
    kind: session.kind,
    userId: session.sub,
    name: session.name,
    email: session.email ?? null,
    role: toUiRole(session.role) as UiRole,
    tenantId: session.tenantId,
    schoolIds: session.schoolIds,
    activeSchoolId: session.activeSchoolId,
    school: serializeSchool(school, stats),
  }
}

/* -------------------------------- students -------------------------------- */

export type StudentStats = {
  /** Present-or-late share of marked days, in percent. */
  attendance?: number
  /** Outstanding invoice total. */
  feeBalance?: number
  /** Latest exam percentages (used by the results sparkline). */
  examScores?: number[]
}

export function serializeStudent(doc: StudentDoc, stats: StudentStats = {}): Student {
  return {
    id: id(doc._id),
    admissionNumber: doc.admissionNumber ?? '',
    name: doc.name,
    class: doc.className ?? '',
    section: doc.section || 'A',
    gender: doc.gender ?? '',
    avatar: doc.avatar || initialsOf(doc.name),
    status: studentStatusToUi(doc.status),
    attendance: stats.attendance ?? 0,
    feeBalance: stats.feeBalance ?? 0,
    guardians: doc.guardian?.name ? [doc.guardian.name] : [],
    examScores: stats.examScores ?? [],
  }
}

/* -------------------------------- classes --------------------------------- */

export function serializeClassRow(
  doc: ClassDoc,
  stats: { studentCount?: number; teacher?: string; subjects?: string[] } = {},
): ClassRow {
  const sectionList = doc.sections?.length ? doc.sections : ['A']
  return {
    id: id(doc._id),
    name: doc.name,
    sections: sectionList.length,
    sectionList,
    studentCount: stats.studentCount ?? 0,
    teacher: stats.teacher ?? '',
    subjects: stats.subjects ?? [],
  }
}

export function serializeSubjectRow(doc: SubjectDoc, classNames: string[] = []): SubjectRow {
  return {
    id: id(doc._id),
    name: doc.name,
    classIds: (doc.classIds ?? []).map(String),
    classNames,
  }
}

/* --------------------------- teacher assignments -------------------------- */

export function serializeAssignment(
  doc: TeacherAssignmentDoc,
  names: { teacherName?: string; subjectName?: string; className?: string } = {},
) {
  return {
    id: id(doc._id),
    schoolId: id(doc.schoolId),
    teacherId: id(doc.teacherId),
    teacherName: names.teacherName ?? '',
    subjectId: id(doc.subjectId),
    subjectName: names.subjectName ?? '',
    classId: id(doc.classId),
    className: names.className ?? '',
  }
}

/* --------------------------------- staff ---------------------------------- */

export function serializeStaff(
  doc: UserDoc,
  extras: { subjects?: string[]; classes?: string[] } = {},
): Staff {
  return {
    id: id(doc._id),
    name: doc.name,
    role: staffRoleToUi(doc.role),
    subjects: extras.subjects ?? [],
    classes: extras.classes ?? [],
    status: staffStatusToUi(doc.status),
    avatar: initialsOf(doc.name),
    email: doc.email ?? undefined,
  }
}

/* ------------------------------- attendance -------------------------------- */

export function serializeAttendanceDay(doc: AttendanceDoc): AttendanceDay {
  return {
    classId: id(doc.classId),
    date: toDateKey(doc.date),
    records: (doc.records ?? []).map((record) => ({
      studentId: id(record.studentId),
      status: attendanceStatusToUi(record.status),
    })),
  }
}

export { toDateKey }

/* -------------------------------- invoices --------------------------------- */

/** Display status: paid wins, otherwise an overdue due-date upgrades Pending. */
export function invoiceStatusToUi(
  status: string | undefined,
  dueDate?: Date | string | null,
): 'Paid' | 'Pending' | 'Overdue' {
  if (status === 'paid') return 'Paid'
  if (status === 'overdue') return 'Overdue'
  const due = dueDate ? new Date(dueDate).getTime() : Number.NaN
  return Number.isFinite(due) && due < Date.now() ? 'Overdue' : 'Pending'
}

/** Filter labels the UI sends ("Overdue") → query values. */
export const invoiceStatusToDb = (value: string): 'paid' | 'pending' | 'overdue' => {
  const key = value.trim().toLowerCase()
  return key === 'paid' || key === 'overdue' ? key : 'pending'
}

export function serializeInvoice(doc: InvoiceDoc, studentName: string): Invoice {
  return {
    id: id(doc._id),
    student: studentName,
    studentId: id(doc.studentId),
    amount: doc.amount,
    dueDate: toDateKey(doc.dueDate),
    status: invoiceStatusToUi(doc.status, doc.dueDate),
    term: doc.term || undefined,
    paystackRef: doc.paystackRef || null,
  }
}

/* -------------------------------- payments --------------------------------- */

export function serializePayment(doc: PaymentDoc): PaymentRecord {
  const paidAt = doc.paidAt ?? doc.updatedAt ?? doc.createdAt
  return {
    id: id(doc._id),
    invoiceId: id(doc.invoiceId),
    paystackRef: doc.paystackRef,
    amount: doc.amount,
    paidAt: paidAt ? new Date(paidAt).toISOString() : new Date(0).toISOString(),
  }
}

/* ---------------------------------- exams ---------------------------------- */

const EXAM_STATUS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  closed: 'Completed',
}

export const examStatusToUi = (status?: string | null): string =>
  EXAM_STATUS[status ?? 'draft'] ?? 'Draft'

/** UI label ("Completed", "Live") → stored status. */
export const examStatusToDb = (value: string): 'draft' | 'scheduled' | 'live' | 'closed' => {
  const status = value.trim().toLowerCase()
  if (status === 'completed' || status === 'closed') return 'closed'
  if (status === 'live') return 'live'
  if (status === 'scheduled') return 'scheduled'
  return 'draft'
}

export function serializeExam(
  doc: ExamDoc,
  stats: { questions?: number; participants?: number; status?: string } = {},
): ExamView {
  return {
    id: id(doc._id),
    title: doc.title,
    subject: doc.subjectName ?? '',
    class: doc.className ?? '',
    status: stats.status ?? examStatusToUi(doc.status),
    date: examDateLabel(doc.startTime),
    startTime: doc.startTime.toISOString(),
    endTime: doc.endTime.toISOString(),
    duration: doc.durationMinutes,
    participants: stats.participants ?? 0,
    questions: stats.questions ?? 0,
  }
}

export function serializeQuestion(
  doc: QuestionDoc,
  options: { includeAnswers?: boolean } = {},
): ExamQuestion {
  const base = {
    id: id(doc._id),
    type: (doc.type === 'short_answer' ? 'short_answer' : 'mcq') as 'mcq' | 'short_answer',
    text: doc.text,
    options: (doc.options ?? []).map((option) => ({ id: option.id, text: option.text })),
    marks: doc.marks ?? 0,
    order: doc.order ?? 0,
  }
  // The answer key is teacher-only — students get the bare shape.
  return options.includeAnswers ? { ...base, correctOptionId: doc.correctOptionId ?? null } : base
}

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : ''

export function serializeAttempt(
  doc: ExamAttemptDoc,
  options: { questions?: QuestionDoc[] } = {},
): ExamAttemptView {
  const reveal = doc.status !== 'in_progress'
  return {
    id: id(doc._id),
    examId: id(doc.examId),
    studentId: id(doc.studentId),
    startedAt: iso(doc.startedAt),
    deadlineAt: iso(doc.deadlineAt),
    submittedAt: doc.submittedAt ? iso(doc.submittedAt) : null,
    autoSubmitted: Boolean(doc.autoSubmitted),
    answers: (doc.answers ?? []).map((answer) => ({
      questionId: id(answer.questionId),
      response: answer.response ?? '',
      isCorrect: answer.isCorrect ?? null,
      marksAwarded: reveal ? (answer.marksAwarded ?? null) : null,
      feedback: answer.feedback || null,
    })),
    questions: (options.questions ?? []).map((question) => serializeQuestion(question)),
    tabSwitchCount: doc.tabSwitchCount ?? 0,
    flagged: Boolean(doc.flagged),
    status: doc.status,
    totalScore: doc.totalScore ?? 0,
    maxScore: doc.maxScore ?? 0,
  }
}

/** `POST /api/exams/:id/start` and resume payload for the exam runner. */
export function serializeStartedAttempt(
  attempt: ExamAttemptDoc,
  exam: ExamDoc,
  questions: QuestionDoc[],
): StartedAttempt {
  return {
    attempt: serializeAttempt(attempt, { questions }),
    questions: questions.map((question) => serializeQuestion(question)),
    exam: {
      id: id(exam._id),
      title: exam.title,
      subject: exam.subjectName ?? '',
      className: exam.className ?? '',
      durationMinutes: exam.durationMinutes,
    },
  }
}

/* --------------------------------- results --------------------------------- */

export const gradeFor = (percent: number): string =>
  percent >= 80 ? 'A' : percent >= 70 ? 'B' : percent >= 60 ? 'C' : percent >= 50 ? 'D' : 'F'

export function serializeResultRow(input: {
  attempt: ExamAttemptDoc
  studentName: string
}): ResultRow {
  const maxScore = input.attempt.maxScore ?? 0
  const percent = maxScore
    ? Math.round(((input.attempt.totalScore ?? 0) / maxScore) * 100)
    : 0
  return {
    studentId: id(input.attempt.studentId),
    studentName: input.studentName,
    score: input.attempt.totalScore ?? 0,
    maxScore,
    percent,
    grade: gradeFor(percent),
    tabSwitches: input.attempt.tabSwitchCount ?? 0,
    flagged: Boolean(input.attempt.flagged),
    status: input.attempt.status,
  }
}
