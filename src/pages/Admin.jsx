import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import AdminOverview from '../components/admin/AdminOverview'
import AdminUsers from '../components/admin/AdminUsers'
import AdminDisputes from '../components/admin/AdminDisputes'
import AdminSupport from '../components/admin/AdminSupport'
import { AdminPayments, AdminAds, AdminSettings } from '../components/admin/AdminPayments'
import KycQueue from '../components/admin/KycQueue'
import SpecimenLibrary from '../components/admin/SpecimenLibrary'
import ClaimsQueue from '../components/admin/ClaimsQueue'
import BusinessSyncPanel from '../components/admin/BusinessSyncPanel'
import JobSyncPanel from '../components/JobSyncPanel'
import CareerBoardsPanel from '../components/admin/CareerBoardsPanel'
import DocLink from '../components/admin/DocLink'
import { adminStats } from '../lib/marketplace'

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'fas fa-chart-pie' },
  { id: 'signups', label: 'Sign-up approvals', icon: 'fas fa-user-clock', badge: 'pending' },
  { id: 'users', label: 'Users', icon: 'fas fa-users' },
  { id: 'kyc', label: 'KYC & address', icon: 'fas fa-id-card', badge: 'kyc_pending' },
  { id: 'disputes', label: 'Disputes', icon: 'fas fa-gavel', badge: 'disputes_open' },
  { id: 'support', label: 'Support chat', icon: 'far fa-comments', badge: 'support_unread' },
  { id: 'payments', label: 'Payments & escrow', icon: 'fas fa-money-check-alt', badge: 'withdrawals_pending' },
  { id: 'ads', label: 'Ads', icon: 'fas fa-bullhorn', badge: 'ads_pending' },
  { id: 'businesses', label: 'Businesses', icon: 'fas fa-store', badge: 'claims_pending' },
  { id: 'jobs', label: 'Job import', icon: 'fas fa-briefcase' },
  { id: 'settings', label: 'Settings', icon: 'fas fa-sliders-h' },
]

function AdminLogin() {
  const { signInWithEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error: err } = await signInWithEmail(email, password)
    setBusy(false)
    if (err) setError(err.message)
  }
  return (
    <div className="admin-login">
      <form onSubmit={submit} className="card">
        <div className="admin-login-icon"><i className="fas fa-user-shield"></i></div>
        <h1>AfriTalent Admin</h1>
        <p className="muted">Sign in with an administrator account.</p>
        <input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" aria-label="Email" />
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" aria-label="Password" />
        {error && <div className="notice notice-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

function KycSection() {
  const [addr, setAddr] = useState([])
  async function load() {
    const { data } = await supabase.from('address_verifications').select('*, profiles(full_name)').eq('status', 'pending').order('submitted_at', { ascending: false }).limit(20)
    setAddr(data || [])
  }
  useEffect(() => { load() }, [])
  async function review(a, status) {
    await supabase.from('address_verifications').update({ status, verified_at: status === 'approved' ? new Date().toISOString() : null }).eq('id', a.id)
    await supabase.from('profiles').update({ address_status: status }).eq('id', a.user_id)
    load()
  }
  return (
    <div className="admin-grid">
      <KycQueue />
      <div className="card">
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Address verifications ({addr.length})</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {addr.length ? addr.map(a => (
            <div key={a.id} className="kyc-item">
              <div style={{ fontWeight: 600, fontSize: 13 }}>{a.profiles?.full_name || 'User'}</div>
              <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>{a.address_text}</div>
              <div className="kyc-docs">
                {a.gps_lat && <a className="doc-link" href={`https://www.google.com/maps?q=${Number(a.gps_lat)},${Number(a.gps_lng)}`} target="_blank" rel="noopener noreferrer"><i className="fas fa-map-pin"></i> GPS</a>}
                <DocLink refPath={a.utility_bill_url}><i className="fas fa-file-invoice"></i> Utility bill</DocLink>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={() => review(a, 'approved')}>Approve</button>
                <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={() => review(a, 'rejected')}>Reject</button>
              </div>
            </div>
          )) : <p className="muted" style={{ fontSize: 13 }}>No pending address verifications.</p>}
        </div>
      </div>
      <SpecimenLibrary />
    </div>
  )
}

export default function Admin() {
  const { user, isAdmin, loading, signOut, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const section = SECTIONS.some(s => s.id === params.get('s')) ? params.get('s') : 'overview'
  const [counts, setCounts] = useState({})
  const [chatWith, setChatWith] = useState(null)
  const [menu, setMenu] = useState(false)
  const go = s => { setParams({ s }, { replace: true }); setMenu(false) }

  useEffect(() => {
    if (!isAdmin) return
    const refresh = () => adminStats().then(setCounts).catch(() => {})
    refresh()
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [isAdmin, section])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!user) return <AdminLogin />
  if (!isAdmin) {
    return (
      <div className="admin-login"><div className="card" style={{ textAlign: 'center' }}>
        <div className="admin-login-icon"><i className="fas fa-lock"></i></div>
        <h1>Admins only</h1><p className="muted">You're signed in as {user.email}, which is not an administrator account.</p>
        <button className="btn btn-outline" onClick={signOut}>Sign in with a different account</button> <Link to="/" className="btn btn-ghost">Go home</Link>
      </div></div>
    )
  }

  const messageUser = u => { setChatWith(u); go('support') }
  const current = SECTIONS.find(s => s.id === section)

  return (
    <div className="admin-shell">
      <aside className={`admin-nav ${menu ? 'open' : ''}`}>
        <div className="admin-nav-head"><i className="fas fa-user-shield"></i> Admin console</div>
        {SECTIONS.map(s => (
          <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => go(s.id)}>
            <i className={s.icon}></i><span>{s.label}</span>{s.badge && counts[s.badge] > 0 && <span className="badge-dot">{counts[s.badge]}</span>}
          </button>
        ))}
        <div className="admin-nav-foot">{profile?.full_name || user.email}<button className="linkish" onClick={signOut}>Sign out</button></div>
      </aside>
      <main className="admin-main">
        <div className="admin-topbar">
          <button className="btn btn-ghost admin-menu-btn" onClick={() => setMenu(m => !m)} aria-label="Menu"><i className="fas fa-bars"></i></button>
          <h1><i className={current.icon}></i> {current.label}</h1>
        </div>
        {section === 'overview' && <AdminOverview go={go} />}
        {section === 'signups' && <AdminUsers key="pending" initialStatus="pending" title="Sign-ups awaiting approval" onMessage={messageUser} showApprovalToggle />}
        {section === 'users' && <AdminUsers key="all" onMessage={messageUser} />}
        {section === 'kyc' && <KycSection />}
        {section === 'disputes' && <AdminDisputes />}
        {section === 'support' && <AdminSupport startWith={chatWith} onStarted={() => setChatWith(null)} />}
        {section === 'payments' && <AdminPayments />}
        {section === 'ads' && <AdminAds />}
        {section === 'businesses' && <div className="dash-stack"><BusinessSyncPanel /><ClaimsQueue /></div>}
        {section === 'jobs' && <div><JobSyncPanel /><CareerBoardsPanel /></div>}
        {section === 'settings' && <AdminSettings />}
      </main>
    </div>
  )
}
