import { useEffect, useState } from 'react'
import { apiUrl } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { timeAgo } from '../../lib/jobs'
import { BUSINESS_CATEGORIES } from '../../lib/businesses'

const PROVIDERS = [
  { id: 'greenhouse', label: 'Greenhouse', hint: 'boards.greenhouse.io/<name>' },
  { id: 'lever', label: 'Lever', hint: 'jobs.lever.co/<name>' },
  { id: 'ashby', label: 'Ashby', hint: 'jobs.ashbyhq.com/<name>' },
  { id: 'workable', label: 'Workable', hint: 'apply.workable.com/<name>' },
  { id: 'smartrecruiters', label: 'SmartRecruiters', hint: 'jobs.smartrecruiters.com/<Name>' },
  { id: 'recruitee', label: 'Recruitee', hint: '<name>.recruitee.com' },
]
const LABEL = Object.fromEntries(PROVIDERS.map(p => [p.id, p.label]))

/** Work out provider + board name from a pasted careers URL. */
export function parseCareersUrl(url) {
  try {
    const u = new URL(url.trim())
    const seg = u.pathname.split('/').filter(Boolean)
    if (/greenhouse\.io$/.test(u.hostname)) return { provider: 'greenhouse', slug: u.searchParams.get('for') || seg[0] }
    if (u.hostname === 'jobs.lever.co') return { provider: 'lever', slug: seg[0] }
    if (u.hostname === 'jobs.ashbyhq.com') return { provider: 'ashby', slug: seg[0] }
    if (u.hostname === 'apply.workable.com') return { provider: 'workable', slug: seg[0] }
    if (/smartrecruiters\.com$/.test(u.hostname)) return { provider: 'smartrecruiters', slug: seg[0] }
    if (/\.recruitee\.com$/.test(u.hostname)) return { provider: 'recruitee', slug: u.hostname.split('.')[0] }
  } catch { /* not a URL */ }
  return null
}

async function testBoard(body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(apiUrl('/api/career-board-test'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify(body) })
  return res.json()
}

