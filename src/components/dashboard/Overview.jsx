import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { formatMoney, TX_LABEL } from '../../lib/marketplace'
import { dashboardSummary, myOrders, ORDER_STATUS } from '../../lib/social'
import { timeAgo } from '../../context/InboxContext'
import { SetupPending } from '../social/SocialUI'

function Stat({ icon, label, value, sub, to }) {
  const body = (
    <>
      <span className="ov-icon"><i className={icon}></i></span>
      <div><span className="ov-label">{label}</span><strong className="ov-value">{value}</strong>{sub && <span className="ov-sub">{sub}</span>}</div>
    </>
  )
  return to ? <Link to={to} className="ov-stat card">{body}</Link> : <div className="ov-stat card">{body}</div>
}

export function OverviewTab() {
  const { profile, isBusiness } = useAuth()
  const [s, setS] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { dashboardSummary().then(setS).catch(setError) }, [])

  if (error) return (
    <div className="dash-stack">
      <SetupPending error={error} />
      <div className="ov-grid">
        <Stat icon="fas fa-wallet" label="Wallet" value="Open wallet" to="/dashboard?tab=wallet" />
        <Stat icon="fas fa-briefcase" label="Jobs & gigs" value="Browse" to="/jobs" />
        <Stat icon="fas fa-store" label="Market" value="Browse" to="/market" />
      </div>
    </div>
  )
  if (!s) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
  const cur = s.wallet?.currency || 'NGN'

  return (
    <div className="dash-stack">
      <div className="ov-grid">
        <Stat icon="fas fa-wallet" label="Wallet balance" value={formatMoney(s.wallet?.balance || 0, cur)} sub={s.wallet?.held ? `${formatMoney(s.wallet.held, cur)} held in escrow` : 'Available to spend or withdraw'} to="/dashboard?tab=wallet" />
        <Stat icon="fas fa-coins" label="Total earned" value={formatMoney(s.earned_total, cur)} sub={`${formatMoney(s.earned_30d, cur)} in the last 30 days`} to="/dashboard?tab=earnings" />
        <Stat icon="fas fa-star" label="Rating" value={s.rating ? `${s.rating} ★` : '—'} sub={s.ratings_count ? `${s.ratings_count} review${s.ratings_count > 1 ? 's' : ''}` : 'Complete work to get rated'} to={profile?.username ? `/u/${profile.username}` : undefined} />
        {isBusiness
          ? <Stat icon="fas fa-bullhorn" label="Gigs posted" value={s.gigs_posted} sub={`${s.contracts_active} active hire${s.contracts_active === 1 ? '' : 's'}`} to="/dashboard?tab=gigs" />
          : <Stat icon="fas fa-paper-plane" label="Applications" value={s.job_applications + s.proposals_sent} sub={`${s.job_applications} jobs · ${s.proposals_sent} gig proposals (${s.proposals_accepted} won)`} to="/dashboard?tab=gigs" />}
        <Stat icon="fas fa-shopping-bag" label="Orders" value={s.orders_bought + s.orders_sold} sub={`${s.orders_sold} sold · ${s.orders_bought} bought · ${s.orders_open} open`} to="/dashboard?tab=orders" />
        <Stat icon="fas fa-users" label="Network" value={s.followers} sub={`followers · ${s.following} following · ${s.posts || 0} posts`} to="/feed" />
      </div>

      <div className="ov-two">
        <div className="card">
          <div className="section-row"><h3 className="section-h">Recent transactions</h3><Link to="/dashboard?tab=wallet" className="link-btn">Wallet →</Link></div>
          {s.recent_transactions.length === 0 && <p className="muted">No transactions yet. <Link to="/dashboard?tab=wallet">Add funds</Link> to hire, buy or boost.</p>}
          {s.recent_transactions.map(t => (
            <div key={t.id} className="ov-row">
              <div><strong>{TX_LABEL[t.type] || t.type}</strong><span className="muted ellipsis" style={{ display: 'block', fontSize: 12 }}>{t.description}</span></div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ color: t.amount > 0 ? 'var(--color-success)' : t.amount < 0 ? 'var(--color-danger)' : 'inherit' }}>
                  {t.amount ? `${t.amount > 0 ? '+' : ''}${formatMoney(t.amount, cur)}` : `${formatMoney(Math.abs(t.held_change), cur)} ${t.held_change > 0 ? 'held' : 'released'}`}
                </strong>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>{timeAgo(t.created_at)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 className="section-h">Recent activity</h3>
          {[...s.recent_applications.map(a => ({ at: a.created_at, icon: 'fas fa-briefcase', text: <>Applied to <Link to={`/jobs/${a.job_id}`}>{a.title}</Link>{a.company ? ` at ${a.company}` : ''}</> })),
            ...s.recent_proposals.map(p => ({ at: p.created_at, icon: 'fas fa-file-signature', text: <>Proposal on <Link to={`/gigs/${p.gig_id}`}>{p.title}</Link> · <span className="muted">{p.status}</span></> })),
            ...s.recent_orders.map(o => ({ at: o.created_at, icon: 'fas fa-shopping-bag', text: <>{o.bought ? 'Bought' : 'Sold'} <Link to={`/orders/${o.id}`}>{o.title}</Link> · {formatMoney(o.amount, cur)} · <span className="muted">{ORDER_STATUS[o.status]?.label || o.status}</span></> })),
          ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8).map((r, i) => (
            <div key={i} className="ov-row"><span><i className={r.icon} style={{ color: 'var(--color-primary-dark)', width: 18 }}></i> {r.text}</span><span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(r.at)}</span></div>
          ))}
          {!s.recent_applications.length && !s.recent_proposals.length && !s.recent_orders.length && (
            <p className="muted">Nothing yet — <Link to="/jobs">find a job or gig</Link>, or <Link to="/market">shop the market</Link>.</p>
          )}
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
