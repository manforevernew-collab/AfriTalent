import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BusinessForm from '../components/BusinessForm'
import { fetchCompany, directionsUrl, googleMapsUrl, osmEmbedUrl, SOCIAL_ICONS } from '../lib/businesses'
import { checkFile, uploadPrivate } from '../lib/kyc'
import { timeAgo, isDirectSource } from '../lib/jobs'

function OpenRoles({ company }) {
  const [jobs, setJobs] = useState(null)
  useEffect(() => {
    const name = String(company.name || '').replace(/[%_\\,()]/g, ' ').trim()
    if (!name) return
    supabase.from('jobs').select('id,title,location,work_mode,source,posted_at').eq('is_active', true).ilike('company', name)
      .order('posted_at', { ascending: false }).limit(10)
      .then(({ data, error }) => setJobs(error ? [] : data || []))
  }, [company.name])
  if (!jobs?.length) return null
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2 className="section-h"><i className="fas fa-briefcase" style={{ color: '#f59e0b' }}></i> Open roles at {company.name} ({jobs.length}{jobs.length === 10 ? '+' : ''})</h2>
      <div className="list-rows">
        {jobs.map(j => (
          <Link key={j.id} to={`/jobs/${j.id}`} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}><strong>{j.title}</strong><div className="muted" style={{ fontSize: 12 }}>{j.location} · {j.work_mode || 'On-site'} · {timeAgo(j.posted_at)}</div></div>
            {isDirectSource(j.source) ? <span className="pill pill-direct"><i className="fas fa-building"></i> Direct</span> : <span className="pill pill-muted">{j.source}</span>}
          </Link>
        ))}
      </div>
      <Link to={`/jobs?q=${encodeURIComponent(company.name)}`} className="biz-gmaps"><i className="fas fa-search"></i> See all jobs mentioning {company.name}</Link>
    </div>
  )
}

