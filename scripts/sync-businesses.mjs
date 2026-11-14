#!/usr/bin/env node
// CLI business import (OpenStreetMap -> companies).
//   npm run sync:businesses                      → today's rotation of cities
//   npm run sync:businesses -- --dry-run         → fetch + normalise only (no DB needed)
//   npm run sync:businesses -- --only=Lagos,Accra
//   npm run sync:businesses -- --all             → every city (slow: ~30–60 s per city)

import { readFileSync, existsSync } from 'node:fs'
import { syncBusinesses } from '../server/business/syncBusinesses.js'
import { CITIES } from '../shared/businessTaxonomy.js'

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
let only = onlyArg ? onlyArg.slice(7).split(',').map(s => s.trim()) : undefined
if (args.includes('--all')) only = CITIES.map(c => c.name)

const summary = await syncBusinesses({ dryRun, only, budgetMs: Infinity, log: m => console.log(' ', m) })

console.log(`\nBusiness sync ${summary.status} — ${summary.total_fetched} businesses` +
  (dryRun ? '' : `, ${summary.upserted} upserted, ${summary.skipped_claimed} claimed (kept), ${summary.deactivated} retired`))
console.table(Object.fromEntries(Object.entries(summary.cities).map(([k, v]) =>
  [k, v.ok ? { fetched: v.fetched, valid: v.valid, ms: v.ms } : { error: v.error || v.skipped }])))
if (dryRun && summary.sample) console.log('\nSample:', summary.sample[0])
if (summary.errors.length) {
  console.error('\nErrors:\n - ' + summary.errors.join('\n - '))
  process.exit(1)
}
