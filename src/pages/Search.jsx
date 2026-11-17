import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { searchDirectory } from '../lib/search'
import UserAvatar from '../components/UserAvatar'
import Rating from '../components/Rating'
import { BusinessLogo } from '../components/SearchBar'

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'businesses', label: 'Businesses' },
  { id: 'jobs', label: 'Jobs' },
]

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const tab = TABS.some(t => t.id === params.get('type')) ? params.get('type') : 'all'
  const [input, setInput] = useState(q)
  const [res, setRes] = useState(null)

  useEffect(() => { setInput(q) }, [q])
  useEffect(() => {
    let alive = true
    setRes(null)
    searchDirectory(q, tab === 'all' ? 8 : 30, tab === 'all' ? ['people', 'businesses', 'jobs'] : [tab]).then(r => { if (alive) setRes(r) })
    return () => { alive = false }
  }, [q, tab])

  const show = id => tab === 'all' || tab === id
  const total = res ? res.people.length + res.businesses.length + res.jobs.length : 0

  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 860, paddingTop: 28, paddingBottom: 60 }}>
        <form className="search-page-form" onSubmit={e => { e.preventDefault(); setParams({ q: input.trim(), ...(tab !== 'all' ? { type: tab } : {}) }) }}>
          <i className="fas fa-search"></i>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Search people, businesses, jobs" autoFocus aria-label="Search" />
          <button className="btn btn-primary">Search</button>
        </form>
        <nav className="feed-tabs" style={{ margin: '16px 0' }}>
          {TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setParams({ q, ...(t.id !== 'all' ? { type: t.id } : {}) })}>{t.label}</button>)}
        </nav>

        {q.trim().length < 2 && <p className="muted">Type at least 2 characters.</p>}
        {q.trim().length >= 2 && !res && <div className="spinner" style={{ margin: '30px auto' }} />}
        {res && q.trim().length >= 2 && total === 0 && <div className="empty-state card"><i className="fas fa-search"></i><p>No results for “{q}”.</p></div>}

        {res && show('people') && res.people.length > 0 && (
          <section className="card search-section">
            <h3 className="section-h">People</h3>
            {res.people.map(p => (
              <Link key={p.id} to={`/u/${p.username}`} className="search-row">
                <UserAvatar src={p.avatar_url} name={p.full_name} size={48} />
                <span className="ns-text">
                  <strong>{p.full_name}{p.verified && <i className="fas fa-check-circle verified-tick" title="ID verified"></i>}</strong>
                  <span>{p.headline || p.profession || (p.user_type === 'business' ? 'Business' : 'Professional')}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{[p.location, `${p.followers || 0} followers`].filter(Boolean).join(' · ')}</span>
                </span>
                <Rating value={p.rating} count={p.ratings_count} />
              </Link>
            ))}
            {res.fallback && <p className="muted" style={{ fontSize: 13 }}>People search is being switched on.</p>}
          </section>
        )}

        {res && show('businesses') && res.businesses.length > 0 && (
          <section className="card search-section">
            <h3 className="section-h">Businesses</h3>
            {res.businesses.map(b => (
              <Link key={b.id} to={`/businesses/${b.id}`} className="search-row">
                <BusinessLogo b={b} size={48} />
                <span className="ns-text">
                  <strong>{b.name}{b.verified && <i className="fas fa-check-circle verified-tick" title="Verified owner"></i>}</strong>
                  <span>{[b.category, b.city, b.country].filter(Boolean).join(' · ')}</span>
                </span>
                <Rating value={b.rating} count={b.review_count} />
              </Link>
            ))}
          </section>
        )}

        {res && show('jobs') && res.jobs.length > 0 && (
          <section className="card search-section">
            <h3 className="section-h">Jobs</h3>
            {res.jobs.map(j => (
              <Link key={j.id} to={`/jobs/${j.id}`} className="search-row">
                <span className="biz-initial" style={{ width: 48, height: 48, minWidth: 48 }}><i className="fas fa-briefcase"></i></span>
                <span className="ns-text"><strong>{j.title}</strong><span>{[j.company, j.location, j.work_mode].filter(Boolean).join(' · ')}</span></span>
              </Link>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
