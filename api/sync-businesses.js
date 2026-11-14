// GET/POST /api/sync-businesses — daily cron (vercel.json) or an admin.
import { syncBusinesses } from '../server/business/syncBusinesses.js'
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
    // 3 cities keeps one invocation safely under the 300 s limit
    const summary = await syncBusinesses({ perRun: Number(process.env.BUSINESS_CITIES_PER_RUN) || 3 })
    return res.status(summary.status === 'error' ? 500 : 200).json(summary)
  } catch (e) {
    console.error('sync-businesses failed', e)
    return res.status(500).json({ status: 'error', error: 'Sync failed — see function logs' })
  }
}

export default withCors(handler)
