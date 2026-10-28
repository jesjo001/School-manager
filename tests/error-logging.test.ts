import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, badRequest, errorResponse, redact } from '@/lib/api'

const req = new Request('http://localhost/api/students', { method: 'POST' })

const BCRYPT = '$2b$10$' + 'a'.repeat(31) + 'B'.repeat(22)
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
/** `NODE_ENV` is typed read-only, so tests poke it through the plain bag. */
const env = process.env as Record<string, string | undefined>
const ORIGINAL_ENV = env.NODE_ENV

afterEach(() => {
  vi.restoreAllMocks()
  env.NODE_ENV = ORIGINAL_ENV
})

describe('redaction', () => {
  it('strips bcrypt password hashes', () => {
    expect(redact(`Cast failed for value "${BCRYPT}"`)).not.toContain(BCRYPT)
    expect(redact(`hash=${BCRYPT}`)).toBe('hash=[redacted]')
  })

  it('strips session tokens', () => {
    expect(redact(`bad token ${JWT} in cookie`)).not.toContain(JWT)
  })

  it('strips secret-looking key/value pairs', () => {
    expect(redact('authorization: Bearer abc123')).toBe('authorization: [redacted]')
    expect(redact("passwordHash: '$2b$10$whatever'")).toBe('passwordHash: [redacted]')
  })

  it('leaves ordinary messages readable', () => {
    expect(redact('Cast to ObjectId failed for value "nope"')).toBe(
      'Cast to ObjectId failed for value "nope"',
    )
  })
})

describe('error responses', () => {
  it('never exposes an unexpected error to the client', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = errorResponse(new Error(`boom ${BCRYPT}`), req)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('keeps the thrown status and message for known errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(errorResponse(badRequest('Choose a class'), req).status).toBe(400)
    expect(errorResponse(new ApiError('That record already exists', 409), req).status).toBe(409)
    const body = await errorResponse(new ApiError('Not found', 404), req).json()
    expect(body).toEqual({ success: false, data: null, error: 'Not found' })
  })

  it('logs one line without a stack in production, and redacted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    env.NODE_ENV = 'production'

    errorResponse(new Error(`failed with ${BCRYPT}`), req)

    expect(spy).toHaveBeenCalledTimes(1)
    const line = String(spy.mock.calls[0]?.[0])
    expect(line).toContain('[api] POST /api/students')
    expect(line).not.toContain(BCRYPT)
    expect(line).not.toContain('\n') // no stack frames in production
  })
})
