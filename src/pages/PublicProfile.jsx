import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPublicProfile, follow, unfollow, profileUrl, addReview, deleteReview, MAX_REVIEWS_PER_PERSON, REVIEW_RELATIONSHIPS, recordProfileView, scheduleInterview, INTERVIEW_MODES } from '../lib/social'
import Rating from '../components/Rating'
import { timeAgo } from '../context/InboxContext'
import { PostList } from './Feed'
import { ShareMenu, SetupPending } from '../components/social/SocialUI'
import UserAvatar from '../components/UserAvatar'

const TABS = [
  { id: 'portfolio', label: 'Portfolio', kinds: ['portfolio'] },
  { id: 'shop', label: 'Services & products', kinds: ['service', 'product'] },
  { id: 'posts', label: 'All posts', kinds: null },
  { id: 'reviews', label: 'Reviews' },
  { id: 'about', label: 'About' },
]

function InterviewInvite({ profile, onClose }) {
  const tomorrow = new Date(Date.now() + 864e5); tomorrow.setHours(10, 0, 0, 0)
  const pad = n => String(n).padStart(2, '0')
  const local = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  const [form, setForm] = useState({ title: '', when: local(tomorrow), duration: 30, mode: 'video', location: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const set = patch => setForm(v => ({ ...v, ...patch }))
  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (form.title.trim().length < 3) return setErr('Add a title, e.g. the role you are hiring for.')
    const at = new Date(form.when)
    if (!(at > new Date())) return setErr('Pick a time in the future.')
    setBusy(true)
    try { await scheduleInterview({ candidateId: profile.id, title: form.title.trim(), scheduledAt: at.toISOString(), durationMinutes: Number(form.duration), mode: form.mode, location: form.location.trim(), notes: form.notes.trim() }); setDone(true) }
    catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        {done ? (
          <>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Invitation sent 📅</h3>
            <p className="muted">{profile.full_name} has been notified and can accept or decline from their dashboard. You'll be notified when they reply.</p>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Invite {profile.full_name} to an interview</h3>
            <label className="field"><span>Title</span><input className="input" value={form.title} onChange={e => set({ title: e.target.value })} placeholder="e.g. Interior Designer — first interview" maxLength={140} /></label>
            <div className="composer-grid">
              <label className="field"><span>Date & time</span><input type="datetime-local" className="input" value={form.when} onChange={e => set({ when: e.target.value })} /></label>
              <label className="field"><span>Duration</span><select className="input" value={form.duration} onChange={e => set({ duration: e.target.value })}>{[15, 30, 45, 60, 90].map(m => <option key={m} value={m}>{m} minutes</option>)}</select></label>
            </div>
            <label className="field"><span>Format</span><select className="input" value={form.mode} onChange={e => set({ mode: e.target.value })}>{Object.entries(INTERVIEW_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>{form.mode === 'video' ? 'Meeting link' : form.mode === 'phone' ? 'Phone number to call' : 'Address'}</span>
              <input className="input" value={form.location} onChange={e => set({ location: e.target.value })} placeholder={form.mode === 'video' ? 'https://meet.google.com/…' : form.mode === 'phone' ? '+234…' : 'Office address'} maxLength={300} /></label>
            <label className="field"><span>Notes (optional)</span><textarea className="input" rows={2} value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="What to prepare, who they'll meet…" maxLength={2000} /></label>
            {err && <div className="notice notice-error">{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" disabled={busy} style={{ flex: 1, justifyContent: 'center' }}><i className="fas fa-calendar-plus"></i> {busy ? 'Sending…' : 'Send invitation'}</button>
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

function ReviewForm({ profile, onAdded }) {
  const [rating, setRating] = useState(0)
  const [relationship, setRelationship] = useState('customer')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const left = MAX_REVIEWS_PER_PERSON - (profile.my_review_count || 0)
  if (left <= 0) return <p className="muted" style={{ fontSize: 13 }}>You've left the maximum of {MAX_REVIEWS_PER_PERSON} reviews for {profile.full_name}.</p>

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!rating) return setErr('Choose a star rating.')
    if (body.trim().length < 10) return setErr('Write at least 10 characters about your experience.')
    setBusy(true)
    try { await addReview({ revieweeId: profile.id, rating, title: title.trim(), body: body.trim(), relationship }); setRating(0); setTitle(''); setBody(''); onAdded() }
    catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }
  return (
    <form className="review-form" onSubmit={submit}>
      <strong>Review {profile.full_name}</strong>
      <div className="star-input" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={n + ' star' + (n > 1 ? 's' : '')} onClick={() => setRating(n)}>
            <i className={n <= rating ? 'fas fa-star' : 'far fa-star'}></i>
          </button>
        ))}
      </div>
      <select className="input" value={relationship} onChange={e => setRelationship(e.target.value)} aria-label="How do you know them?">
        {REVIEW_RELATIONSHIPS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={120} />
      <textarea className="input" rows={3} value={body} onChange={e => setBody(e.target.value)} placeholder="What was it like working with or buying from them? Be honest and specific." maxLength={2000} />
      {err && <div className="notice notice-error">{err}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Posting…' : 'Post review'}</button>
        <span className="muted" style={{ fontSize: 12 }}>You can leave {left} more review{left === 1 ? '' : 's'} for this person. Reviews from completed orders or gigs show as “Verified customer”.</span>
      </div>
    </form>
  )
}

function Stars({ value }) {
  const v = Math.round(Number(value) || 0)
  return <span className="stars" aria-label={`${value} out of 5`}>{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= v ? 'fas fa-star' : 'far fa-star'}></i>)}</span>
}

export default function PublicProfile() {
  const { handle } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [p, setP] = useState(undefined)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('portfolio')
  const [busy, setBusy] = useState(false)

  const reload = () => getPublicProfile(handle).then(d => setP(d || null)).catch(setError)
  useEffect(() => {
    let alive = true
    setP(undefined)
    getPublicProfile(handle).then(d => { if (alive) setP(d || null) }).catch(e => { if (alive) { setError(e); setP(null) } })
    return () => { alive = false }
  }, [handle, user?.id])

  useEffect(() => { if (p) document.title = `${p.full_name} — AfriTalent` ; return () => { document.title = 'AfriTalent — Discover Africa\'s Top Talent & Leading Companies' } }, [p])

  useEffect(() => { if (p?.id && !p.is_me) recordProfileView(p.id) }, [p?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleFollow() {
    if (!user) return navigate(`/login?next=/u/${handle}`)
    setBusy(true)
    try {
      if (p.is_following) { await unfollow(user.id, p.id); setP({ ...p, is_following: false, followers: p.followers - 1 }) }
      else { await follow(p.id); setP({ ...p, is_following: true, followers: p.followers + 1 }) }
    } catch (e) { setError(e) }
    finally { setBusy(false) }
  }

  if (p === undefined) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!p) {
    return (
      <div className="container" style={{ maxWidth: 640, padding: '60px 16px' }}>
        <SetupPending error={error} />
        {!error && <div className="empty-state card"><i className="far fa-user"></i><p>This profile doesn't exist or is private.</p></div>}
      </div>
    )
  }

  const current = TABS.find(t => t.id === tab)
  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 980, paddingTop: 20, paddingBottom: 60 }}>
        <section className="profile-hero card">
          <div className="profile-cover" style={p.cover_url ? { backgroundImage: `url(${p.cover_url})` } : undefined} />
          <div className="profile-main">
            <UserAvatar src={p.avatar_url} name={p.full_name} size={120} style={{ border: '4px solid #fff', marginTop: -70 }} />
            <div className="profile-id">
              <h1>{p.full_name} {p.kyc_verified && <i className="fas fa-check-circle verified-tick" title="Identity verified"></i>}</h1>
              {p.headline && <p className="profile-headline">{p.headline}</p>}
              <p className="muted" style={{ fontSize: 13 }}>
                {[p.profession, p.location, p.user_type === 'business' ? 'Business' : null].filter(Boolean).join(' · ')}
                {p.website && <> · <a href={p.website} target="_blank" rel="noreferrer nofollow">{p.website.replace(/^https?:\/\//, '')}</a></>}
              </p>
              <div className="profile-stats">
                <span><b>{p.followers}</b> followers</span>
                <span><b>{p.following}</b> following</span>
                <span><b>{p.jobs_completed}</b> jobs done</span>
                <button type="button" className="link-btn" onClick={() => setTab('reviews')} style={{ padding: 0 }}><Rating value={p.rating} count={p.ratings_count} /></button>
              </div>
              <div className="profile-badges">
                {p.kyc_verified && <span className="pill pill-direct"><i className="fas fa-id-card"></i> ID verified</span>}
                {p.address_verified && <span className="pill pill-direct"><i className="fas fa-map-marker-alt"></i> Address verified</span>}
                <span className="pill pill-muted">Member since {new Date(p.member_since).getFullYear()}</span>
              </div>
            </div>
            <div className="profile-cta">
              {p.is_me
                ? <Link to="/dashboard?tab=profile" className="btn btn-outline"><i className="fas fa-pen"></i> Edit profile</Link>
                : <button type="button" className={`btn ${p.is_following ? 'btn-outline' : 'btn-primary'}`} onClick={toggleFollow} disabled={busy}>
                    <i className={p.is_following ? 'fas fa-user-check' : 'fas fa-user-plus'}></i> {p.is_following ? 'Following' : 'Follow'}
                  </button>}
              {!p.is_me && (
                <button type="button" className="btn btn-outline" onClick={() => (user ? setInviting(true) : navigate('/login?next=/u/' + handle))}>
                  <i className="fas fa-calendar-plus"></i> Invite to interview
                </button>
              )}
              <ShareMenu url={profileUrl(p.username)} text={p.full_name + (p.rating ? ' ★ ' + Number(p.rating).toFixed(1) + ' (' + p.ratings_count + ' reviews)' : '') + ' on AfriTalent'} label="Share profile" />
            </div>
          </div>
          {p.skills?.length > 0 && <div className="post-tags" style={{ padding: '0 24px 20px' }}>{p.skills.map(s => <span key={s} className="pill pill-muted">{s}</span>)}</div>}
        </section>

        <SetupPending error={error} />
        <nav className="dash-tabs" style={{ marginTop: 16 }}>
          {TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}{t.id === 'reviews' && p.ratings_count ? ' (' + p.ratings_count + ')' : ''}</button>)}
        </nav>

        {tab === 'about' ? (
          <div className="card">
            <h3 className="section-h">About</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{p.bio || 'No bio yet.'}</p>
          </div>
        ) : tab === 'reviews' ? (
          <div className="card">
            <div className="section-row">
              <h3 className="section-h">Reviews</h3>
              <Rating value={p.rating} count={p.ratings_count} size={15} />
            </div>
            {!p.is_me && (user
              ? <ReviewForm profile={p} onAdded={reload} />
              : <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}><Link to={'/login?next=/u/' + p.username}>Sign in</Link> to review {p.full_name}.</p>)}
            {p.reviews?.length ? p.reviews.map((r, i) => (
              <div key={r.id || i} className="review-card">
                <Link to={r.reviewer_username ? '/u/' + r.reviewer_username : '#'}><UserAvatar src={r.reviewer_avatar} name={r.reviewer_name} size={40} /></Link>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{r.reviewer_name || 'AfriTalent member'}</strong>
                    {r.verified && <span className="pill pill-direct" style={{ fontSize: 11 }}><i className="fas fa-check"></i> Verified customer</span>}
                    <span className="muted" style={{ fontSize: 12 }}>{r.source === 'order' ? 'Order review' : r.source === 'contract' ? 'Gig review' : REVIEW_RELATIONSHIPS.find(x => x.id === r.relationship)?.label}{r.at ? ' · ' + timeAgo(r.at) : ''}</span>
                  </div>
                  <Stars value={r.rating} />{r.title && <strong style={{ marginLeft: 6 }}>{r.title}</strong>}
                  {r.text && <p style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{r.text}</p>}
                  {r.reviewer_id && r.reviewer_id === user?.id && (
                    <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={async () => { if (window.confirm('Delete your review?')) { await deleteReview(r.id).catch(() => {}); reload() } }}>Delete my review</button>
                  )}
                </div>
              </div>
            )) : <p className="muted">No reviews yet.</p>}
          </div>
        ) : (
          <PostList key={tab} scope="profile" author={p.id} kinds={current.kinds} grid={tab !== 'posts'}
            empty={<div className="empty-state card"><i className="far fa-images"></i><p>{p.is_me ? 'Post your work from the Feed — choose “Portfolio”, “Service” or “Product”.' : 'Nothing here yet.'}</p></div>} />
        )}
        {inviting && <InterviewInvite profile={p} onClose={() => setInviting(false)} />}
      </div>
    </div>
  )
}
