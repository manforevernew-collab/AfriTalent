// Paystack (https://paystack.com/docs/api) — card / bank / mobile-money top-ups.
// Test keys (sk_test_…) work without a live business account.
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'

const API = 'https://api.paystack.co'

export const paystackConfigured = () => /^sk_(test|live)_/.test(process.env.PAYSTACK_SECRET_KEY || '')

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.status === false) throw new Error(json.message || `Paystack HTTP ${res.status}`)
  return json.data
}

export const newReference = () => `afri_${randomUUID().replace(/-/g, '')}`

/** amount in minor units (kobo / pesewas / cents). */
export function initializeTransaction({ email, amount, currency, reference, callbackUrl, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({ email, amount, currency, reference, callback_url: callbackUrl, metadata }),
  })
}

export const verifyTransaction = reference => call(`/transaction/verify/${encodeURIComponent(reference)}`)

/** Webhook authenticity: HMAC-SHA512 of the raw body with the secret key. */
export function validWebhookSignature(rawBody, signature) {
  if (!paystackConfigured() || !signature) return false
  const expected = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature))
  return a.length === b.length && timingSafeEqual(a, b)
}
