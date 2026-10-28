import { apiRequest } from './http'
import type {
  Exam,
  ExamAttempt,
  ExamQuestion,
  ExamResults,
  GradingItem,
  MyResult,
  Paginated,
  ResultRow,
  StudentQuestion,
} from './types'

export type ExamFilters = { q?: string; status?: string; page?: number; limit?: number }

export type ExamInput = {
  title: string
  subjectId: string
  classId: string
  startTime: string
  endTime: string
  durationMinutes: number
  status?: 'draft' | 'scheduled' | 'live' | 'closed'
}

export type QuestionInput = {
  id?: string
  type: 'mcq' | 'short_answer'
  text: string
  options?: { id: string; text: string }[]
  correctOptionId?: string | null
  marks: number
  order?: number
}

/* --------------------------------- exams --------------------------------- */

export const listExams = (filters: ExamFilters = {}) =>
  apiRequest<Paginated<Exam>>('/api/exams', { query: filters as Record<string, string | number> })

export const getExam = (id: string) => apiRequest<Exam>(`/api/exams/${id}`)

export const createExam = (input: ExamInput) => apiRequest<Exam>('/api/exams', { method: 'POST', body: input })

export const updateExam = (id: string, patch: Partial<ExamInput>) =>
  apiRequest<Exam>(`/api/exams/${id}`, { method: 'PATCH', body: patch })

export const deleteExam = (id: string) => apiRequest<{ ok: true }>(`/api/exams/${id}`, { method: 'DELETE' })

/* ------------------------------- questions ------------------------------- */

export const listQuestions = (examId: string) =>
  apiRequest<ExamQuestion[]>(`/api/exams/${examId}/questions`)

export const saveQuestions = (examId: string, questions: QuestionInput[]) =>
  apiRequest<ExamQuestion[]>(`/api/exams/${examId}/questions`, { method: 'PUT', body: { questions } })

export const reorderQuestions = (examId: string, orderedIds: string[]) =>
  apiRequest<ExamQuestion[]>(`/api/exams/${examId}/questions/reorder`, { method: 'POST', body: { orderedIds } })

/* -------------------------------- attempts ------------------------------- */

export type StartedAttempt = {
  attempt: ExamAttempt
  questions: StudentQuestion[]
  exam: { id: string; title: string; subject: string; className: string; durationMinutes: number }
}

export const startAttempt = (examId: string) =>
  apiRequest<StartedAttempt>(`/api/exams/${examId}/start`, { method: 'POST' })

export const getAttempt = (attemptId: string) =>
  apiRequest<StartedAttempt>(`/api/attempts/${attemptId}`)

export const saveAnswer = (attemptId: string, input: { questionId: string; response: string }) =>
  apiRequest<{ saved: true }>(`/api/attempts/${attemptId}/answer`, { method: 'PATCH', body: input })

export const reportTabSwitch = (attemptId: string) =>
  apiRequest<{ tabSwitchCount: number; flagged: boolean }>(`/api/attempts/${attemptId}/tab-switch`, {
    method: 'POST',
  })

export const submitAttempt = (attemptId: string) =>
  apiRequest<{ attempt: ExamAttempt }>(`/api/attempts/${attemptId}/submit`, { method: 'POST' })

/* -------------------------------- grading -------------------------------- */

export const getGradingQueue = () => apiRequest<GradingItem[]>('/api/grading/queue')

export const gradeAttempt = (
  attemptId: string,
  input: { answers: { questionId: string; marksAwarded: number; feedback?: string }[] },
) => apiRequest<{ attempt: ExamAttempt; pending: number }>(`/api/attempts/${attemptId}/grade`, {
  method: 'PATCH',
  body: input,
})

/* -------------------------------- results -------------------------------- */

export const getExamResults = (examId: string) => apiRequest<ExamResults>(`/api/exams/${examId}/results`)

export const getMyResults = () => apiRequest<{ items: MyResult[]; average: number }>('/api/me/results')

export const getAttemptDetail = (attemptId: string) =>
  apiRequest<{ rows: ResultRow[] }>(`/api/attempts/${attemptId}`)
