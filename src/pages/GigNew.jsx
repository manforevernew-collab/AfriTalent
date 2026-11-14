import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { GIG_CATEGORIES, toMinor, useSettings, friendly } from '../lib/marketplace'

export default function GigNew() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const settings = useSettings()
  const [f, setF] = useState({ title: '', description: '', category: '', skills: '', budget: '', deadline: '', location: 'Remote' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const pending = profile?.account_status && profile.account_status !== 'active'

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (f.title.trim().length < 5) return setError('Give the gig a clear title (at least 5 characters).')
    if (f.description.trim().length < 20) return setError('Describe the work in at least 20 characters.')
    const budget = toMinor(f.budget)
    if (!budget || budget < 100) return setError('Enter a budget.')
    setBusy(true)
    const { data, error: err } = await supabase.from('gigs').insert({
      title: f.title.trim(), description: f.description.trim(), category: f.category || null,
      skills: f.skills.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10), budget,
      deadline: f.deadline || null, location: f.location.trim() || 'Remote',
    }).select('id').single()
    setBusy(false)
    if (err) return setError(friendly(err))
    navigate(`/gigs/${data.id}`)
  }

  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 760, paddingTop: 40, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Post a gig</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Describe the work, set a budget and receive proposals from verified professionals. You only pay into escrow once you hire someone.</p>
        {pending && <div className="notice notice-warn"><i className="fas fa-user-clock"></i> Your account is awaiting approval — you can post gigs once it's approved.</div>}
        <form onSubmit={submit} className="card biz-form">
          <div className="form-grid">
            <div className="span-2"><label className="form-label" htmlFor="g-title">Title</label><input id="g-title" className="input" value={f.title} onChange={e => set('title', e.target.value)} placeholder="Design a logo and brand kit for a fintech startup" /></div>
            <div className="span-2"><label className="form-label" htmlFor="g-desc">What needs to be done?</label><textarea id="g-desc" className="input" rows={6} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Scope, deliverables, how you'll judge the work is complete…" /></div>
            <div><label className="form-label" htmlFor="g-cat">Category</label><select id="g-cat" className="input" value={f.category} onChange={e => set('category', e.target.value)}><option value="">Choose…</option>{GIG_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
            <div><label className="form-label" htmlFor="g-budget">Budget ({settings?.currency || 'NGN'})</label><input id="g-budget" className="input" inputMode="decimal" value={f.budget} onChange={e => set('budget', e.target.value)} placeholder="50000" /></div>
            <div className="span-2"><label className="form-label" htmlFor="g-skills">Skills (comma separated)</label><input id="g-skills" className="input" value={f.skills} onChange={e => set('skills', e.target.value)} placeholder="Figma, Branding, Illustration" /></div>
            <div><label className="form-label" htmlFor="g-deadline">Deadline (optional)</label><input id="g-deadline" type="date" className="input" value={f.deadline} onChange={e => set('deadline', e.target.value)} /></div>
            <div><label className="form-label" htmlFor="g-loc">Location</label><input id="g-loc" className="input" value={f.location} onChange={e => set('location', e.target.value)} /></div>
          </div>
          <div className="kyc-steps"><i className="fas fa-lock"></i><div>When you hire, the agreed amount moves from your wallet into <strong>escrow</strong>. The professional is paid only when you approve the work. If something goes wrong, open a dispute and AfriTalent decides.</div></div>
          {error && <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || pending}>{busy ? 'Posting…' : 'Post gig'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
