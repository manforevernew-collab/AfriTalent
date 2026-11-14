// POST /api/paystack-webhook — set this URL in Paystack → Settings → API Keys & Webhooks.
// Credits wallets even if the user closes the browser before returning to the site.
import { getAdminClient } from '../server/syncJobs.js'
import { validWebhookSignature, verifyTransaction } from '../server/payments/paystack.js'
import { settlePayment } from './wallet-verify.js'

export const config = { maxDuration: 30 }

async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8')
  let data = ''
  for await (const chunk of req) data += chunk
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const raw = await rawBody(req)
  if (!validWebhookSignature(raw, req.headers['x-paystack-signature'])) return res.status(401).end()

  let event
  try { event = JSON.parse(raw) } catch { return res.status(400).end() }
  if (event.event !== 'charge.success' || !/^afri_/.test(event.data?.reference || '')) return res.status(200).json({ ignored: true })

  try {
    // Re-verify with the API rather than trusting the payload alone
    const data = await verifyTransaction(event.data.reference)
    const result = await settlePayment(getAdminClient(), event.data.reference, data)
    return res.status(200).json(result)
  } catch (e) {
    console.error('paystack webhook failed', e)
    return res.status(500).end() // Paystack retries
  }
}
