// POST /api/wallet-verify { reference } — called when the user returns from checkout.
// Asks Paystack directly (never trusts the browser) and credits the wallet once.
import { getAdminClient } from '../server/syncJobs.js'
import { getCaller, readJsonBody, withCors } from '../server/auth.js'
import { paystackConfigured, verifyTransaction } from '../server/payments/paystack.js'

export const config = { maxDuration: 30 }

export async function settlePayment(db, reference, data) {
  if (data?.status !== 'success') return { status: data?.status || 'pending' }
  const { data: pay } = await db.from('payments').select('amount, currency').eq('reference', reference).maybeSingle()
  if (!pay) return { status: 'unknown' }
  if (String(data.currency).toUpperCase() !== String(pay.currency).toUpperCase()) return { status: 'currency_mismatch' }
  const { data: result, error } = await db.rpc('credit_topup', { p_reference: reference, p_amount: data.amount, p_raw: data })
  if (error) throw error
  return { status: 'success', credited: result === 'credited' }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  if (!paystackConfigured()) return res.status(503).json({ error: 'Card payments are not set up.' })
  const db = getAdminClient()
  const caller = await getCaller(req, db)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })

  const { reference } = await readJsonBody(req)
  if (!/^afri_[a-f0-9]{32}$/.test(String(reference || ''))) return res.status(400).json({ error: 'Invalid reference' })
  const { data: pay } = await db.from('payments').select('user_id, status').eq('reference', reference).maybeSingle()
  if (!pay || pay.user_id !== caller.user.id) return res.status(404).json({ error: 'Payment not found' })
  if (pay.status === 'success') return res.status(200).json({ status: 'success' })

  try {
    const data = await verifyTransaction(reference)
    return res.status(200).json(await settlePayment(db, reference, data))
  } catch (e) {
    console.error('wallet-verify failed', e)
    return res.status(502).json({ error: 'Could not confirm the payment yet. If you were charged, your wallet will update automatically.' })
  }
}

export default withCors(handler)
