#!/usr/bin/env node
// Register "Sign in with Indeed" as a Supabase custom OAuth provider (custom:indeed).
//
// 1. Create an Indeed app: https://secure.indeed.com/account/apikeys  (Partner Console → Register new app)
//    Redirect / callback URL:  https://<project-ref>.supabase.co/auth/v1/callback
// 2. Add to .env (never committed):  INDEED_CLIENT_ID=...   INDEED_CLIENT_SECRET=...
// 3. node scripts/setup-indeed-login.mjs          (re-run any time to update; --disable to switch off)
//
// Uses SUPABASE_SERVICE_ROLE_KEY (admin API) — never prints secrets.
// Indeed shares the person's email address (scope "email", which Indeed requires to be paired
// with "offline_access"); name and photo are completed during AfriTalent's setup wizard.

import { readFileSync, existsSync } from 'node:fs'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}
const env = process.env
const base = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) { console.error('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(1) }

const ID = 'custom:indeed'
const disable = process.argv.includes('--disable')
const api = async (method, path, body) => {
  const r = await fetch(`${base}/auth/v1/admin/custom-providers${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path || '/'} → ${r.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

if (!disable && (!env.INDEED_CLIENT_ID || !env.INDEED_CLIENT_SECRET)) {
  console.error('Add INDEED_CLIENT_ID and INDEED_CLIENT_SECRET to .env first.')
  console.error(`Indeed app redirect URL: ${base}/auth/v1/callback`)
  process.exit(1)
}

const { providers = [] } = await api('GET', '')
const existing = providers.find(p => p.identifier === ID)

if (disable) {
  if (!existing) { console.log('Indeed sign-in is not set up — nothing to disable.'); process.exit(0) }
  await api('PUT', `/${ID}`, { enabled: false })
  console.log('Indeed sign-in disabled.'); process.exit(0)
}

const config = {
  name: 'Indeed',
  client_id: env.INDEED_CLIENT_ID,
  client_secret: env.INDEED_CLIENT_SECRET,
  authorization_url: 'https://secure.indeed.com/oauth/v2/authorize',
  token_url: 'https://apis.indeed.com/oauth/v2/tokens',
  userinfo_url: 'https://secure.indeed.com/v2/api/userinfo',
  scopes: ['email', 'offline_access'],
  enabled: true,
}

const saved = existing
  ? await api('PUT', `/${ID}`, config)
  : await api('POST', '', { provider_type: 'oauth2', identifier: ID, ...config })

console.log(`✅ Indeed sign-in ${existing ? 'updated' : 'created'} (${saved.identifier || ID}, enabled: ${saved.enabled ?? true})`)
console.log(`   Indeed app redirect URL must be: ${base}/auth/v1/callback`)
