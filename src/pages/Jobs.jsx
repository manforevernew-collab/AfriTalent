import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  WORK_MODES, JOB_TYPES, LEVELS, CATEGORIES, SOURCES, DATE_RANGES, SORTS, PAGE_SIZE, EMPTY_FILTERS,
  filtersFromParams, filtersToParams, activeFilterCount, fetchJobs, fetchLastSync, timeAgo,
} from '../lib/jobs'
import JobCard from '../components/JobCard'
import AdSlot from '../components/AdSlot'
import { supabase } from '../lib/supabase'
import { sanitizeJob } from '../lib/jobs'

const QUICK = [
  { label: 'Remote', icon: 'fas fa-globe', test: f => f.modes.includes('Remote'), toggle: f => ({ ...f, modes: toggle(f.modes, 'Remote') }) },
  { label: 'Hybrid', icon: 'fas fa-random', test: f => f.modes.includes('Hybrid'), toggle: f => ({ ...f, modes: toggle(f.modes, 'Hybrid') }) },
  { label: 'On-site', icon: 'fas fa-building', test: f => f.modes.includes('On-site'), toggle: f => ({ ...f, modes: toggle(f.modes, 'On-site') }) },
  { label: 'Visa sponsorship', icon: 'fas fa-passport', test: f => f.visa, toggle: f => ({ ...f, visa: !f.visa }) },
  { label: 'Relocation support', icon: 'fas fa-plane-departure', test: f => f.relocation, toggle: f => ({ ...f, relocation: !f.relocation }) },
  { label: 'Graduate / Entry', icon: 'fas fa-user-graduate', test: f => f.levels.includes('Entry'), toggle: f => ({ ...f, levels: toggle(f.levels, 'Entry') }) },
  { label: 'Internships', icon: 'fas fa-seedling', test: f => f.types.includes('Internship'), toggle: f => ({ ...f, types: toggle(f.types, 'Internship') }) },
  { label: 'Past 24h', icon: 'fas fa-bolt', test: f => f.days === '1', toggle: f => ({ ...f, days: f.days === '1' ? '' : '1' }) },
]

