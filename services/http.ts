/**
 * Single HTTP client for the CampusFlow frontend.
 * Every service module goes through `apiRequest`, which understands the
 * `{ success, data, error }` envelope used by all /api route handlers.
 */

export type ApiEnvelope<T> = {
  success: boolean
  data?: T
  error?: string | null
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type RequestOptions = Omit<RequestInit, 'body'> & {
  /** JSON body — serialised automatically. */
  body?: unknown
  /** Query string parameters. `undefined` / `null` / `''` values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options
  const response = await fetch(buildUrl(path, query), {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : null),
      ...(headers ?? null),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })

  let payload: ApiEnvelope<T> | null = null
  try {
    payload = (await response.json()) as ApiEnvelope<T>
  } catch {
    payload = null
  }

  if (!response.ok || !payload?.success) {
    const message = payload?.error ?? `Request failed (${response.status})`
    throw new ApiError(message, response.status)
  }

  return payload.data as T
}

/** `FormData` upload helper (school logo, etc.). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' })
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
  if (!response.ok || !payload?.success) {
    throw new ApiError(payload?.error ?? `Upload failed (${response.status})`, response.status)
  }
  return payload.data as T
}
