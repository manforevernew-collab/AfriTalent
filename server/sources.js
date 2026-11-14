// Job source connectors.
//
// Each connector returns raw job objects that `buildJob()` normalises.
// Free public feeds are enabled by default. Paid / key-based providers switch on
// automatically when their environment variables are present.
//
// Why no direct LinkedIn / X / Upwork / Fiverr scraping:
//   Those sites forbid automated scraping in their terms and actively block it,
//   so a scraper would break within days and could get the site's IP banned.
//   Instead we use the sanctioned routes:
//     - LinkedIn, Indeed, Glassdoor, ZipRecruiter… → JSearch (Google for Jobs index) via RapidAPI
//     - X (Twitter)                               → official X API v2 recent search
//     - Upwork                                    → official Upwork GraphQL API (requires an approved app)
//   Fiverr has no job listings to import: sellers post services there, buyers don't post roles.

import { buildJob, formatSalary } from './normalize.js'
import { mergeBoards, fetchAllBoards } from './careerBoards.js'
import { fetchMyJobMag } from './myjobmag.js'

const UA = 'AfriTalentJobBot/2.0 (+https://afritalent.app/jobs)'

async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout || 25000),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split('?')[0]}`)
  return res.json()
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

const env = (k, d = '') => (typeof process !== 'undefined' && process.env[k]) || d
const list = (k, d = '') => env(k, d).split(',').map(s => s.trim()).filter(Boolean)

// ───────────────────────────── Free public feeds ─────────────────────────────

async function remotive() {
  const data = await getJson('https://remotive.com/api/remote-jobs?limit=300')
  return (data.jobs || []).map(j => ({
    source: 'Remotive',
    externalId: j.id,
    title: j.title,
    company: j.company_name,
    companyLogo: j.company_logo_url || j.company_logo,
    location: j.candidate_required_location ? `Remote · ${j.candidate_required_location}` : 'Remote',
    remote: true,
    typeHint: j.job_type,
    categoryHint: j.category,
    salary: j.salary || null,
    description: j.description,
    tags: j.tags,
    postedAt: j.publication_date,
    // Remotive's terms require linking back to the Remotive listing
    applyUrl: j.url,
    sourceUrl: j.url,
  }))
}

async function remoteOk() {
  const data = await getJson('https://remoteok.com/api')
  return (Array.isArray(data) ? data : []).filter(j => j && j.id && j.position).map(j => ({
    source: 'RemoteOK',
    externalId: j.id,
    title: j.position,
    company: j.company,
    companyLogo: j.company_logo || j.logo,
    location: j.location ? `Remote · ${j.location}` : 'Remote',
    remote: true,
    typeHint: (j.tags || []).join(' '),
    categoryHint: (j.tags || []).join(' '),
    salary: formatSalary(j.salary_min, j.salary_max, 'USD', 'year'),
    description: j.description,
    tags: j.tags,
    postedAt: j.epoch || j.date,
    applyUrl: j.apply_url || j.url,
    sourceUrl: j.url,
  }))
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return ''
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim()
}

async function weWorkRemotely() {
  const xml = await getText('https://weworkremotely.com/remote-jobs.rss')
  return xml.split('<item>').slice(1).map(chunk => {
    const item = chunk.split('</item>')[0]
    const rawTitle = xmlTag(item, 'title')
    // Titles look like "Company: Role"
    const idx = rawTitle.indexOf(':')
    const company = idx > 0 ? rawTitle.slice(0, idx) : ''
    const title = idx > 0 ? rawTitle.slice(idx + 1) : rawTitle
    const link = xmlTag(item, 'link') || xmlTag(item, 'guid')
    const region = xmlTag(item, 'region')
    return {
      source: 'We Work Remotely',
      externalId: link.split('/').pop(),
      title,
      company,
      location: region ? `Remote · ${region}` : 'Remote',
      remote: true,
      typeHint: xmlTag(item, 'type'),
      categoryHint: xmlTag(item, 'category'),
      description: xmlTag(item, 'description'),
      tags: [xmlTag(item, 'category'), ...xmlTag(item, 'skills').split(',')].filter(Boolean),
      postedAt: xmlTag(item, 'pubDate'),
      applyUrl: link,
      sourceUrl: link,
    }
  })
}

async function arbeitnow() {
  const pages = Number(env('ARBEITNOW_PAGES', '2'))
  const mapJob = (j, visa) => ({
    source: 'Arbeitnow',
    externalId: j.slug,
    title: j.title,
    company: j.company_name,
    location: j.location,
    remote: j.remote === true,
    typeHint: (j.job_types || []).join(' '),
    categoryHint: (j.tags || []).join(' '),
    description: j.description,
    tags: j.tags,
    visaSponsorship: visa || undefined,
    postedAt: j.created_at,
    applyUrl: j.url,
    sourceUrl: j.url,
  })
  const out = new Map()
  // Pull the dedicated visa-sponsorship feed first so those flags win on dedupe
  const visa = await getJson('https://www.arbeitnow.com/api/job-board-api?visa_sponsorship=true').catch(() => ({ data: [] }))
  for (const j of visa.data || []) out.set(j.slug, mapJob(j, true))
  for (let p = 1; p <= pages; p++) {
    const data = await getJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`)
    for (const j of data.data || []) if (!out.has(j.slug)) out.set(j.slug, mapJob(j, false))
    if (!data.links?.next) break
  }
  return [...out.values()]
}

