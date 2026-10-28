import { apiRequest } from './http'
import type { Paginated, Student } from './types'

export type StudentFilters = {
  q?: string
  classId?: string
  status?: string
  page?: number
  limit?: number
}

export type StudentInput = {
  name: string
  classId: string
  section: string
  gender?: string
  admissionNumber?: string
  dob?: string
  guardian?: { name?: string; phone?: string; email?: string }
}

export const listStudents = (filters: StudentFilters = {}) =>
  apiRequest<Paginated<Student>>('/api/students', { query: filters as Record<string, string | number> })

export const getStudent = (id: string) => apiRequest<Student>(`/api/students/${id}`)

export const createStudent = (input: StudentInput) =>
  apiRequest<Student>('/api/students', { method: 'POST', body: input })

export const updateStudent = (id: string, patch: Partial<StudentInput> & { status?: string }) =>
  apiRequest<Student>(`/api/students/${id}`, { method: 'PATCH', body: patch })

export const deleteStudent = (id: string) => apiRequest<{ ok: true }>(`/api/students/${id}`, { method: 'DELETE' })
