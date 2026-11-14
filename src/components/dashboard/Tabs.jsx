import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import ChatPanel from '../ChatPanel'
import BoostButton from '../BoostButton'
import { fetchPeople } from '../../lib/people'
import { formatMoney, CONTRACT_STATUS, createAd, useSettings, fetchWallet } from '../../lib/marketplace'
import { StatCard, TxList, TopupForm, WithdrawForm, WithdrawalHistory } from './WalletParts'

// ---------------------------------------------------------------- contracts
export function ContractsList({ role }) {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [people, setPeople] = useState({})
  useEffect(() => {
    supabase.from('contracts').select('*').eq(role === 'client' ? 'client_id' : 'freelancer_id', user.id).order('updated_at', { ascending: false }).limit(50)
      .then(async ({ data }) => { setRows(data || []); setPeople(await fetchPeople((data || []).map(c => (role === 'client' ? c.freelancer_id : c.client_id)))) })
  }, [user.id, role])
  if (!rows) return <div className="skeleton" style={{ height: 100, borderRadius: 12 }} />
  if (!rows.length) return <p className="muted">{role === 'client' ? 'You have not hired anyone yet.' : 'No contracts yet — send proposals on open gigs.'} <Link to="/gigs">Browse gigs</Link></p>
  return (
    <div className="list-rows">
      {rows.map(c => {
        const st = CONTRACT_STATUS[c.status] || {}
        const other = people[role === 'client' ? c.freelancer_id : c.client_id]
        return (
          <Link key={c.id} to={`/contracts/${c.id}`} className="list-row">
            <div style={{ minWidth: 0, flex: 1 }}><strong>{c.title}</strong><div className="muted" style={{ fontSize: 12 }}>{role === 'client' ? 'Freelancer' : 'Client'}: {other?.full_name || '—'}</div></div>
            <span className="pill" style={{ background: st.bg, color: st.color }}>{st.label}</span>
            <strong>{formatMoney(c.amount, c.currency)}</strong>
          </Link>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- earnings (job seekers)
export function EarningsTab() {
  const { user } = useAuth()
  const settings = useSettings()
  const [wallet, setWallet] = useState(null)
  const [earnings, setEarnings] = useState([])
  const [escrow, setEscrow] = useState(0)
  const [key, setKey] = useState(0)
  useEffect(() => {
    fetchWallet(user.id).then(setWallet)
    supabase.from('wallet_transactions').select('amount, created_at').eq('user_id', user.id).eq('type', 'earning').order('created_at').then(({ data }) => setEarnings(data || []))
    supabase.from('contracts').select('amount, fee_percent').eq('freelancer_id', user.id).in('status', ['funded', 'submitted', 'revision_requested', 'disputed'])
      .then(({ data }) => setEscrow((data || []).reduce((s, c) => s + c.amount - Math.round(c.amount * Number(c.fee_percent) / 100), 0)))
  }, [user.id, key])

  const months = useMemo(() => {
    const out = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const total = earnings.filter(e => { const t = new Date(e.created_at); return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() }).reduce((s, e) => s + e.amount, 0)
      out.push({ label: d.toLocaleDateString(undefined, { month: 'short' }), total })
    }
    return out
  }, [earnings])
  const lifetime = earnings.reduce((s, e) => s + e.amount, 0)
  const max = Math.max(1, ...months.map(m => m.total))
  const cur = settings?.currency

  return (
    <div className="dash-stack">
      <div className="stat-grid">
        <StatCard icon="fas fa-wallet" label="Available to withdraw" value={formatMoney(wallet?.balance, cur)} tone="good" />
        <StatCard icon="fas fa-lock" label="Pending in escrow" value={formatMoney(escrow, cur)} hint="Paid when clients approve your work" />
        <StatCard icon="fas fa-coins" label="Lifetime earnings" value={formatMoney(lifetime, cur)} hint={`After ${Number(settings?.platform_fee_percent || 10)}% platform fee`} />
        <StatCard icon="fas fa-university" label="Withdrawal in progress" value={formatMoney(wallet?.pending_withdrawal, cur)} />
      </div>
      <div className="card">
        <h3 className="section-h">Earnings, last 6 months</h3>
        <div className="bars" role="img" aria-label="Monthly earnings for the last six months">
          {months.map(m => (
            <div key={m.label} className="bar-col" title={`${m.label}: ${formatMoney(m.total, cur)}`}>
              <div className="bar-val">{m.total ? formatMoney(m.total, cur) : ''}</div>
              <div className="bar" style={{ height: `${Math.max(2, (m.total / max) * 100)}%` }} />
              <div className="bar-label">{m.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card"><h3 className="section-h">Withdraw to your bank</h3><WithdrawForm balance={wallet?.balance || 0} onDone={() => setKey(k => k + 1)} /><WithdrawalHistory userId={user.id} refreshKey={key} /></div>
      <div className="card"><h3 className="section-h">My contracts</h3><ContractsList role="freelancer" /></div>
      <div className="card"><h3 className="section-h">Earnings history</h3><TxList userId={user.id} types={['earning', 'withdrawal', 'withdrawal_paid', 'withdrawal_reversal', 'dispute_settlement', 'adjustment']} refreshKey={key} /></div>
    </div>
  )
}

// ---------------------------------------------------------------- wallet (businesses / clients)
export function WalletTab({ notice }) {
  const { user } = useAuth()
  const settings = useSettings()
  const [wallet, setWallet] = useState(null)
  const [key, setKey] = useState(0)
  useEffect(() => { fetchWallet(user.id).then(setWallet) }, [user.id, key, notice])
  const cur = settings?.currency
  return (
    <div className="dash-stack">
      {notice}
      <div className="stat-grid">
        <StatCard icon="fas fa-wallet" label="Available balance" value={formatMoney(wallet?.balance, cur)} tone="good" hint="For escrow, boosts and ads" />
        <StatCard icon="fas fa-lock" label="Held in escrow" value={formatMoney(wallet?.held, cur)} hint="Released when you approve work" />
        <StatCard icon="fas fa-university" label="Withdrawal in progress" value={formatMoney(wallet?.pending_withdrawal, cur)} />
      </div>
      <div className="card"><h3 className="section-h">Add funds</h3><TopupForm /></div>
      <div className="card"><h3 className="section-h">My gigs & hires</h3><MyGigs /><h3 className="sub-h" style={{ marginTop: 18 }}>Contracts</h3><ContractsList role="client" /></div>
      <div className="card"><h3 className="section-h">Transactions</h3><TxList userId={user.id} refreshKey={key} /></div>
      <details className="card"><summary className="section-h" style={{ cursor: 'pointer', marginBottom: 0 }}>Withdraw unused funds</summary><div style={{ marginTop: 12 }}><WithdrawForm balance={wallet?.balance || 0} onDone={() => setKey(k => k + 1)} /><WithdrawalHistory userId={user.id} refreshKey={key} /></div></details>
    </div>
  )
}

export function MyGigs() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.from('gigs').select('*').eq('client_id', user.id).order('created_at', { ascending: false }).limit(30).then(({ data }) => setRows(data || [])) }, [user.id])
  if (!rows) return null
  if (!rows.length) return <p className="muted">No gigs posted yet. <Link to="/gigs/new">Post your first gig</Link></p>
  return (
    <div className="list-rows">
      {rows.map(g => (
        <Link key={g.id} to={`/gigs/${g.id}`} className="list-row">
          <div style={{ minWidth: 0, flex: 1 }}><strong>{g.title}</strong><div className="muted" style={{ fontSize: 12 }}>{g.proposals_count} proposals · {g.status.replace('_', ' ')}</div></div>
          {g.boosted_until && new Date(g.boosted_until) > new Date() && <span className="pill pill-featured"><i className="fas fa-bolt"></i> Featured</span>}
          <strong>{formatMoney(g.budget, g.currency)}</strong>
        </Link>
      ))}
    </div>
  )
}

export function MyProposals() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.from('gig_proposals').select('*, gig:gigs(id,title,currency,status)').eq('freelancer_id', user.id).order('created_at', { ascending: false }).limit(30).then(({ data }) => setRows(data || [])) }, [user.id])
  if (!rows) return null
  if (!rows.length) return <p className="muted">No proposals yet. <Link to="/gigs">Find gigs</Link></p>
  return <div className="list-rows">{rows.map(p => (
    <Link key={p.id} to={`/gigs/${p.gig?.id}`} className="list-row">
      <div style={{ flex: 1, minWidth: 0 }}><strong>{p.gig?.title}</strong><div className="muted" style={{ fontSize: 12 }}>Sent {new Date(p.created_at).toLocaleDateString()}</div></div>
      <span className="pill pill-muted">{p.status}</span><strong>{formatMoney(p.amount, p.gig?.currency)}</strong>
    </Link>))}</div>
}

// ---------------------------------------------------------------- promote (boosts + ads)
export function PromoteTab() {
  const { user } = useAuth()
  const settings = useSettings()
  const [items, setItems] = useState({ jobs: [], gigs: [], companies: [] })
  const [ads, setAds] = useState([])
  const [key, setKey] = useState(0)
  const [ad, setAd] = useState({ title: '', body: '', targetUrl: '', imageUrl: '', placement: 'jobs', days: 7 })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('jobs').select('id,title,boosted_until').eq('posted_by', user.id).limit(20),
      supabase.from('gigs').select('id,title,boosted_until').eq('client_id', user.id).eq('status', 'open').limit(20),
      supabase.from('companies').select('id,name,boosted_until').eq('claimed_by', user.id).limit(10),
      supabase.from('ad_campaigns').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    ]).then(([j, g, c, a]) => { setItems({ jobs: j.data || [], gigs: g.data || [], companies: c.data || [] }); setAds(a.data || []) })
  }, [user.id, key])

  const price = (settings?.ad_price_per_day?.[ad.placement] || 0) * ad.days
  async function launch(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try { await createAd(ad); setMsg({ text: 'Campaign submitted. It goes live as soon as our team approves it (refunded if not approved).' }); setAd({ ...ad, title: '', body: '', targetUrl: '', imageUrl: '' }); setKey(k => k + 1) }
    catch (err) { setMsg({ bad: true, text: err.message }) } finally { setBusy(false) }
  }

  const all = [...items.jobs.map(x => ({ ...x, type: 'job', label: x.title })), ...items.gigs.map(x => ({ ...x, type: 'gig', label: x.title })), ...items.companies.map(x => ({ ...x, type: 'company', label: x.name }))]
  return (
    <div className="dash-stack">
      <div className="card">
        <h3 className="section-h"><i className="fas fa-bolt" style={{ color: '#f59e0b' }}></i> Boost your posts</h3>
        <p className="muted" style={{ marginBottom: 12 }}>{formatMoney(settings?.boost_price_per_day, settings?.currency)} per day, paid from your wallet. Boosted jobs, gigs and business profiles are featured at the top of their pages.</p>
        {all.length ? <div className="boost-grid">{all.map(x => (
          <div key={`${x.type}${x.id}`} className="boost-item"><div><span className="pill pill-muted">{x.type}</span> <strong>{x.label}</strong></div><BoostButton type={x.type} id={x.id} until={x.boosted_until} onDone={() => setKey(k => k + 1)} /></div>
        ))}</div> : <p className="muted">Post a job or gig, or claim your business profile, to boost it.</p>}
      </div>

      <div className="card">
        <h3 className="section-h"><i className="fas fa-bullhorn" style={{ color: '#f59e0b' }}></i> Run an ad</h3>
        <form onSubmit={launch} className="form-grid">
          <div><label className="form-label" htmlFor="ad-place">Placement</label>
            <select id="ad-place" className="input" value={ad.placement} onChange={e => setAd({ ...ad, placement: e.target.value })}>
              {Object.entries(settings?.ad_price_per_day || {}).map(([k, v]) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)} page · {formatMoney(v, settings?.currency)}/day</option>)}
            </select></div>
          <div><label className="form-label" htmlFor="ad-days">Duration</label>
            <select id="ad-days" className="input" value={ad.days} onChange={e => setAd({ ...ad, days: Number(e.target.value) })}>{[3, 7, 14, 30].map(d => <option key={d} value={d}>{d} days</option>)}</select></div>
          <div className="span-2"><label className="form-label" htmlFor="ad-title">Headline</label><input id="ad-title" className="input" maxLength={80} value={ad.title} onChange={e => setAd({ ...ad, title: e.target.value })} /></div>
          <div className="span-2"><label className="form-label" htmlFor="ad-body">Text (max 220 characters)</label><textarea id="ad-body" className="input" rows={2} maxLength={220} value={ad.body} onChange={e => setAd({ ...ad, body: e.target.value })} /></div>
          <div><label className="form-label" htmlFor="ad-url">Link</label><input id="ad-url" className="input" value={ad.targetUrl} onChange={e => setAd({ ...ad, targetUrl: e.target.value })} placeholder="https://" /></div>
          <div><label className="form-label" htmlFor="ad-img">Image URL (optional)</label><input id="ad-img" className="input" value={ad.imageUrl} onChange={e => setAd({ ...ad, imageUrl: e.target.value })} placeholder="https://…jpg" /></div>
          <div className="span-2" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : `Pay ${formatMoney(price, settings?.currency)} & submit`}</button>
            {msg && <span className={`field-hint ${msg.bad ? 'bad' : 'ok'}`} style={{ margin: 0 }}>{msg.text}</span>}
          </div>
        </form>
        {ads.length > 0 && (
          <table className="sync-table" style={{ marginTop: 16 }}>
            <thead><tr><th>Campaign</th><th>Placement</th><th>Status</th><th>Views</th><th>Clicks</th><th>Ends</th></tr></thead>
            <tbody>{ads.map(a => <tr key={a.id}><td>{a.title}</td><td>{a.placement}</td><td><span className="pill pill-muted">{a.status.replace('_', ' ')}</span></td><td>{a.impressions}</td><td>{a.clicks}</td><td>{a.ends_at ? new Date(a.ends_at).toLocaleDateString() : '—'}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- support
export function SupportTab() {
  const { user } = useAuth()
  const [threads, setThreads] = useState([])
  const [active, setActive] = useState(null)
  const [subject, setSubject] = useState('')
  const [first, setFirst] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('support_threads').select('*').eq('user_id', user.id).order('last_message_at', { ascending: false })
    setThreads(data || [])
    if (!active && data?.length) setActive(data[0].id)
  }
  useEffect(() => { load() }, [user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) supabase.from('support_threads').update({ user_unread: 0 }).eq('id', active).then(() => {}) }, [active])

  async function start(e) {
    e.preventDefault()
    setErr('')
    if (subject.trim().length < 3 || first.trim().length < 2) return setErr('Add a subject and a message.')
    const { data, error } = await supabase.from('support_threads').insert({ subject: subject.trim() }).select().single()
    if (error) return setErr(error.message)
    await supabase.from('support_messages').insert({ thread_id: data.id, body: first.trim() })
    setSubject(''); setFirst(''); setActive(data.id); load()
  }

  return (
    <div className="support-layout card" style={{ padding: 0 }}>
      <div className="support-list">
        <form onSubmit={start} className="support-new">
          <strong>New conversation</strong>
          <input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
          <textarea className="input" rows={2} value={first} onChange={e => setFirst(e.target.value)} placeholder="How can we help?" />
          <button className="btn btn-primary btn-sm">Start chat</button>
          {err && <span className="field-hint bad">{err}</span>}
        </form>
        {threads.map(t => (
          <button key={t.id} className={`support-item ${active === t.id ? 'on' : ''}`} onClick={() => setActive(t.id)}>
            <strong>{t.subject}</strong>
            <span className="muted">{t.status} · {new Date(t.last_message_at).toLocaleDateString()}</span>
            {t.user_unread > 0 && <span className="badge-dot">{t.user_unread}</span>}
          </button>
        ))}
      </div>
      <div className="support-chat">
        {active ? <ChatPanel key={active} table="support_messages" fk="thread_id" id={active} height={460} placeholder="Message AfriTalent support…" />
          : <div className="muted" style={{ padding: 40, textAlign: 'center' }}>Start a conversation and our team will reply here.</div>}
      </div>
    </div>
  )
}
