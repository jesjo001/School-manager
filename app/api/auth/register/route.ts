import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { apiHandler, clientIp, conflict, parseBody } from '@/lib/api'
import { SESSION_COOKIE, sessionCookieOptions, signSession, type SessionPayload } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { School, Tenant, User } from '@/lib/models'
import { assertRateLimit } from '@/lib/ratelimit'
import { serializeSession } from '@/lib/serialize'
import { isRemoteImageUrl, saveSchoolLogoDataUrl } from '@/lib/storage'

const Body = z.object({
  schoolName: z.string().trim().min(2, 'Enter the school name').max(120),
  location: z.string().trim().min(2, 'Enter the school location').max(120),
  ownerName: z.string().trim().min(2, 'Enter your full name').max(120),
  email: z.string().trim().email('Enter a valid email address').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  /** Branding picked on the onboarding screen (stored inline for now). */
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Pick a valid colour')
    .optional(),
  /** Data-URL logo, capped at ~1 MB; file uploads move to lib/storage.ts in Phase 6. */
  logo: z.string().max(1_000_000, 'Logo must be smaller than 1MB').optional(),
})

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'school'

async function uniqueTenantSlug(name: string): Promise<string> {
  const base = slugify(name)
  let candidate = base
  for (let i = 2; i < 60; i++) {
    if (!(await Tenant.exists({ slug: candidate }))) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now().toString(36)}`
}

/**
 * Onboarding: creates the tenant, its first school, and the proprietor
 * account in one transaction-free but ordered flow.
 */
export const POST = apiHandler(async (req) => {
  const input = await parseBody(req, Body)
  await connectDB()
  await assertRateLimit('register-ip', clientIp(req), {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  }, 'Too many sign-up attempts from your network.')

  const email = input.email.toLowerCase()
  if (await User.exists({ email })) {
    throw conflict('An account with that email already exists')
  }

  const slug = await uniqueTenantSlug(input.schoolName)
  const tenant = await Tenant.create({
    name: input.schoolName,
    slug,
    settings: {
      contactEmail: email,
      ...(input.brandColor ? { brandColor: input.brandColor } : {}),
    },
  })

  const school = await School.create({
    tenantId: tenant._id,
    name: input.schoolName,
    location: input.location,
    slug,
    ...(input.brandColor ? { brandColor: input.brandColor } : {}),
  })

  // Logos never live in the database — move the data URL to disk storage now
  // that the school id exists (see lib/storage.ts).
  if (input.logo) {
    const logo = isRemoteImageUrl(input.logo)
      ? input.logo
      : await saveSchoolLogoDataUrl(String(school._id), input.logo)
    school.logo = logo
    await school.save()
  }

  const passwordHash = await bcrypt.hash(input.password, 10)
  const user = await User.create({
    tenantId: tenant._id,
    schoolIds: [school._id],
    activeSchoolId: school._id,
    name: input.ownerName,
    email,
    passwordHash,
    role: 'proprietor',
    lastLoginAt: new Date(),
  })

  tenant.ownerUserId = user._id
  await tenant.save()

  const payload: SessionPayload = {
    sub: String(user._id),
    kind: 'staff',
    role: 'proprietor',
    tenantId: String(tenant._id),
    schoolIds: [String(school._id)],
    activeSchoolId: String(school._id),
    name: user.name,
    email: user.email ?? undefined,
  }

  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession(payload), sessionCookieOptions())

  return serializeSession(payload, school)
})
