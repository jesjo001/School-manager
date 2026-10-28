import mongoose from 'mongoose'
import { z } from 'zod'
import { apiHandler, badRequest, parseBody } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { School } from '@/lib/models'
import { serializeSchool } from '@/lib/serialize'
import { loadSchoolStats } from '@/lib/stats'
import { isRemoteImageUrl, saveSchoolLogoDataUrl } from '@/lib/storage'
import { withTenant } from '@/lib/tenant'

/**
 * The schools this session may act for. Membership comes from the database
 * (re-validated by `withTenant`) — the request carries no tenant input at all.
 */
export const GET = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req)

  const ids = ctx.session.schoolIds.filter((id) => mongoose.isValidObjectId(id))
  if (!ids.length) return []

  const docs = await School.find({
    _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    tenantId: ctx.tenantId,
  }).sort({ name: 1 })

  const stats = await loadSchoolStats(
    ctx.tenantId,
    docs.map((doc) => String(doc._id)),
  )

  return docs.map((doc) => serializeSchool(doc, stats.get(String(doc._id)) ?? {}))
})

const PatchBody = z.object({
  name: z.string().trim().min(2, 'Enter the school name').max(120).optional(),
  location: z.string().trim().max(160).optional(),
  brandColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #7479e8')
    .optional(),
  logo: z.string().trim().max(2_000_000).optional(),
})

/** PATCH /api/schools — school profile (branding) edits. */
export const PATCH = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req, { roles: ['proprietor', 'admin'] })
  const input = await parseBody(req, PatchBody)

  const update: Record<string, unknown> = {}
  if (input.name !== undefined) update.name = input.name
  if (input.location !== undefined) update.location = input.location
  if (input.brandColor !== undefined) update.brandColor = input.brandColor
  if (input.logo !== undefined) {
    if (isRemoteImageUrl(input.logo)) {
      update.logo = input.logo
    } else if (input.logo.startsWith('data:image/')) {
      // Normalise data URLs to a stored file so the DB never holds images.
      update.logo = await saveSchoolLogoDataUrl(ctx.schoolId, input.logo)
    } else if (input.logo === '') {
      update.logo = ''
    } else {
      throw badRequest('Logo must be an image URL or an uploaded image')
    }
  }

  const doc = await School.findOneAndUpdate(
    { _id: ctx.schoolId, tenantId: ctx.tenantId },
    { $set: update },
    { new: true },
  )
  if (!doc) throw badRequest('School not found')

  const stats = await loadSchoolStats(ctx.tenantId, [String(doc._id)])
  return serializeSchool(doc, stats.get(String(doc._id)) ?? {})
})
