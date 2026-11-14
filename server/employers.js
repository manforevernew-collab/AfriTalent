// Business discovery from job sources: every employer that is actively hiring
// in Africa (or runs a career board we follow) gets a business-directory profile,
// which owners can then claim. Existing profiles — imported or claimed — are
// never modified (insert-only upsert).

import { PROVIDER_LABEL } from './careerBoards.js'

const COUNTRIES = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Egypt', 'Uganda', 'Rwanda', 'Tanzania', 'Ethiopia', 'Morocco',
  'Senegal', "Côte d'Ivoire", 'Cameroon', 'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Angola', 'Mozambique', 'Tunisia']
const GENERIC = /^(confidential|anonymous|employer on|a (reputable|leading|well)|our client|private|undisclosed|company|n\/?a|various|multiple|recruit(er|ment agency)$)/i
const JOB_TO_BIZ = {
  Engineering: 'Technology', Technology: 'Technology', Data: 'Technology', Design: 'Marketing & Media', Product: 'Technology',
  Marketing: 'Marketing & Media', Sales: 'Professional Services', 'Customer Support': 'Professional Services', Finance: 'Finance & Banking',
  HR: 'Recruitment', Healthcare: 'Healthcare', Education: 'Education', Legal: 'Legal', Media: 'Marketing & Media', Operations: 'Professional Services',
}

export const employerSlug = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(limited|ltd|plc|inc|llc|nigeria|ng|group|company|co|technologies|technology|tech|holdings|international|intl)\b\.?/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// The employer's own name is a better signal of what the business does than one job title.
const NAME_RULES = [
  [/\b(college|school|university|academy|institute|polytechnic|nursery|montessori)\b/i, 'Education'],
  [/\b(hospital|clinic|dental|medical|pharma|pharmacy|health|diagnostics?|laborator(y|ies)|nursing home)\b/i, 'Healthcare'],
  [/\b(bank|microfinance|finance|capital|insurance|assurance|pensions?|fintech)\b/i, 'Finance & Banking'],
  [/\b(farms?|agro|agric|foods?|poultry|organic)\b/i, 'Agriculture'],
  [/\b(hotel|resort|suites|lodge|restaurant|bakery|cafe|kitchen)\b/i, 'Hospitality'],
  [/\b(law|legal|chambers|solicitors|attorneys)\b/i, 'Legal'],
  [/\b(logistics|shipping|haulage|transport|courier)\b/i, 'Logistics & Transport'],
  [/\b(properties|realty|estates?|homes)\b/i, 'Real Estate'],
  [/\b(construction|engineering|builders)\b/i, 'Construction & Engineering'],
  [/\b(consult|consulting|advisory)\b/i, 'Consulting'],
  [/\b(foundation|ngo|initiative|charity|relief|humanitarian)\b/i, 'Non-profit'],
]
const cleanPlace = s => String(s || '').replace(/^\s*remote\s*[·\-–:]\s*/i, '').trim()

function countryOf(location = '') {
  return COUNTRIES.find(c => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(location)) || null
}

/** Build candidate company rows (pure). */
export function employerRows(jobs, boards = [], boardReport = {}) {
  const rows = new Map()
  // Career-board employers (rich, curated)
  for (const b of boards) {
    const rep = boardReport[`${PROVIDER_LABEL[b.provider]}:${b.slug}`]
    if (!b.company || (rep && !rep.ok)) continue
    rows.set(employerSlug(b.company), {
      external_id: `career:${b.provider}:${b.slug.toLowerCase()}`,
      source: 'Career page',
      source_url: b.website || null,
      name: b.company,
      category: b.category || 'Technology',
      industry: b.category || 'Technology',
      website: b.website || null,
      country: b.country || null,
      location: b.country || (b.scope === 'remote_or_africa' ? 'Remote-friendly' : null),
      description: `${b.company} is hiring${b.scope === 'remote_or_africa' ? ' remote and Africa-based talent' : ''}. Roles are imported hourly from its official careers page.`,
      services: [],
    })
  }
  // Employers with African roles on job boards
  const counts = new Map()
  for (const j of jobs) {
    const name = String(j.company || '').trim()
    const country = countryOf(j.location)
    if (!name || name.length < 2 || name.length > 120 || GENERIC.test(name) || !country) continue
    const slug = employerSlug(name)
    if (!slug || rows.has(slug)) continue
    const firstPart = cleanPlace(String(j.location).split(',')[0])
    const city = firstPart && firstPart.toLowerCase() !== country.toLowerCase() ? firstPart : null
    const c = counts.get(slug) || { name, country, city, cats: [], url: j.source_url, sources: new Set(), n: 0 }
    c.n++; c.cats.push(j.category); c.sources.add(j.source)
    counts.set(slug, c)
  }
  for (const [slug, c] of counts) {
    const top = c.cats.sort((a, b) => c.cats.filter(x => x === b).length - c.cats.filter(x => x === a).length)[0]
    const category = (NAME_RULES.find(([re]) => re.test(c.name)) || [])[1] || JOB_TO_BIZ[top] || 'Other'
    rows.set(slug, {
      external_id: `employer:${slug}`,
      source: 'Hiring employer',
      source_url: c.url || null,
      name: c.name,
      category, industry: category,
      city: c.city ? c.city.slice(0, 80) : null,
      country: c.country,
      location: [c.city, c.country].filter(Boolean).join(', '),
      description: `${c.name} is currently hiring in ${c.country} (seen on ${[...c.sources].join(', ')}). Is this your business? Claim the profile to add your address, services and contacts.`,
      services: [],
    })
  }
  return [...rows.values()]
}

export async function discoverEmployers(db, jobs, boards, boardReport, { dryRun = false } = {}) {
  let rows = employerRows(jobs, boards, boardReport)
  if (dryRun || !db || !rows.length) return rows
  // Skip names that already have a profile (e.g. from OpenStreetMap or an owner)
  const existing = new Set()
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await db.from('companies').select('name').in('name', rows.slice(i, i + 200).map(r => r.name))
    for (const d of data || []) existing.add(employerSlug(d.name))
  }
  rows = rows.filter(r => !existing.has(employerSlug(r.name)))
  const added = []
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const { data, error } = await db.from('companies').upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: true }).select('id')
    if (error) throw error
    added.push(...(data || []))
  }
  return added
}
