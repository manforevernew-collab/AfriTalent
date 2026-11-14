import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { triggerBusinessSync } from '../../lib/kyc'
import { timeAgo } from '../../lib/jobs'

export default function BusinessSyncPanel() {
  const [runs, setRuns] = useState([])
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const { data, error } = await supabase.from('business_sync_runs').select('*').order('started_at', { ascending: false }).limit(5)
    if (error) { setMissing(true); return }
    setRuns(data || [])
  }
  useEffect(() => { load() }, [])

  async function run() {
    setBusy(true)
    setMsg('Importing businesses — this takes 2–4 minutes…')
    try {
      const r = await triggerBusinessSync()
      setMsg(`Done: ${r.upserted} businesses imported from ${Object.keys(r.cities || {}).join(', ')}.`)
    } catch (e) { setMsg(e.message) } finally { setBusy(false); load() }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}><i className="fas fa-store" style={{ color: 'var(--color-primary)' }}></i> Business directory import</h3>
          <p className="muted" style={{ fontSize: 12 }}>OpenStreetMap listings for 28 African cities, refreshed daily (a few cities per run). Claimed profiles are never overwritten.</p>
        </div>
        <button className="btn btn-primary" onClick={run} disabled={busy || missing}>{busy ? 'Importing…' : 'Import now'}</button>
      </div>
      {missing && <div className="notice notice-warn" style={{ fontSize: 12, marginTop: 12 }}>Run <code>supabase-kyc-business-migration.sql</code> to enable the directory import.</div>}
      {msg && <div className="notice notice-info" style={{ fontSize: 12, marginTop: 12 }}>{msg}</div>}
      {runs.length > 0 && (
        <table className="sync-table" style={{ marginTop: 12 }}>
          <thead><tr><th>When</th><th>Status</th><th>Cities</th><th>Imported</th><th>Retired</th></tr></thead>
          <tbody>{runs.map(r => (
            <tr key={r.id}><td>{timeAgo(r.finished_at || r.started_at)}</td><td>{r.status}</td><td>{Object.keys(r.cities || {}).join(', ')}</td><td>{r.upserted}</td><td>{r.deactivated}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
