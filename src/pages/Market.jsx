import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PostList } from './Feed'
import { Composer } from '../components/social/SocialUI'

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'product', label: 'Products' },
  { id: 'service', label: 'Services' },
]

export default function Market() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const kind = FILTERS.some(f => f.id === params.get('kind')) ? params.get('kind') : ''
  const q = params.get('q') || ''
  const [input, setInput] = useState(q)
  const [selling, setSelling] = useState(false)
  const [fresh, setFresh] = useState(null)

  return (
    <div className="page-enter">
      <section className="jobs-hero">
        <div className="container">
          <div className="jobs-hero-inner">
            <h1>AfriTalent Market</h1>
            <p>Buy from verified African creators, designers and businesses. Your money is held in escrow until you confirm delivery.</p>
            <form className="jobs-search" style={{ gridTemplateColumns: '1fr auto' }} onSubmit={e => { e.preventDefault(); setParams(Object.fromEntries(Object.entries({ kind, q: input.trim() }).filter(([, v]) => v))) }}>
              <div className="jobs-search-field"><i className="fas fa-search"></i><input value={input} onChange={e => setInput(e.target.value)} placeholder="Furniture, logo design, Ankara fabric, interior consultation…" aria-label="Search the market" /></div>
              <button className="btn btn-primary jobs-search-btn">Search</button>
            </form>
            <div className="escrow-steps">
              <span><i className="fas fa-shopping-bag"></i> Order</span><i className="fas fa-chevron-right"></i>
              <span><i className="fas fa-lock"></i> Pay into escrow</span><i className="fas fa-chevron-right"></i>
              <span><i className="fas fa-truck"></i> Seller ships with receipt</span><i className="fas fa-chevron-right"></i>
              <span><i className="fas fa-hand-holding-usd"></i> Confirm delivery → seller paid</span>
            </div>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 24, paddingBottom: 60 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          {FILTERS.map(f => (
            <button key={f.id} type="button" className={`btn btn-sm ${kind === f.id ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setParams(Object.fromEntries(Object.entries({ kind: f.id, q }).filter(([, v]) => v)))}>{f.label}</button>
          ))}
          {user
            ? <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelling(s => !s)}><i className="fas fa-plus"></i> Sell something</button>
            : <Link to="/login?next=/market" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>Sign in to sell</Link>}
        </div>
        {selling && <div style={{ maxWidth: 680, marginBottom: 20 }}><Composer defaultKind="product" onPosted={p => { setFresh(p); setSelling(false) }} /></div>}
        <PostList key={`${kind}-${q}`} scope="market" kinds={kind ? [kind] : null} search={q || null} grid prepend={fresh}
          empty={<div className="empty-state card"><i className="fas fa-store"></i><p>No listings yet{q ? ` for “${q}”` : ''}. Be the first to sell!</p></div>} />
      </div>
    </div>
  )
}
