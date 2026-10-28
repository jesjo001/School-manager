import mongoose from 'mongoose'
import { z } from 'zod'
import { badRequest } from './api'
import { Invoice, SchoolClass, Student } from './models'

/** Query/body primitives shared by every resource route. */

export const objectIdSchema = (label = 'id') =>
  z
    .string()
    .refine((value) => mongoose.isValidObjectId(value), { message: `${label} is not a valid id` })

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  // Shape alone would let `2026-13-99` roll over into 2027 — require a real day.
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const probe = new Date(Date.UTC(year, month - 1, day))
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  }, 'That date does not exist')

/** `page` / `limit` arrive as query strings — coerce and bound them. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type Paginated<T> = { items: T[]; total: number; page: number; limit: number }

export const paginated = <T>(items: T[], total: number, page: number, limit: number): Paginated<T> => ({
  items,
  total,
  page,
  limit,
})

/** Free-text search is turned into a *literal* (escaped) case-insensitive match. */
export const searchRegex = (value: string) =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim(), 'i')

/** Section letters for a class: 3 → ["A","B","C"]. */
export const sectionLetters = (count: number): string[] =>
  Array.from({ length: Math.max(1, Math.min(26, Math.trunc(count) || 1)) }, (_, index) =>
    String.fromCharCode(65 + index),
  )

/**
 * Scope lookups that a request claims to reference. Every one of these throws
 * a 400/404 instead of letting a foreign id leak into a query.
 */
export async function requireClass(tenantId: string, schoolId: string, classId: string) {
  if (!mongoose.isValidObjectId(classId)) throw badRequest('That class does not exist')
  const doc = await SchoolClass.findOne({ _id: classId, tenantId, schoolId })
  if (!doc) throw badRequest('That class does not belong to this school')
  return doc
}

export async function requireStudent(tenantId: string, schoolId: string, studentId: string) {
  if (!mongoose.isValidObjectId(studentId)) throw badRequest('That student does not exist')
  const doc = await Student.findOne({ _id: studentId, tenantId, schoolId })
  if (!doc) throw badRequest('That student does not belong to this school')
  return doc
}

export async function requireInvoice(tenantId: string, schoolId: string, invoiceId: string) {
  if (!mongoose.isValidObjectId(invoiceId)) throw badRequest('That invoice does not exist')
  const doc = await Invoice.findOne({ _id: invoiceId, tenantId, schoolId })
  if (!doc) throw badRequest('That invoice does not belong to this school')
  return doc
}

/** Next free `ADM-0001` style number inside one school. */
export async function nextAdmissionNumber(tenantId: string, schoolId: string): Promise<string> {
  const seed = (await Student.countDocuments({ tenantId, schoolId })) + 1
  for (let n = seed; n < seed + 100; n++) {
    const candidate = `ADM-${String(n).padStart(4, '0')}`
    if (!(await Student.exists({ schoolId, admissionNumber: candidate }))) return candidate
  }
  return `ADM-${Date.now().toString(36).toUpperCase()}`
}
