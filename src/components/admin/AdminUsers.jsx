import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { adminListUsers, adminSetStatus, adminAdjustWallet, formatMoney, toMinor, useSettings, clearSettingsCache } from '../../lib/marketplace'
import DocLink from './DocLink'

const STATUS_STYLE = {
  active: { bg: '#dcfce7', color: '#166534' }, pending: { bg: '#dbeafe', color: '#1d4ed8' },
  suspended: { bg: '#fef3c7', color: '#92400e' }, blocked: { bg: '#fee2e2', color: '#991b1b' }, rejected: { bg: '#e2e8f0', color: '#334155' },
}
export const StatusPill = ({ s }) => <span className="pill" style={STATUS_STYLE[s] || {}}>{s}</span>

function UserActions({ u, onDone, onMessage }) {
  const settings = useSettings()
  const [mode, setMode] = useState(null)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(7)
  const [amount, setAmount] = useState('')
  const [msg, setMsg] = useState(null)
  const [kyc, setKyc] = useState(null)

  useEffect(() => {
    supabase.from('kyc_verifications').select('*').eq('user_id', u.id).order('id', { ascending: false }).limit(1).maybeSingle().then(({ data }) => setKyc(data))
  }, [u.id])

  async function run(fn, text) {
    setMsg(null)
    try { await fn(); setMsg({ text }); setMode(null); setReason(''); onDone() } catch (e) { setMsg({ bad: true, text: e.message }) }
  }
  const until = new Date(Date.now() + days * 86400e3).toISOString()

  return (
    <div className="user-detail">
      <div className="user-facts">
        <span><strong>Type:</strong> {u.user_type || '—'}</span>
        <span><strong>KYC:</strong> {u.kyc_status}{kyc?.auto_status ? ` (auto: ${kyc.auto_status}, risk ${kyc.risk_score ?? '—'})` : ''}</span>
        <span><strong>Address:</strong> {u.address_status}</span>
        <span><strong>Wallet:</strong> {formatMoney(u.balance, settings?.currency)} · escrow {formatMoney(u.held, settings?.currency)}</span>
        <span><strong>Last sign-in:</strong> {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : 'never'}</span>
        {kyc?.id_document_url && <DocLink refPath={kyc.id_document_url}><i className="fas fa-id-card"></i> View ID</DocLink>}
        {u.status_reason && <span><strong>Reason:</strong> {u.status_reason}{u.suspended_until ? ` (until ${new Date(u.suspended_until).toLocaleDateString()})` : ''}</span>}
      </div>
      <div className="user-btns">
        {u.account_status !== 'active' && <button className="btn btn-success btn-sm" onClick={() => run(() => adminSetStatus(u.id, 'active'), 'Account activated.')}><i className="fas fa-check"></i> {u.account_status === 'pending' ? 'Approve' : 'Reactivate'}</button>}
        {u.account_status !== 'suspended' && u.role !== 'admin' && <button className="btn btn-outline btn-sm" onClick={() => setMode('suspend')}><i className="fas fa-pause-circle"></i> Suspend</button>}
        {u.account_status !== 'blocked' && u.role !== 'admin' && <button className="btn btn-danger btn-sm" onClick={() => setMode('block')}><i className="fas fa-ban"></i> Block</button>}
        <button className="btn btn-outline btn-sm" onClick={() => setMode('wallet')}><i className="fas fa-wallet"></i> Adjust wallet</button>
        <button className="btn btn-outline btn-sm" onClick={() => onMessage(u)}><i className="far fa-comments"></i> Message</button>
      </div>
      {mode && (
        <div className="contract-panel">
          {mode === 'wallet' ? (
            <>
              <input className="input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount, e.g. 5000 to credit or -5000 to debit" />
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (recorded in the audit log)" />
              <button className="btn btn-primary btn-sm" onClick={() => run(() => adminAdjustWallet(u.id, (String(amount).trim().startsWith('-') ? -1 : 1) * toMinor(amount), reason), 'Wallet adjusted.')}>Apply adjustment</button>
            </>
          ) : (
            <>
              {mode === 'suspend' && <select className="input" value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30, 90].map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}</select>}
              <input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (shown to the user)" />
              <button className="btn btn-danger btn-sm" disabled={reason.trim().length < 3}
                onClick={() => run(() => adminSetStatus(u.id, mode === 'suspend' ? 'suspended' : 'blocked', reason, mode === 'suspend' ? until : null), mode === 'suspend' ? 'Account suspended.' : 'Account blocked.')}>
                Confirm {mode}
              </button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Cancel</button>
        </div>
      )}
      {msg && <div className={`field-hint ${msg.bad ? 'bad' : 'ok'}`}>{msg.text}</div>}
    </div>
  )
}

export default function AdminUsers({ initialStatus = '', title = 'Users', onMessage, showApprovalToggle }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState('')
  const [approval, setApproval] = useState(null)

  async function load(p = page) {
    setErr('')
    try {
      const data = await adminListUsers(search.trim(), status, 25, p * 25)
      setRows(data || []); setTotal(data?.[0]?.total_count || 0); setPage(p)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { load(0) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (showApprovalToggle) supabase.from('app_settings').select('require_signup_approval').eq('id', 1).maybeSingle().then(({ data }) => setApproval(data?.require_signup_approval ?? null)) }, [showApprovalToggle])

  async function toggleApproval(v) {
    const { error } = await supabase.from('app_settings').update({ require_signup_approval: v, updated_at: new Date().toISOString() }).eq('id', 1)
    if (!error) { setApproval(v); clearSettingsCache() }
  }

  return (
    <div className="card">
      <div className="admin-card-head">
        <h3 className="section-h" style={{ margin: 0 }}>{title} <span className="muted" style={{ fontWeight: 400 }}>({total})</span></h3>
        {showApprovalToggle && approval !== null && (
          <label className="biz-toggle"><input type="checkbox" checked={approval} onChange={e => toggleApproval(e.target.checked)} /> New sign-ups need approval</label>
        )}
      </div>
      <form className="biz-toolbar" onSubmit={e => { e.preventDefault(); load(0) }} style={{ marginTop: 12 }}>
        <input className="input" style={{ flex: 1, minWidth: 220 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email or user ID" />
        {!initialStatus && (
          <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>{['active', 'pending', 'suspended', 'blocked', 'rejected'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button className="btn btn-outline">Search</button>
      </form>
      {err && <div className="notice notice-warn">{err}</div>}
      <div className="list-rows">
        {rows.map(u => (
          <div key={u.id} className={`user-row ${open === u.id ? 'open' : ''}`}>
            <button className="list-row" onClick={() => setOpen(open === u.id ? null : u.id)}>
              <span className="mini-avatar" style={{ width: 34, height: 34 }}>{(u.full_name || u.email || '?').charAt(0).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <strong>{u.full_name || '(no name)'}</strong>{u.role === 'admin' && <span className="pill pill-muted" style={{ marginLeft: 6 }}>admin</span>}
                <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email} · joined {new Date(u.created_at).toLocaleDateString()}</div>
              </div>
              <span className="pill pill-muted">KYC {u.kyc_status}</span>
              <StatusPill s={u.account_status} />
            </button>
            {open === u.id && <UserActions u={u} onDone={() => load(page)} onMessage={onMessage} />}
          </div>
        ))}
        {!rows.length && !err && <p className="muted">No users found.</p>}
      </div>
      {total > 25 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          <button className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => load(page - 1)}>Previous</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Page {page + 1} of {Math.ceil(total / 25)}</span>
          <button className="btn btn-outline btn-sm" disabled={(page + 1) * 25 >= total} onClick={() => load(page + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
