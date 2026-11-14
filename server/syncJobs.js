// Pulls every source, upserts into Supabase `jobs`, retires stale listings, adds
// hiring employers to the business directory and records a row in `job_sync_runs`.
// Used by the Vercel cron endpoint, the GitHub Actions hourly workflow and `npm run sync:jobs`.

import { createClient } from '@supabase/supabase-js'
import { collectJobs, getBoardReport } from './sources.js'
import { mergeBoards, PROVIDER_LABEL } from './careerBoards.js'
import { discoverEmployers } from './employers.js'

const BATCH = 200
export const ATS_SOURCES = Object.values(PROVIDER_LABEL)

export function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set to sync jobs.')
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function loadBoardRows(db) {
  if (!db) return []
  const { data, error } = await db.from('career_boards').select('*')
  return error ? [] : data || [] // table is optional (created by supabase-career-boards-migration.sql)
}

export async function syncJobs({ dryRun = false, only } = {}) {
  const startedAt = new Date()
  const db = dryRun ? null : getAdminClient()
  const boardRows = await loadBoardRows(db)
  const boards = mergeBoards(boardRows)
  const { jobs, report } = await collectJobs({ only, boards })
  const boardReport = getBoardReport()
  if (report['Company career pages']) report['Company career pages'].boards = boardReport

  const summary = {
    started_at: startedAt.toISOString(),
    total_fetched: jobs.length,
    upserted: 0,
    deactivated: 0,
    employers_added: 0,
    sources: report,
    errors: [],
  }

  if (dryRun) {
    summary.finished_at = new Date().toISOString()
    summary.status = 'dry-run'
    summary.sample = jobs.slice(0, 3)
    summary.employers_preview = (await discoverEmployers(null, jobs, boards, boardReport, { dryRun: true })).slice(0, 10)
    return summary
  }

  for (let i = 0; i < jobs.length; i += BATCH) {
    const chunk = jobs.slice(i, i + BATCH)
    const { error, count } = await db.from('jobs').upsert(chunk, { onConflict: 'external_id', count: 'exact' })
    if (error) summary.errors.push(`upsert batch ${i / BATCH + 1}: ${error.message}`)
    else summary.upserted += count ?? chunk.length
  }

  // 1) Direct employer boards are authoritative: a role missing from a board that
  //    loaded successfully this run has closed — hide it now, not in 72h.
  const okCompanies = [...new Set(jobs.filter(j => ATS_SOURCES.includes(j.source)).map(j => j.company))]
  if (okCompanies.length) {
    const { error, count } = await db.from('jobs').update({ is_active: false }, { count: 'exact' })
      .eq('is_external', true).eq('is_active', true).in('source', ATS_SOURCES).in('company', okCompanies)
      .lt('last_seen_at', new Date(startedAt.getTime() - 60_000).toISOString())
    if (error) summary.errors.push(`retire closed ATS roles: ${error.message}`)
    else summary.deactivated += count || 0
  }

  // 2) Everything else: retire external jobs not seen for STALE_HOURS (default 72h), or older
  //    than MAX_AGE_DAYS. Rows are deactivated, not deleted, so applications stay intact.
  const staleHours = Number(process.env.STALE_HOURS || 72)
  const maxAgeDays = Number(process.env.MAX_AGE_DAYS || 45)
  const staleBefore = new Date(Date.now() - staleHours * 3600e3).toISOString()
  const tooOld = new Date(Date.now() - maxAgeDays * 86400e3).toISOString()
  // Employer career-page roles are exempt from the age rule: an old posting that is
  // still on the employer's own board is still open.
  const { error: staleErr, count: staleCount } = await db.from('jobs')
    .update({ is_active: false }, { count: 'exact' })
    .eq('is_external', true).eq('is_active', true)
    .or(`last_seen_at.lt.${staleBefore},and(posted_at.lt.${tooOld},source.not.in.(${ATS_SOURCES.join(',')}))`)
  if (staleErr) summary.errors.push(`deactivate: ${staleErr.message}`)
  else summary.deactivated += staleCount || 0

  // 3) Hiring employers -> business directory (never overwrites existing/claimed profiles)
  try {
    summary.employers_added = (await discoverEmployers(db, jobs, boards, boardReport)).length
  } catch (e) { summary.errors.push(`employers: ${e.message}`) }

  // 4) Per-board health for admin-managed boards
  for (const row of boardRows) {
    const r = boardReport[`${PROVIDER_LABEL[row.provider]}:${row.slug}`]
    if (!r) continue
    await db.from('career_boards').update({
      last_status: r.ok ? 'ok' : 'error', last_total: r.total ?? null, last_kept: r.kept ?? null,
      last_error: r.ok ? null : String(r.error).slice(0, 300), last_checked_at: new Date().toISOString(),
    }).eq('id', row.id)
  }

  const failedSources = Object.values(report).filter(r => !r.ok).length
  summary.status = summary.errors.length ? 'error' : failedSources ? 'partial' : 'success'
  summary.finished_at = new Date().toISOString()

  const { error: logErr } = await db.from('job_sync_runs').insert({
    started_at: summary.started_at,
    finished_at: summary.finished_at,
    status: summary.status,
    total_fetched: summary.total_fetched,
    upserted: summary.upserted,
    deactivated: summary.deactivated,
    sources: summary.sources,
    errors: summary.errors,
  })
  if (logErr) summary.errors.push(`log: ${logErr.message}`)

  return summary
}
