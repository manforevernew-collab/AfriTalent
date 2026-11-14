// Direct employer career pages (Applicant Tracking Systems).
//
// Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Recruitee all publish
// official, public job-board APIs for exactly this purpose. Listings come
// straight from the employer, link to the employer's own application form and
// disappear the moment the role closes — so they are the most reliable source.
//
// scope:
//   'all'               keep every role (African employers)
//   'remote_or_africa'  global companies: keep remote roles and roles located in Africa

import { detectWorkMode } from './normalize.js'

const UA = 'AfriTalentJobBot/2.0 (+https://afritalent.app/jobs)'

// Verified live on 2026-11-14. Admins can add more from Admin → Job import.
export const DEFAULT_BOARDS = [
  { provider: 'greenhouse', slug: 'moniepoint', company: 'Moniepoint', website: 'https://moniepoint.com', category: 'Finance & Banking', country: 'Nigeria', scope: 'all' },
  { provider: 'greenhouse', slug: 'jumia', company: 'Jumia', website: 'https://group.jumia.com', category: 'Retail', scope: 'all' },
  { provider: 'ashby', slug: 'lemfi', company: 'LemFi', website: 'https://lemfi.com', category: 'Finance & Banking', scope: 'all' },
  { provider: 'ashby', slug: 'sabi', company: 'Sabi', website: 'https://sabi.am', category: 'Technology', country: 'Nigeria', scope: 'all' },
  { provider: 'workable', slug: 'kuda', company: 'Kuda', website: 'https://kuda.com', category: 'Finance & Banking', country: 'Nigeria', scope: 'all' },
  { provider: 'workable', slug: 'fairmoney', company: 'FairMoney', website: 'https://fairmoney.io', category: 'Finance & Banking', scope: 'all' },
  { provider: 'greenhouse', slug: 'gitlab', company: 'GitLab', website: 'https://about.gitlab.com', category: 'Technology', scope: 'remote_or_africa' },
  { provider: 'greenhouse', slug: 'canonical', company: 'Canonical', website: 'https://canonical.com', category: 'Technology', scope: 'remote_or_africa' },
  { provider: 'greenhouse', slug: 'elastic', company: 'Elastic', website: 'https://www.elastic.co', category: 'Technology', scope: 'remote_or_africa' },
  { provider: 'greenhouse', slug: 'turing', company: 'Turing', website: 'https://www.turing.com', category: 'Technology', scope: 'remote_or_africa' },
  { provider: 'lever', slug: 'toptal', company: 'Toptal', website: 'https://www.toptal.com', category: 'Technology', scope: 'remote_or_africa' },
  { provider: 'ashby', slug: 'supabase', company: 'Supabase', website: 'https://supabase.com', category: 'Technology', scope: 'remote_or_africa' },
  { provider: 'ashby', slug: 'posthog', company: 'PostHog', website: 'https://posthog.com', category: 'Technology', scope: 'remote_or_africa' },
]

export const PROVIDERS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee']
export const PROVIDER_LABEL = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', smartrecruiters: 'SmartRecruiters', recruitee: 'Recruitee',
}

const AFRICA = /\b(nigeria|lagos|abuja|ibadan|port harcourt|kano|ghana|accra|kumasi|kenya|nairobi|mombasa|south africa|johannesburg|cape town|durban|pretoria|egypt|cairo|morocco|casablanca|rabat|tunisia|tunis|algeria|ethiopia|addis|uganda|kampala|rwanda|kigali|tanzania|dar es salaam|senegal|dakar|c[oô]te d.?ivoire|abidjan|cameroon|douala|zambia|lusaka|zimbabwe|harare|botswana|gaborone|namibia|windhoek|angola|luanda|mozambique|maputo|africa|emea)\b/i

export function inScope(scope, { location = '', title = '', remote, workplace = '' }) {
  if (scope !== 'remote_or_africa') return true
  if (AFRICA.test(location)) return true
  const mode = detectWorkMode({ remoteFlag: remote, hint: workplace, location, title })
  // "Remote - US only" style restrictions exclude African applicants
  if (mode === 'Remote' && !/\b(us|usa|united states|canada|uk only|us only|americas|north america|latam|apac only)\b/i.test(location)) return true
  return false
}

async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const base = (b, extra) => ({ company: b.company || b.slug, ...extra })

