import { SignJWT, jwtVerify } from 'jose'

/**
 * Pure token layer (no `next/headers`, no Node APIs) so it can be imported by
 * `middleware.ts` on the edge runtime as well as by route handlers.
 */

export const SESSION_COOKIE = 'cf_session'

export type DbRole = 'proprietor' | 'admin' | 'teacher' | 'student'
export type UiRole = 'Proprietor' | 'Admin' | 'Teacher' | 'Student'

export type SessionPayload = {
  /** User id (staff) or Student id (learners). */
  sub: string
  kind: 'staff' | 'student'
  role: DbRole
  tenantId: string
  schoolIds: string[]
  activeSchoolId: string
  name: string
  email?: string
}

const SECRET = () => {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not configured')
  return new TextEncoder().encode(secret)
}

/** `'7d' | '12h' | '30m' | '45s'` → seconds. */
export function parseExpiry(value: string): number {
  const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim())
  if (!m) return 7 * 24 * 60 * 60
  const amount = Number(m[1])
  const unit = (m[2] ?? 'd').toLowerCase()
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400
  return amount * factor
}

export const sessionMaxAge = () => parseExpiry(process.env.JWT_EXPIRES_IN ?? '7d')

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAge()}s`)
    .sign(SECRET())
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET(), { algorithms: ['HS256'] })
    if (!payload.sub || !payload.tenantId || !payload.activeSchoolId) return null
    if (payload.kind !== 'staff' && payload.kind !== 'student') return null
    return {
      sub: String(payload.sub),
      kind: payload.kind,
      role: payload.role as DbRole,
      tenantId: String(payload.tenantId),
      schoolIds: Array.isArray(payload.schoolIds) ? payload.schoolIds.map(String) : [],
      activeSchoolId: String(payload.activeSchoolId),
      name: String(payload.name ?? ''),
      email: payload.email ? String(payload.email) : undefined,
    }
  } catch {
    return null
  }
}

/** Cookie attributes shared by login/register/switch/logout. */
export function sessionCookieOptions(maxAge = sessionMaxAge()) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }
}

export const toUiRole = (role: DbRole): UiRole =>
  role === 'proprietor'
    ? 'Proprietor'
    : role === 'admin'
      ? 'Admin'
      : role === 'teacher'
        ? 'Teacher'
        : 'Student'

export const toDbRole = (role: string): DbRole => role.toLowerCase() as DbRole

/** Landing page per role (mirrors the original WorkspaceRoute table). */
export const ROLE_HOME: Record<DbRole, string> = {
  proprietor: '/',
  admin: '/',
  teacher: '/dashboard',
  student: '/exams',
}
