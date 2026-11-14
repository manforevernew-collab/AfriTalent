// POST /api/wallet-topup { amount }  (amount in major units, e.g. 5000 = ₦5,000)
// Starts a Paystack checkout and returns its URL. The wallet is credited only after
// Paystack confirms the payment (webhook or /api/wallet-verify).
import { getAdminClient } from '../server/syncJobs.js'
import { getCaller, readJsonBody, withCors } from '../server/auth.js'
import { paystackConfigured, initializeTransaction, newReference } from '../server/payments/paystack.js'

export const config = { maxDuration: 30 }

function siteOrigin(req) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, '')
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  if (!paystackConfigured()) return res.status(503).json({ error: 'Card payments are not set up yet. Please contact support to fund your wallet.' })

  const db = getAdminClient()
  const caller = await getCaller(req, db)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })

  const [{ data: profile }, { data: settings }] = await Promise.all([
    db.from('profiles').select('account_status').eq('id', caller.user.id).maybeSingle(),
    db.from('app_settings').select('currency, min_topup').eq('id', 1).single(),
  ])
  if (profile?.account_status !== 'active') return res.status(403).json({ error: 'Your account must be active to add funds.' })

  const body = await readJsonBody(req)
  const amount = Math.round(Number(body.amount) * 100)
  if (!Number.isFinite(amount) || amount < settings.min_topup || amount > 1_000_000_000) {
    return res.status(400).json({ error: `Enter an amount of at least ${settings.min_topup / 100}.` })
  }

  const reference = newReference()
  const { error: insErr } = await db.from('payments').insert({ user_id: caller.user.id, reference, amount, currency: settings.currency })
  if (insErr) return res.status(500).json({ error: 'Could not start the payment.' })

  try {
    const data = await initializeTransaction({
      email: caller.user.email, amount, currency: settings.currency, reference,
      callbackUrl: `${siteOrigin(req)}/dashboard?tab=wallet&ref=${reference}`,
      metadata: { user_id: caller.user.id, purpose: 'wallet_topup' },
    })
    return res.status(200).json({ authorization_url: data.authorization_url, reference })
  } catch (e) {
    await db.from('payments').update({ status: 'failed', raw: { error: e.message } }).eq('reference', reference)
    return res.status(502).json({ error: `Payment provider error: ${e.message}` })
  }
}

export default withCors(handler)
