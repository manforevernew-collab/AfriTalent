// Vercel Serverless Function: GET/POST /api/sync-jobs
//
// Triggered hourly by the Vercel cron in vercel.json (and/or the GitHub Actions
// workflow). Also callable by a signed-in admin from the Admin dashboard.
//
// Authorised when either:
//   - Authorization: Bearer <CRON_SECRET>      (Vercel cron sends this automatically)
//   - Authorization: Bearer <supabase access token> belonging to a profile with role = 'admin'

import { syncJobs } from '../server/syncJobs.js'
import { isCronOrAdmin, withCors } from '../server/auth.js'

export const config = { maxDuration: 300 }

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  res.setHeader('Cache-Control', 'no-store')
  if (!(await isCronOrAdmin(req))) return res.status(401).json({ error: 'Unauthorised' })

  try {
    const summary = await syncJobs()
    return res.status(summary.status === 'error' ? 500 : 200).json(summary)
  } catch (e) {
    console.error('sync-jobs failed', e)
    return res.status(500).json({ status: 'error', error: 'Sync failed — see function logs' })
  }
}

export default withCors(handler)
