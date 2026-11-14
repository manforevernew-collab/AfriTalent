import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { timeAgo } from '../lib/jobs'
import { supabase } from '../lib/supabase'
import AdSlot from '../components/AdSlot'
import { sanitizeCompany } from '../lib/businesses'
import {
  fetchBusinesses, fetchLastBusinessSync, bizFiltersFromParams, bizFiltersToParams, BIZ_PAGE,
  CITIES, BUSINESS_COUNTRIES, BUSINESS_CATEGORIES, SOCIAL_ICONS,
} from '../lib/businesses'

const QUICK = ['Technology', 'Finance & Banking', 'Healthcare', 'Hospitality', 'Food & Drink', 'Legal', 'Real Estate', 'Education']

function BusinessCard({ c, featured }) {
  const services = (c.services || []).slice(0, 4)
  const socials = Object.entries(c.socials || {}).slice(0, 4)
  return (
    <article className={`biz-card ${featured ? 'featured' : ''}`}>
      <div className="biz-card-top">
        <div className="biz-avatar">{(c.name || '?').trim().charAt(0).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link to={`/businesses/${c.id}`} className="biz-name">{c.name}</Link>
          <div className="biz-cat">{c.category || c.industry || 'Business'}</div>
        </div>
        {featured ? <span className="pill pill-featured"><i className="fas fa-bolt"></i> Featured</span> : c.verified ? <span className="pill pill-verified" title="Owner verified by AfriTalent"><i className="fas fa-check-circle"></i> Verified</span>
          : c.claimed_by ? <span className="pill pill-muted">Owner managed</span> : null}
      </div>
      {(c.address || c.location) && (
        <div className="biz-line"><i className="fas fa-map-marker-alt"></i><span>{c.address || c.location}{c.address && c.country && !c.address.includes(c.country) ? `, ${c.country}` : ''}</span></div>
      )}
      {services.length > 0 && <div className="biz-services">{services.map(s => <span key={s} className="pill pill-muted">{s}</span>)}</div>}
      <div className="biz-card-foot">
        <div className="biz-contacts">
          {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} title={c.phone} aria-label="Call"><i className="fas fa-phone"></i></a>}
          {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" title="Website" aria-label="Website"><i className="fas fa-globe"></i></a>}
          {c.email && <a href={`mailto:${c.email}`} title={c.email} aria-label="Email"><i className="fas fa-envelope"></i></a>}
          {socials.map(([k, url]) => <a key={k} href={url} target="_blank" rel="noopener noreferrer nofollow" title={k} aria-label={k}><i className={SOCIAL_ICONS[k] || 'fas fa-link'}></i></a>)}
        </div>
        <Link to={`/businesses/${c.id}`} className="biz-view">View profile <i className="fas fa-arrow-right"></i></Link>
      </div>
      {c.source && c.source !== 'Owner' && c.source !== 'AfriTalent' && <div className="biz-source">via {c.source}</div>}
    </article>
  )
}

export default function Businesses() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => bizFiltersFromParams(params), [params])
  const [qInput, setQInput] = useState(filters.q)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [state, setState] = useState({ legacy: false, missing: false, error: null })
  const [lastSync, setLastSync] = useState(null)
  const req = useRef(0)

  const update = patch => setParams(bizFiltersToParams({ ...filters, ...patch }), { replace: true })
  const cityOptions = useMemo(() => CITIES.filter(c => !filters.country || c.country === filters.country).map(c => c.name), [filters.country])

  const load = useCallback(async (f, p) => {
    const id = ++req.current
    p === 0 ? setLoading(true) : setMore(true)
    try {
      const r = await fetchBusinesses(f, p)
      if (id !== req.current) return
      setRows(prev => (p === 0 ? r.companies : [...prev, ...r.companies]))
      setCount(r.count)
      setPage(p)
      setState({ legacy: r.legacy, missing: !!r.missing, error: null })
    } catch (e) {
      if (id === req.current) setState(s => ({ ...s, error: /failed to fetch/i.test(e.message) ? 'Can’t reach the directory right now. Please try again shortly.' : 'Could not load businesses.' }))
    } finally {
      if (id === req.current) { setLoading(false); setMore(false) }
    }
  }, [])

  useEffect(() => { load(filters, 0) }, [filters, load])
  useEffect(() => { setQInput(filters.q) }, [filters.q])
  useEffect(() => { fetchLastBusinessSync().then(setLastSync) }, [])
  const [featured, setFeatured] = useState([])
  useEffect(() => {
    supabase.from('companies').select('*').eq('is_active', true).gt('boosted_until', new Date().toISOString()).limit(3)
      .then(({ data, error }) => { if (!error) setFeatured((data || []).map(sanitizeCompany)) })
  }, [])
  const showFeatured = featured.length > 0 && !filters.q && !filters.category && !filters.city && !filters.country

  const cityCount = lastSync?.cities ? Object.values(lastSync.cities).filter(c => c.ok).length : null

  return (
    <div className="page-enter">
      <section className="jobs-hero">
        <div className="container">
          <div className="jobs-hero-inner">
            <h1>Discover African businesses</h1>
            <p>Verified companies, local services and employers across {CITIES.length} cities — with addresses, contacts and services.</p>
            <form className="jobs-search biz-search" onSubmit={e => { e.preventDefault(); update({ q: qInput.trim() }) }}>
              <div className="jobs-search-field">
                <i className="fas fa-search"></i>
                <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Business name, service or category" aria-label="Search businesses" />
              </div>
              <div className="jobs-search-field">
                <i className="fas fa-map-marker-alt"></i>
                <select value={filters.city} onChange={e => update({ city: e.target.value })} aria-label="City">
                  <option value="">All cities</option>
                  {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-primary jobs-search-btn">Search</button>
            </form>
            <div className="sync-status">
              <span className="live-dot" />
              {lastSync?.finished_at ? `Directory updated ${timeAgo(lastSync.finished_at)}${cityCount ? ` · ${cityCount} cities refreshed` : ''}` : 'Directory refreshed daily from public business listings'}
            </div>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div className="quick-chips">
          {QUICK.map(cat => (
            <button key={cat} type="button" className={`chip ${filters.category === cat ? 'chip-on' : ''}`} onClick={() => update({ category: filters.category === cat ? '' : cat })}>{cat}</button>
          ))}
        </div>

        <div className="biz-toolbar">
          <select className="input" value={filters.country} onChange={e => update({ country: e.target.value, city: '' })} aria-label="Country">
            <option value="">All countries</option>
            {BUSINESS_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={filters.category} onChange={e => update({ category: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {BUSINESS_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="biz-toggle">
            <input type="checkbox" checked={filters.verified} onChange={e => update({ verified: e.target.checked })} /> Verified owners only
          </label>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-outline" onClick={() => navigate(user ? '/businesses/new' : '/login?next=/businesses/new')}>
            <i className="fas fa-plus"></i> Add your business
          </button>
        </div>

        {state.missing && <div className="notice notice-warn"><i className="fas fa-database"></i> The business directory tables are not set up yet. Run <code>supabase-companies-reviews-migration.sql</code> and <code>supabase-kyc-business-migration.sql</code>.</div>}
        {state.legacy && !state.missing && <div className="notice notice-warn"><i className="fas fa-database"></i> Run <code>supabase-kyc-business-migration.sql</code> to enable addresses, services, filters and claiming.</div>}
        {state.error && <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {state.error}</div>}

        <AdSlot placement="businesses" />
        {showFeatured && <div className="biz-grid" style={{ marginBottom: 18 }}>{featured.map(c => <BusinessCard key={`f${c.id}`} c={c} featured />)}</div>}
        <div className="results-head" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{loading ? 'Loading…' : `${count.toLocaleString()} ${count === 1 ? 'business' : 'businesses'}`}</h2>
        </div>

        {loading ? (
          <div className="biz-grid">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="biz-card skeleton" style={{ height: 210 }} />)}</div>
        ) : rows.length ? (
          <>
            <div className="biz-grid">{rows.map(c => <BusinessCard key={c.id} c={c} />)}</div>
            {rows.length < count && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <button className="btn btn-outline load-more" onClick={() => load(filters, page + 1)} disabled={more}>
                  {more ? 'Loading…' : `Show more (${Math.min(BIZ_PAGE, count - rows.length)} of ${(count - rows.length).toLocaleString()} remaining)`}
                </button>
              </div>
            )}
          </>
        ) : !state.missing && (
          <div className="empty-state">
            <i className="fas fa-store-slash"></i>
            <h3>No businesses match</h3>
            <p>Try another city or category — or add your own business.</p>
          </div>
        )}

        <p className="biz-attrib">Public listings include data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> (ODbL). Business owners can claim and update their profiles.</p>
      </div>
    </div>
  )
}
