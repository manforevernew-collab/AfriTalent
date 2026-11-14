// Shared normalisation helpers for the job aggregator.
// Every source connector maps its raw payload into the same "job row" shape
// so the database and UI can filter consistently (work mode, visa, level...).

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•',
}

export function decodeEntities(str = '') {
  return String(str).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** HTML (possibly entity-escaped) -> readable plain text with paragraph breaks. */
export function htmlToText(html = '', maxLen = 6000) {
  let s = String(html || '')
  // Some feeds double-escape their HTML (&lt;p&gt;) — decode once first if so.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s)
  // In HTML, source newlines are just whitespace; plain-text feeds keep theirs.
  if (/<\/?(p|div|br|li|ul|ol|h[1-6]|span|strong|b|em)\b/i.test(s)) s = s.replace(/\s*\n\s*/g, ' ')
  s = s
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|li|tr|section)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/•\s*\n+/g, '• ')        // bullet whose text was wrapped in <p>
    .replace(/\n+(?=• )/g, '\n')      // keep list items on consecutive lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, '') + '…'
  return s
}

const NO_VISA = /\b(no|not|unable to|cannot|can['’]?t|won['’]?t|will not|do(es)? not|without( the need for)?)\b[^.\n]{0,40}\b(visa|sponsor)/i
const YES_VISA = /\b(visa sponsorship|sponsor(ship)? (of |for )?(your |a |the )?(work )?visa|visa support|h-?1b (sponsorship|transfer)|we (can |will |do )?sponsor|sponsorship (is )?available|relocation (and|&) visa|visa (and|&) relocation)\b/i

/** true when the text clearly offers visa sponsorship, false otherwise. */
export function detectVisaSponsorship(...texts) {
  const t = texts.filter(Boolean).join(' \n ')
  if (!t) return false
  if (NO_VISA.test(t) && !/\bvisa sponsorship (is )?available\b/i.test(t)) return false
  return YES_VISA.test(t)
}

export function detectRelocation(...texts) {
  const t = texts.filter(Boolean).join(' ')
  return /\brelocation (assistance|package|support|bonus|allowance)|\b(we|will) (help|assist) (you )?relocat|\brelocation (is )?(provided|offered|available)/i.test(t)
}

/** Remote | Hybrid | On-site */
export function detectWorkMode({ remoteFlag, hint = '', location = '', title = '', description = '' } = {}) {
  const lead = `${hint} ${title} ${location}`
  if (/\bhybrid\b/i.test(lead)) return 'Hybrid'
  if (/\b(on[- ]?site|in[- ]office|onsite)\b/i.test(hint)) return 'On-site'
  if (remoteFlag === true) return 'Remote'
  if (/\b(remote|anywhere|worldwide|work from home|wfh|distributed|flexible \/ remote)\b/i.test(lead)) return 'Remote'
  if (/\bhybrid (role|position|work|working|model|schedule)\b/i.test(description)) return 'Hybrid'
  if (remoteFlag === false) return 'On-site'
  if (/\b(fully|100%) remote\b/i.test(description)) return 'Remote'
  return 'On-site'
}

/** Full-time | Part-time | Contract | Freelance | Internship | Temporary */
export function normalizeType(raw = '', title = '') {
  const s = `${Array.isArray(raw) ? raw.join(' ') : raw} ${title}`.toLowerCase()
  if (/intern(ship)?\b/.test(s)) return 'Internship'
  if (/freelanc/.test(s)) return 'Freelance'
  if (/contract|contractor|consultant|\bc2c\b/.test(s)) return 'Contract'
  if (/part[\s_-]?time/.test(s)) return 'Part-time'
  if (/temp(orary)?\b|seasonal/.test(s)) return 'Temporary'
  return 'Full-time'
}

/** Internship | Entry | Mid | Senior | Executive */
export function detectLevel(title = '', hint = '') {
  const s = `${Array.isArray(hint) ? hint.join(' ') : hint} | ${title}`.toLowerCase()
  if (/\bintern(ship)?\b/.test(s)) return 'Internship'
  if (/\b(chief|c[etfo]o|vp|vice president|head of|director|partner)\b/.test(s)) return 'Executive'
  if (/\b(graduate|grad|entry[\s-]?level|entry|junior|jr\.?|trainee|apprentice|new grad|associate i\b)/.test(s)) return 'Entry'
  if (/\b(senior|sr\.?|lead|principal|staff|manager|expert)\b/.test(s)) return 'Senior'
  return 'Mid'
}

