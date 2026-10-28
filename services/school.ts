/**
 * The single client-side API surface for CampusFlow.
 *
 * Everything the UI needs to talk to the backend is re-exported from here, so
 * components import from `@/services/school` exactly as they did when the app
 * was a mock. The mock arrays below are transitional (see `./seeds`) and are
 * removed once every screen is wired to the query hooks in Phase 6.
 */

/* ------------------------------- view models ------------------------------ */
export * from './types'

/* ------------------------------ API functions ----------------------------- */
export * from './auth'
export * from './schools'
export * from './students'
export * from './staff'
export * from './classes'
export * from './attendance'
export * from './fees'
export * from './exams'
export * from './dashboard'
export { ApiError, apiRequest, apiUpload } from './http'

/* --------------------------- transitional dataset ------------------------- */
export * from './seeds'

/* ------------------------- local preference helpers ----------------------- */
/**
 * Small localStorage helpers used for UI-only preferences (dark mode,
 * notification toggles, billing plan preview). School/role/permission data is
 * NOT stored here any more — it comes from the session cookie.
 */
export const schoolStorageKey = (schoolId: string, key: string) => `campusflow:${schoolId}:${key}`

export const schoolSeed = <T,>(schoolId: string, seed: T): T =>
  schoolId === 'school-1' || schoolId === 'school-2' ? seed : ([] as unknown as T)

const demoSeedKeys = new Set([
  'campus-students',
  'campus-staff',
  'campus-classes',
  'campus-invoices',
  'campus-exams',
  'campus-grading-queue',
])

let activeSchoolId = 'school-1'

export const setActiveSchoolId = (schoolId: string) => {
  activeSchoolId = schoolId
}

const scopedKey = (key: string) => {
  if (key.startsWith('campusflow:') || ['campus-role', 'campus-school', 'campus-dark'].includes(key)) return key
  return schoolStorageKey(activeSchoolId, key)
}

export const loadLocal = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(scopedKey(key))
    if (raw) return JSON.parse(raw) as T
    const current = JSON.parse(localStorage.getItem('campus-school') || 'null') as { id?: string } | null
    if (current?.id && !['school-1', 'school-2'].includes(current.id) && demoSeedKeys.has(key)) {
      return [] as unknown as T
    }
    return fallback
  } catch {
    return fallback
  }
}

export const saveLocal = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(scopedKey(key), JSON.stringify(value))
}

/* ------------------------------- formatting ------------------------------- */
export const money = (n: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(n)
