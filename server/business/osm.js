// OpenStreetMap business connector (Overpass API).
// OSM data is © OpenStreetMap contributors, licensed ODbL — it may be stored and
// shown with attribution, which the UI does on every imported profile.

import { categoryFromTags } from '../../shared/businessTaxonomy.js'

// Public Overpass instances, tried in order; a busy/rate-limited one falls through to the next.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const UA = 'AfriTalentBusinessBot/1.0 (AfriTalent business directory; daily import of public business listings)'

const AMENITIES = 'bank|bureau_de_change|money_transfer|clinic|hospital|doctors|dentist|pharmacy|veterinary|restaurant|cafe|fast_food|bar|pub|school|college|university|kindergarten|language_school|driving_school|fuel|car_rental|car_wash|coworking_space'

export function buildQuery([s, w, n, e], limit = 5000) {
  const b = `(${s},${w},${n},${e})`
  return `[out:json][timeout:120];(
  nwr["name"]["office"]["office"!~"^(government|diplomatic|political_party|religion)$"]${b};
  nwr["name"]["amenity"~"^(${AMENITIES})$"]${b};
  nwr["name"]["healthcare"]${b};
  nwr["name"]["tourism"~"^(hotel|guest_house|hostel|apartment)$"]${b};
  nwr["name"]["craft"]${b};
  nwr["name"]["shop"]["shop"!="vacant"]${b};
);out center tags ${limit};`
}

export async function fetchOverpass(query, { timeoutMs = 150_000 } = {}) {
  let lastErr
  for (const url of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status === 429 || res.status === 504) {
          lastErr = new Error(`${new URL(url).host} busy (${res.status})`)
          if (attempt === 0) await new Promise(r => setTimeout(r, 5000))
          continue
        }
        if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`)
        const json = await res.json()
        return json.elements || []
      } catch (e) {
        lastErr = new Error(`${new URL(url).host}: ${e.cause?.code || e.message}`)
        break // network-level failure: move on to the next instance
      }
    }
  }
  throw lastErr || new Error('All OpenStreetMap servers are unavailable')
}

// ---------- normalisation -----------------------------------------------------
const pretty = v => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

function safeUrl(u, base) {
  if (!u) return null
  let s = String(u).trim().split(';')[0].trim()
  if (base && !/^https?:\/\//i.test(s)) s = base + s.replace(/^@/, '')
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  try {
    const url = new URL(s)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}
const first = (t, ...keys) => { for (const k of keys) if (t[k]) return String(t[k]).split(';')[0].trim(); return null }

const SOCIALS = {
  facebook: ['https://facebook.com/', 'contact:facebook', 'facebook'],
  instagram: ['https://instagram.com/', 'contact:instagram', 'instagram'],
  x: ['https://x.com/', 'contact:twitter', 'twitter', 'contact:x'],
  linkedin: ['https://www.linkedin.com/company/', 'contact:linkedin', 'linkedin'],
  youtube: ['https://youtube.com/', 'contact:youtube', 'youtube'],
  tiktok: ['https://www.tiktok.com/@', 'contact:tiktok', 'tiktok'],
}

export function socialsFromTags(t) {
  const out = {}
  for (const [name, [base, ...keys]] of Object.entries(SOCIALS)) {
    const v = first(t, ...keys)
    const url = v && safeUrl(v, base)
    if (url) out[name] = url
  }
  const wa = first(t, 'contact:whatsapp', 'whatsapp')
  if (wa) {
    const digits = wa.replace(/[^\d]/g, '')
    if (digits.length >= 8) out.whatsapp = `https://wa.me/${digits}`
  }
  return out
}

