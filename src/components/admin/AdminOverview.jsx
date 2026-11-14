import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { adminStats, formatMoney, useSettings } from '../../lib/marketplace'
import { timeAgo } from '../../lib/jobs'
import { StatCard } from '../dashboard/WalletParts'

const ACTION_TEXT = {
  account_active: 'approved / reactivated an account', account_suspended: 'suspended an account', account_blocked: 'blocked an account',
  account_rejected: 'rejected a sign-up', wallet_adjust: 'adjusted a wallet', dispute_resolve: 'resolved a dispute',
  withdrawal_paid: 'paid a withdrawal', withdrawal_rejected: 'declined a withdrawal', ad_approved: 'approved an ad', ad_rejected: 'rejected an ad',
}

export default function AdminOverview({ go }) {
  const settings = useSettings()
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  const [feed, setFeed] = useState([])
  const [syncs, setSyncs] = useState({})

  useEffect(() => {
    adminStats().then(setS).catch(e => setErr(e.message))
    Promise.all([
      supabase.from('admin_actions').select('*').order('created_at', { ascending: false }).limit(12),
      supabase.from('wallet_transactions').select('id,type,amount,held_change,description,created_at').order('created_at', { ascending: false }).limit(10),
      supabase.from('job_sync_runs').select('status,finished_at,errors').order('started_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('business_sync_runs').select('status,finished_at,errors').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([a, t, j, b]) => {
      const items = [
        ...(a.data || []).map(x => ({ at: x.created_at, icon: 'fas fa-user-shield', text: `Admin ${ACTION_TEXT[x.action] || x.action}` })),
        ...(t.data || []).map(x => ({ at: x.created_at, icon: 'fas fa-exchange-alt', text: `${x.description} · ${formatMoney(x.amount || -x.held_change, settings?.currency)}` })),
      ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 15)
      setFeed(items)
      setSyncs({ jobs: j.data, businesses: b.data })
    })
  }, [settings?.currency])

  if (err) return <div className="notice notice-warn"><i className="fas fa-database"></i> {err}</div>
  if (!s) return <div className="skeleton" style={{ height: 300, borderRadius: 14 }} />
  const cur = settings?.currency
  const alerts = [
    s.pending && { tab: 'signups', text: `${s.pending} sign-up${s.pending > 1 ? 's' : ''} awaiting approval`, icon: 'fas fa-user-clock' },
    s.kyc_pending && { tab: 'kyc', text: `${s.kyc_pending} KYC submission${s.kyc_pending > 1 ? 's' : ''} to review`, icon: 'fas fa-id-card' },
    s.disputes_open && { tab: 'disputes', text: `${s.disputes_open} open dispute${s.disputes_open > 1 ? 's' : ''}`, icon: 'fas fa-gavel', bad: true },
    s.support_unread && { tab: 'support', text: `${s.support_unread} unread support message${s.support_unread > 1 ? 's' : ''}`, icon: 'far fa-comments' },
    s.withdrawals_pending && { tab: 'payments', text: `${s.withdrawals_pending} withdrawal${s.withdrawals_pending > 1 ? 's' : ''} to pay (${formatMoney(s.withdrawals_pending_amount, cur)})`, icon: 'fas fa-university' },
    s.ads_pending && { tab: 'ads', text: `${s.ads_pending} ad${s.ads_pending > 1 ? 's' : ''} awaiting review`, icon: 'fas fa-bullhorn' },
    s.claims_pending && { tab: 'businesses', text: `${s.claims_pending} business claim${s.claims_pending > 1 ? 's' : ''}`, icon: 'fas fa-flag' },
  ].filter(Boolean)

  const syncRow = (label, r) => (
    <li><span className={`dot-status ${!r ? '' : r.status === 'success' ? 'ok' : r.status === 'partial' ? 'warn' : 'bad'}`} />{label}: {r ? `${r.status} · ${timeAgo(r.finished_at)}` : 'never run'}{r?.errors?.length ? <span className="muted"> · {r.errors.length} error(s)</span> : null}</li>
  )

  return (
    <div className="dash-stack">
      <div className="stat-grid">
        <StatCard icon="fas fa-users" label="Users" value={s.users.toLocaleString()} hint={`+${s.signups_7d} this week`} />
        <StatCard icon="fas fa-lock" label="Held in escrow" value={formatMoney(s.escrow_held, cur)} hint={`${s.contracts_active} active contracts`} />
        <StatCard icon="fas fa-chart-line" label="Revenue (30 days)" value={formatMoney(s.revenue_30d, cur)} hint="Fees, boosts & ads" tone="good" />
        <StatCard icon="fas fa-wallet" label="User wallet balances" value={formatMoney(s.wallet_balances, cur)} />
        <StatCard icon="fas fa-briefcase" label="Live jobs / open gigs" value={`${s.jobs_active.toLocaleString()} / ${s.gigs_open}`} />
        <StatCard icon="fas fa-store" label="Businesses" value={s.companies.toLocaleString()} />
        <StatCard icon="fas fa-user-lock" label="Suspended / blocked" value={`${s.suspended} / ${s.blocked}`} tone={s.suspended + s.blocked ? 'warn' : ''} />
        <StatCard icon="fas fa-shield-alt" label="KYC auto-rejected (7d)" value={s.kyc_auto_rejected_7d} hint="Fakes stopped automatically" />
      </div>

      <div className="admin-two">
        <div className="card">
          <h3 className="section-h">Needs attention</h3>
          {alerts.length ? <div className="list-rows">{alerts.map(a => (
            <button key={a.tab} className="list-row" onClick={() => go(a.tab)}><i className={a.icon} style={{ color: a.bad ? 'var(--color-danger)' : 'var(--color-primary-dark)', width: 18 }}></i><span style={{ flex: 1, textAlign: 'left' }}>{a.text}</span><i className="fas fa-chevron-right muted"></i></button>
          ))}</div> : <p className="muted"><i className="fas fa-check-circle" style={{ color: 'var(--color-success)' }}></i> All clear.</p>}
          <h3 className="sub-h" style={{ marginTop: 18 }}>Automations</h3>
          <ul className="status-list">{syncRow('Hourly job import', syncs.jobs)}{syncRow('Daily business import', syncs.businesses)}</ul>
        </div>
        <div className="card">
          <h3 className="section-h">Recent activity</h3>
          {feed.length ? <ul className="feed">{feed.map((f, i) => <li key={i}><i className={f.icon}></i><span>{f.text}</span><span className="muted">{timeAgo(f.at)}</span></li>)}</ul> : <p className="muted">No activity yet.</p>}
        </div>
      </div>
    </div>
  )
}
