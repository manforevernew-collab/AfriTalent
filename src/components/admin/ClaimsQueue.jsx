import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import DocLink from './DocLink'

export default function ClaimsQueue() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [missing, setMissing] = useState(false)
  const [notes, setNotes] = useState({})

  async function load() {
    const { data, error } = await supabase.from('company_claims')
      .select('*, company:companies(id,name,website,city,country)')
      .eq('status', 'pending').order('created_at').limit(50)
    if (error) { setMissing(true); return }
    setRows(data || [])
  }
  useEffect(() => { load() }, [])

  async function review(c, status) {
    await supabase.from('company_claims').update({ status, reviewer_note: notes[c.id] || null, reviewed_by: user.id, reviewed_at: new Date().toISOString() }).eq('id', c.id)
    load()
  }

  return (
    <div className="card">
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Business claims ({rows.length})</h3>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Approving hands the profile to the claimant and marks it verified.</p>
      {missing && <div className="notice notice-warn" style={{ fontSize: 12 }}>Run <code>supabase-kyc-business-migration.sql</code> to enable claims.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.length ? rows.map(c => (
          <div key={c.id} className="kyc-item">
            <div className="kyc-item-head">
              <div>
                <Link to={`/businesses/${c.company?.id}`} style={{ fontWeight: 700 }}>{c.company?.name}</Link>
                <div className="muted" style={{ fontSize: 12 }}>{c.claimant_name} · {c.claimant_role} · {c.business_email}{c.business_phone ? ` · ${c.business_phone}` : ''}</div>
              </div>
              {c.email_domain_match
                ? <span className="pill" style={{ background: '#dcfce7', color: '#166534' }}><i className="fas fa-at"></i> Email domain matches</span>
                : <span className="pill pill-muted">No domain match</span>}
            </div>
            {c.message && <p style={{ fontSize: 13, margin: '6px 0' }}>{c.message}</p>}
            <div className="kyc-docs"><DocLink refPath={c.evidence_path}><i className="fas fa-file-alt"></i> Proof document</DocLink>{c.company?.website && <a className="doc-link" href={c.company.website} target="_blank" rel="noopener noreferrer nofollow">Business website</a>}</div>
            <input className="input" style={{ fontSize: 13, padding: '6px 10px', marginTop: 8 }} placeholder="Note (shown to the claimant if declined)" value={notes[c.id] || ''} onChange={e => setNotes(n => ({ ...n, [c.id]: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-success" style={{ padding: '6px 12px', fontSize: 12, flex: 1 }} onClick={() => review(c, 'approved')}>Approve claim</button>
              <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: 12, flex: 1 }} onClick={() => review(c, 'rejected')}>Decline</button>
            </div>
          </div>
        )) : !missing && <p className="muted" style={{ fontSize: 13 }}>No pending claims.</p>}
      </div>
    </div>
  )
}
