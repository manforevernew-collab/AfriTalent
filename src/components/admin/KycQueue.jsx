import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { RISK_STYLE, screenKyc } from '../../lib/kyc'
import { COUNTRIES, idTypeInfo } from '../../../shared/idRules.js'
import DocLink from './DocLink'

const SEV = { reject: '#dc2626', high: '#d97706', medium: '#2563eb', info: '#64748b' }
const countryName = c => COUNTRIES.find(x => x.code === c)?.name || c

function KycItem({ k, onDecide, onRescreen }) {
  const risk = RISK_STYLE[k.auto_status || 'pending'] || RISK_STYLE.pending
  const flags = (k.auto_flags || []).filter(f => f.severity !== 'info')
  const [open, setOpen] = useState(k.auto_status === 'review')
  const [note, setNote] = useState('')
  return (
    <div className="kyc-item">
      <div className="kyc-item-head">
        <div>
          <div style={{ fontWeight: 700 }}>{k.profiles?.full_name || 'User'} <span className="badge badge-orange" style={{ textTransform: 'capitalize', marginLeft: 6 }}>{k.type?.replace('_', ' ')}</span></div>
          <div className="muted" style={{ fontSize: 12 }}>
            {k.id_type ? `${idTypeInfo(k.country, k.id_type)?.label || k.id_type} · ${countryName(k.country)}` : 'Legacy submission'}
            {k.id_last4 && ` · ••••${k.id_last4}`}
            {k.full_name_on_id && ` · on ID: ${k.full_name_on_id}`}
          </div>
        </div>
        <span className="pill" style={{ background: risk.bg, color: risk.color }}><i className={risk.icon}></i> {risk.label}{k.risk_score != null ? ` · risk ${k.risk_score}` : ''}</span>
      </div>
      <div className="kyc-docs">
        <DocLink refPath={k.id_document_url}><i className="fas fa-id-card"></i> View ID</DocLink>
        {k.certificate_url && <DocLink refPath={k.certificate_url}><i className="fas fa-file-contract"></i> Certificate</DocLink>}
        {k.date_of_birth && <span className="muted">DOB {k.date_of_birth}</span>}
        {k.expiry_date && <span className="muted">Expires {k.expiry_date}</span>}
        {flags.length > 0 && <button type="button" className="linkish" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show'} {flags.length} finding{flags.length > 1 ? 's' : ''}</button>}
      </div>
      {open && flags.length > 0 && (
        <ul className="kyc-flags">{flags.map((f, i) => <li key={i}><span className="dot" style={{ background: SEV[f.severity] }} />{f.message}</li>)}</ul>
      )}
      {k.auto_status !== 'rejected' && (
        <>
          <input className="input" style={{ fontSize: 13, padding: '6px 10px', marginTop: 8 }} placeholder="Note to the user (optional, shown if declined)" value={note} onChange={e => setNote(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-success" style={{ padding: '6px 12px', fontSize: 12, flex: 1 }} onClick={() => onDecide(k, 'approved', note)}>Approve</button>
            <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12, flex: 1 }} onClick={() => onDecide(k, 'rejected', note)}>Decline</button>
            <button className="btn btn-outline" style={{ padding: '6px 10px', fontSize: 12 }} title="Re-run automatic checks" onClick={() => onRescreen(k)}><i className="fas fa-redo"></i></button>
          </div>
        </>
      )}
    </div>
  )
}

export default function KycQueue({ onChange }) {
  const [rows, setRows] = useState([])
  const [rejected, setRejected] = useState([])
  const [legacy, setLegacy] = useState(false)
  const [showRejected, setShowRejected] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const base = () => supabase.from('kyc_verifications').select('*, profiles(full_name)')
    const { data, error } = await base().eq('status', 'pending').order('risk_score', { ascending: false, nullsFirst: true }).limit(50)
    if (error && (error.code === '42703' || /column/i.test(error.message))) {
      setLegacy(true)
      const { data: d2 } = await base().eq('status', 'pending').order('submitted_at', { ascending: false }).limit(50)
      setRows(d2 || [])
      return
    }
    setRows(data || [])
    const { data: rej } = await base().eq('auto_status', 'rejected').order('auto_checked_at', { ascending: false }).limit(20)
    setRejected(rej || [])
  }
  useEffect(() => { load() }, [])

  async function decide(k, status, note) {
    const { error } = await supabase.from('kyc_verifications').update({
      status, verified_at: status === 'approved' ? new Date().toISOString() : null, ...(legacy ? {} : { reviewer_note: note || null }),
    }).eq('id', k.id)
    if (error) return setMsg(error.message)
    const { error: pErr } = await supabase.from('profiles').update({ kyc_status: status }).eq('id', k.user_id)
    if (pErr) setMsg(pErr.message)
    load(); onChange?.()
  }
  async function rescreen(k) {
    setMsg('Re-running checks…')
    try { const r = await screenKyc({ kycId: k.id }); setMsg(`Re-screened: ${r.decision} (risk ${r.riskScore})`) } catch (e) { setMsg(e.message) }
    load()
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>KYC verifications ({rows.length})</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Sorted by risk. Obvious fakes are rejected automatically and never appear here.</p>
      {legacy && <div className="notice notice-warn" style={{ fontSize: 12 }}>Run <code>supabase-kyc-business-migration.sql</code> to enable automatic screening.</div>}
      {msg && <div className="notice notice-info" style={{ fontSize: 12 }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.length ? rows.map(k => <KycItem key={k.id} k={k} onDecide={decide} onRescreen={rescreen} />)
          : <p className="muted" style={{ fontSize: 13 }}>No pending KYC verifications.</p>}
      </div>
      {rejected.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button type="button" className="linkish" onClick={() => setShowRejected(s => !s)}>{showRejected ? 'Hide' : 'Show'} recently auto-rejected ({rejected.length})</button>
          {showRejected && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>{rejected.map(k => <KycItem key={k.id} k={k} onDecide={decide} onRescreen={rescreen} />)}</div>}
        </div>
      )}
    </div>
  )
}
