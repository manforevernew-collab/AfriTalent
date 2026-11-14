// Shared job-board helpers: filter options, Supabase query building and formatting.
import { supabase } from './supabase'

export const WORK_MODES = ['Remote', 'Hybrid', 'On-site']
export const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Freelance', 'Internship', 'Temporary']
export const LEVELS = [
  { value: 'Internship', label: 'Internship' },
  { value: 'Entry', label: 'Graduate / Entry' },
  { value: 'Mid', label: 'Mid-level' },
  { value: 'Senior', label: 'Senior' },
  { value: 'Executive', label: 'Executive' },
]
export const CATEGORIES = ['Technology', 'Engineering', 'Data', 'Design', 'Product', 'Marketing', 'Sales',
  'Customer Support', 'Finance', 'HR', 'Operations', 'Healthcare', 'Education', 'Legal', 'Media', 'Other']
// Employer applicant-tracking systems: listings come straight from the company's careers page
export const DIRECT_SOURCES = ['Greenhouse', 'Lever', 'Ashby', 'Workable', 'SmartRecruiters', 'Recruitee']
export const SOURCES = ['AfriTalent', ...DIRECT_SOURCES, 'MyJobMag', 'LinkedIn', 'Indeed', 'Glassdoor', 'ZipRecruiter', 'Wellfound',
  'Jobberman', 'We Work Remotely', 'Remotive', 'RemoteOK', 'Himalayas', 'Jobicy', 'Arbeitnow', 'The Muse', 'Adzuna', 'Upwork', 'X']