function toggle(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

const REFRESH_MS = 10 * 60 * 1000

export default function Jobs() {
  const { isBusiness, kycVerified, addressVerified } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams))
  const [draft, setDraft] = useState({ q: filters.q, location: filters.location })
  const [jobs, setJobs] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [legacy, setLegacy] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [newRolesReady, setNewRolesReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const syncRef = useRef(null)
  const requestId = useRef(0)

  const load = useCallback(async (f, p = 0) => {
    const id = ++requestId.current
    p === 0 ? setLoading(true) : setLoadingMore(true)
    setError(null)
    try {
      const res = await fetchJobs(f, p)
      if (id !== requestId.current) return
      setJobs(prev => (p === 0 ? res.jobs : [...prev, ...res.jobs]))
      setCount(res.count)
      setLegacy(res.legacy)
      setPage(p)
    } catch (e) {
      if (id === requestId.current) setError(/failed to fetch|networkerror|load failed/i.test(e.message || '')
        ? 'Can’t reach the jobs database right now. Check your connection and try again in a moment.'
        : 'Could not load jobs. Please try again.')
    } finally {
      if (id === requestId.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [])

  // Reload whenever filters change, and mirror them into the URL (shareable searches)
  useEffect(() => {
    setSearchParams(filtersToParams(filters), { replace: true })
    load(filters, 0)
    setNewRolesReady(false)
  }, [filters, load, setSearchParams])

  // Live status: show when the importer last ran and offer fresh results after each hourly sync
  useEffect(() => {
    let alive = true
    async function poll() {
      const s = await fetchLastSync()
      if (!alive || !s) return
      if (syncRef.current && s.finished_at !== syncRef.current) setNewRolesReady(true)
      syncRef.current = s.finished_at
      setLastSync(s)
    }
    poll()
    const t = setInterval(poll, REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  function update(patch) { setFilters(f => ({ ...f, ...patch })) }

  function submitSearch(e) {
    e.preventDefault()
    update({ q: draft.q.trim(), location: draft.location.trim() })
  }

  function clearAll() {
    setDraft({ q: '', location: '' })
    setFilters({ ...EMPTY_FILTERS })
  }

  const canPost = isBusiness && kycVerified && addressVerified
  const nActive = activeFilterCount(filters)
  const hasMore = jobs.length < count

  const filterPanel = (
    <div className="filter-panel">
      <div className="filter-head">
        <h3><i className="fas fa-sliders-h"></i> Filters</h3>
        {nActive > 0 && <button className="link-btn" onClick={clearAll}>Clear all</button>}
      </div>

      <FilterGroup title="Work arrangement">
        {WORK_MODES.map(m => (
          <Check key={m} label={m} checked={filters.modes.includes(m)} onChange={() => update({ modes: toggle(filters.modes, m) })} />
        ))}
      </FilterGroup>

      <FilterGroup title="Visa & relocation">
        <Toggle label="Visa sponsorship offered" icon="fas fa-passport" checked={filters.visa} onChange={() => update({ visa: !filters.visa })} />
        <Toggle label="Relocation support" icon="fas fa-plane-departure" checked={filters.relocation} onChange={() => update({ relocation: !filters.relocation })} />
      </FilterGroup>

      <FilterGroup title="Experience level">
        {LEVELS.map(l => (
          <Check key={l.value} label={l.label} checked={filters.levels.includes(l.value)} onChange={() => update({ levels: toggle(filters.levels, l.value) })} />
        ))}
      </FilterGroup>

      <FilterGroup title="Job type">
        {JOB_TYPES.map(t => (
          <Check key={t} label={t} checked={filters.types.includes(t)} onChange={() => update({ types: toggle(filters.types, t) })} />
        ))}
      </FilterGroup>

      <FilterGroup title="Date posted">
        <select className="input" value={filters.days} onChange={e => update({ days: e.target.value })}>
          {DATE_RANGES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </FilterGroup>

      <FilterGroup title="Category">
        <select className="input" value={filters.category} onChange={e => update({ category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </FilterGroup>

      <FilterGroup title="Source" collapsible>
        {SOURCES.map(s => (
          <Check key={s} label={s} checked={filters.sources.includes(s)} onChange={() => update({ sources: toggle(filters.sources, s) })} />
        ))}
      </FilterGroup>
    </div>
  )

  const [featuredJobs, setFeaturedJobs] = useState([])
  useEffect(() => {
    supabase.from('jobs').select('*').eq('is_active', true).gt('boosted_until', new Date().toISOString())
      .order('boosted_until', { ascending: false }).limit(3)
      .then(({ data, error: e }) => { if (!e) setFeaturedJobs((data || []).map(sanitizeJob)) })
  }, [])
  const showFeatured = featuredJobs.length > 0 && !nActive && !filters.q

  return (
    <div className="page-enter">
      {/* Header band keeps the landing page's navy + amber look */}
      <section className="jobs-hero">
        <div className="container">
          <div className="jobs-hero-inner">
            <h1>Find your next role</h1>
            <p>Thousands of live roles imported every hour from the web's leading job boards — apply directly at the source.</p>
            <form className="jobs-search" onSubmit={submitSearch}>
              <div className="jobs-search-field">
                <i className="fas fa-search"></i>
                <input placeholder="Job title, skill or company" value={draft.q} onChange={e => setDraft(d => ({ ...d, q: e.target.value }))} />
              </div>
              <div className="jobs-search-field">
                <i className="fas fa-map-marker-alt"></i>
                <input placeholder="City, country or “remote”" value={draft.location} onChange={e => setDraft(d => ({ ...d, location: e.target.value }))} />
              </div>
              <button type="submit" className="btn btn-primary jobs-search-btn">Search</button>
            </form>
            <div className="sync-status">
              <span className="live-dot"></span>
              {lastSync
                ? <>Live · last import {timeAgo(lastSync.finished_at)} · {Object.keys(lastSync.sources || {}).length} sources · refreshes hourly</>
                : <>Live listings · refreshed hourly</>}
            </div>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div className="quick-chips">
          {QUICK.map(c => {
            const on = c.test(filters)
            return (
              <button key={c.label} className={`chip ${on ? 'chip-on' : ''}`} onClick={() => setFilters(f => c.toggle(f))} aria-pressed={on}>
                <i className={c.icon}></i> {c.label}
              </button>
            )
          })}
        </div>

        {legacy && (
          <div className="notice notice-warn">
            <i className="fas fa-database"></i> Advanced filters (work mode, visa, level, source) need the job-aggregator database update.
            Ask an admin to run <code>supabase-job-aggregator-migration.sql</code>.
          </div>
        )}

        {newRolesReady && (
          <button className="notice notice-info notice-btn" onClick={() => { load(filters, 0); setNewRolesReady(false) }}>
            <i className="fas fa-sync-alt"></i> New roles were just imported — click to refresh results
          </button>
        )}

        <div className="jobs-layout">
          <aside className="jobs-sidebar">{filterPanel}</aside>

          <div>
            <div className="results-bar">
              <div>
                <h2>{loading ? 'Searching…' : `${count.toLocaleString()} ${count === 1 ? 'role' : 'roles'}`}</h2>
                {filters.q && <span className="results-sub">for “{filters.q}”</span>}
              </div>
              <div className="results-actions">
                <button className="btn btn-outline mobile-filter-btn" onClick={() => setDrawerOpen(true)}>
                  <i className="fas fa-sliders-h"></i> Filters{nActive ? ` (${nActive})` : ''}
                </button>
                <select className="input sort-select" value={filters.sort} onChange={e => update({ sort: e.target.value })} aria-label="Sort">
                  {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                {canPost && <Link to="/post-job" className="btn btn-success" style={{ whiteSpace: 'nowrap' }}>+ Post a Job</Link>}
              </div>
            </div>

            {error && <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {error}</div>}
            <AdSlot placement="jobs" />
            {showFeatured && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 14 }}>
                {featuredJobs.map(job => <JobCard key={`f${job.id}`} job={job} featured onOpen={() => navigate(`/jobs/${job.id}`)} />)}
              </div>
            )}

            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="job-card skeleton" />)}
              </div>
            ) : jobs.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {jobs.map(job => <JobCard key={job.id} job={job} onOpen={() => navigate(`/jobs/${job.id}`)} />)}
                {hasMore && (
                  <button className="btn btn-outline load-more" onClick={() => load(filters, page + 1)} disabled={loadingMore}>
                    {loadingMore ? 'Loading…' : `Show more roles (${Math.min(PAGE_SIZE, count - jobs.length)} of ${(count - jobs.length).toLocaleString()} remaining)`}
                  </button>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <i className="fas fa-search"></i>
                <h3>No roles match these filters</h3>
                <p>Try removing a filter or broadening your search. New roles arrive every hour.</p>
                {nActive > 0 && <button className="btn btn-primary" onClick={clearAll}>Clear filters</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={e => e.stopPropagation()}>
            {filterPanel}
            <div className="drawer-footer">
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setDrawerOpen(false)}>
                Show {count.toLocaleString()} roles
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterGroup({ title, children, collapsible }) {
  const [open, setOpen] = useState(!collapsible)
  return (
    <div className="filter-group">
      <button className="filter-group-title" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {title} <i className={`fas fa-chevron-${open ? 'up' : 'down'}`}></i>
      </button>
      {open && <div className="filter-group-body">{children}</div>}
    </div>
  )
}

function Check({ label, checked, onChange }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function Toggle({ label, icon, checked, onChange }) {
  return (
    <label className="toggle">
      <span><i className={icon}></i> {label}</span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
    </label>
  )
}
