/**
 * Shared view models for the CampusFlow UI.
 * The API returns exactly these shapes (server-side serializers in
 * `lib/serialize.ts` map Mongo documents + lowercase enums onto them) so the
 * original design layer keeps working untouched.
 */

export type Role = 'Proprietor' | 'Admin' | 'Teacher' | 'Student'

export type StaffRole = 'proprietor' | 'admin' | 'teacher'

export type School = {
  id: string
  name: string
  location: string
  brandColor: string
  /** Two-letter initials, or an image path when one has been uploaded. */
  logo: string
  /** Populated only when `logo` points at an uploaded/remote image. */
  logoUrl?: string
  studentCount: number
  feesCollected: number
}

export type Student = {
  id: string
  /** Human-facing learner code (e.g. GFA-2401). */
  admissionNumber?: string
  name: string
  class: string
  section: string
  gender: string
  avatar: string
  status: string
  attendance: number
  feeBalance: number
  guardians: string[]
  examScores: number[]
}

export type Staff = {
  id: string
  name: string
  role: string
  subjects: string[]
  classes: string[]
  status: string
  avatar: string
  email?: string
}

export type ClassRow = {
  /** Present on records loaded from the API; local drafts may omit it. */
  id?: string
  name: string
  /** Number of sections — what the existing UI renders. */
  sections: number
  /** Actual section identifiers (["A","B","C"]) for pickers and records. */
  sectionList?: string[]
  studentCount: number
  teacher: string
  subjects: string[]
}

export type SubjectRow = {
  id: string
  name: string
  classIds: string[]
  classNames: string[]
}

/** Statuses the UI offers; `status` stays a string so local edits remain legal. */
export type ExamStatus = 'Draft' | 'Scheduled' | 'Live' | 'Closed' | 'Completed'

export type Exam = {
  id: string
  title: string
  subject: string
  class: string
  status: string
  /** Display label, e.g. `Today · 10:30 AM`. */
  date: string
  /** Raw window (ISO) — used by editors to republish an exam. */
  startTime?: string
  endTime?: string
  duration: number
  participants: number
  questions: number
}

export type InvoiceStatus = 'Paid' | 'Pending' | 'Overdue'

export type Invoice = {
  id: string
  student: string
  studentId?: string
  amount: number
  dueDate: string
  status: string
  term?: string
  paystackRef?: string | null
}

export type AttendanceRecord = {
  studentId: string
  status: string
}

export type AttendanceDay = {
  classId: string
  date: string
  records: AttendanceRecord[]
}

export type Paginated<T> = {
  items: T[]
  total: number
  page: number
  limit: number
}

/* ---------------------------------- CBT ---------------------------------- */

export type QuestionOption = { id: string; text: string }

export type ExamQuestion = {
  id: string
  type: 'mcq' | 'short_answer'
  text: string
  options: QuestionOption[]
  marks: number
  order: number
  /** Teacher-side only — never sent to students. */
  correctOptionId?: string | null
}

/** Question payload as seen by a student (no answer key). */
export type StudentQuestion = Omit<ExamQuestion, 'correctOptionId'>

export type AttemptAnswer = {
  questionId: string
  response: string
  isCorrect?: boolean | null
  marksAwarded?: number | null
  feedback?: string | null
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'graded'

export type ExamAttempt = {
  id: string
  examId: string
  studentId: string
  startedAt: string
  deadlineAt: string
  submittedAt?: string | null
  autoSubmitted?: boolean
  answers: AttemptAnswer[]
  questions: StudentQuestion[]
  tabSwitchCount: number
  flagged: boolean
  status: AttemptStatus
  totalScore: number
  maxScore: number
}

export type GradingItem = {
  attemptId: string
  examId: string
  examTitle: string
  studentId: string
  studentName: string
  questionId: string
  questionText: string
  response: string
  marks: number
}

export type ResultRow = {
  studentId: string
  studentName: string
  score: number
  maxScore: number
  percent: number
  grade: string
  tabSwitches: number
  flagged: boolean
  status: AttemptStatus
}

export type ExamResults = {
  examId: string
  examTitle: string
  className: string
  rows: ResultRow[]
  distribution: { range: string; students: number }[]
  flaggedCount: number
  average: number
}

export type MyResult = {
  attemptId: string
  examId: string
  title: string
  subject: string
  date: string
  score: number
  maxScore: number
  percent: number
  grade: string
}

/* -------------------------------- Dashboard ------------------------------- */

export type DashboardStats = {
  totalStudents: number
  presentToday: number
  /** Today's register: share of marked learners who are in school. */
  presentTodayRate: number
  attendanceRate: number
  feesCollected: number
  feesOutstanding: number
  activeExams: number
  schools?: { id: string; name: string; location: string; studentCount: number; feesCollected: number }[]
  attendanceSeries: { name: string; present: number; absent: number }[]
  feesSeries: { name: string; value: number }[]
  upcomingExams: Exam[]
  recentActivity: { initial: string; text: string; meta: string; color: string }[]
}

/* ---------------------------------- Auth ---------------------------------- */

export type Session = {
  kind: 'staff' | 'student'
  userId: string
  name: string
  email: string | null
  role: Role
  tenantId: string
  schoolIds: string[]
  activeSchoolId: string
  school: School
}