export const isDirectSource = s => DIRECT_SOURCES.includes(s)
export const DATE_RANGES = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Past 24 hours' },
  { value: '3', label: 'Past 3 days' },
  { value: '7', label: 'Past week' },
  { value: '30', label: 'Past month' },
]
export const SORTS = [
  { value: 'newest', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
]
export const PAGE_SIZE = 30

export const EMPTY_FILTERS = {
  q: '', location: '', modes: [], types: [], levels: [], sources: [],
  category: '', visa: false, relocation: false, days: '', sort: 'newest',
}

const ARRAY_KEYS = ['modes', 'types', 'levels', 'sources']
const BOOL_KEYS = ['visa', 'relocation']

export function filtersFromParams(params) {
  const f = { ...EMPTY_FILTERS }
  for (const key of Object.keys(EMPTY_FILTERS)) {
    const v = params.get(key)
    if (v == null || v === '') continue
    if (ARRAY_KEYS.includes(key)) f[key] = v.split(',').filter(Boolean)
    else if (BOOL_KEYS.includes(key)) f[key] = v === '1' || v === 'true'
    else f[key] = v
  }
  // Friendly aliases used by links on the home page, e.g. /jobs?mode=Remote&level=Entry
  if (params.get('mode')) f.modes = [params.get('mode')]
  if (params.get('level')) f.levels = [params.get('level')]
  return f
}

export function filtersToParams(f) {
  const out = {}
  for (const [key, val] of Object.entries(f)) {
    if (ARRAY_KEYS.includes(key)) { if (val.length) out[key] = val.join(',') }
    else if (BOOL_KEYS.includes(key)) { if (val) out[key] = '1' }
    else if (val && !(key === 'sort' && val === 'newest')) out[key] = val
  }
  return out
}

export function activeFilterCount(f) {
  return f.modes.length + f.types.length + f.levels.length + f.sources.length +
    (f.category ? 1 : 0) + (f.visa ? 1 : 0) + (f.relocation ? 1 : 0) + (f.days ? 1 : 0) + (f.location ? 1 : 0)
}

/** Only allow http(s) links from the database into href attributes (blocks javascript:/data: URLs). */
export function safeHref(url) {
  try {
    const u = new URL(String(url || '').trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

/** Strip any non-http(s) URLs from a job row before it is rendered. */
export function sanitizeJob(job) {
  if (!job) return job
  return { ...job, apply_url: safeHref(job.apply_url), source_url: safeHref(job.source_url), company_logo: safeHref(job.company_logo) }
}

// PostgREST `or()` uses commas/parentheses as syntax — strip them from user text.
const clean = s => String(s || '').replace(/[,()*%\\:"]/g, ' ').trim()

/**
 * Fetch one page of jobs. Returns { jobs, count, legacy }.
 * `legacy` = true when the aggregator migration hasn't been run yet; in that case we fall back
 * to the original columns and filter on the client so the board keeps working.
 */
export async function fetchJobs(filters, page = 0) {
  if (!supabase) return { jobs: [], count: 0, legacy: false }
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = supabase.from('jobs').select('*', { count: 'exact' }).eq('is_active', true)
  const q = clean(filters.q)
  if (q) query = query.or(`title.ilike.%${q}%,company.ilike.%${q}%,description.ilike.%${q}%`)
  const loc = clean(filters.location)
  if (loc) query = query.ilike('location', `%${loc}%`)
  if (filters.modes.length) query = query.in('work_mode', filters.modes)
  if (filters.types.length) query = query.in('type', filters.types)
  if (filters.levels.length) query = query.in('experience_level', filters.levels)
  if (filters.sources.length) query = query.in('source', filters.sources)
  if (filters.category) query = query.eq('category', filters.category)
  if (filters.visa) query = query.eq('visa_sponsorship', true)
  if (filters.relocation) query = query.eq('relocation', true)
  if (Number(filters.days) > 0) query = query.gte('posted_at', new Date(Date.now() - Number(filters.days) * 86400e3).toISOString())
  query = query.order('posted_at', { ascending: filters.sort === 'oldest' }).range(from, to)

  const { data, error, count } = await query
  if (!error) return { jobs: (data || []).map(sanitizeJob), count: count ?? 0, legacy: false }

  // 42703 = undefined column → migration not applied yet
  if (error.code !== '42703' && !/column .* does not exist/i.test(error.message)) throw error
  const { data: all, error: legacyErr } = await supabase.from('jobs').select('*').order('posted_at', { ascending: false })
  if (legacyErr) throw legacyErr
  const filtered = (all || []).filter(j => matchesLocally(j, filters))
  return { jobs: filtered.slice(from, to + 1).map(sanitizeJob), count: filtered.length, legacy: true }
}

export function matchesLocally(j, f) {
  const has = (field, needle) => String(j[field] || '').toLowerCase().includes(needle.toLowerCase())
  if (f.q && !['title', 'company', 'description'].some(k => has(k, f.q))) return false
  if (f.location && !has('location', f.location)) return false
  if (f.modes.length && !f.modes.includes(workModeOf(j))) return false
  if (f.types.length && !f.types.includes(j.type)) return false
  if (f.category && j.category !== f.category) return false
  if (f.visa && !j.visa_sponsorship) return false
  if (Number(f.days) > 0 && new Date(j.posted_at) < new Date(Date.now() - Number(f.days) * 86400e3)) return false
  return true
}

export function workModeOf(job) {
  if (job.work_mode) return job.work_mode
  const loc = String(job.location || '')
  return /hybrid/i.test(loc) ? 'Hybrid' : /remote/i.test(loc) ? 'Remote' : 'On-site'
}

export async function fetchLastSync() {
  if (!supabase) return null
  const { data, error } = await supabase.from('job_sync_runs')
    .select('finished_at,status,total_fetched,upserted,sources')
    .order('finished_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  return error ? null : data
}

export function timeAgo(date) {
  if (!date) return ''
  const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(date).toLocaleDateString()
}

export const MODE_STYLE = {
  Remote: { bg: 'rgba(22, 163, 74, 0.1)', color: '#15803d', icon: 'fas fa-globe' },
  Hybrid: { bg: 'rgba(59, 130, 246, 0.1)', color: '#1d4ed8', icon: 'fas fa-random' },
  'On-site': { bg: 'rgba(100, 116, 139, 0.12)', color: '#334155', icon: 'fas fa-building' },
}
