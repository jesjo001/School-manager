import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getPaymentProvider, isValidWebhookSignature } from '@/lib/payments/provider'

const KEY = 'sk_test_campusflow_secret'
const BODY = JSON.stringify({
  event: 'charge.success',
  data: { reference: 'cf_lk9f2p_4a7b', amount: 12000000, channel: 'card' },
})

/** What Paystack puts in `x-paystack-signature`: HMAC-SHA512(rawBody, secret). */
const sign = (body: string, key = KEY) => createHmac('sha512', key).update(body).digest('hex')

describe('Paystack webhook signature', () => {
  it('accepts a body signed with the configured key', () => {
    expect(isValidWebhookSignature(BODY, sign(BODY), KEY)).toBe(true)
  })

  it('tolerates whitespace around the header value', () => {
    expect(isValidWebhookSignature(BODY, `  ${sign(BODY)}\n`, KEY)).toBe(true)
  })

  it('rejects a signature made with a different secret', () => {
    expect(isValidWebhookSignature(BODY, sign(BODY, 'sk_test_someone_else'), KEY)).toBe(false)
  })

  it('rejects a body that was altered after signing', () => {
    const signature = sign(BODY)
    const tampered = BODY.replace('12000000', '1')
    expect(tampered).not.toBe(BODY)
    expect(isValidWebhookSignature(tampered, signature, KEY)).toBe(false)
  })

  it('rejects a missing, empty or padded-to-the-wrong-length signature', () => {
    expect(isValidWebhookSignature(BODY, null, KEY)).toBe(false)
    expect(isValidWebhookSignature(BODY, '', KEY)).toBe(false)
    expect(isValidWebhookSignature(BODY, sign(BODY).slice(0, 40), KEY)).toBe(false)
  })

  it('rejects everything when no gateway key is configured', () => {
    expect(isValidWebhookSignature(BODY, sign(BODY), '')).toBe(false)
    expect(isValidWebhookSignature(BODY, sign(BODY), '   ')).toBe(false)
  })

  it('the configured provider rejects unsigned pushes', () => {
    // With `PAYSTACK_SECRET_KEY` unset the app runs the simulated provider,
    // which must never trust a webhook — the route answers 401 and the invoice
    // stays as it was.
    const provider = getPaymentProvider()
    const configured = Boolean(process.env.PAYSTACK_SECRET_KEY?.trim())
    if (!configured) {
      expect(provider.live).toBe(false)
      expect(provider.verifyWebhookSignature(BODY, sign(BODY))).toBe(false)
      expect(provider.verifyWebhookSignature(BODY, null)).toBe(false)
    } else {
      expect(provider.verifyWebhookSignature(BODY, sign(BODY))).toBe(true)
      expect(provider.verifyWebhookSignature(BODY, null)).toBe(false)
    }
  })
})
