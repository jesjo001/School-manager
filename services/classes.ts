import { apiRequest } from './http'
import type { ClassRow, SubjectRow } from './types'

export type ClassInput = {
  name: string
  sections?: number
  /** Staff account id of the class teacher (empty string clears it). */
  classTeacherId?: string
}

export const listClasses = () => apiRequest<ClassRow[]>('/api/classes')

export const createClass = (input: ClassInput) => apiRequest<ClassRow>('/api/classes', { method: 'POST', body: input })

export const updateClass = (id: string, patch: Partial<ClassInput>) =>
  apiRequest<ClassRow>(`/api/classes/${id}`, { method: 'PATCH', body: patch })

export const deleteClass = (id: string) => apiRequest<{ ok: true }>(`/api/classes/${id}`, { method: 'DELETE' })

/* ------------------------------- subjects -------------------------------- */

export type SubjectInput = { name: string; classIds?: string[] }

export const listSubjects = () => apiRequest<SubjectRow[]>('/api/subjects')

export const createSubject = (input: SubjectInput) =>
  apiRequest<SubjectRow>('/api/subjects', { method: 'POST', body: input })

export const updateSubject = (id: string, patch: Partial<SubjectInput>) =>
  apiRequest<SubjectRow>(`/api/subjects/${id}`, { method: 'PATCH', body: patch })

export const deleteSubject = (id: string) => apiRequest<{ ok: true }>(`/api/subjects/${id}`, { method: 'DELETE' })

/* --------------------------- teacher assignments ------------------------- */

export type TeacherAssignment = {
  id: string
  schoolId: string
  teacherId: string
  teacherName: string
  subjectId: string
  subjectName: string
  classId: string
  className: string
}

export type TeacherAssignmentInput = { teacherId: string; subjectId: string; classId: string }

export const listTeacherAssignments = (teacherId?: string) =>
  apiRequest<TeacherAssignment[]>('/api/teacher-assignments', { query: { teacherId } })

export const createTeacherAssignment = (input: TeacherAssignmentInput) =>
  apiRequest<TeacherAssignment>('/api/teacher-assignments', { method: 'POST', body: input })

export const deleteTeacherAssignment = (id: string) =>
  apiRequest<{ ok: true }>(`/api/teacher-assignments/${id}`, { method: 'DELETE' })
