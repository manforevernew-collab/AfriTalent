import { useState } from 'react'
import { BUSINESS_CATEGORIES, BUSINESS_COUNTRIES, CITIES, SOCIAL_ICONS, companyPayload } from '../lib/businesses'

const L = ({ children, htmlFor }) => <label htmlFor={htmlFor} className="form-label">{children}</label>
const SOCIAL_KEYS = ['facebook', 'instagram', 'x', 'linkedin', 'youtube', 'tiktok', 'whatsapp']

export default function BusinessForm({ initial = {}, submitLabel = 'Save', onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial.name || '', category: initial.category || initial.industry || '', description: initial.description || '',
    services: (initial.services || []).join(', '), address: initial.address || '', city: initial.city || '',
    country: initial.country || '', phone: initial.phone || '', email: initial.email || '', website: initial.website || '',
    opening_hours: initial.opening_hours || '', socials: { ...(initial.socials || {}) },
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (form.name.trim().length < 2) return setError('Enter the business name.')
    if (!form.city.trim() || !form.country.trim()) return setError('Enter the city and country.')
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return setError('Enter a valid email address.')
    setBusy(true)
    try { await onSubmit(companyPayload(form)) } catch (err) { setError(err.message || 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="biz-form">
      <div className="form-grid">
        <div className="span-2"><L htmlFor="bf-name">Business name *</L><input id="bf-name" className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
        <div><L htmlFor="bf-cat">Category</L>
          <select id="bf-cat" className="input" value={form.category} onChange={e => set('category', e.target.value)}>
            <option value="">Choose…</option>{BUSINESS_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select></div>
        <div><L htmlFor="bf-phone">Phone</L><input id="bf-phone" className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+234 …" /></div>
        <div className="span-2"><L htmlFor="bf-desc">About the business</L><textarea id="bf-desc" className="input" rows={4} value={form.description} onChange={e => set('description', e.target.value)} placeholder="What you do, who you serve, what makes you different" /></div>
        <div className="span-2"><L htmlFor="bf-svc">Services (comma separated)</L><input id="bf-svc" className="input" value={form.services} onChange={e => set('services', e.target.value)} placeholder="Web design, Mobile apps, IT support" /></div>
        <div className="span-2"><L htmlFor="bf-addr">Street address</L><input id="bf-addr" className="input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="12 Admiralty Way, Lekki Phase 1" /></div>
        <div><L htmlFor="bf-city">City *</L>
          <input id="bf-city" className="input" list="bf-cities" value={form.city} onChange={e => set('city', e.target.value)} />
          <datalist id="bf-cities">{CITIES.map(c => <option key={c.name} value={c.name} />)}</datalist></div>
        <div><L htmlFor="bf-country">Country *</L>
          <input id="bf-country" className="input" list="bf-countries" value={form.country} onChange={e => set('country', e.target.value)} />
          <datalist id="bf-countries">{BUSINESS_COUNTRIES.map(c => <option key={c} value={c} />)}</datalist></div>
        <div><L htmlFor="bf-web">Website</L><input id="bf-web" className="input" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://" /></div>
        <div><L htmlFor="bf-email">Public email</L><input id="bf-email" type="email" className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        <div className="span-2"><L htmlFor="bf-hours">Opening hours</L><input id="bf-hours" className="input" value={form.opening_hours} onChange={e => set('opening_hours', e.target.value)} placeholder="Mo-Fr 08:00-17:00; Sa 09:00-13:00" /></div>
      </div>
      <fieldset className="biz-socials">
        <legend>Social media</legend>
        <div className="form-grid">
          {SOCIAL_KEYS.map(k => (
            <div key={k} className="social-input">
              <i className={SOCIAL_ICONS[k]}></i>
              <input className="input" value={form.socials[k] || ''} aria-label={k}
                placeholder={k === 'whatsapp' ? 'https://wa.me/234…' : `https://${k === 'x' ? 'x' : k}.com/yourpage`}
                onChange={e => setForm(f => ({ ...f, socials: { ...f.socials, [k]: e.target.value } }))} />
            </div>
          ))}
        </div>
      </fieldset>
      {error && <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {error}</div>}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      </div>
    </form>
  )
}
