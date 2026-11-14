import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatMoney, toMinor, hireProposal, declineProposal, friendly } from '../lib/marketplace'
import { fetchPeople, Avatar } from '../lib/people'
import { timeAgo } from '../lib/jobs'
import BoostButton from '../components/BoostButton'

export default function GigDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, kycVerified, profile } = useAuth()
  const [gig, setGig] = useState(null)
  const [client, setClient] = useState(null)
  const [proposals, setProposals] = useState([])
  const [people, setPeople] = useState({})
  const [mine, setMine] = useState(null)
  const [contractId, setContractId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ cover: '', amount: '', days: '' })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data: g } = await supabase.from('gigs').select('*').eq('id', id).maybeSingle()
    setGig(g)
    if (!g) { setLoading(false); return }
    const owner = user?.id === g.client_id
    const [{ data: props }, { data: c }] = await Promise.all([
      user ? supabase.from('gig_proposals').select('*').eq('gig_id', id).order('created_at') : { data: [] },
      user ? supabase.from('contracts').select('id').eq('gig_id', id).not('status', 'in', '(cancelled)').limit(1).maybeSingle() : { data: null },
    ])
    setProposals(owner ? props || [] : [])
    setMine((props || []).find(p => p.freelancer_id === user?.id) || null)
    setContractId(c?.id || null)
    const ppl = await fetchPeople([g.client_id, ...(props || []).map(p => p.freelancer_id)])
    setPeople(ppl)
    setClient(ppl[g.client_id])
    if (!form.amount) setForm(f => ({ ...f, amount: String(g.budget / 100) }))
    setLoading(false)
  }
  useEffect(() => { load() }, [id, user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function propose(e) {
    e.preventDefault()
    setMsg(null)
    const amount = toMinor(form.amount)
    if (form.cover.trim().length < 20) return setMsg({ bad: true, text: 'Write at least 20 characters about how you would do the work.' })
    if (!amount) return setMsg({ bad: true, text: 'Enter your price.' })
    setBusy(true)
    const { error } = await supabase.from('gig_proposals').insert({ gig_id: Number(id), cover_letter: form.cover.trim(), amount, delivery_days: Number(form.days) || null })
    setBusy(false)
    if (error) return setMsg({ bad: true, text: error.code === '23505' ? 'You already sent a proposal for this gig.' : friendly(error) })
    setMsg({ text: 'Proposal sent! The client will be in touch.' })
    load()
  }

  async function act(fn, after) {
    setBusy(true); setMsg(null)
    try { const r = await fn(); after?.(r) } catch (e) { setMsg({ bad: true, text: e.message }) } finally { setBusy(false); load() }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!gig) return <div className="container" style={{ padding: 60, textAlign: 'center' }}><h2>Gig not found</h2><Link to="/gigs" className="btn btn-primary" style={{ marginTop: 12 }}>Browse gigs</Link></div>

  const owner = user?.id === gig.client_id
  const canPropose = user && !owner && gig.status === 'open' && !mine

  return (
    <div className="page-enter">
      <div className="container biz-detail">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 12, paddingLeft: 0 }}>← Back</button>
        <div className="biz-layout">
          <div>
            <div className="card">
              <div className="gig-card-top" style={{ marginBottom: 8 }}>
                <h1 style={{ fontSize: 26, fontWeight: 800 }}>{gig.title}</h1>
                <div className="gig-budget lg">{formatMoney(gig.budget, gig.currency)}</div>
              </div>
              <div className="gig-meta" style={{ marginBottom: 14 }}>
                <span className={`pill ${gig.status === 'open' ? 'pill-verified' : 'pill-muted'}`}>{gig.status.replace('_', ' ')}</span>
                {gig.category && <span>{gig.category}</span>}
                <span><i className="fas fa-map-marker-alt"></i> {gig.location}</span>
                {gig.deadline && <span><i className="far fa-calendar"></i> Due {new Date(gig.deadline).toLocaleDateString()}</span>}
                <span className="muted">Posted {timeAgo(gig.created_at)}</span>
              </div>
              <p className="biz-about">{gig.description}</p>
              {gig.skills?.length > 0 && <div className="biz-services" style={{ marginTop: 10 }}>{gig.skills.map(s => <span key={s} className="pill pill-muted">{s}</span>)}</div>}
            </div>

            {owner && (
              <div className="card" style={{ marginTop: 20 }}>
                <h2 className="section-h">Proposals ({proposals.length})</h2>
                {contractId && <div className="notice notice-info"><i className="fas fa-file-contract"></i> You hired someone for this gig. <Link to={`/contracts/${contractId}`} style={{ fontWeight: 700, marginLeft: 4 }}>Open contract →</Link></div>}
                {proposals.length ? proposals.map(p => (
                  <div key={p.id} className="proposal">
                    <div className="proposal-head">
                      <Avatar person={people[p.freelancer_id]} />
                      <div style={{ flex: 1 }}>
                        <strong>{people[p.freelancer_id]?.full_name}</strong>
                        {people[p.freelancer_id]?.kyc_status === 'approved' && <span className="pill pill-verified" style={{ marginLeft: 8 }}><i className="fas fa-check-circle"></i> ID verified</span>}
                        <div className="muted" style={{ fontSize: 12 }}>{formatMoney(p.amount, gig.currency)}{p.delivery_days ? ` · ${p.delivery_days} day delivery` : ''} · {timeAgo(p.created_at)}</div>
                      </div>
                      <span className="pill pill-muted">{p.status}</span>
                    </div>
                    <p className="proposal-body">{p.cover_letter}</p>
                    {p.status === 'pending' && gig.status === 'open' && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => hireProposal(p.id), cid => navigate(`/contracts/${cid}`))}><i className="fas fa-handshake"></i> Hire for {formatMoney(p.amount, gig.currency)}</button>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(() => declineProposal(p.id))}>Decline</button>
                      </div>
                    )}
                  </div>
                )) : <p className="muted">No proposals yet. Boost the gig to reach more professionals.</p>}
              </div>
            )}
          </div>

          <aside>
            <div className="card biz-side">
              <h3 className="sub-h">Client</h3>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Avatar person={client} /><div><strong>{client?.full_name}</strong><div className="muted" style={{ fontSize: 12 }}>{client?.user_type === 'business' ? 'Business' : 'Individual'}</div></div></div>
              <ul className="biz-contact-list" style={{ marginTop: 12 }}>
                <li><i className="fas fa-lock"></i><span>Payment protected by AfriTalent escrow</span></li>
                <li><i className="fas fa-paper-plane"></i><span>{gig.proposals_count} proposal{gig.proposals_count === 1 ? '' : 's'}</span></li>
              </ul>
            </div>

            {owner && gig.status === 'open' && <div className="card biz-side"><h3 className="sub-h"><i className="fas fa-bolt"></i> Get more proposals</h3><BoostButton type="gig" id={gig.id} until={gig.boosted_until} onDone={load} /></div>}

            {!user && <div className="card biz-side claim-box"><h3 className="sub-h">Want this gig?</h3><button className="btn btn-primary" onClick={() => navigate(`/login?next=/gigs/${id}`)}>Sign in to send a proposal</button></div>}

            {mine && <div className="card biz-side"><h3 className="sub-h">Your proposal</h3><p className="muted">{formatMoney(mine.amount, gig.currency)} · {mine.status}</p>{contractId && mine.status === 'accepted' && <Link className="btn btn-primary" to={`/contracts/${contractId}`}>Open contract</Link>}</div>}

            {canPropose && (
              <div className="card biz-side claim-box">
                <h3 className="sub-h">Send a proposal</h3>
                {!kycVerified ? (
                  <><p className="muted">Only ID-verified professionals can send proposals.</p><Link to="/kyc" className="btn btn-primary">Verify my ID</Link></>
                ) : profile?.account_status !== 'active' ? (
                  <p className="muted">Your account is awaiting approval.</p>
                ) : (
                  <form onSubmit={propose} className="claim-form">
                    <textarea className="input" rows={5} value={form.cover} onChange={e => setForm(f => ({ ...f, cover: e.target.value }))} placeholder="How you'll approach the work, relevant experience, links to past work…" aria-label="Cover letter" />
                    <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <input className="input" inputMode="decimal" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="Your price" aria-label="Your price" />
                      <input className="input" inputMode="numeric" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} placeholder="Days to deliver" aria-label="Days to deliver" />
                    </div>
                    <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send proposal'}</button>
                  </form>
                )}
              </div>
            )}
            {msg && <div className={`notice ${msg.bad ? 'notice-error' : 'notice-info'}`}>{msg.text}</div>}
          </aside>
        </div>
      </div>
    </div>
  )
}
