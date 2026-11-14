// POST /api/kyc-check  { kycId, country, idType, idNumber, fullName, dob, expiry, mrz }
// Called by the KYC form right after upload (user token), or by an admin to re-screen.
// The typed ID number is only used here — the database keeps last-4 + a keyed hash.

import { getAdminClient } from '../server/syncJobs.js'
import { getCaller, readJsonBody, withCors } from '../server/auth.js'
import { runKycCheck } from '../server/kyc/runCheck.js'

export const config = { maxDuration: 60 }

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  res.setHeader('Cache-Control', 'no-store')
  const db = getAdminClient()
  const caller = await getCaller(req, db)
  if (!caller) return res.status(401).json({ error: 'Please sign in again.' })

  const body = await readJsonBody(req)
  const kycId = Number(body.kycId)
  if (!Number.isInteger(kycId) || kycId <= 0) return res.status(400).json({ error: 'kycId required' })

  try {
    const result = await runKycCheck(db, {
      kycId,
      actorId: caller.user.id,
      actorIsAdmin: caller.isAdmin,
      fields: {
        country: str(body.country, 8), idType: str(body.idType, 40), idNumber: str(body.idNumber, 40),
        fullName: str(body.fullName, 120), dob: date(body.dob), expiry: date(body.expiry), mrz: str(body.mrz, 200),
      },
    })
    const { status, ...payload } = result
    return res.status(status).json(payload)
  } catch (e) {
    console.error('kyc-check failed', e)
    return res.status(500).json({ error: 'Automatic screening failed — your documents are saved and the team will review them.' })
  }
}

export default withCors(handler)
