import { supabase } from './supabase'
import { safeHref } from './jobs'
import { CITIES, BUSINESS_COUNTRIES, BUSINESS_CATEGORIES } from '../../shared/businessTaxonomy.js'

export { CITIES, BUSINESS_COUNTRIES, BUSINESS_CATEGORIES }
export const BIZ_PAGE = 24
export const EMPTY_BIZ_FILTERS = { q: '', country: '', city: '', category: '', verified: false }

export function bizFiltersFromParams(p) {
  return { q: p.get('q') || '', country: p.get('country') || '', city: p.get('city') || '', category: p.get('category') || '', verified: p.get('verified') === '1' }
}
export function bizFiltersToParams(f) {
  const o = {}
  if (f.q) o.q = f.q
  if (f.country) o.country = f.country
  if (f.city) o.city = f.city
  if (f.category) o.category = f.category
  if (f.verified) o.verified = '1'
  return o
}

const clean = s => String(s || '').replace(/[,()*%\\:"]/g, ' ').trim().toLowerCase()

/** Strip unsafe URLs from a company row before rendering. */
export function sanitizeCompany(c) {
  if (!c) return c
  const socials = {}
  for (const [k, v] of Object.entries(c.socials || {})) { const u = safeHref(v); if (u) socials[k] = u }
  return { ...c, website: safeHref(c.website), source_url: safeHref(c.source_url), logo_url: safeHref(c.logo_url), socials }
}

/** { companies, count, legacy, missing } — legacy = directory migration not run yet. */
export async function fetchBusinesses(filters, page = 0) {
  const from = page * BIZ_PAGE
  let q = supabase.from('companies').select('*', { count: 'exact' }).eq('is_active', true)
  const term = clean(filters.q)
  if (term) q = q.ilike('search_text', `%${term}%`)
  if (filters.country) q = q.eq('country', filters.country)
  if (filters.city) q = q.ilike('city', clean(filters.city))
  if (filters.category) q = q.eq('category', filters.category)
  if (filters.verified) q = q.eq('verified', true)
  q = q.order('verified', { ascending: false }).order('name').range(from, from + BIZ_PAGE - 1)
  const { data, error, count } = await q
  if (!error) return { companies: (data || []).map(sanitizeCompany), count: count ?? 0, legacy: false }

  if (error.code === 'PGRST205' || /could not find the table/i.test(error.message)) return { companies: [], count: 0, legacy: true, missing: true }
  if (error.code !== '42703' && !/column .* does not exist/i.test(error.message)) throw error
  // Old schema: name/industry/location only
  const { data: all, error: e2 } = await supabase.from('companies').select('*').order('name')
  if (e2) throw e2
  const t = term
  const rows = (all || []).filter(c => !t || `${c.name} ${c.industry} ${c.location}`.toLowerCase().includes(t))
  return { companies: rows.slice(from, from + BIZ_PAGE).map(sanitizeCompany), count: rows.length, legacy: true }
}

export async function fetchCompany(id) {
  const { data, error } = await supabase.from('companies').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return sanitizeCompany(data)
}

export async function fetchLastBusinessSync() {
  const { data, error } = await supabase.from('business_sync_runs').select('finished_at,status,upserted,cities')
    .order('finished_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  return error ? null : data
}

export function directionsUrl(c) {
  if (c.lat && c.lng) return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.name, c.address || c.city, c.country].filter(Boolean).join(', '))}`
}
export function googleMapsUrl(c) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.name, c.address || c.city, c.country].filter(Boolean).join(', '))}`
}
export function osmEmbedUrl(c) {
  if (!c.lat || !c.lng) return null
  const d = 0.006
  return `https://www.openstreetmap.org/export/embed.html?bbox=${c.lng - d},${c.lat - d},${c.lng + d},${c.lat + d}&layer=mapnik&marker=${c.lat},${c.lng}`
}

export const SOCIAL_ICONS = {
  facebook: 'fab fa-facebook', instagram: 'fab fa-instagram', x: 'fab fa-twitter', linkedin: 'fab fa-linkedin',
  youtube: 'fab fa-youtube', tiktok: 'fab fa-tiktok', whatsapp: 'fab fa-whatsapp',
}

/** Fields an owner may edit (everything else is protected server-side). */
export const EDITABLE_FIELDS = ['name', 'category', 'description', 'services', 'address', 'city', 'country', 'phone', 'email', 'website', 'opening_hours', 'socials', 'logo_url']

export function companyPayload(form) {
  const services = (Array.isArray(form.services) ? form.services : String(form.services || '').split(','))
    .map(s => s.trim()).filter(Boolean).slice(0, 20)
  const socials = {}
  for (const [k, v] of Object.entries(form.socials || {})) { const u = safeHref(v); if (u) socials[k] = u }
  const website = form.website ? safeHref(/^https?:\/\//i.test(form.website) ? form.website : `https://${form.website}`) : null
  return {
    name: String(form.name || '').trim().slice(0, 150),
    category: form.category || 'Other',
    industry: form.category || 'Other',
    description: String(form.description || '').trim().slice(0, 2000) || null,
    services,
    address: String(form.address || '').trim().slice(0, 300) || null,
    city: String(form.city || '').trim().slice(0, 80) || null,
    country: String(form.country || '').trim().slice(0, 80) || null,
    location: [form.city, form.country].filter(Boolean).join(', ') || null,
    phone: String(form.phone || '').trim().slice(0, 40) || null,
    email: String(form.email || '').trim().slice(0, 120) || null,
    website,
    opening_hours: String(form.opening_hours || '').trim().slice(0, 200) || null,
    socials,
  }
}
