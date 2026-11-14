// Shared request authorisation for the /api functions.
import { createHash, timingSafeEqual } from 'node:crypto'
import { getAdminClient } from './syncJobs.js'

export function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return token && token.length <= 4096 ? token : ''
}

/** Constant-time comparison so a secret can't be guessed via response timing. */
export function secretMatches(token, secret) {
  if (!token || !secret || secret.length < 16) return false
  const a = createHash('sha256').update(token).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

/** Resolve the signed-in Supabase user (and admin flag) from the bearer token. */
export async function getCaller(req, db = getAdminClient()) {
  const token = bearerToken(req)
  if (!token) return null
  try {
    const { data: { user } } = await db.auth.getUser(token)
    if (!user) return null
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle()
    return { user, isAdmin: profile?.role === 'admin' }
  } catch {
    return null
  }
}

/** Cron jobs (CRON_SECRET) or a signed-in admin. */
export async function isCronOrAdmin(req) {
  if (secretMatches(bearerToken(req), process.env.CRON_SECRET)) return true
  const caller = await getCaller(req)
  return !!caller?.isAdmin
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  return {}
}

// CORS for browser calls from the static site when it is hosted outside Vercel
// (e.g. https://afritalent.anaefunasoftwares.com). Only listed origins are allowed;
// add more with ALLOWED_ORIGINS=https://a.com,https://b.com
const DEFAULT_ORIGINS = ['https://afritalent.anaefunasoftwares.com', 'http://localhost:4173', 'http://localhost:5173']
export function withCors(handler) {
  return async (req, res) => {
    const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    const origin = req.headers.origin
    if (origin && [...DEFAULT_ORIGINS, ...extra].includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '86400')
    }
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end() }
    return handler(req, res)
  }
}