const CATEGORY_RULES = [
  ['Data', /\b(data|analytics|machine learning|\bml\b|\bai\b|scientist|bi\b|business intelligence)/i],
  ['Design', /\b(design|designer|ux|ui\b|creative|illustrat|figma|graphic)/i],
  ['Engineering', /\b(engineer(ing)?|developer|devops|sre|programm|software|full[- ]?stack|back[- ]?end|front[- ]?end|mobile|qa\b|test|architect)/i],
  ['Technology', /\b(it\b|tech|cloud|security|cyber|network|sysadmin|system administrator|support engineer)/i],
  ['Product', /\b(product (manager|owner|lead)|product management|scrum|project manager|program manager)/i],
  ['Marketing', /\b(marketing|seo|sem\b|growth|social media|content|brand|communications|pr\b|copywrit|paid ads|advertising|ads specialist|campaign)/i],
  ['Sales', /\b(sales|account executive|business development|bdr|sdr|account manager|partnerships|dealer|commercial|key account)/i],
  ['Customer Support', /\b(customer (support|service|success|experience)|support specialist|help ?desk|call cent)/i],
  ['Finance', /\b(financ|accountant|accounting|bookkeep|audit|tax|payroll|controller|treasury|investment)/i],
  ['HR', /\b(hr\b|human resources|recruit|talent acquisition|people (ops|operations|partner))/i],
  ['Healthcare', /\b(nurse|nursing|medical|health|clinical|physician|pharma|doctor|therap)/i],
  ['Education', /\b(teach|teacher|tutor|education|instructor|lecturer|curriculum|trainer)/i],
  ['Legal', /\b(legal|lawyer|attorney|paralegal|counsel|compliance|grc|risk|regulatory)/i],
  ['Media', /\b(writer|editor|journalist|video|media|photograph|translator|producer)/i],
  ['Operations', /\b(operations|logistics|supply chain|admin(istrative)?|assistant|office manager|procurement|strateg|project|category manager|consultant|analyst|coordinator)/i],
]

export const CATEGORIES = ['Technology', 'Engineering', 'Data', 'Design', 'Product', 'Marketing', 'Sales',
  'Customer Support', 'Finance', 'HR', 'Operations', 'Healthcare', 'Education', 'Legal', 'Media', 'Other']

export function detectCategory(...hints) {
  const primary = hints.filter(Boolean).map(h => (Array.isArray(h) ? h.join(' ') : String(h)))
  for (const text of primary) {
    for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat
  }
  return 'Other'
}

export function formatSalary(min, max, currency = 'USD', period = '') {
  const lo = Number(min) || 0
  const hi = Number(max) || 0
  if (!lo && !hi) return null
  const sym = { USD: '$', EUR: '€', GBP: '£', ZAR: 'R', NGN: '₦', KES: 'KSh ', CAD: 'C$', AUD: 'A$' }[String(currency || 'USD').toUpperCase()] ?? `${currency} `
  const fmt = n => (n >= 1000 ? `${sym}${Math.round(n / 1000)}k` : `${sym}${n}`)
  const per = /hour/i.test(period) ? '/hr' : /month/i.test(period) ? '/mo' : /year|annual/i.test(period) ? '/yr' : ''
  return lo && hi && lo !== hi ? `${fmt(lo)} – ${fmt(hi)}${per}` : `${fmt(lo || hi)}${per}`
}

export function toIso(value) {
  if (value === null || value === undefined || value === '') return new Date().toISOString()
  let d
  if (typeof value === 'number') d = new Date(value < 1e12 ? value * 1000 : value)
  else {
    // "2026-11-04T16:53:35" without a zone is UTC in these feeds
    const s = String(value)
    d = new Date(/T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s) ? `${s}Z` : s)
  }
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  // Never store a future posted date
  return (d.getTime() > Date.now() ? new Date() : d).toISOString()
}

function cleanTags(tags) {
  const out = []
  for (const t of tags || []) {
    const v = String(t || '').trim()
    if (v && v.length <= 40 && !out.some(o => o.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  return out.slice(0, 8)
}

function safeUrl(u) {
  try {
    const url = new URL(String(u || '').trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}

/**
 * Build the final DB row. `raw` fields are already source-mapped; this applies
 * all the shared detection so every source gets identical filter semantics.
 */
export function buildJob(raw) {
  const description = htmlToText(raw.description || '')
  const title = decodeEntities(String(raw.title || '')).trim()
  const company = decodeEntities(String(raw.company || '')).trim() || 'Confidential'
  const location = decodeEntities(String(raw.location || '')).trim()
  const applyUrl = safeUrl(raw.applyUrl) || safeUrl(raw.sourceUrl)
  if (!title || !applyUrl || !raw.externalId) return null

  const workMode = raw.workMode || detectWorkMode({
    remoteFlag: raw.remote, hint: raw.workModeHint, location, title, description,
  })
  const visa = raw.visaSponsorship === true || detectVisaSponsorship(title, raw.tags?.join(' '), description)
  return {
    external_id: `${raw.source.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${raw.externalId}`.slice(0, 200),
    source: raw.source,
    source_url: safeUrl(raw.sourceUrl) || applyUrl,
    apply_url: applyUrl,
    title: title.slice(0, 200),
    company: company.slice(0, 150),
    company_logo: safeUrl(raw.companyLogo),
    location: (location || (workMode === 'Remote' ? 'Remote' : 'Not specified')).slice(0, 200),
    work_mode: workMode,
    visa_sponsorship: visa,
    relocation: raw.relocation === true || detectRelocation(description),
    type: raw.type || normalizeType(raw.typeHint, title),
    experience_level: raw.level || detectLevel(title, raw.levelHint),
    category: raw.category || detectCategory(raw.categoryHint, title),
    salary: raw.salary || 'Not disclosed',
    description: description || `${title} at ${company}. See the full listing for details.`,
    required_skills: cleanTags(raw.tags),
    posted_at: toIso(raw.postedAt),
    is_external: true,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  }
}
