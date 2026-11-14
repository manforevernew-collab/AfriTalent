import { useEffect, useState } from 'react'
import { apiUrl } from '../lib/api'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/jobs'

const STATUS_BADGE = { success: 'badge-green', partial: 'badge-orange', error: 'badge-red' }

export default function JobSyncPanel() {
  const [runs, setRuns] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState(null)
  const [missing, setMissing] = useState(false)

  async function loadRuns() {
    const { data, error } = await supabase.from('job_sync_runs').select('*').order('started_at', { ascending: false }).limit(8)
    if (error) { setMissing(true); return }
    setMissing(false)
    setRuns(data || [])
  }

  useEffect(() => { loadRuns() }, [])

  async function syncNow() {
    setSyncing(true)
    setMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(apiUrl('/api/sync-jobs'), { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || body.errors?.join('; ') || `Sync failed (${res.status})`)
      setMessage({ ok: true, text: `Imported ${body.total_fetched} roles (${body.upserted} saved, ${body.deactivated} retired).` })
      loadRuns()
    } catch (e) {
      setMessage({ ok: false, text: e.message.includes('Failed to fetch') ? 'The sync endpoint is only available on the deployed site (Vercel).' : e.message })
    } finally {
      setSyncing(false)
    }
  }

  const last = runs[0]

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="live-dot"></span> Automatic job import
          </h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Runs every hour. {last ? `Last run ${timeAgo(last.finished_at || last.started_at)}.` : 'No runs recorded yet.'}
          </p>
        </div>
        <button className="btn btn-primary" onClick={syncNow} disabled={syncing}>
          <i className={`fas fa-sync-alt ${syncing ? 'fa-spin' : ''}`}></i> {syncing ? 'Importing…' : 'Sync now'}
        </button>
      </div>

      {missing && (
        <div className="notice notice-warn"><i className="fas fa-database"></i> Run <code>supabase-job-aggregator-migration.sql</code> to enable job imports.</div>
      )}
      {message && <div className={`notice ${message.ok ? 'notice-info' : 'notice-error'}`}>{message.text}</div>}

      {last?.sources && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {Object.entries(last.sources).map(([name, s]) => (
            <span key={name} className={`badge ${s.ok ? 'badge-green' : 'badge-red'}`} title={s.error || `${s.valid} valid of ${s.fetched}`} style={{ fontSize: 12 }}>
              {s.ok ? '✓' : '✕'} {name}{s.ok ? ` · ${s.valid}` : ''}
            </span>
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="sync-table">
            <thead><tr><th>When</th><th>Status</th><th>Fetched</th><th>Saved</th><th>Retired</th></tr></thead>
            <tbody>
              {runs.map(r => (
                <tr key={r.id}>
                  <td>{new Date(r.started_at).toLocaleString()}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>{r.status}</span></td>
                  <td>{r.total_fetched}</td>
                  <td>{r.upserted}</td>
                  <td>{r.deactivated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
