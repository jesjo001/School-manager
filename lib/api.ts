import { NextResponse, type NextRequest } from 'next/server'
import { ZodError, type ZodTypeAny, type z } from 'zod'

/**
 * Central API plumbing: the `{ success, data, error }` envelope, Zod body/query
 * parsing, and one place that turns thrown errors into responses (no stack
 * traces or internal details ever leave this function).
 */

export type Envelope<T> = { success: boolean; data: T | null; error: string | null }

/** Thrown by handlers to produce a specific HTTP status + message. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const badRequest = (message: string) => new ApiError(message, 400)
export const unauthorized = (message = 'You need to sign in to continue') =>
  new ApiError(message, 401)
export const forbidden = (message = 'You do not have permission to do that') =>
  new ApiError(message, 403)
export const notFound = (message = 'Not found') => new ApiError(message, 404)
export const conflict = (message: string) => new ApiError(message, 409)
export const tooManyRequests = (message: string) => new ApiError(message, 429)

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json<Envelope<T>>({ success: true, data, error: null }, init)
}

export function fail(error: string, status: number, init?: ResponseInit): NextResponse {
  return NextResponse.json<Envelope<null>>(
    { success: false, data: null, error },
    { status, ...init },
  )
}

function messageFromZod(err: ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'Invalid request'
  const path = issue.path.join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/** Parse a JSON body (or query object) with Zod; throws a 400 ApiError. */
export async function parseBody<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw badRequest('Request body must be valid JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) throw badRequest(messageFromZod(result.error))
  return result.data
}

/** Validate query-string params with Zod (missing/empty values are dropped). */
export function parseQuery<S extends ZodTypeAny>(req: Request, schema: S): z.infer<S> {
  const url = new URL(req.url)
  const raw: Record<string, string> = {}
  for (const [key, value] of url.searchParams) if (value !== '') raw[key] = value
  const result = schema.safeParse(raw)
  if (!result.success) throw badRequest(messageFromZod(result.error))
  return result.data
}

/**
 * Values that must never reach a log line: password hashes, session tokens and
 * anything driver errors hand back under a sensitive-looking key.
 */
const SENSITIVE_PATTERNS: { re: RegExp; with: string }[] = [
  { re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, with: '[redacted]' }, // bcrypt hash
  { re: /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w.-]+/g, with: '[redacted]' }, // JWT
  {
    re: /\b(password[\w-]*|secret[\w-]*|token[\w-]*|cookie[\w-]*|authorization[\w-]*)(["'\s:=]+).+/gi,
    with: '$1: [redacted]',
  }, // key: value (everything after it)
]

export const redact = (value: string): string =>
  SENSITIVE_PATTERNS.reduce((text, rule) => text.replace(rule.re, rule.with), value)

/**
 * One-line server log for a failed request. Stacks are logged in development
 * only; production logs stay free of internal detail (per spec).
 */
function logError(err: unknown, req: Request) {
  const name = err instanceof Error ? err.name : 'UnknownError'
  const message = redact(err instanceof Error ? err.message : String(err))
  const path = new URL(req.url).pathname
  const line = `[api] ${req.method} ${path} → ${name}: ${message}`
  if (process.env.NODE_ENV !== 'production') {
    const stack = err instanceof Error && err.stack ? `\n${err.stack.split('\n').slice(1, 4).join('\n')}` : ''
    console.error(line + stack)
  } else {
    console.error(line)
  }
}

export function errorResponse(err: unknown, req: Request): NextResponse {
  if (err instanceof ZodError) return fail(messageFromZod(err), 400)
  if (err instanceof ApiError) return fail(err.message, err.status)

  // Mongo duplicate key → friendly conflict.
  const code = (err as { code?: number } | null)?.code
  if (code === 11000) {
    return fail('That record already exists', 409)
  }

  logError(err, req)
  return fail('Something went wrong. Please try again.', 500)
}

export type RouteContext = { params: Promise<Record<string, string | string[]>> }

/**
 * Read one dynamic segment as a plain string (Next may hand back `string[]`
 * for repeated segments).
 */
export async function param(ctx: RouteContext, key: string): Promise<string> {
  const params = await ctx.params
  const value = params[key]
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

/**
 * Wraps a route handler so it can either return its payload (auto-enveloped)
 * or a `NextResponse` directly. Every thrown error becomes a proper envelope.
 */
export function apiHandler<T>(
  handler: (req: NextRequest, ctx: RouteContext) => Promise<T | NextResponse>,
) {
  return async (req: NextRequest, ctx: RouteContext): Promise<NextResponse> => {
    try {
      const result = await handler(req, ctx)
      if (result instanceof Response) return result
      return ok(result as T)
    } catch (err) {
      return errorResponse(err, req)
    }
  }
}

/** Client IP (best effort — first hop of x-forwarded-for). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