export default function CareerBoardsPanel() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [builtIn, setBuiltIn] = useState({})
  const [missing, setMissing] = useState(false)
  const [f, setF] = useState({ url: '', provider: 'greenhouse', slug: '', company_name: '', website: '', category: 'Technology', country: '', scope: 'all' })
  const [test, setTest] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data, error } = await supabase.from('career_boards').select('*').order('created_at', { ascending: false })
    if (error) setMissing(true); else setRows(data || [])
    const { data: run } = await supabase.from('job_sync_runs').select('sources').order('started_at', { ascending: false }).limit(1).maybeSingle()
    setBuiltIn(run?.sources?.['Company career pages']?.boards || {})
  }
  useEffect(() => { load() }, [])

  function fromUrl(url) {
    const p = parseCareersUrl(url)
    setF(prev => ({ ...prev, url, ...(p || {}) }))
    setTest(null)
  }

  async function runTest() {
    setBusy(true); setMsg(null)
    const r = await testBoard({ provider: f.provider, slug: f.slug, scope: f.scope }).catch(e => ({ ok: false, error: e.message }))
    setTest(r)
    if (r.ok && r.company && !f.company_name) setF(prev => ({ ...prev, company_name: r.company }))
    setBusy(false)
  }

  async function add() {
    setMsg(null)
    const { error } = await supabase.from('career_boards').insert({
      provider: f.provider, slug: f.slug.trim(), company_name: f.company_name.trim(), website: f.website.trim() || null,
      category: f.category, country: f.country.trim() || null, scope: f.scope, created_by: user.id,
    })
    if (error) return setMsg({ bad: true, text: error.code === '23505' ? 'That board is already on the list.' : error.message })
    setMsg({ text: `${f.company_name} added — its roles arrive with the next hourly import.` })
    setF({ url: '', provider: 'greenhouse', slug: '', company_name: '', website: '', category: 'Technology', country: '', scope: 'all' }); setTest(null)
    load()
  }
  async function toggle(r) { await supabase.from('career_boards').update({ enabled: !r.enabled }).eq('id', r.id); load() }
  async function remove(r) { if (confirm(`Remove ${r.company_name}?`)) { await supabase.from('career_boards').delete().eq('id', r.id); load() } }

  const builtInRows = Object.entries(builtIn).filter(([k]) => !rows.some(r => `${LABEL[r.provider]}:${r.slug}` === k))

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h3 className="section-h" style={{ marginBottom: 4 }}><i className="fas fa-building" style={{ color: '#f59e0b' }}></i> Employer career pages</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Roles straight from employers' own applicant tracking systems — the most reliable source: they link to the employer's application form and disappear as soon as the role closes. Paste a careers-page URL to add an employer.
      </p>

      {missing ? <div className="notice notice-warn"><i className="fas fa-database"></i> Run <code>supabase-career-boards-migration.sql</code> to add your own employers. Built-in employers are already imported.</div> : (
        <div className="board-form">
          <input className="input span-2" value={f.url} onChange={e => fromUrl(e.target.value)} placeholder="Paste a careers URL, e.g. https://boards.greenhouse.io/moniepoint" />
          <select className="input" value={f.provider} onChange={e => { setF({ ...f, provider: e.target.value }); setTest(null) }} aria-label="ATS provider">
            {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input className="input" value={f.slug} onChange={e => { setF({ ...f, slug: e.target.value }); setTest(null) }} placeholder={PROVIDERS.find(p => p.id === f.provider)?.hint} aria-label="Board name" />
          <select className="input" value={f.scope} onChange={e => setF({ ...f, scope: e.target.value })} aria-label="Which roles">
            <option value="all">Import all roles (African employer)</option>
            <option value="remote_or_africa">Only remote & Africa-based roles (global employer)</option>
          </select>
          <button type="button" className="btn btn-outline" disabled={!f.slug || busy} onClick={runTest}>{busy ? 'Checking…' : 'Check board'}</button>
          {test && (test.ok ? (
            <div className="span-2 notice notice-info" style={{ margin: 0 }}>
              <i className="fas fa-check-circle"></i>
              <span>Found <strong>{test.total}</strong> open roles{f.scope === 'remote_or_africa' ? `, ${test.kept} remote or in Africa` : ''}. {test.sample?.slice(0, 3).map(s => s.title).join(' · ')}</span>
            </div>
          ) : <div className="span-2 notice notice-error" style={{ margin: 0 }}><i className="fas fa-times-circle"></i> {test.error}</div>)}
          {test?.ok && (
            <>
              <input className="input" value={f.company_name} onChange={e => setF({ ...f, company_name: e.target.value })} placeholder="Company name" aria-label="Company name" />
              <input className="input" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} placeholder="Website (https://…)" aria-label="Website" />
              <select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} aria-label="Category">{BUSINESS_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
              <input className="input" value={f.country} onChange={e => setF({ ...f, country: e.target.value })} placeholder="HQ country (optional)" aria-label="Country" />
              <button type="button" className="btn btn-primary span-2" disabled={!f.company_name.trim()} onClick={add}><i className="fas fa-plus"></i> Add employer</button>
            </>
          )}
        </div>
      )}
      {msg && <div className={`notice ${msg.bad ? 'notice-error' : 'notice-info'}`} style={{ marginTop: 10 }}>{msg.text}</div>}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="sync-table">
          <thead><tr><th>Employer</th><th>Platform</th><th>Roles</th><th>Last check</th><th></th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                <td><strong>{r.company_name}</strong>{r.scope === 'remote_or_africa' && <span className="muted"> · remote/Africa only</span>}</td>
                <td>{LABEL[r.provider]} · <span className="mono">{r.slug}</span></td>
                <td>{r.last_status === 'error' ? <span className="field-hint bad" style={{ margin: 0 }}>{r.last_error}</span> : r.last_kept ?? '—'}</td>
                <td className="muted">{r.last_checked_at ? timeAgo(r.last_checked_at) : 'next import'}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="linkish" onClick={() => toggle(r)}>{r.enabled ? 'Pause' : 'Resume'}</button> · <button className="linkish" onClick={() => remove(r)}>Remove</button></td>
              </tr>
            ))}
            {builtInRows.map(([k, r]) => (
              <tr key={k}>
                <td><strong>{r.company || k.split(':')[1]}</strong> <span className="pill pill-muted">built-in</span></td>
                <td>{k.split(':')[0]} · <span className="mono">{k.split(':')[1]}</span></td>
                <td>{r.ok ? `${r.kept}${r.kept !== r.total ? ` of ${r.total}` : ''}` : <span className="field-hint bad" style={{ margin: 0 }}>{r.error}</span>}</td>
                <td className="muted">last import</td><td></td>
              </tr>
            ))}
            {!rows.length && !builtInRows.length && <tr><td colSpan={5} className="muted">Run an import to see each employer's status.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
