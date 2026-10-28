import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, parseBody, parseQuery } from '@/lib/api'
import { parseDateOnly } from '@/lib/dates'
import { connectDB } from '@/lib/db'
import { Invoice, Student } from '@/lib/models'
import { invoiceStatusToDb, serializeInvoice } from '@/lib/serialize'
import { actorId, scopedFilter, withTenant } from '@/lib/tenant'
import {
  dateOnlySchema,
  paginated,
  paginationSchema,
  requireStudent,
  searchRegex,
} from '@/lib/validate'

/** /fees is admin/proprietor territory in the original route table. */
const ROLES = ['proprietor', 'admin'] as const

const Query = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
})

const CreateBody = z.object({
  studentId: z.string().trim().min(1, 'Choose a student'),
  amount: z.coerce.number().positive('Enter an amount').max(5_000_000_000),
  dueDate: dateOnlySchema,
  term: z.string().trim().max(60).optional(),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        amount: z.coerce.number().min(0).max(5_000_000_000),
      }),
    )
    .max(25)
    .optional(),
})

/** GET /api/invoices — paginated, searchable, school-scoped. */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const query = parseQuery(req, Query)

  const filter = scopedFilter(tenant)

  if (query.q) {
    const or: Record<string, unknown>[] = [{ number: searchRegex(query.q) }]
    const students = await Student.find({
      ...scopedFilter(tenant),
      $or: [{ name: searchRegex(query.q) }, { admissionNumber: searchRegex(query.q) }],
    })
      .select('_id')
      .limit(200)
      .lean()
    if (students.length) or.push({ studentId: { $in: students.map((doc) => doc._id) } })
    filter.$or = or
  }

  if (query.status) {
    const status = invoiceStatusToDb(query.status)
    if (status === 'paid') {
      filter.status = 'paid'
    } else if (status === 'overdue') {
      // Not yet settled *and* past its due date.
      filter.status = { $ne: 'paid' }
      filter.dueDate = { $lt: new Date() }
    } else {
      filter.status = { $ne: 'paid' }
      filter.dueDate = { $gte: new Date() }
    }
  }

  const total = await Invoice.countDocuments(filter)
  const docs = await Invoice.find(filter)
    .sort({ createdAt: -1 })
    .skip((query.page - 1) * query.limit)
    .limit(query.limit)

  const studentIds = [...new Set(docs.map((doc) => String(doc.studentId)))]
    .filter((value) => mongoose.isValidObjectId(value))
    .map((value) => new mongoose.Types.ObjectId(value))
  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } }).select('name').lean()
    : []
  const names = new Map(students.map((doc) => [String(doc._id), doc.name]))

  return paginated(
    docs.map((doc) =>
      serializeInvoice(doc, names.get(String(doc.studentId)) ?? 'Unknown student'),
    ),
    total,
    query.page,
    query.limit,
  )
})

/** POST /api/invoices */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })
  const input = await parseBody(req, CreateBody)

  const student = await requireStudent(tenant.tenantId, tenant.schoolId, input.studentId)

  const doc = await Invoice.create({
    tenantId: tenant.tenantId,
    schoolId: tenant.schoolId,
    studentId: student._id,
    items: input.items ?? [],
    amount: input.amount,
    dueDate: parseDateOnly(input.dueDate),
    status: 'pending',
    term: input.term ?? '',
    createdBy: actorId(tenant),
  })

  return serializeInvoice(doc, student.name)
})
