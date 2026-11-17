import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMoney, GIG_CATEGORIES } from '../lib/marketplace'
import { timeAgo } from '../lib/jobs'
import AdSlot from '../components/AdSlot'

function GigCard({ g, featured }) {
  return (
    <article className={`gig-card ${featured ? 'featured' : ''}`}>
      <div className="gig-card-top">
        <Link to={`/gigs/${g.id}`} className="gig-title">{g.title}</Link>
        <div className="gig-budget">{formatMoney(g.budget, g.currency)}</div>
      </div>
      <p className="gig-desc">{g.description.slice(0, 180)}{g.description.length > 180 ? '…' : ''}</p>
      <div className="biz-services">
        {featured && <span className="pill pill-featured"><i className="fas fa-bolt"></i> Featured</span>}
        {g.category && <span className="pill pill-muted">{g.category}</span>}
        {(g.skills || []).slice(0, 4).map(s => <span key={s} className="pill pill-muted">{s}</span>)}
      </div>
      <div className="gig-meta">
        <span><i className="fas fa-map-marker-alt"></i> {g.location || 'Remote'}</span>
        {g.deadline && <span><i className="far fa-calendar"></i> Due {new Date(g.deadline).toLocaleDateString()}</span>}
        <span><i className="far fa-paper-plane"></i> {g.proposals_count} proposal{g.proposals_count === 1 ? '' : 's'}</span>
        <span className="muted">{timeAgo(g.created_at)}</span>
      </div>
    </article>
  )
}

export default function Gigs() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const category = params.get('category') || ''
  const [input, setInput] = useState(q)
  const [gigs, setGigs] = useState([])
  const [featured, setFeatured] = useState([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancel = false
    async function load() {
      setLoading(true)
      const term = q.replace(/[,()*%\\:"]/g, ' ').trim()
      let query = supabase.from('gigs').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(60)
      if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`)
      if (category) query = query.eq('category', category)
      const [{ data, error }, { data: feat }] = await Promise.all([
        query,
        supabase.from('gigs').select('*').eq('status', 'open').gt('boosted_until', new Date().toISOString()).order('boosted_until', { ascending: false }).limit(4),
      ])
      if (cancel) return
      if (error) { setMissing(/does not exist|could not find/i.test(error.message)); setGigs([]) } else setGigs(data || [])
      setFeatured(feat || [])
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [q, category])

  const featuredIds = useMemo(() => new Set(featured.map(f => f.id)), [featured])
  const set = patch => setParams(Object.fromEntries(Object.entries({ tab: 'gigs', q, category, ...patch }).filter(([, v]) => v)), { replace: true })

  return (
    <div className="page-enter">
      <section className="jobs-hero">
        <div className="container">
          <div className="jobs-hero-inner">
            <h1>Gigs with escrow protection</h1>
            <p>Hire verified African talent for short projects. Pay into escrow; funds are released only when you're satisfied.</p>
            <form className="jobs-search" onSubmit={e => { e.preventDefault(); set({ q: input.trim() }) }} style={{ gridTemplateColumns: '1fr auto' }}>
              <div className="jobs-search-field"><i className="fas fa-search"></i><input value={input} onChange={e => setInput(e.target.value)} placeholder="Logo design, React developer, translation…" aria-label="Search gigs" /></div>
              <button className="btn btn-primary jobs-search-btn">Search</button>
            </form>
            <div className="escrow-steps">
              <span><i className="fas fa-file-signature"></i> Post a gig</span><i className="fas fa-chevron-right"></i>
              <span><i className="fas fa-user-check"></i> Hire a verified pro</span><i className="fas fa-chevron-right"></i>
              <span><i className="fas fa-lock"></i> Fund escrow</span><i className="fas fa-chevron-right"></i>
              <span><i className="fas fa-hand-holding-usd"></i> Release when satisfied</span>
            </div>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div className="biz-toolbar">
          <div className="quick-chips" style={{ margin: 0 }}>
            <button className={`chip ${!category ? 'chip-on' : ''}`} onClick={() => set({ category: '' })}>All</button>
            {GIG_CATEGORIES.map(c => <button key={c} className={`chip ${category === c ? 'chip-on' : ''}`} onClick={() => set({ category: category === c ? '' : c })}>{c}</button>)}
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={() => navigate(user ? '/gigs/new' : '/login?next=/gigs/new')}><i className="fas fa-plus"></i> Post a gig</button>
        </div>

        <AdSlot placement="gigs" />

        {missing && <div className="notice notice-warn"><i className="fas fa-database"></i> Run <code>supabase-admin-escrow-migration.sql</code> to enable gigs and escrow.</div>}

        {featured.length > 0 && !q && !category && (
          <div className="gig-grid" style={{ marginBottom: 18 }}>{featured.map(g => <GigCard key={`f${g.id}`} g={g} featured />)}</div>
        )}

        {loading ? <div className="gig-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="gig-card skeleton" style={{ height: 180 }} />)}</div>
          : gigs.length ? <div className="gig-grid">{gigs.filter(g => q || category || !featuredIds.has(g.id)).map(g => <GigCard key={g.id} g={g} featured={featuredIds.has(g.id) && (q || category)} />)}</div>
          : !missing && <div className="empty-state"><i className="fas fa-briefcase"></i><h3>No open gigs yet</h3><p>Be the first to post one — verified professionals will send proposals.</p></div>}
      </div>
    </div>
  )
}
