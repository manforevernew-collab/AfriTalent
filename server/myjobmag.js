// MyJobMag (Nigeria) — indexed like a search engine: title, employer, location,
// type, a short excerpt and a link back to the role's own MyJobMag page, where
// candidates read the full advert and apply. No full adverts are copied.
//
// Allowed by MyJobMag's robots.txt (/jobs/ and /job/ pages); robots.txt is
// re-checked for every URL, requests are sequential and rate-limited.

import { robotsAllows } from './robots.js'
import { decodeEntities } from './normalize.js'

const UA = 'AfriTalentJobBot/2.0 (+https://afritalent.app/jobs; job search index linking back to source)'
const SITES = {
  ng: { host: 'https://www.myjobmag.com', country: 'Nigeria' },
  gh: { host: 'https://www.myjobmag.com.gh', country: 'Ghana' },
  ke: { host: 'https://www.myjobmag.co.ke', country: 'Kenya' },
  za: { host: 'https://www.myjobmag.co.za', country: 'South Africa' },
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const text = s => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp(?!;)/g, ' ')).replace(/\s+/g, ' ').trim() // \s also matches NBSP

async function get(url) {
  if (!(await robotsAllows(url, { userAgent: UA }))) throw Object.assign(new Error('blocked by robots.txt'), { robots: true })
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
function parseDate(s) {
  const m = String(s || '').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/)
  return m && MONTHS[m[1].toLowerCase()] != null ? new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2], 9)).toISOString() : null
}

/** Parse one MyJobMag listing page into one raw job per position (pure; unit-tested). */
export function parseListing(html, pageUrl, country = 'Nigeria') {
  const origin = new URL(pageUrl).origin
  const h1 = text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1])
  const company = (h1.match(/\bat\s+(.+)$/i) || [])[1]?.trim() || null
  const flat = text(html.slice(0, 200000))
  const posted = parseDate((flat.match(/Posted:\s*([A-Za-z]{3,9}\.? \d{1,2},? \d{4})/i) || [])[1])
  const expiresRaw = (flat.match(/Expires:\s*(Not specified|[A-Za-z]{3,9}\.? \d{1,2},? \d{4})/i) || [])[1] || ''
  const expires = /not specified/i.test(expiresRaw) ? null : parseDate(expiresRaw)
  if (expires && new Date(expires) < new Date()) return []

  const out = []
  const re = /<h2[^>]*id=["']job(\d+)["'][^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[\s>]|$)/gi
  let m
  while ((m = re.exec(html))) {
    const [, id, head, body] = m
    const link = (head.match(/href=["']([^"']+)["']/) || [])[1]
    const title = text(head)
    if (!title || !link) continue
    const info = {}
    for (const k of body.matchAll(/jkey-title["'][^>]*>([\s\S]*?)<\/span>\s*<span[^>]*jkey-info["'][^>]*>([\s\S]*?)<\/span>/gi)) {
      info[text(k[1]).toLowerCase()] = text(k[2])
    }
    const details = (body.match(/<div[^>]*class=["']job-details["'][^>]*>([\s\S]*)/i) || [])[1] || ''
    let excerpt = text(details).slice(0, 420)
    if (excerpt.length === 420) excerpt = excerpt.replace(/\s+\S*$/, '') + '…'
    const roleUrl = new URL(link, origin).toString()
    const location = info.location ? `${info.location}, ${country}` : country
    out.push({
      source: 'MyJobMag',
      externalId: id,
      title,
      company: company || 'Employer on MyJobMag',
      location,
      remote: /remote/i.test(info.location || '') ? true : undefined,
      typeHint: info['job type'],
      levelHint: /0\s*-\s*1|entry|graduate|intern/i.test(info.experience || '') ? 'entry' : '',
      categoryHint: [info['job field'], title],
      description: `${excerpt}\n\nExperience: ${info.experience || 'Not specified'} · Qualification: ${info.qualification || 'Not specified'}\nRead the full advert and apply on MyJobMag.`,
      postedAt: posted,
      applyUrl: roleUrl,
      sourceUrl: roleUrl,
    })
  }
  return out
}

/** Newest listing pages from the jobs sitemap, then one polite request per page. */
export async function fetchMyJobMag({ pages = Number(process.env.MYJOBMAG_PAGES) || 30, sites = (process.env.MYJOBMAG_SITES || 'ng').split(','), delayMs = 700 } = {}) {
  const out = []
  for (const code of sites.map(s => s.trim()).filter(s => SITES[s])) {
    const { host, country } = SITES[code]
    let xml
    try { xml = await get(`${host}/sitemap-main-jobs.xml`) } catch (e) { if (code === 'ng') throw e; continue }
    const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(x => x[1]).filter(u => /\/jobs\//.test(u)).slice(0, pages)
    for (const url of urls) {
      try {
        out.push(...parseListing(await get(url), url, country))
      } catch (e) {
        if (e.robots) continue
      }
      await sleep(delayMs)
    }
  }
  return out
}