// Each fetcher returns raw job objects for buildJob(), already scope-filtered.
const FETCH = {
  async greenhouse(b) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.slug)}/jobs?content=true`)
    return (data.jobs || []).map(j => base(b, {
      source: 'Greenhouse', externalId: `${b.slug}-${j.id}`, title: j.title, company: j.company_name || b.company || b.slug,
      location: j.location?.name, categoryHint: (j.departments || []).map(d => d.name), description: j.content,
      postedAt: j.first_published || j.updated_at, applyUrl: j.absolute_url, sourceUrl: j.absolute_url,
    }))
  },
  async lever(b) {
    const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(b.slug)}?mode=json`)
    return (data || []).map(j => base(b, {
      source: 'Lever', externalId: j.id, title: j.text,
      location: j.categories?.location || (j.categories?.allLocations || []).join(', '),
      workModeHint: j.workplaceType === 'onsite' ? 'on-site' : j.workplaceType || '', remote: j.workplaceType === 'remote' ? true : undefined,
      typeHint: j.categories?.commitment, categoryHint: [j.categories?.team, j.categories?.department],
      description: j.descriptionPlain || j.description, postedAt: j.createdAt, applyUrl: j.applyUrl || j.hostedUrl, sourceUrl: j.hostedUrl,
    }))
  },
  async ashby(b) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.slug)}?includeCompensation=true`)
    return (data.jobs || []).filter(j => j.isListed !== false).map(j => base(b, {
      source: 'Ashby', externalId: `${b.slug}-${j.id}`, title: j.title,
      location: [j.location, ...(j.secondaryLocations || []).map(l => l.location)].filter(Boolean).join(' · '),
      remote: j.isRemote === true ? true : undefined, workModeHint: j.workplaceType || '',
      typeHint: j.employmentType, categoryHint: [j.department, j.team], description: j.descriptionHtml || j.descriptionPlain,
      salary: j.compensation?.compensationTierSummary || undefined,
      postedAt: j.publishedAt, applyUrl: j.applyUrl || j.jobUrl, sourceUrl: j.jobUrl,
    }))
  },
  async workable(b) {
    const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(b.slug)}?details=true`)
    return (data.jobs || []).map(j => base(b, {
      source: 'Workable', externalId: `${b.slug}-${j.shortcode || j.id}`, title: j.title, company: data.name || b.company || b.slug,
      location: [j.city, j.state, j.country].filter(Boolean).join(', ') || (j.locations || []).map(l => [l.city, l.country].filter(Boolean).join(', ')).join(' · '),
      remote: j.telecommuting === true ? true : undefined, workModeHint: j.workplace || '',
      typeHint: j.employment_type, categoryHint: [j.department, j.function], description: j.description,
      postedAt: j.published_on || j.created_at, applyUrl: j.application_url || j.url || j.shortlink, sourceUrl: j.url || j.shortlink,
    }))
  },
  async smartrecruiters(b) {
    const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.slug)}/postings?limit=100`)
    return (data.content || []).map(j => base(b, {
      source: 'SmartRecruiters', externalId: `${b.slug}-${j.id}`, title: j.name, company: j.company?.name || b.company || b.slug,
      location: [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '),
      remote: j.location?.remote === true ? true : undefined, typeHint: j.typeOfEmployment?.label,
      categoryHint: [j.department?.label, j.function?.label], levelHint: j.experienceLevel?.label,
      description: `${j.name} at ${j.company?.name || b.company}.`, postedAt: j.releasedDate,
      applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(b.slug)}/${j.id}`, sourceUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(b.slug)}/${j.id}`,
    }))
  },
  async recruitee(b) {
    const data = await getJson(`https://${encodeURIComponent(b.slug)}.recruitee.com/api/offers/`)
    return (data.offers || []).map(j => base(b, {
      source: 'Recruitee', externalId: `${b.slug}-${j.id}`, title: j.title, company: j.company_name || b.company || b.slug,
      location: j.location || [j.city, j.country].filter(Boolean).join(', '), remote: j.remote === true ? true : undefined,
      typeHint: j.employment_type_code, categoryHint: [j.department], description: j.description,
      postedAt: j.published_at || j.created_at, applyUrl: j.careers_apply_url || j.careers_url, sourceUrl: j.careers_url,
    }))
  },
}

/** Fetch one board. Returns { jobs, total, kept } — throws on network/HTTP errors. */
export async function fetchBoard(b) {
  const fn = FETCH[b.provider]
  if (!fn) throw new Error(`Unknown provider ${b.provider}`)
  const raw = await fn(b)
  const jobs = raw.filter(r => r.title && inScope(b.scope, { location: r.location, title: r.title, remote: r.remote, workplace: r.workModeHint }))
  return { jobs, total: raw.length, kept: jobs.length }
}

/** Defaults + GREENHOUSE_BOARDS / LEVER_COMPANIES env vars + admin-managed rows (db). */
export function mergeBoards(dbRows = []) {
  const env = k => (process.env[k] || '').split(',').map(s => s.trim()).filter(Boolean)
  const all = [
    ...DEFAULT_BOARDS,
    ...env('GREENHOUSE_BOARDS').map(slug => ({ provider: 'greenhouse', slug, scope: 'all' })),
    ...env('LEVER_COMPANIES').map(slug => ({ provider: 'lever', slug, scope: 'all' })),
    ...env('ASHBY_BOARDS').map(slug => ({ provider: 'ashby', slug, scope: 'all' })),
    ...env('WORKABLE_ACCOUNTS').map(slug => ({ provider: 'workable', slug, scope: 'all' })),
    ...dbRows.map(r => ({ provider: r.provider, slug: r.slug, company: r.company_name, website: r.website, category: r.category, country: r.country, scope: r.scope || 'all', enabled: r.enabled !== false, id: r.id })),
  ]
  const seen = new Map()
  for (const b of all) seen.set(`${b.provider}:${b.slug.toLowerCase()}`, { ...seen.get(`${b.provider}:${b.slug.toLowerCase()}`), ...b })
  return [...seen.values()].filter(b => b.enabled !== false)
}

/** Fetch all boards with limited concurrency. Returns { raw, report }. */
export async function fetchAllBoards(boards, concurrency = 4) {
  const report = {}
  const raw = []
  let i = 0
  async function worker() {
    while (i < boards.length) {
      const b = boards[i++]
      const key = `${PROVIDER_LABEL[b.provider]}:${b.slug}`
      try {
        const r = await fetchBoard(b)
        raw.push(...r.jobs)
        report[key] = { ok: true, total: r.total, kept: r.kept, company: b.company }
      } catch (e) {
        report[key] = { ok: false, error: e.message, company: b.company }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker))
  return { raw, report }
}
