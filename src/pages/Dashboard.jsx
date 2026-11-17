import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { verifyTopup } from '../lib/marketplace'
import VerificationBanner from '../components/VerificationBanner'
import { EarningsTab, WalletTab, PromoteTab, SupportTab, ContractsList, MyGigs, MyProposals } from '../components/dashboard/Tabs'

const SEEKER_TABS = [
  { id: 'earnings', label: 'Earnings', icon: 'fas fa-coins' },
  { id: 'gigs', label: 'My gigs', icon: 'fas fa-briefcase' },
  { id: 'wallet', label: 'Wallet', icon: 'fas fa-wallet' },
  { id: 'support', label: 'Support', icon: 'far fa-life-ring' },
]
const BUSINESS_TABS = [
  { id: 'wallet', label: 'Wallet', icon: 'fas fa-wallet' },
  { id: 'gigs', label: 'Gigs & hires', icon: 'fas fa-briefcase' },
  { id: 'promote', label: 'Ads & boosts', icon: 'fas fa-bullhorn' },
  { id: 'support', label: 'Support', icon: 'far fa-life-ring' },
]

export function AccountBanner() {
  const { profile } = useAuth()
  const s = profile?.account_status
  if (!s || s === 'active') return null
  const text = {
    pending: 'Your account is awaiting approval by our team. You can complete verification in the meantime; posting, applying and payments unlock once approved.',
    suspended: `Your account is suspended${profile.suspended_until ? ` until ${new Date(profile.suspended_until).toLocaleDateString()}` : ''}.${profile.status_reason ? ` Reason: ${profile.status_reason}.` : ''} Contact support if you believe this is a mistake.`,
    blocked: `Your account has been blocked.${profile.status_reason ? ` Reason: ${profile.status_reason}.` : ''} You can appeal through support.`,
    rejected: `Your sign-up was not approved.${profile.status_reason ? ` Reason: ${profile.status_reason}.` : ''} Contact support for details.`,
  }[s]
  return <div className={`notice ${s === 'pending' ? 'notice-info' : 'notice-error'}`}><i className={s === 'pending' ? 'fas fa-user-clock' : 'fas fa-user-lock'}></i> <span>{text} <Link to="/dashboard?tab=support" style={{ fontWeight: 700 }}>Message support</Link></span></div>
}

export default function Dashboard() {
  const { profile, isBusiness } = useAuth()
  const [params, setParams] = useSearchParams()
  const tabs = isBusiness ? BUSINESS_TABS : SEEKER_TABS
  const tab = tabs.some(t => t.id === params.get('tab')) ? params.get('tab') : tabs[0].id
  const [topupNotice, setTopupNotice] = useState(null)

  // Returning from Paystack checkout
  useEffect(() => {
    const ref = params.get('ref') || params.get('reference')
    if (!ref) return
    setTopupNotice(<div className="notice notice-info"><span className="spinner" style={{ width: 14, height: 14 }} /> Confirming your payment…</div>)
    verifyTopup(ref)
      .then(r => setTopupNotice(<div className={`notice ${r.status === 'success' ? 'notice-info' : 'notice-warn'}`}><i className="fas fa-check-circle"></i> {r.status === 'success' ? 'Payment received — your wallet has been topped up.' : `Payment status: ${r.status}. Your wallet updates automatically once it completes.`}</div>))
      .catch(e => setTopupNotice(<div className="notice notice-warn"><i className="fas fa-exclamation-circle"></i> {e.message}</div>))
      .finally(() => { const p = new URLSearchParams(params); p.delete('ref'); p.delete('reference'); p.delete('trxref'); setParams(p, { replace: true }) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page-enter">
      <div className="container dash">
        <div className="dash-head">
          <div>
            <h1>Hi {profile?.full_name?.split(' ')[0] || 'there'} 👋</h1>
            <p className="muted">{isBusiness ? 'Manage your wallet, hires, ads and boosts.' : 'Track your gigs, earnings and payouts.'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isBusiness ? <Link to="/gigs/new" className="btn btn-primary"><i className="fas fa-plus"></i> Post a gig</Link> : <Link to="/gigs" className="btn btn-primary"><i className="fas fa-search"></i> Find gigs</Link>}
          </div>
        </div>
        <AccountBanner />
        <VerificationBanner purpose={isBusiness ? 'withdraw funds and hire' : 'send proposals and get paid'} />

        <nav className="dash-tabs" aria-label="Dashboard sections">
          {tabs.map(t => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setParams({ tab: t.id }, { replace: true })}><i className={t.icon}></i> {t.label}</button>)}
        </nav>

        {tab === 'earnings' && <EarningsTab />}
        {tab === 'wallet' && <WalletTab notice={topupNotice} />}
        {tab === 'gigs' && (
          <div className="dash-stack">
            {isBusiness ? (
              <><div className="card"><h3 className="section-h">Gigs you posted</h3><MyGigs /></div><div className="card"><h3 className="section-h">People you hired</h3><ContractsList role="client" /></div></>
            ) : (
              <><div className="card"><h3 className="section-h">Active contracts</h3><ContractsList role="freelancer" /></div><div className="card"><h3 className="section-h">Proposals</h3><MyProposals /></div><div className="card"><h3 className="section-h">Gigs you hired for</h3><ContractsList role="client" /></div></>
            )}
          </div>
        )}
        {tab === 'promote' && <PromoteTab />}
        {tab === 'support' && <SupportTab />}
      </div>
    </div>
  )
}
