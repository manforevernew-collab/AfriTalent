#!/usr/bin/env node
// Build the site and upload it to cPanel/FTP hosting (e.g. afritalent.anaefunasoftwares.com).
//
// Static hosting can't run the /api functions, so the build points them at your Vercel
// deployment via VITE_API_BASE. Credentials come from .env (never committed):
//
//   FTP_HOST=ftp.anaefunasoftwares.com
//   FTP_USER=...
//   FTP_PASSWORD=...
//   FTP_DIR=/afritalent.anaefunasoftwares.com     (the subdomain's document root)
//   FTP_SECURE=true                               (FTPS; set false only if the host has no TLS)
//   VITE_API_BASE=https://<your-project>.vercel.app
//
//   npm run deploy:ftp

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { Client } from 'basic-ftp'

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const need = ['FTP_HOST', 'FTP_USER', 'FTP_PASSWORD', 'FTP_DIR', 'VITE_API_BASE']
const missing = need.filter(k => !process.env[k])
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`)
  process.exit(1)
}
if (!/^https:\/\//.test(process.env.VITE_API_BASE)) {
  console.error('VITE_API_BASE must be the https:// URL of your Vercel deployment')
  process.exit(1)
}

console.log(`Building with API at ${process.env.VITE_API_BASE} …`)
execSync('npm run build', { stdio: 'inherit', env: process.env })

const client = new Client(60_000)
client.ftp.verbose = false
try {
  await client.access({
    host: process.env.FTP_HOST,
    port: Number(process.env.FTP_PORT || 21),
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    secure: process.env.FTP_SECURE !== 'false',
    secureOptions: { rejectUnauthorized: process.env.FTP_ALLOW_SELF_SIGNED !== 'true' },
  })
  console.log(`Connected to ${process.env.FTP_HOST}. Uploading dist/ → ${process.env.FTP_DIR}`)
  await client.ensureDir(process.env.FTP_DIR)
  client.trackProgress(info => { if (info.name) process.stdout.write(`\r  ${info.name.slice(-60).padEnd(60)}`) })
  await client.uploadFromDir('dist')
  client.trackProgress()
  console.log(`\nDone — https://${process.env.FTP_DIR.replace(/^\/+/, '').split('/')[0] || process.env.FTP_HOST}`)
} catch (e) {
  console.error(`\nFTP upload failed: ${e.message}`)
  process.exitCode = 1
} finally {
  client.close()
}