async function jobicy() {
  const data = await getJson('https://jobicy.com/api/v2/remote-jobs?count=100')
  return (data.jobs || []).map(j => ({
    source: 'Jobicy',
    externalId: j.id,
    title: j.jobTitle,
    company: j.companyName,
    companyLogo: j.companyLogo,
    location: j.jobGeo ? `Remote · ${j.jobGeo}` : 'Remote',
    remote: true,
    typeHint: j.jobType,
    levelHint: j.jobLevel,
    categoryHint: j.jobIndustry,
    salary: formatSalary(j.annualSalaryMin ?? j.salaryMin, j.annualSalaryMax ?? j.salaryMax, j.salaryCurrency, j.salaryPeriod || 'year'),
    description: j.jobDescription || j.jobExcerpt,
    tags: j.jobIndustry,
    postedAt: j.pubDate,
    applyUrl: j.url,
    sourceUrl: j.url,
  }))
}

async function himalayas() {
  const pages = Number(env('HIMALAYAS_PAGES', '5'))
  const out = []
  let cursor = ''
  for (let p = 0; p < pages; p++) {
    const data = await getJson(`https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    for (const j of data.jobs || []) {
      const where = (j.locationRestrictions || []).slice(0, 3).join(', ')
      out.push({
        source: 'Himalayas',
        externalId: j.guid || j.applicationLink,
        title: j.title,
        company: j.companyName,
        companyLogo: j.companyLogo,
        location: where ? `Remote · ${where}` : 'Remote · Worldwide',
        remote: true,
        typeHint: j.employmentType,
        levelHint: j.seniority,
        categoryHint: [...(j.parentCategories || []), ...(j.categories || [])],
        salary: formatSalary(j.minSalary, j.maxSalary, j.currency || 'USD', j.salaryPeriod),
        description: j.description || j.excerpt,
        tags: j.categories?.map(c => c.replace(/-/g, ' ')),
        postedAt: j.pubDate,
        applyUrl: j.applicationLink,
        sourceUrl: j.applicationLink,
      })
    }
    cursor = data.nextCursor
    if (!cursor) break
  }
  return out
}

async function theMuse() {
  // The Muse includes on-site and hybrid roles, plus entry level / internships.
  const pages = Number(env('MUSE_PAGES', '5'))
  const key = env('MUSE_API_KEY')
  const out = []
  for (let p = 1; p <= pages; p++) {
    const data = await getJson(`https://www.themuse.com/api/public/jobs?page=${p}&descending=true${key ? `&api_key=${key}` : ''}`)
    for (const j of data.results || []) {
      const locs = (j.locations || []).map(l => l.name)
      const location = locs.join(' / ')
      out.push({
        source: 'The Muse',
        externalId: j.id,
        title: j.name,
        company: j.company?.name,
        location,
        workModeHint: /flexible \/ remote|remote/i.test(location) ? 'remote' : '',
        levelHint: (j.levels || []).map(l => l.name),
        categoryHint: (j.categories || []).map(c => c.name),
        typeHint: (j.levels || []).map(l => l.name).join(' '),
        description: j.contents,
        tags: (j.categories || []).map(c => c.name),
        postedAt: j.publication_date,
        applyUrl: j.refs?.landing_page,
        sourceUrl: j.refs?.landing_page,
      })
    }
    if (p >= (data.page_count || 0)) break
  }
  return out
}

// Direct employer career pages (Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
// Recruitee) — see server/careerBoards.js. The board list comes from the defaults,
// env vars and the admin-managed career_boards table.
let lastBoardReport = {}
export const getBoardReport = () => lastBoardReport
async function careerPages(ctx = {}) {
  const boards = ctx.boards || mergeBoards()
  const { raw, report } = await fetchAllBoards(boards)
  lastBoardReport = report
  if (!raw.length && Object.values(report).every(r => !r.ok)) throw new Error('No career board responded')
  return raw
}

// MyJobMag — search-index style (excerpt + link back), robots.txt-checked, rate-limited.
async function myJobMag() {
  return fetchMyJobMag()
}

// ───────────────────────────── Key-based providers ─────────────────────────────

// JSearch indexes Google for Jobs → LinkedIn, Indeed, Glassdoor, ZipRecruiter, BeBee, company sites…
// https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch
const PUBLISHERS = [
  [/linkedin/i, 'LinkedIn'], [/indeed/i, 'Indeed'], [/glassdoor/i, 'Glassdoor'], [/ziprecruiter/i, 'ZipRecruiter'],
  [/wellfound|angel.?co|angellist/i, 'Wellfound'], [/jobberman/i, 'Jobberman'], [/myjobmag/i, 'MyJobMag'],
  [/hotnigerianjobs/i, 'HotNigerianJobs'], [/flexjobs/i, 'FlexJobs'], [/headhunter.ng/i, 'HeadHunter.ng'],
]
const publisherName = p => (PUBLISHERS.find(([re]) => re.test(p)) || [])[1] || p

async function jsearch() {
  const key = env('JSEARCH_API_KEY')
  const queries = list('JSEARCH_QUERIES',
    'jobs in Lagos Nigeria,jobs in Abuja Nigeria,graduate trainee Nigeria,remote jobs Nigeria,jobs in Nairobi Kenya,jobs in Accra Ghana,jobs in Johannesburg South Africa,startup jobs Africa,remote jobs Africa,visa sponsorship jobs')
  const out = []
  for (const q of queries) {
    try {
      const data = await getJson(
        `https://jsearch.p.rapidapi.com/search?query=${encodeURIComponent(q)}&page=1&num_pages=${env('JSEARCH_PAGES', '1')}&date_posted=week`,
        { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' } },
      )
      for (const j of data.data || []) {
        const where = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ')
        const publisher = j.job_publisher || 'Web'
        out.push({
          // Keep the original board (LinkedIn, Indeed…) as the visible source
          source: publisherName(publisher),
          externalId: j.job_id,
          title: j.job_title,
          company: j.employer_name,
          companyLogo: j.employer_logo,
          location: j.job_is_remote ? (where ? `Remote · ${where}` : 'Remote') : where,
          remote: j.job_is_remote === true ? true : undefined,
          typeHint: j.job_employment_type,
          levelHint: j.job_required_experience?.no_experience_required ? 'entry' : '',
          categoryHint: [j.job_title],
          salary: formatSalary(j.job_min_salary, j.job_max_salary, j.job_salary_currency, j.job_salary_period),
          description: j.job_description,
          tags: j.job_required_skills || [],
          postedAt: j.job_posted_at_datetime_utc || j.job_posted_at_timestamp,
          // Prefer the employer's own application page over a board's copy of the advert
          applyUrl: (j.apply_options || []).find(o => o.is_direct)?.apply_link || (j.job_apply_is_direct ? j.job_apply_link : null) || j.job_apply_link,
          sourceUrl: j.job_apply_link || j.job_google_link,
        })
      }
    } catch (e) { console.warn(`[jsearch:${q}] ${e.message}`) }
  }
  return out
}

// Adzuna: strong coverage for South Africa, UK, US, Canada, Australia, Europe.
async function adzuna() {
  const id = env('ADZUNA_APP_ID')
  const key = env('ADZUNA_APP_KEY')
  const out = []
  for (const country of list('ADZUNA_COUNTRIES', 'za,gb,us,ca')) {
    try {
      const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${id}&app_key=${key}&results_per_page=50&max_days_old=7&sort_by=date&content-type=application/json`)
      for (const j of data.results || []) {
        out.push({
          source: 'Adzuna',
          externalId: `${country}-${j.id}`,
          title: j.title,
          company: j.company?.display_name,
          location: j.location?.display_name,
          typeHint: `${j.contract_time || ''} ${j.contract_type || ''}`,
          categoryHint: j.category?.label,
          salary: formatSalary(j.salary_min, j.salary_max, { za: 'ZAR', gb: 'GBP', us: 'USD', ca: 'CAD', au: 'AUD' }[country] || 'USD', 'year'),
          description: j.description,
          postedAt: j.created,
          applyUrl: j.redirect_url,
          sourceUrl: j.redirect_url,
        })
      }
    } catch (e) { console.warn(`[adzuna:${country}] ${e.message}`) }
  }
  return out
}

// X (Twitter) API v2 recent search for hiring posts that include a link.
async function xPosts() {
  const token = env('X_BEARER_TOKEN')
  const query = env('X_QUERY', '("we\'re hiring" OR "we are hiring" OR "now hiring" OR "job opening") (remote OR hybrid OR "visa sponsorship" OR Africa) has:links -is:retweet -is:reply lang:en')
  const data = await getJson(
    `https://api.x.com/2/tweets/search/recent?max_results=100&query=${encodeURIComponent(query)}&tweet.fields=created_at,entities,author_id&expansions=author_id&user.fields=name,username,profile_image_url`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const users = new Map((data.includes?.users || []).map(u => [u.id, u]))
  return (data.data || []).map(t => {
    const link = (t.entities?.urls || []).map(u => u.unwound_url || u.expanded_url).find(u => u && !/(?:x|twitter)\.com\//i.test(u))
    if (!link) return null
    const author = users.get(t.author_id)
    const firstLine = t.text.split('\n').find(l => l.trim().length > 10) || t.text
    return {
      source: 'X',
      externalId: t.id,
      title: firstLine.replace(/https?:\/\/\S+/g, '').replace(/[#@]/g, '').trim().slice(0, 120),
      company: author?.name,
      companyLogo: author?.profile_image_url,
      description: t.text,
      categoryHint: [t.text],
      postedAt: t.created_at,
      applyUrl: link,
      sourceUrl: author ? `https://x.com/${author.username}/status/${t.id}` : link,
    }
  }).filter(Boolean)
}

// Upwork official GraphQL API (requires an approved Upwork API app + OAuth2 token).
async function upwork() {
  const token = env('UPWORK_ACCESS_TOKEN')
  const q = env('UPWORK_QUERY', 'developer OR designer OR marketing OR writer')
  const body = {
    query: `query($filter: MarketplaceJobPostingsSearchFilter) {
      marketplaceJobPostingsSearch(marketPlaceJobFilter: $filter) {
        edges { node { id title description createdDateTime ciphertext
          amount { displayValue } hourlyBudgetMin { displayValue } hourlyBudgetMax { displayValue }
          skills { name } occupations { category { prefLabel } } duration engagement } }
      } }`,
    variables: { filter: { searchExpression_eq: q } },
  }
  const data = await getJson('https://api.upwork.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (data.data?.marketplaceJobPostingsSearch?.edges || []).map(({ node: j }) => {
    const url = `https://www.upwork.com/jobs/${j.ciphertext || j.id}`
    const budget = j.amount?.displayValue && j.amount.displayValue !== '0.0' ? j.amount.displayValue
      : j.hourlyBudgetMin?.displayValue ? `${j.hourlyBudgetMin.displayValue}–${j.hourlyBudgetMax?.displayValue || ''}/hr` : null
    return {
      source: 'Upwork',
      externalId: j.id,
      title: j.title,
      company: 'Upwork client',
      location: 'Remote',
      remote: true,
      type: 'Freelance',
      categoryHint: [j.occupations?.category?.prefLabel, j.title],
      salary: budget,
      description: j.description,
      tags: (j.skills || []).map(s => s.name),
      postedAt: j.createdDateTime,
      applyUrl: url,
      sourceUrl: url,
    }
  })
}

// ───────────────────────────── Registry ─────────────────────────────

export const SOURCES = [
  { name: 'Remotive', run: remotive },
  { name: 'RemoteOK', run: remoteOk },
  { name: 'We Work Remotely', run: weWorkRemotely },
  { name: 'Arbeitnow', run: arbeitnow },
  { name: 'Jobicy', run: jobicy },
  { name: 'Himalayas', run: himalayas },
  { name: 'The Muse', run: theMuse, enabled: () => !!env('MUSE_API_KEY') }, // public API now returns 403 without a key
  { name: 'Company career pages', run: careerPages },
  { name: 'MyJobMag', run: myJobMag, enabled: () => env('MYJOBMAG_ENABLED', 'true') !== 'false' },
  { name: 'JSearch (LinkedIn, Indeed, Glassdoor, ZipRecruiter, Wellfound)', run: jsearch, enabled: () => !!env('JSEARCH_API_KEY') },
  { name: 'Adzuna', run: adzuna, enabled: () => !!(env('ADZUNA_APP_ID') && env('ADZUNA_APP_KEY')) },
  { name: 'X', run: xPosts, enabled: () => !!env('X_BEARER_TOKEN') },
  { name: 'Upwork', run: upwork, enabled: () => !!env('UPWORK_ACCESS_TOKEN') },
]

/** Run every enabled source in parallel; one failing source never blocks the rest. */
export async function collectJobs({ only, boards } = {}) {
  const active = SOURCES.filter(s => (!s.enabled || s.enabled()) && (!only || only.includes(s.name)))
  const report = {}
  const results = await Promise.all(active.map(async s => {
    const t0 = Date.now()
    try {
      const raw = await s.run({ boards })
      const jobs = raw.map(r => { try { return r && buildJob(r) } catch { return null } }).filter(Boolean)
      report[s.name] = { ok: true, fetched: raw.length, valid: jobs.length, ms: Date.now() - t0 }
      return jobs
    } catch (e) {
      report[s.name] = { ok: false, error: String(e.message || e).slice(0, 300), ms: Date.now() - t0 }
      return []
    }
  }))

  // Dedupe: same external id, or same title+company seen on several boards.
  const byId = new Map()
  const byKey = new Map()
  for (const job of results.flat()) {
    if (byId.has(job.external_id)) continue
    const key = `${job.title}|${job.company}`.toLowerCase().replace(/[^a-z0-9|]+/g, '')
    const prev = byKey.get(key)
    if (prev) {
      // keep the richer record, but merge the visa / relocation signals
      prev.visa_sponsorship ||= job.visa_sponsorship
      prev.relocation ||= job.relocation
      continue
    }
    byId.set(job.external_id, job)
    byKey.set(key, job)
  }
  return { jobs: [...byId.values()], report }
}
