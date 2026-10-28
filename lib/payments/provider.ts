import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Payment gateway abstraction.
 *
 * The whole app talks to `getPaymentProvider()`; Paystack is one implementation
 * behind it. When `PAYSTACK_SECRET_KEY` is not configured the app falls back to
 * a simulated provider so local development never depends on network access —
 * `live: false` tells the UI it is running against the simulation.
 */

export type InitializeInput = {
  reference: string
  /** Naira — the provider converts to the gateway's minor unit (kobo). */
  amount: number
  email: string
  callbackUrl?: string
  metadata?: Record<string, unknown>
}

export type InitializeResult = {
  reference: string
  authorizationUrl: string
  amount: number
}

export type VerifyResult = {
  status: 'success' | 'failed' | 'pending' | 'abandoned'
  /** Naira as reported by the gateway; `null` when the gateway reports none (simulation). */
  amount: number | null
  paidAt: Date | null
  channel: string
  raw: Record<string, unknown>
}

export type PaymentProvider = {
  readonly name: string
  /** `false` → local simulation (no gateway keys configured). */
  readonly live: boolean
  initialize(input: InitializeInput): Promise<InitializeResult>
  verify(reference: string): Promise<VerifyResult>
  /** Webhook bodies are signed with HMAC over the *raw* payload. */
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean
}

const PAYSTACK_BASE = 'https://api.paystack.co'
const secret = () => process.env.PAYSTACK_SECRET_KEY?.trim() ?? ''

const appUrl = () =>
  (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')

/** Absolute URL of the app, for gateway callback/redirect targets. */
export const appBaseUrl = (path = '/fees') => `${appUrl()}${path.startsWith('/') ? path : `/${path}`}`

const toKobo = (naira: number) => Math.round(naira * 100)
const fromKobo = (kobo: number) => Math.round(kobo) / 100

/**
 * Paystack signs webhook bodies with `HMAC-SHA512(rawBody, secret)`.
 * Exported so the signature check can be unit-tested without a live key.
 */
export function isValidWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  key: string,
): boolean {
  if (!signature || !key) return false
  const expected = createHmac('sha512', key).update(rawBody).digest('hex')
  const provided = signature.trim()
  if (expected.length !== provided.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided))
}

type PaystackStatus = 'success' | 'failed' | 'pending' | 'abandoned'

const normalizeStatus = (value: unknown): PaystackStatus => {
  const status = String(value ?? '').toLowerCase()
  if (status === 'success') return 'success'
  if (status === 'failed' || status === 'reverted' || status === 'declined') return 'failed'
  if (status === 'abandoned') return 'abandoned'
  return 'pending'
}

/** Paystack's own implementation — used whenever a secret key is configured. */
class PaystackProvider implements PaymentProvider {
  readonly name = 'paystack'
  readonly live = true

  private headers() {
    return { authorization: `Bearer ${secret()}`, 'content-type': 'application/json' }
  }

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        email: input.email,
        amount: toKobo(input.amount),
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
      cache: 'no-store',
    })

    const body = (await response.json().catch(() => null)) as {
      status?: boolean
      message?: string
      data?: { authorization_url?: string }
    } | null

    if (!response.ok || !body?.status || !body.data?.authorization_url) {
      throw new Error(body?.message ?? `Payment gateway error (${response.status})`)
    }

    return {
      reference: input.reference,
      authorizationUrl: body.data.authorization_url,
      amount: input.amount,
    }
  }

  async verify(reference: string): Promise<VerifyResult> {
    const response = await fetch(
      `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: this.headers(), cache: 'no-store' },
    )
    const body = (await response.json().catch(() => null)) as {
      status?: boolean
      message?: string
      data?: Record<string, unknown>
    } | null

    if (!response.ok || !body?.status || !body.data) {
      throw new Error(body?.message ?? `Payment verification failed (${response.status})`)
    }

    const data = body.data
    return {
      status: normalizeStatus(data.status),
      amount: typeof data.amount === 'number' ? fromKobo(data.amount) : null,
      paidAt: data.paid_at ? new Date(String(data.paid_at)) : null,
      channel: String(data.channel ?? 'paystack'),
      raw: data,
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
    return isValidWebhookSignature(rawBody, signature, secret())
  }
}

/**
 * Local simulation: no network, no keys. Verification always succeeds, which is
 * what lets the whole fees flow be exercised end-to-end offline.
 * Webhooks are still rejected (no key → no signature to trust).
 */
class SimulatedProvider implements PaymentProvider {
  readonly name = 'simulated'
  readonly live = false

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    return {
      reference: input.reference,
      authorizationUrl: `${appUrl()}/fees?reference=${encodeURIComponent(input.reference)}`,
      amount: input.amount,
    }
  }

  async verify(reference: string): Promise<VerifyResult> {
    return {
      status: 'success',
      amount: null,
      paidAt: new Date(),
      channel: 'test',
      raw: { simulated: true, reference },
    }
  }

  verifyWebhookSignature(): boolean {
    return false
  }
}

let cached: PaymentProvider | null = null

export function getPaymentProvider(): PaymentProvider {
  // Memoised, but a key added at runtime (tests) still takes effect on restart.
  if (!cached) cached = secret() ? new PaystackProvider() : new SimulatedProvider()
  return cached
}

/** Gateway-agnostic, collision-resistant reference (`paystackRef` is unique). */
export function newReference(): string {
  const stamp = Date.now().toString(36)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `cf_${stamp}_${suffix}`.slice(0, 64)
}
