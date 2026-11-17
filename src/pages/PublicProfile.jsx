import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPublicProfile, follow, unfollow, profileUrl } from '../lib/social'
import { PostList } from './Feed'
import { ShareMenu, SetupPending } from '../components/social/SocialUI'
import UserAvatar from '../components/UserAvatar'

const TABS = [
  { id: 'portfolio', label: 'Portfolio', kinds: ['portfolio'] },
  { id: 'shop', label: 'Services & products', kinds: ['service', 'product'] },
  { id: 'posts', label: 'All posts', kinds: null },
  { id: 'about', label: 'About & reviews' },
]

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

  useEffect(() => {
    let alive = true
    setP(undefined)
    getPublicProfile(handle).then(d => { if (alive) setP(d || null) }).catch(e => { if (alive) { setError(e); setP(null) } })
    return () => { alive = false }
  }, [handle, user?.id])

  useEffect(() => { if (p) document.title = `${p.full_name} — AfriTalent` ; return () => { document.title = 'AfriTalent — Discover Africa\'s Top Talent & Leading Companies' } }, [p])

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
                {p.rating && <span><Stars value={p.rating} /> <b>{p.rating}</b> ({p.ratings_count})</span>}
              </div>
              <div className="profile-badges">
                {p.kyc_verified && <span className="pill pill-direct"><i className="fas fa-id-card"></i> ID verified</span>}
                {p.address_verified && <span className="pill pill-direct"><i className="fas fa-map-marker-alt"></i> Address verified</span>}
                <span className="pill pill-muted">Member since {new Date(p.member_since).getFullYear()}</span>
              </div>
            </div>
            <div className="profile-cta">
              {p.is_me
                ? <Link to="/profile" className="btn btn-outline"><i className="fas fa-pen"></i> Edit profile</Link>
                : <button type="button" className={`btn ${p.is_following ? 'btn-outline' : 'btn-primary'}`} onClick={toggleFollow} disabled={busy}>
                    <i className={p.is_following ? 'fas fa-user-check' : 'fas fa-user-plus'}></i> {p.is_following ? 'Following' : 'Follow'}
                  </button>}
              <ShareMenu url={profileUrl(p.username)} text={`${p.full_name} on AfriTalent`} label="Share profile" />
            </div>
          </div>
          {p.skills?.length > 0 && <div className="post-tags" style={{ padding: '0 24px 20px' }}>{p.skills.map(s => <span key={s} className="pill pill-muted">{s}</span>)}</div>}
        </section>

        <SetupPending error={error} />
        <nav className="dash-tabs" style={{ marginTop: 16 }}>
          {TABS.map(t => <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </nav>

        {tab === 'about' ? (
          <div className="card">
            <h3 className="section-h">About</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{p.bio || 'No bio yet.'}</p>
            <h3 className="section-h" style={{ marginTop: 24 }}>Reviews</h3>
            {p.reviews?.length ? p.reviews.map((r, i) => (
              <div key={i} className="review-row">
                <Stars value={r.rating} /> <strong>{r.title}</strong>
                {r.text && <p style={{ marginTop: 4 }}>{r.text}</p>}
                <span className="muted" style={{ fontSize: 12 }}>{r.at ? new Date(r.at).toLocaleDateString() : ''}</span>
              </div>
            )) : <p className="muted">No reviews yet.</p>}
          </div>
        ) : (
          <PostList key={tab} scope="profile" author={p.id} kinds={current.kinds} grid={tab !== 'posts'}
            empty={<div className="empty-state card"><i className="far fa-images"></i><p>{p.is_me ? 'Post your work from the Feed — choose “Portfolio”, “Service” or “Product”.' : 'Nothing here yet.'}</p></div>} />
        )}
      </div>
    </div>
  )
}
