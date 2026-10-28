import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { apiHandler, conflict, parseBody, parseQuery } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { User } from '@/lib/models'
import { staffRoleToDb } from '@/lib/serialize'
import { decorateStaff } from '@/lib/staff'
import { scopedFilter, withTenant } from '@/lib/tenant'
import { paginated, paginationSchema, searchRegex } from '@/lib/validate'

/** /staff is admin/proprietor territory in the original route table. */
const ROLES = ['proprietor', 'admin'] as const

const Query = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  role: z.string().trim().max(60).optional(),
})

const namesList = z.array(z.string().trim().min(1).max(60)).max(30).optional()

const CreateBody = z.object({
  name: z.string().trim().min(2, 'Enter the staff member’s name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(200),
  role: z.string().trim().min(1, 'Choose a role').max(60),
  subjects: namesList,
  classes: namesList,
})

/** Filter labels ("Head of School") and raw values ("proprietor") both work. */
const roleFilterToDb = (value: string): string => {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('head') || normalized.includes('proprietor')) return 'proprietor'
  if (normalized.includes('admin') || normalized.includes('bursar')) return 'admin'
  if (normalized.includes('teacher')) return 'teacher'
  return normalized
}

/** GET /api/staff — paginated directory of staff accounts. */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const query = parseQuery(req, Query)

  const filter = scopedFilter(tenant)
  // Learners authenticate through the Student collection — never list them here.
  filter.role = { $in: ['proprietor', 'admin', 'teacher'] }
  if (query.q) filter.$or = [{ name: searchRegex(query.q) }, { email: searchRegex(query.q) }]
  if (query.role) filter.role = roleFilterToDb(query.role)

  const total = await User.countDocuments(filter)
  const docs = await User.find(filter)
    .collation({ locale: 'en', strength: 1 })
    .sort({ name: 1 })
    .skip((query.page - 1) * query.limit)
    .limit(query.limit)

  return paginated(await decorateStaff(tenant, docs), total, query.page, query.limit)
})

/** POST /api/staff — prepares an invited account (no usable password yet). */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, CreateBody)

  const email = input.email.toLowerCase()
  if (await User.exists({ email })) throw conflict('An account with that email already exists')

  const doc = await User.create({
    tenantId: tenant.tenantId,
    schoolIds: [tenant.schoolId],
    activeSchoolId: tenant.schoolId,
    name: input.name,
    email,
    // Unusable until an invite/reset flow sets a real password.
    passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
    role: staffRoleToDb(input.role),
    status: 'invited',
    subjectNames: input.subjects ?? [],
    classNames: input.classes ?? [],
  })

  return (await decorateStaff(tenant, [doc]))[0]
})
