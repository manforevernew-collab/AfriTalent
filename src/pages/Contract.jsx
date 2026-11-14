import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import ChatPanel from '../components/ChatPanel'
import { fetchPeople, Avatar } from '../lib/people'
import {
  formatMoney, CONTRACT_STATUS, fetchWallet, fundContract, submitWork, requestRevision, releaseContract,
  cancelContract, openDispute,
} from '../lib/marketplace'

const STEPS = [
  { key: 'awaiting_funding', label: 'Hired' },
  { key: 'funded', label: 'Escrow funded' },
  { key: 'submitted', label: 'Work submitted' },
  { key: 'completed', label: 'Approved & paid' },
]
const stepIndex = s => ({ awaiting_funding: 0, funded: 1, revision_requested: 1, submitted: 2, disputed: 2, completed: 3, settled: 3, refunded: 3, cancelled: 0 }[s] ?? 0)

export default function Contract() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const [c, setC] = useState(null)
  const [people, setPeople] = useState({})
  const [wallet, setWallet] = useState(null)
  const [dispute, setDispute] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [panel, setPanel] = useState(null) // submit | revision | release | dispute | cancel
  const [note, setNote] = useState('')
  const [rating, setRating] = useState(5)

  async function load() {
    const { data } = await supabase.from('contracts').select('*').eq('id', id).maybeSingle()
    setC(data)
    if (data) {
      setPeople(await fetchPeople([data.client_id, data.freelancer_id]))
      if (user?.id === data.client_id) setWallet(await fetchWallet(user.id))
      const { data: d } = await supabase.from('disputes').select('*').eq('contract_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      setDispute(d)
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [id, user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn, success) {
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ text: success }); setPanel(null); setNote('') } catch (e) { setMsg({ bad: true, text: e.message }) } finally { setBusy(false); load() }
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!c) return <div className="container" style={{ padding: 60, textAlign: 'center' }}><h2>Contract not found</h2><Link to="/dashboard" className="btn btn-primary" style={{ marginTop: 12 }}>Go to dashboard</Link></div>

  const isClient = user?.id === c.client_id
  const isFreelancer = user?.id === c.freelancer_id
  const st = CONTRACT_STATUS[c.status] || CONTRACT_STATUS.funded
  const fee = Math.round(c.amount * Number(c.fee_percent) / 100)
  const live = ['funded', 'submitted', 'revision_requested'].includes(c.status)
  const closed = ['completed', 'refunded', 'settled', 'cancelled'].includes(c.status)
  const short = wallet && c.status === 'awaiting_funding' ? Math.max(0, c.amount - wallet.balance) : 0

  return (
    <div className="page-enter">
      <div className="container biz-detail">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 12, paddingLeft: 0 }}>← Back</button>
        <div className="card contract-head">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase' }}>Contract #{c.id}</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '4px 0 8px' }}>{c.title}</h1>
            <span className="pill" style={{ background: st.bg, color: st.color }}>{st.label}</span>
          </div>
          <div className="contract-amount">
            <div className="muted" style={{ fontSize: 12 }}>Contract value</div>
            <div className="gig-budget lg">{formatMoney(c.amount, c.currency)}</div>
            {isFreelancer && <div className="muted" style={{ fontSize: 12 }}>You receive {formatMoney(c.amount - fee, c.currency)} after {Number(c.fee_percent)}% fee</div>}
          </div>
        </div>

        <ol className="contract-steps">
          {STEPS.map((s, i) => <li key={s.key} className={i <= stepIndex(c.status) && c.status !== 'cancelled' ? 'done' : ''}><span>{i + 1}</span>{s.label}</li>)}
        </ol>

        <div className="biz-layout">
          <div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', fontWeight: 700 }}>
                <i className="far fa-comments"></i> Workspace chat {c.status === 'disputed' && <span className="muted" style={{ fontWeight: 400 }}>· AfriTalent support can see and reply here</span>}
              </div>
              <ChatPanel table="contract_messages" fk="contract_id" id={c.id} people={people} adminView={isAdmin && !isClient && !isFreelancer}
                disabled={closed && !isAdmin} disabledText="This contract is closed." placeholder="Share updates, files links, questions…" />
            </div>
          </div>

          <aside>
            <div className="card biz-side">
              <h3 className="sub-h">People</h3>
              {[['Client', c.client_id], ['Freelancer', c.freelancer_id]].map(([role, uid]) => (
                <div key={role} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <Avatar person={people[uid]} size={32} />
                  <div><strong style={{ fontSize: 14 }}>{people[uid]?.full_name}{uid === user?.id ? ' (you)' : ''}</strong><div className="muted" style={{ fontSize: 12 }}>{role}</div></div>
                </div>
              ))}
              {c.gig_id && <Link to={`/gigs/${c.gig_id}`} className="biz-gmaps"><i className="fas fa-briefcase"></i> View original gig</Link>}
            </div>

            <div className="card biz-side claim-box">
              <h3 className="sub-h"><i className="fas fa-lock"></i> Escrow</h3>

              {isClient && c.status === 'awaiting_funding' && (
                <>
                  <p>Fund {formatMoney(c.amount, c.currency)} into escrow so work can start. Your wallet: <strong>{formatMoney(wallet?.balance, c.currency)}</strong>.</p>
                  {short > 0 ? <Link className="btn btn-primary" to="/dashboard?tab=wallet">Top up {formatMoney(short, c.currency)}</Link>
                    : <button className="btn btn-primary" disabled={busy} onClick={() => run(() => fundContract(c.id), 'Escrow funded — the freelancer has been notified.')}>Fund escrow</button>}
                  <button className="btn btn-outline" disabled={busy} onClick={() => setPanel('cancel')}>Cancel contract</button>
                </>
              )}
              {isFreelancer && c.status === 'awaiting_funding' && <p>Waiting for the client to fund escrow. Don't start work until it's funded.</p>}

              {isFreelancer && ['funded', 'revision_requested'].includes(c.status) && (
                <>
                  <p>{formatMoney(c.amount, c.currency)} is safely held in escrow. Submit your work when it's ready.</p>
                  <button className="btn btn-primary" onClick={() => setPanel('submit')}>Submit work</button>
                </>
              )}
              {isClient && live && (
                <>
                  <p>{c.status === 'submitted' ? 'The freelancer submitted their work. Review it, then release payment or request changes.' : 'Funds are in escrow. Release payment only when you are satisfied.'}</p>
                  <button className="btn btn-primary" onClick={() => setPanel('release')}><i className="fas fa-check"></i> Approve & release payment</button>
                  {c.status === 'submitted' && <button className="btn btn-outline" onClick={() => setPanel('revision')}>Request changes</button>}
                </>
              )}
              {(isClient || isFreelancer) && live && <button className="btn btn-ghost" style={{ color: 'var(--color-danger)' }} onClick={() => setPanel('dispute')}><i className="fas fa-gavel"></i> Open a dispute</button>}
              {isFreelancer && live && <button className="btn btn-ghost" onClick={() => setPanel('cancel')}>Cancel & refund client</button>}

              {c.status === 'disputed' && <p><i className="fas fa-gavel"></i> In dispute: <strong>{dispute?.reason}</strong>. Funds stay in escrow until AfriTalent decides. Use the chat to share evidence.</p>}
              {c.status === 'completed' && <p><i className="fas fa-check-circle" style={{ color: 'var(--color-success)' }}></i> Completed and paid{c.client_rating ? ` · rated ${'★'.repeat(c.client_rating)}` : ''}.</p>}
              {['refunded', 'settled'].includes(c.status) && <p>{c.status === 'refunded' ? 'Escrow was refunded to the client.' : `Settled by AfriTalent${dispute?.admin_note ? `: ${dispute.admin_note}` : '.'}`}</p>}
              {c.status === 'cancelled' && <p>This contract was cancelled before funding.</p>}

              {panel && (
                <div className="contract-panel">
                  {panel === 'release' && (
                    <>
                      <label className="form-label">Rate the work</label>
                      <div className="stars-input">{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" onClick={() => setRating(n)} className={n <= rating ? 'on' : ''} aria-label={`${n} stars`}>★</button>)}</div>
                      <textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional review" />
                      <p className="field-hint">This releases {formatMoney(c.amount, c.currency)} to {people[c.freelancer_id]?.full_name}. It can't be undone.</p>
                      <button className="btn btn-primary" disabled={busy} onClick={() => run(() => releaseContract(c.id, rating, note), 'Payment released. Thank you!')}>Release payment</button>
                    </>
                  )}
                  {panel === 'submit' && (<><textarea className="input" rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="What you delivered and where to find it (links)…" /><button className="btn btn-primary" disabled={busy} onClick={() => run(() => submitWork(c.id, note), 'Work submitted. The client has been asked to review it.')}>Submit for approval</button></>)}
                  {panel === 'revision' && (<><textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="What needs to change?" /><button className="btn btn-primary" disabled={busy} onClick={() => run(() => requestRevision(c.id, note), 'Changes requested.')}>Send request</button></>)}
                  {panel === 'dispute' && (<><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (e.g. work not delivered)" /><p className="field-hint">An AfriTalent agent will review the chat and decide to release, refund or split the escrow.</p><button className="btn btn-danger" disabled={busy || note.trim().length < 3} onClick={() => run(() => openDispute(c.id, note), 'Dispute opened. Our team will step in shortly.')}>Open dispute</button></>)}
                  {panel === 'cancel' && (<><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason (optional)" /><p className="field-hint">{c.status === 'awaiting_funding' ? 'Cancels the contract. No money has moved.' : `Refunds ${formatMoney(c.amount, c.currency)} to the client.`}</p><button className="btn btn-danger" disabled={busy} onClick={() => run(() => cancelContract(c.id, note), 'Contract cancelled.')}>Confirm</button></>)}
                  <button className="btn btn-ghost" onClick={() => setPanel(null)}>Close</button>
                </div>
              )}
              {msg && <div className={`notice ${msg.bad ? 'notice-error' : 'notice-info'}`} style={{ marginTop: 10, marginBottom: 0 }}>{msg.text}</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