function servicesFromTags(t) {
  const s = []
  for (const key of ['office', 'amenity', 'shop', 'craft', 'healthcare', 'tourism']) {
    if (t[key] && !['yes', 'company'].includes(t[key])) s.push(pretty(t[key]))
  }
  for (const key of ['cuisine', 'healthcare:speciality', 'service', 'services', 'clothes', 'sport']) {
    if (t[key]) String(t[key]).split(/[;,]/).forEach(v => v.trim() && s.push(pretty(v)))
  }
  for (const [k, v] of Object.entries(t)) {
    if (k.startsWith('service:') && v === 'yes') s.push(pretty(k.slice(8)))
  }
  if (t.delivery === 'yes') s.push('Delivery')
  if (t.takeaway === 'yes') s.push('Takeaway')
  if (t.reservation === 'yes' || t.reservation === 'recommended') s.push('Reservations')
  if (t.internet_access && t.internet_access !== 'no') s.push('Wi-Fi')
  if (t.wheelchair === 'yes') s.push('Wheelchair accessible')
  if (t.outdoor_seating === 'yes') s.push('Outdoor seating')
  if (t.air_conditioning === 'yes') s.push('Air conditioning')
  if (['payment:mobile_money', 'payment:mpesa', 'payment:m-pesa', 'payment:momo'].some(k => t[k] === 'yes')) s.push('Mobile money')
  if (['payment:cards', 'payment:debit_cards', 'payment:credit_cards', 'payment:visa', 'payment:mastercard'].some(k => t[k] === 'yes')) s.push('Card payments')
  if (t.stars) s.push(`${t.stars}-star`)
  const seen = new Set()
  return s.filter(v => v && v.length <= 40 && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase())).slice(0, 12)
}

function addressFromTags(t) {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')
  const parts = [t['addr:full'] || street, t['addr:suburb'] || t['addr:district'], t['addr:city'], t['addr:state'], t['addr:postcode']]
  return [...new Set(parts.filter(Boolean).map(p => String(p).trim()))].join(', ') || null
}

/** Map an Overpass element to a companies row (or null when unusable). */
export function toCompany(el, city) {
  const t = el.tags || {}
  const name = (t.name || '').trim()
  if (!name || name.length > 150) return null
  const website = safeUrl(first(t, 'website', 'contact:website', 'url'))
  const phone = first(t, 'phone', 'contact:phone', 'contact:mobile', 'mobile')
  const email = first(t, 'email', 'contact:email')
  const address = addressFromTags(t)
  const socials = socialsFromTags(t)
  // Quality bar: something a person can act on (contact, website, social or street address)
  if (!website && !phone && !email && !address && !Object.keys(socials).length) return null

  const lat = el.lat ?? el.center?.lat ?? null
  const lng = el.lon ?? el.center?.lon ?? null
  const category = categoryFromTags(t)
  const description = (t.description || t.note || '').trim().slice(0, 1000) || null
  return {
    external_id: `osm:${el.type}/${el.id}`,
    source: 'OpenStreetMap',
    source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name,
    industry: category,
    category,
    description,
    services: servicesFromTags(t),
    address,
    city: t['addr:city'] && t['addr:city'].length < 60 ? t['addr:city'] : city.name,
    country: city.country,
    location: [t['addr:city'] || city.name, city.country].join(', '),
    lat, lng,
    phone: phone ? phone.slice(0, 40) : null,
    email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email.slice(0, 120) : null,
    website,
    opening_hours: t.opening_hours ? String(t.opening_hours).slice(0, 200) : null,
    socials,
    brand: t.brand || null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  }
}

export async function fetchCityBusinesses(city, { limit } = {}) {
  const els = await fetchOverpass(buildQuery(city.bbox, limit))
  const rows = []
  const seen = new Set()
  for (const el of els) {
    const row = toCompany(el, city)
    if (!row || seen.has(row.external_id)) continue
    // the same branch is sometimes mapped as both a node and a building
    const key = `${row.name.toLowerCase()}|${row.phone || row.website || row.address}`
    if (seen.has(key)) continue
    seen.add(row.external_id); seen.add(key)
    rows.push(row)
  }
  return { fetched: els.length, rows }
}
