// POST /api/kyc-specimen { path, label, country, docType, sourceUrl }   (admin only)
// Fingerprints an official specimen image the team uploaded to kyc/specimens/...
// Any later submission that is a copy of a specimen is auto-rejected.
// DELETE /api/kyc-specimen { id }

import { getAdminClient } from '../server/syncJobs.js'
import { getCaller, readJsonBody, withCors } from '../server/auth.js'
import { screenFile } from '../server/kyc/screenFile.js'

export const config = { maxDuration: 60 }

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const db = getAdminClient()
  const caller = await getCaller(req, db)
  if (!caller?.isAdmin) return res.status(401).json({ error: 'Admins only' })
  const body = await readJsonBody(req)

  if (req.method === 'DELETE') {
    const { error } = await db.from('kyc_specimens').delete().eq('id', Number(body.id))
    return error ? res.status(500).json({ error: error.message }) : res.status(200).json({ ok: true })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const path = String(body.path || '')
  if (!path.startsWith('specimens/')) return res.status(400).json({ error: 'Upload the specimen to kyc/specimens/ first' })
  const { data, error } = await db.storage.from('kyc').download(path)
  if (error) return res.status(404).json({ error: error.message })
  const file = await screenFile(Buffer.from(await data.arrayBuffer()), { declaredName: path })
  if (!file.hashes.length) return res.status(400).json({ error: 'Specimens must be JPG, PNG or WebP images.' })

  const row = {
    label: String(body.label || path.split('/').pop()).slice(0, 120),
    country: String(body.country || '').slice(0, 8) || null,
    doc_type: String(body.docType || '').slice(0, 40) || null,
    source_url: /^https?:\/\//.test(body.sourceUrl || '') ? String(body.sourceUrl).slice(0, 500) : null,
    storage_path: path,
    dhash: file.hashes[0],
    sha256: file.sha256,
    created_by: caller.user.id,
  }
  const { data: inserted, error: insErr } = await db.from('kyc_specimens').insert(row).select().single()
  if (insErr) return res.status(500).json({ error: insErr.message })
  return res.status(200).json(inserted)
}

export default withCors(handler)
