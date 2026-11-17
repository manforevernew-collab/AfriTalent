#!/usr/bin/env node
// Build the site and upload it to cPanel/FTP hosting (e.g. afritalent.anaefunasoftwares.com).
//
// Static hosting can't run the /api functions, so the build points them at your Vercel
// deployment via VITE_API_BASE (optional until Vercel is set up — the site then works
// except KYC auto-screening, card top-ups and admin "Sync now").
//
// Settings come from .env (never committed). The password can live in a private file
// outside the project instead (FTP_CRED_FILE with FTP_HOST / FTP_USER / FTP_PASS lines):
//
//   FTP_CRED_FILE=C:\Users\you\.myhotspot-deploy      (or FTP_HOST + FTP_USER + FTP_PASSWORD)
//   FTP_DIR=/afritalent.anaefunasoftwares.com          (the subdomain's folder as the FTP account sees it)
//   FTP_SECURE=true                                    (FTPS)
//   VITE_API_BASE=https://<your-project>.vercel.app
//
//   npm run deploy:ftp            build + upload
//   npm run deploy:ftp -- --check connect and list the target folder only
//   node scripts/deploy-ftp.mjs --no-build   upload the existing dist/ as-is

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { Client } from 'basic-ftp'

const readEnvFile = file => Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
  .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^['"]|['"]$/g, '')]))

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const [k, v] of Object.entries(readEnvFile(file))) if (process.env[k] === undefined) process.env[k] = v
}
const fromFile = process.env.FTP_CRED_FILE && existsSync(process.env.FTP_CRED_FILE) ? readEnvFile(process.env.FTP_CRED_FILE) : {}
const cfg = {
  host: process.env.FTP_HOST || fromFile.FTP_HOST,
  user: process.env.FTP_USER || fromFile.FTP_USER,
  password: process.env.FTP_PASSWORD || fromFile.FTP_PASS || fromFile.FTP_PASSWORD,
  dir: process.env.FTP_DIR,
  port: Number(process.env.FTP_PORT || 21),
  secure: process.env.FTP_SECURE !== 'false',
}
const missing = Object.entries({ FTP_HOST: cfg.host, FTP_USER: cfg.user, 'FTP_PASSWORD (or FTP_CRED_FILE)': cfg.password, FTP_DIR: cfg.dir }).filter(([, v]) => !v).map(([k]) => k)
if (missing.length) { console.error(`Missing: ${missing.join(', ')}`); process.exit(1) }
const checkOnly = process.argv.includes('--check')

if (process.env.VITE_API_BASE && !/^https:\/\//.test(process.env.VITE_API_BASE)) {
  console.error('VITE_API_BASE must be the https:// URL of your Vercel deployment'); process.exit(1)
}
const noBuild = process.argv.includes('--no-build')
if (noBuild && !existsSync('dist/index.html')) { console.error('dist/ is missing — run npm run build first'); process.exit(1) }
if (!checkOnly && !noBuild) {
  console.log(process.env.VITE_API_BASE ? `Building with API at ${process.env.VITE_API_BASE} …`
    : 'Building WITHOUT an API base (KYC auto-screening, card top-ups and admin sync stay off until Vercel is deployed) …')
  execSync('npm run build', { stdio: 'inherit', env: process.env })
}

const client = new Client(60_000)
try {
  await client.access({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, secure: cfg.secure })
  console.log(`Connected to ${cfg.host} as ${cfg.user}${cfg.secure ? ' (FTPS)' : ''}`)
  await client.ensureDir(cfg.dir)
  const existing = await client.list()
  console.log(`Target ${cfg.dir}: ${existing.length} entries`)
  if (checkOnly) process.exit(0)

  // Keep the host's cPanel-generated block (PHP settings) at the top of our .htaccess
  if (existing.some(i => i.name === '.htaccess')) {
    const tmp = mkdtempSync(join(tmpdir(), 'afri-'))
    await client.downloadTo(join(tmp, 'remote.htaccess'), '.htaccess')
    const remote = readFileSync(join(tmp, 'remote.htaccess'), 'utf8')
    const block = remote.match(/# BEGIN cPanel-generated[\s\S]*?# END cPanel-generated[^\n]*\n?/)
    if (block) {
      const ours = readFileSync('dist/.htaccess', 'utf8').replace(/# BEGIN cPanel-generated[\s\S]*?# END cPanel-generated[^\n]*\n?/, '')
      writeFileSync('dist/.htaccess', `${block[0].trimEnd()}\n\n${ours}`)
      console.log('Kept the cPanel-generated block in .htaccess')
    }
  }

  // Public profile link previews (share.php) need the Supabase URL + publishable key — both already public in the JS bundle
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    writeFileSync('dist/share-config.json', JSON.stringify({ url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY }))
  }

  let n = 0
  client.trackProgress(info => { if (info.type === 'upload' && info.bytes === 0) n++ })
  await client.uploadFromDir('dist')
  client.trackProgress()
  console.log(`Uploaded dist/ → ${cfg.dir}`)
} catch (e) {
  console.error(`FTP deploy failed: ${e.message}`)
  process.exitCode = 1
} finally {
  client.close()
}
