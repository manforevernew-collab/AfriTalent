#!/usr/bin/env node
// CLI job sync.
//   npm run sync:jobs              → fetch all sources and upsert into Supabase
//   npm run sync:jobs -- --dry-run → fetch + normalise only, print a report (no DB needed)
//   npm run sync:jobs -- --only=Remotive,Jobicy

import { readFileSync, existsSync } from 'node:fs'
import { syncJobs, getAdminClient } from '../server/syncJobs.js'

// Minimal .env loader so local runs pick up the same variables as Vite.
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const onlyArg = args.find(a => a.startsWith('--only='))
const only = onlyArg ? onlyArg.slice(7).split(',').map(s => s.trim()) : undefined

const summary = await syncJobs({ dryRun, only })

// Marketplace: release shipped orders nobody disputed within the hold period (escrow auto-release)
if (!dryRun) {
  const { data: released, error } = await getAdminClient().rpc('release_due_orders')
  if (error && !/release_due_orders|PGRST202/.test(error.message + error.code)) console.warn('Order auto-release failed:', error.message)
  else if (released) console.log(`Released ${released} order(s) to sellers after the escrow hold period`)
}

console.log(`\nJob sync ${summary.status} — ${summary.total_fetched} unique jobs` +
  (dryRun ? '' : `, ${summary.upserted} upserted, ${summary.deactivated} retired`))
console.table(Object.fromEntries(Object.entries(summary.sources).map(([k, v]) =>
  [k, v.ok ? { fetched: v.fetched, valid: v.valid, ms: v.ms } : { error: v.error }])))
if (dryRun && summary.sample) {
  console.log('\nSample normalised job:')
  const s = { ...summary.sample[0] }
  if (s.description) s.description = s.description.slice(0, 200) + '…'
  console.log(s)
}
if (summary.errors.length) {
  console.error('\nErrors:\n - ' + summary.errors.join('\n - '))
  process.exit(1)
}
