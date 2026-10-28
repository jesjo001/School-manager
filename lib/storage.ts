import { createHash } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { badRequest } from '@/lib/api'

/**
 * School branding assets (logos) live on disk under `public/uploads`, never in
 * MongoDB — the database keeps only the public URL. Every upload is validated
 * for type and size before a byte is written.
 */

export const MAX_LOGO_BYTES = 1_000_000 // 1 MB
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
}

export const isAllowedLogoType = (type: string) =>
  ALLOWED_LOGO_TYPES.includes((type || '').split(';')[0]!.trim().toLowerCase())

const uploadDir = () => path.join(process.cwd(), 'public', 'uploads', 'schools')

async function storeLogo(schoolId: string, type: string, bytes: Buffer): Promise<string> {
  if (!isAllowedLogoType(type)) throw badRequest('Upload a PNG, JPEG, WebP or SVG logo')
  if (!bytes.length) throw badRequest('That file is empty')
  if (bytes.length > MAX_LOGO_BYTES) throw badRequest('Logos must be 1MB or smaller')

  const normalized = (type || '').split(';')[0]!.trim().toLowerCase()
  if (normalized === 'image/svg+xml') {
    // SVG is markup: refuse anything that could execute in a browser.
    const svg = bytes.toString('utf8')
    if (/<script|on\w+\s*=|javascript:/i.test(svg)) {
      throw badRequest('That SVG contains active content and was rejected')
    }
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const filename = `${schoolId.replace(/[^a-zA-Z0-9_-]/g, '')}-${hash}${EXTENSIONS[normalized]}`
  await mkdir(uploadDir(), { recursive: true })
  await writeFile(path.join(uploadDir(), filename), bytes)
  return `/uploads/schools/${filename}`
}

/** Store a browser `File` (multipart upload) and return its public URL. */
export async function saveSchoolLogo(schoolId: string, file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())
  return storeLogo(schoolId, file.type, bytes)
}

/** Store a `data:image/...;base64,...` URL (used by registration/profile edits). */
export async function saveSchoolLogoDataUrl(
  schoolId: string,
  dataUrl: string,
): Promise<string> {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim())
  if (!match) throw badRequest('Logo must be an uploaded image or a valid image data URL')
  const bytes = Buffer.from(match[2]!, 'base64')
  return storeLogo(schoolId, match[1]!, bytes)
}

/** True when the value is a plain (absolute or site-relative) image URL. */
export const isRemoteImageUrl = (value: string) =>
  /^https?:\/\/\S+$/i.test(value) || (/^\/(?!\/)\S*$/.test(value) && !value.startsWith('/api/'))
