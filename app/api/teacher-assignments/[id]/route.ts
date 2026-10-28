import mongoose from 'mongoose'
import { apiHandler, notFound, param } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { TeacherAssignment } from '@/lib/models'
import { scopedFilter, withTenant } from '@/lib/tenant'

const ROLES = ['proprietor', 'admin', 'teacher'] as const

/** DELETE /api/teacher-assignments/[id] */
export const DELETE = apiHandler(async (req, ctx) => {
  const id = await param(ctx, 'id')
  await connectDB()
  const tenant = await withTenant(req, { roles: [...ROLES] })

  if (!mongoose.isValidObjectId(id)) throw notFound('Assignment not found')

  const result = await TeacherAssignment.deleteOne(scopedFilter(tenant, { _id: id }))
  if (!result.deletedCount) throw notFound('Assignment not found')
  return { ok: true as const }
})
