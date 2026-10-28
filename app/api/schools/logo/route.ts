import { apiHandler, badRequest } from '@/lib/api'
import { connectDB } from '@/lib/db'
import { School } from '@/lib/models'
import { saveSchoolLogo } from '@/lib/storage'
import { withTenant } from '@/lib/tenant'

/**
 * POST /api/schools/logo — multipart upload of the school logo. The file is
 * validated and written to `public/uploads` by lib/storage.ts; only the
 * resulting public URL is stored on the school record.
 */
export const POST = apiHandler(async (req) => {
  await connectDB()
  const ctx = await withTenant(req, { roles: ['proprietor', 'admin'] })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw badRequest('Send the logo as multipart/form-data')
  }

  const file = form.get('file')
  if (!file || typeof file === 'string') throw badRequest('Attach a logo file')

  const url = await saveSchoolLogo(ctx.schoolId, file)
  const doc = await School.findOneAndUpdate(
    { _id: ctx.schoolId, tenantId: ctx.tenantId },
    { $set: { logo: url } },
    { new: true },
  )
  if (!doc) throw badRequest('School not found')

  return { url }
})
