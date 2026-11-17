import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { searchDirectory } from '../lib/search'
import UserAvatar from './UserAvatar'
import Rating from './Rating'

export function BusinessLogo({ b, size = 36 }) {
  return b.logo_url
    ? <img src={b.logo_url} alt="" style={{ width: size, height: size, minWidth: size, borderRadius: 8, objectFit: 'cover' }} />
    : <span className="biz-initial" style={{ width: size, height: size, minWidth: size }}>{(b.name || '?').charAt(0).toUpperCase()}</span>
}

// Navbar search: people, businesses and jobs, with ratings, as you type.
export default function SearchBar({ onNavigate, autoFocus = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const box = useRef(null)
  const seq = useRef(0)

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setRes(null); return }
    const id = ++seq.current
    setLoading(true)
    const t = setTimeout(() => {
      searchDirectory(term, 4).then(r => { if (id === seq.current) { setRes(r); setOpen(true) } }).finally(() => { if (id === seq.current) setLoading(false) })
    }, 220)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    const close = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function go(path) { setOpen(false); setQ(''); onNavigate?.(); navigate(path) }
  const all = () => go(`/search?q=${encodeURIComponent(q.trim())}`)
  const empty = res && !res.people.length && !res.businesses.length && !res.jobs.length

  return (
    <div className="nav-search" ref={box}>
      <form onSubmit={e => { e.preventDefault(); if (q.trim().length >= 2) all() }} role="search">
        <i className="fas fa-search"></i>
        <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => res && setOpen(true)} autoFocus={autoFocus}
          placeholder="Search people, businesses, jobs" aria-label="Search people, businesses and jobs"
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }} />
        {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
      </form>
      {open && res && (
        <div className="nav-search-pop" role="listbox">
          {empty && <div className="ns-empty">No results for “{q.trim()}”</div>}
          {res.people.length > 0 && <div className="ns-head">People</div>}
          {res.people.map(p => (
            <button key={p.id} type="button" className="ns-item" onClick={() => go(`/u/${p.username}`)}>
              <UserAvatar src={p.avatar_url} name={p.full_name} size={36} />
              <span className="ns-text">
                <strong>{p.full_name}{p.verified && <i className="fas fa-check-circle verified-tick"></i>}</strong>
                <span className="ellipsis">{p.headline || p.profession || (p.user_type === 'business' ? 'Business' : 'Professional')}{p.location ? ` · ${p.location}` : ''}</span>
              </span>
              <Rating value={p.rating} count={p.ratings_count} compact />
            </button>
          ))}
          {res.businesses.length > 0 && <div className="ns-head">Businesses</div>}
          {res.businesses.map(b => (
            <button key={b.id} type="button" className="ns-item" onClick={() => go(`/businesses/${b.id}`)}>
              <BusinessLogo b={b} />
              <span className="ns-text">
                <strong>{b.name}{b.verified && <i className="fas fa-check-circle verified-tick"></i>}</strong>
                <span className="ellipsis">{[b.category, b.city, b.country].filter(Boolean).join(' · ')}</span>
              </span>
              <Rating value={b.rating} count={b.review_count} compact />
            </button>
          ))}
          {res.jobs.length > 0 && <div className="ns-head">Jobs</div>}
          {res.jobs.map(j => (
            <button key={j.id} type="button" className="ns-item" onClick={() => go(`/jobs/${j.id}`)}>
              <span className="biz-initial" style={{ width: 36, height: 36, minWidth: 36 }}><i className="fas fa-briefcase"></i></span>
              <span className="ns-text"><strong className="ellipsis">{j.title}</strong><span className="ellipsis">{[j.company, j.location].filter(Boolean).join(' · ')}</span></span>
            </button>
          ))}
          {!empty && <button type="button" className="ns-all" onClick={all}>See all results for “{q.trim()}” →</button>}
          {res.fallback && <div className="ns-empty" style={{ fontSize: 11 }}>People search is being switched on.</div>}
        </div>
      )}
    </div>
  )
}

