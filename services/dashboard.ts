import { apiRequest } from './http'
import type { DashboardStats } from './types'

export type DashboardFilters = { period?: 'week' | 'month' | 'term' }

export const getDashboard = (filters: DashboardFilters = {}) =>
  apiRequest<DashboardStats>('/api/dashboard', { query: filters })
