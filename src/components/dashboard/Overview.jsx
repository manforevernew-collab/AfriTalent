import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatMoney } from '../../lib/marketplace'
import { dashboardSummary, myOrders, ORDER_STATUS, INTERVIEW_MODES, respondInterview, cancelInterview } from '../../lib/social'
import { timeAgo } from '../../context/InboxContext'
import { SetupPending } from '../social/SocialUI'
import UserAvatar from '../UserAvatar'

function Stat({ icon, label, value, sub, to, tone }) {
  const body = (
    <>
      <span className={`ov-icon ${tone || ''}`}><i className={icon}></i></span>
      <div><span className="ov-label">{label}</span><strong className="ov-value">{value}</strong>{sub && <span className="ov-sub">{sub}</span>}</div>
    </>
  )
  return to ? <Link to={to} className="ov-stat card">{body}</Link> : <div className="ov-stat card">{body}</div>
}

// Used until the dashboard_summary database function is live: counts from existing tables.
async function basicSummary(uid) {
  const count = q => q.then(r => r.count || 0, () => 0)
  const [apps, props, done, earnings] = await Promise.all([
    count(supabase.from('applications').select('id', { count: 'exact', head: true }).eq('user_id', uid)),
    count(supabase.from('gig_proposals').select('id', { count: 'exact', head: true }).eq('freelancer_id', uid)),
    count(supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('freelancer_id', uid).eq('status', 'completed')),
    supabase.from('wallet_transactions').select('id, amount, description, created_at').eq('user_id', uid).eq('type', 'earning').order('created_at', { ascending: false }).limit(200).then(r => r.data || [], () => []),
  ])
  const since = Date.now() - 30 * 864e5
  return {
    basic: true,
    profile_views_30d: null, profile_views_total: null, interviews_upcoming: null, interviews: [],
    job_applications: apps, proposals_sent: props, proposals_accepted: null, jobs_done: done, jobs_in_progress: null,
    earned_total: earnings.reduce((a, t) => a + Number(t.amount), 0),
    earned_30d: earnings.filter(t => new Date(t.created_at) > since).reduce((a, t) => a + Number(t.amount), 0),
    pending_earnings: null, currency: 'NGN', rating: null, ratings_count: 0,
    recent_applications: [], recent_earnings: earnings.slice(0, 6), recent_jobs_done: [],
  }
}