function ClaimForm({ company, onDone }) {
  const { user, profile } = useAuth()
  const [f, setF] = useState({ claimant_name: profile?.full_name || '', claimant_role: '', business_email: user?.email || '', business_phone: '', message: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const domain = company.website ? new URL(company.website).hostname.replace(/^www\./, '') : null

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!f.claimant_name.trim() || !f.claimant_role.trim()) return setError('Tell us your name and your role at the business.')
    if (!file) return setError('Upload proof that you own or run this business.')
    const fe = checkFile(file)
    if (fe) return setError(fe)
    setBusy(true)
    try {
      const evidence_path = await uploadPrivate(file, 'claims', user.id, 'claim')
      const { error: insErr } = await supabase.from('company_claims').insert({ company_id: company.id, user_id: user.id, ...f, evidence_path })
      if (insErr) throw insErr.code === '23505' ? new Error('You already have a pending claim for this business.') : insErr
      onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="claim-form">
      <div className="form-grid">
        <div><label className="form-label" htmlFor="cf-name">Your full name</label><input id="cf-name" className="input" value={f.claimant_name} onChange={e => set('claimant_name', e.target.value)} /></div>
        <div><label className="form-label" htmlFor="cf-role">Your role</label><input id="cf-role" className="input" value={f.claimant_role} onChange={e => set('claimant_role', e.target.value)} placeholder="Owner, Director, Manager…" /></div>
        <div><label className="form-label" htmlFor="cf-email">Business email</label><input id="cf-email" type="email" className="input" value={f.business_email} onChange={e => set('business_email', e.target.value)} /></div>
        <div><label className="form-label" htmlFor="cf-phone">Business phone</label><input id="cf-phone" className="input" value={f.business_phone} onChange={e => set('business_phone', e.target.value)} /></div>
        <div className="span-2"><label className="form-label" htmlFor="cf-proof">Proof of ownership — business registration certificate, utility bill or tax document in the business name</label>
          <input id="cf-proof" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="input" onChange={e => setFile(e.target.files[0] || null)} style={{ padding: 8 }} /></div>
        <div className="span-2"><label className="form-label" htmlFor="cf-msg">Anything else? (optional)</label><textarea id="cf-msg" className="input" rows={2} value={f.message} onChange={e => set('message', e.target.value)} /></div>
      </div>
      {domain && <p className="field-hint"><i className="fas fa-bolt"></i> Fast track: claims from an account whose sign-in email ends in <strong>@{domain}</strong> are matched automatically.</p>}
      {error && <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {error}</div>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit claim'}</button>
    </form>
  )
}

export default function BusinessDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [company, setCompany] = useState(null)
  const [reviews, setReviews] = useState([])
  const [claim, setClaim] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState(null) // 'claim' | 'edit'
  const [toast, setToast] = useState('')

  async function load() {
    setLoading(true)
    try {
      const c = await fetchCompany(id)
      setCompany(c)
      if (c) {
        const { data: r } = await supabase.from('reviews').select('*').eq('company_id', id).order('created_at', { ascending: false })
        setReviews(r || [])
        if (user) {
          const { data: cl } = await supabase.from('company_claims').select('id,status,created_at,reviewer_note')
            .eq('company_id', id).eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
          setClaim(cl || null)
        }
      }
    } catch (e) { console.error(e); setCompany(null) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [id, user]) // eslint-disable-line react-hooks/exhaustive-deps

  function flash(msg) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function saveEdits(payload) {
    const { data, error } = await supabase.from('companies').update(payload).eq('id', id).select().single()
    if (error) throw error
    setCompany(c => ({ ...c, ...data }))
    setMode(null)
    flash('Business profile updated')
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!company) {
    return (
      <div className="container" style={{ paddingTop: 60, textAlign: 'center' }}>
        <h2 style={{ marginBottom: 12 }}>Business not found</h2>
        <Link to="/businesses" className="btn btn-primary">Back to Businesses</Link>
      </div>
    )
  }

  const isOwner = user && company.claimed_by === user.id
  const claimable = !company.claimed_by && 'claimed_by' in company
  const socials = Object.entries(company.socials || {})
  const embed = osmEmbedUrl(company)
  const fromOsm = company.source === 'OpenStreetMap'

  return (
    <div className="page-enter">
      {toast && <div className="toast" style={{ background: 'var(--color-success)' }}>{toast}</div>}
      <div className="container biz-detail">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginBottom: 12, paddingLeft: 0 }}>← Back</button>

        <div className="card biz-head">
          <div className="biz-avatar lg">{company.name?.charAt(0).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1>{company.name}
              {company.verified && <span className="pill pill-verified" style={{ marginLeft: 10, verticalAlign: 'middle' }}><i className="fas fa-check-circle"></i> Verified owner</span>}
            </h1>
            <div className="biz-cat">{company.category || company.industry}</div>
            {(company.address || company.location) && <div className="biz-line"><i className="fas fa-map-marker-alt"></i> {[company.address || company.location, company.address && company.country && !company.address.includes(company.country) ? company.country : null].filter(Boolean).join(', ')}</div>}
            {company.review_count > 0 && company.rating && <div className="card-rating" style={{ marginTop: 8, display: 'inline-flex' }}><i className="fas fa-star"></i> {company.rating} · {company.review_count} reviews</div>}
          </div>
          <div className="biz-actions">
            {company.website && <a className="btn btn-primary" href={company.website} target="_blank" rel="noopener noreferrer nofollow"><i className="fas fa-globe"></i> Website</a>}
            {company.phone && <a className="btn btn-outline" href={`tel:${company.phone.replace(/[^\d+]/g, '')}`}><i className="fas fa-phone"></i> Call</a>}
            <a className="btn btn-outline" href={directionsUrl(company)} target="_blank" rel="noopener noreferrer"><i className="fas fa-directions"></i> Directions</a>
          </div>
        </div>

        <div className="biz-layout">
          <div>
            {mode === 'edit' && isOwner ? (
              <div className="card"><h2 className="section-h">Edit business profile</h2><BusinessForm initial={company} submitLabel="Save changes" onSubmit={saveEdits} onCancel={() => setMode(null)} /></div>
            ) : (
              <>
                <div className="card">
                  <h2 className="section-h">About</h2>
                  <p className="biz-about">{company.description || `${company.name} is a ${String(company.category || 'business').toLowerCase()} business in ${company.city || company.location || 'Africa'}.${claimable ? ' Are you the owner? Claim this profile to add a description, services and photos.' : ''}`}</p>
                  {company.services?.length > 0 && (
                    <>
                      <h3 className="sub-h">Services</h3>
                      <div className="biz-services">{company.services.map(s => <span key={s} className="pill pill-muted">{s}</span>)}</div>
                    </>
                  )}
                </div>

                <OpenRoles company={company} />

                <h2 className="section-h" style={{ margin: '28px 0 12px' }}>Reviews</h2>
                {reviews.length ? reviews.map(r => (
                  <div key={r.id} className="card review-card" style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div className="review-stars">{Array.from({ length: 5 }).map((_, i) => <i key={i} className={i < (r.rating || 0) ? 'fas fa-star' : 'far fa-star'}></i>)}</div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{r.title}</div>
                    <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.7, marginBottom: 8 }}>{r.body}</div>
                    <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}><strong style={{ color: 'var(--color-text)' }}>{r.author_name}</strong> — {r.author_role}</div>
                  </div>
                )) : <div className="card" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No reviews yet. <Link to="/reviews" style={{ color: 'var(--color-primary-dark)', fontWeight: 600 }}>Write the first one</Link></div>}
              </>
            )}
          </div>

          <aside>
            <div className="card biz-side">
              <h3 className="sub-h">Contact</h3>
              <ul className="biz-contact-list">
                {company.phone && <li><i className="fas fa-phone"></i><a href={`tel:${company.phone.replace(/[^\d+]/g, '')}`}>{company.phone}</a></li>}
                {company.email && <li><i className="fas fa-envelope"></i><a href={`mailto:${company.email}`}>{company.email}</a></li>}
                {company.website && <li><i className="fas fa-globe"></i><a href={company.website} target="_blank" rel="noopener noreferrer nofollow">{company.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a></li>}
                {company.opening_hours && <li><i className="fas fa-clock"></i><span>{company.opening_hours}</span></li>}
                {!company.phone && !company.email && !company.website && <li className="muted">No contact details yet.</li>}
              </ul>
              {socials.length > 0 && <div className="biz-contacts" style={{ marginTop: 12 }}>{socials.map(([k, url]) => <a key={k} href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={k} title={k}><i className={SOCIAL_ICONS[k] || 'fas fa-link'}></i></a>)}</div>}
              <a href={googleMapsUrl(company)} target="_blank" rel="noopener noreferrer" className="biz-gmaps"><i className="fas fa-map-marked-alt"></i> View on Google Maps</a>
            </div>

            {embed && <div className="card biz-map"><iframe title={`Map of ${company.name}`} src={embed} loading="lazy" referrerPolicy="no-referrer" /></div>}

            <div className="card biz-side claim-box">
              {isOwner ? (
                <>
                  <h3 className="sub-h"><i className="fas fa-user-shield"></i> You manage this business</h3>
                  <p className="muted">Keep your address, services and contacts up to date.</p>
                  <button className="btn btn-primary" onClick={() => setMode('edit')}><i className="fas fa-pen"></i> Edit profile</button>
                </>
              ) : company.claimed_by ? (
                <p className="muted"><i className="fas fa-check-circle" style={{ color: 'var(--color-success)' }}></i> This profile is managed by its owner.</p>
              ) : claim?.status === 'pending' ? (
                <><h3 className="sub-h">Claim submitted</h3><p className="muted">Our team is reviewing your claim (usually within 2 business days).</p></>
              ) : mode === 'claim' && user ? (
                <><h3 className="sub-h">Claim {company.name}</h3><ClaimForm company={company} onDone={() => { setMode(null); setClaim({ status: 'pending' }); flash('Claim submitted — we will review it shortly') }} /></>
              ) : claimable ? (
                <>
                  <h3 className="sub-h">Is this your business?</h3>
                  {claim?.status === 'rejected' && <p className="field-hint bad">Your previous claim was declined{claim.reviewer_note ? `: ${claim.reviewer_note}` : ''}.</p>}
                  <p className="muted">Claim it for free to update your details, add services and respond to reviews.</p>
                  <button className="btn btn-primary" onClick={() => (user ? setMode('claim') : navigate(`/login?next=/businesses/${id}`))}>
                    <i className="fas fa-flag"></i> Claim this business
                  </button>
                </>
              ) : null}
            </div>
            {fromOsm && <p className="biz-attrib">Listing data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>{company.source_url && <> · <a href={company.source_url} target="_blank" rel="noopener noreferrer">source</a></>}</p>}
          </aside>
        </div>
      </div>
    </div>
  )
}
