// Business directory import: OpenStreetMap -> companies.
// Rotates through CITIES (a few per run) so every city is refreshed weekly
// with a daily schedule. Claimed profiles are never overwritten.

import { CITIES } from '../../shared/businessTaxonomy.js'
import { fetchCityBusinesses } from './osm.js'
import { getAdminClient } from '../syncJobs.js'

const BATCH = 200

export function pickCities({ only, perRun = Number(process.env.BUSINESS_CITIES_PER_RUN) || 4, now = new Date() } = {}) {
  if (only?.length) {
    const wanted = only.map(s => s.toLowerCase())
    return CITIES.filter(c => wanted.includes(c.name.toLowerCase()))
  }
  const day = Math.floor(now.getTime() / 86400e3)
  const start = (day * perRun) % CITIES.length
  return Array.from({ length: Math.min(perRun, CITIES.length) }, (_, i) => CITIES[(start + i) % CITIES.length])
}

export async function syncBusinesses({ dryRun = false, only, perRun, budgetMs = 230_000, log = () => {} } = {}) {
  const startedAt = new Date()
  const cities = pickCities({ only, perRun })
  const summary = { status: 'success', started_at: startedAt.toISOString(), cities: {}, total_fetched: 0, upserted: 0, deactivated: 0, skipped_claimed: 0, errors: [] }
  const db = dryRun ? null : getAdminClient()
  const done = []

  for (const city of cities) {
    if (Date.now() - startedAt.getTime() > budgetMs) { summary.cities[city.name] = { skipped: 'time budget' }; continue }
    const t0 = Date.now()
    try {
      const { fetched, rows } = await fetchCityBusinesses(city)
      rows.forEach(r => { r.scan_city = city.name })
      summary.total_fetched += rows.length
      let upserted = 0, claimed = 0
      if (!dryRun) {
        for (let i = 0; i < rows.length; i += BATCH) {
          let batch = rows.slice(i, i + BATCH)
          const { data: owned, error: ownErr } = await db.from('companies').select('external_id')
            .in('external_id', batch.map(r => r.external_id)).not('claimed_by', 'is', null)
          if (ownErr) throw ownErr
          const ownedSet = new Set((owned || []).map(o => o.external_id))
          claimed += ownedSet.size
          batch = batch.filter(r => !ownedSet.has(r.external_id))
          if (!batch.length) continue
          const { error } = await db.from('companies').upsert(batch, { onConflict: 'external_id' })
          if (error) throw error
          upserted += batch.length
        }
        // Gone from OSM since the last scan of this city -> hide (never delete)
        const { count, error: deErr } = await db.from('companies').update({ is_active: false }, { count: 'exact' })
          .eq('source', 'OpenStreetMap').eq('scan_city', city.name).is('claimed_by', null).eq('is_active', true)
          .lt('last_seen_at', new Date(startedAt.getTime() - 60_000).toISOString())
        if (deErr) summary.errors.push(`${city.name} deactivate: ${deErr.message}`)
        else summary.deactivated += count || 0
      }
      summary.upserted += upserted
      summary.skipped_claimed += claimed
      summary.cities[city.name] = { ok: true, fetched, valid: rows.length, upserted, ms: Date.now() - t0 }
      done.push(city.name)
      log(`${city.name}: ${rows.length} businesses`)
      if (dryRun && !summary.sample) summary.sample = rows.slice(0, 3)
    } catch (e) {
      summary.cities[city.name] = { ok: false, error: e.message, ms: Date.now() - t0 }
      summary.errors.push(`${city.name}: ${e.message}`)
    }
  }

  if (!done.length) summary.status = 'error'
  else if (summary.errors.length) summary.status = 'partial'
  summary.finished_at = new Date().toISOString()

  if (!dryRun) {
    const { error } = await db.from('business_sync_runs').insert({
      started_at: summary.started_at, finished_at: summary.finished_at, status: summary.status,
      total_fetched: summary.total_fetched, upserted: summary.upserted, deactivated: summary.deactivated,
      cities: summary.cities, errors: summary.errors,
    })
    if (error) summary.errors.push(`log: ${error.message}`)
  }
  return summary
}
