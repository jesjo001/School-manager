import { apiRequest } from './http'
import type { Paginated, Staff } from './types'

export type StaffFilters = { q?: string; role?: string; page?: number; limit?: number }

export type StaffInput = {
  name: string
  email: string
  role: 'admin' | 'teacher'
  subjects?: string[]
  classes?: string[]
}

export const listStaff = (filters: StaffFilters = {}) =>
  apiRequest<Paginated<Staff>>('/api/staff', { query: filters as Record<string, string | number> })

export const inviteStaff = (input: StaffInput) => apiRequest<Staff>('/api/staff', { method: 'POST', body: input })

export const updateStaff = (id: string, patch: Partial<StaffInput> & { status?: string }) =>
  apiRequest<Staff>(`/api/staff/${id}`, { method: 'PATCH', body: patch })

export const deleteStaff = (id: string) => apiRequest<{ ok: true }>(`/api/staff/${id}`, { method: 'DELETE' })
