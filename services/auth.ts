import { apiRequest } from './http'
import type { Session } from './types'

export type LoginInput = { email: string; password: string }

export type RegisterInput = {
  schoolName: string
  location: string
  ownerName: string
  email: string
  password: string
  /** Branding picked on onboarding (optional; stored on the School/Tenant). */
  brandColor?: string
  logo?: string
}

export type StudentLoginInput = {
  /** School e-mail **or** admission number — both resolve the learner. */
  identifier: string
  password: string
}

export const login = (input: LoginInput) => apiRequest<Session>('/api/auth/login', { method: 'POST', body: input })

export const register = (input: RegisterInput) =>
  apiRequest<Session>('/api/auth/register', { method: 'POST', body: input })

export const logout = () => apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' })

export const fetchSession = () => apiRequest<Session | null>('/api/auth/me')

export const studentLogin = (input: StudentLoginInput) =>
  apiRequest<Session>('/api/auth/student-login', { method: 'POST', body: input })