function trend(now, prev) {
  if (prev == null || now == null) return null
  if (!prev) return now ? 'New this month' : null
  const pct = Math.round(((now - prev) / prev) * 100)
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs previous 30 days`
}

function InterviewRow({ iv, onChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const when = new Date(iv.scheduled_at)
  const soon = when - Date.now() < 864e5
  async function run(fn) { setBusy(true); setErr(''); try { await fn(); onChange() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  return (
    <div className="iv-row">
      <div className={`iv-date ${soon ? 'soon' : ''}`}>
        <span>{when.toLocaleDateString(undefined, { month: 'short' })}</span>
        <b>{when.getDate()}</b>
        <span>{when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{iv.title}</strong>
        <div className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <UserAvatar src={iv.other_avatar} name={iv.other_name} size={20} />
          {iv.as_candidate ? 'with' : 'with candidate'} <Link to={`/u/${iv.other_username}`}>{iv.other_name}</Link>
          · {INTERVIEW_MODES[iv.mode]} · {iv.duration_minutes} min
        </div>
        {iv.location && (/^https?:\/\//.test(iv.location)
          ? <a href={iv.location} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}><i className="fas fa-video"></i> Join link</a>
          : <span style={{ fontSize: 13 }}><i className="fas fa-map-marker-alt"></i> {iv.location}</span>)}
        {iv.notes && <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{iv.notes}</p>}
        {err && <div className="notice notice-error" style={{ marginTop: 6 }}>{err}</div>}
      </div>
      <div className="iv-actions">
        <span className={`status-pill ${iv.status === 'accepted' ? 'ok' : ''}`}>{iv.status === 'accepted' ? 'Confirmed' : iv.as_candidate ? 'Awaiting your reply' : 'Awaiting candidate'}</span>
        {iv.as_candidate && iv.status === 'scheduled' && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => respondInterview(iv.id, true))}>Accept</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => run(() => respondInterview(iv.id, false, window.prompt('Optional: tell them why or suggest another time') || null))}>Decline</button>
          </>
        )}
        {!iv.as_candidate && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => window.confirm('Cancel this interview?') && run(() => cancelInterview(iv.id))}>Cancel</button>}
      </div>
    </div>
  )
}

export function OverviewTab() {
  const { user, profile } = useAuth()
  const [s, setS] = useState(null)
  const load = useCallback(() => {
    dashboardSummary().then(d => setS(d)).catch(() => basicSummary(user.id).then(setS))
  }, [user.id])
  useEffect(() => { load() }, [load])

  if (!s) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
  const cur = s.currency || 'NGN'
  const applied = (s.job_applications || 0) + (s.proposals_sent || 0)

  return (
    <div className="dash-stack">
      <div className="ov-grid ov-grid-5">
        <Stat icon="fas fa-eye" label="Profile visits" value={s.profile_views_30d ?? '—'}
          sub={s.basic ? 'Tracking starts shortly' : (trend(s.profile_views_30d, s.profile_views_prev_30d) || `${s.profile_views_total} all time · last 30 days`)}
          to={profile?.username ? `/u/${profile.username}` : undefined} />
        <Stat icon="fas fa-check-double" label="Jobs done" value={s.jobs_done}
          sub={s.jobs_in_progress ? `${s.jobs_in_progress} in progress` : s.rating ? `★ ${Number(s.rating).toFixed(1)} from ${s.ratings_count} review${s.ratings_count === 1 ? '' : 's'}` : 'Completed gigs and sales'}
          to="/dashboard?tab=gigs" />
        <Stat icon="fas fa-paper-plane" label="Jobs applied for" value={applied}
          sub={`${s.job_applications} job${s.job_applications === 1 ? '' : 's'} · ${s.proposals_sent} gig proposal${s.proposals_sent === 1 ? '' : 's'}${s.proposals_accepted ? ` (${s.proposals_accepted} won)` : ''}`}
          to="/dashboard?tab=gigs" />
        <Stat icon="fas fa-calendar-check" label="Upcoming interviews" value={s.interviews_upcoming ?? '—'}
          sub={s.interviews?.[0] ? `Next: ${new Date(s.interviews[0].scheduled_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : s.basic ? 'Interview scheduling starts shortly' : 'None scheduled'}
          tone={s.interviews_upcoming ? 'hot' : ''} />
        <Stat icon="fas fa-coins" label="Earnings" value={formatMoney(s.earned_total || 0, cur)}
          sub={`${formatMoney(s.earned_30d || 0, cur)} this month${s.pending_earnings ? ` · ${formatMoney(s.pending_earnings, cur)} pending in escrow` : ''}`}
          to="/dashboard?tab=earnings" />
      </div>

      <div className="card">
        <div className="section-row"><h3 className="section-h">Upcoming interviews</h3></div>
        {s.interviews?.length
          ? s.interviews.map(iv => <InterviewRow key={iv.id} iv={iv} onChange={load} />)
          : <p className="muted">{s.basic ? 'Interviews will appear here once scheduling is switched on.' : 'No interviews scheduled. Employers can invite you straight from your public profile — keep it complete and share it.'}</p>}
      </div>

      <div className="ov-two">
        <div className="card">
          <h3 className="section-h">Recent applications</h3>
          {s.recent_applications?.length ? s.recent_applications.map((a, i) => (
            <div key={i} className="ov-row">
              <span><i className={a.kind === 'gig' ? 'fas fa-bolt' : 'fas fa-briefcase'} style={{ color: 'var(--color-primary-dark)', width: 18 }}></i>{' '}
                <Link to={a.kind === 'gig' ? `/gigs/${a.job_id}` : `/jobs/${a.job_id}`}>{a.title}</Link>{a.company ? ` · ${a.company}` : ''}
                {a.status && <span className="muted"> · {a.status}</span>}</span>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(a.created_at)}</span>
            </div>
          )) : <p className="muted">{applied ? 'Your latest applications will show here.' : <>No applications yet — <Link to="/jobs">find a job or gig</Link>.</>}</p>}
        </div>

        <div className="card">
          <div className="section-row"><h3 className="section-h">Recent earnings & completed work</h3><Link to="/dashboard?tab=earnings" className="link-btn">All earnings →</Link></div>
          {[...(s.recent_jobs_done || []).map(j => ({ at: j.done_at, key: `j${j.kind}${j.id}`, text: <><Link to={j.kind === 'order' ? `/orders/${j.id}` : `/contracts/${j.id}`}>{j.title}</Link>{j.rating ? <span style={{ color: '#f59e0b' }}> · {'★'.repeat(j.rating)}</span> : ''}</>, amount: j.amount })),
            ...(s.recent_jobs_done?.length ? [] : (s.recent_earnings || []).map(t => ({ at: t.created_at, key: `t${t.id}`, text: t.description, amount: t.amount }))),
          ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6).map(r => (
            <div key={r.key} className="ov-row">
              <span className="ellipsis">{r.text}</span>
              <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong style={{ color: 'var(--color-success)' }}>+{formatMoney(r.amount, cur)}</strong><span className="muted" style={{ display: 'block', fontSize: 12 }}>{timeAgo(r.at)}</span></span>
            </div>
          ))}
          {!s.recent_jobs_done?.length && !s.recent_earnings?.length && <p className="muted">Complete a gig or make a sale to start earning.</p>}
        </div>
      </div>
    </div>
  )
}

export function OrdersTab() {
  const { user } = useAuth()
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [view, setView] = useState('all')
  useEffect(() => { myOrders(user.id).then(setOrders).catch(e => { setError(e); setOrders([]) }) }, [user.id])

  const shown = (orders || []).filter(o => view === 'all' || (view === 'sold' ? o.seller_id === user.id : o.buyer_id === user.id))
  return (
    <div className="card">
      <div className="section-row">
        <h3 className="section-h">Orders</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {['all', 'bought', 'sold'].map(v => <button key={v} type="button" className={`btn btn-sm ${view === v ? 'btn-primary' : 'btn-outline'}`} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
        </div>
      </div>
      <SetupPending error={error} />
      {orders === null && <div className="spinner" />}
      {orders && shown.length === 0 && !error && <p className="muted">No orders yet. <Link to="/market">Visit the market</Link> or list something to sell from your <Link to="/feed">feed</Link>.</p>}
      {shown.map(o => {
        const st = ORDER_STATUS[o.status] || { label: o.status }
        return (
          <Link key={o.id} to={`/orders/${o.id}`} className="ov-row order-row">
            <div><strong>{o.title}</strong><span className="muted" style={{ display: 'block', fontSize: 12 }}>#{o.id} · {o.seller_id === user.id ? 'Sold' : 'Bought'} · {new Date(o.created_at).toLocaleDateString()}</span></div>
            <div style={{ textAlign: 'right' }}>
              <strong>{formatMoney(o.amount, o.currency)}</strong>
              <span className="status-pill" style={{ background: st.bg, color: st.color, display: 'block', marginTop: 4 }}>{st.label}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
