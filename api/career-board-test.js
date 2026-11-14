// POST /api/career-board-test { provider, slug, scope }  (admin only)
// Checks that an employer's public ATS board exists before it is added.
import { getCaller, readJsonBody, withCors } from '../server/auth.js'
import { fetchBoard, PROVIDERS } from '../server/careerBoards.js'

export const config = { maxDuration: 30 }

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }) }
  const caller = await getCaller(req)
  if (!caller?.isAdmin) return res.status(401).json({ error: 'Admins only' })
  const { provider, slug, scope = 'all' } = await readJsonBody(req)
  if (!PROVIDERS.includes(provider) || !/^[A-Za-z0-9._-]{1,80}$/.test(String(slug || ''))) {
    return res.status(400).json({ error: 'Choose a provider and enter the board name from the careers URL.' })
  }
  try {
    const r = await fetchBoard({ provider, slug, scope })
    return res.status(200).json({
      ok: true, total: r.total, kept: r.kept,
      company: r.jobs[0]?.company || null,
      sample: r.jobs.slice(0, 5).map(j => ({ title: j.title, location: j.location })),
    })
  } catch (e) {
    return res.status(200).json({ ok: false, error: /404/.test(e.message) ? 'No public board found with that name.' : e.message })
  }
}

export default withCors(handler)
