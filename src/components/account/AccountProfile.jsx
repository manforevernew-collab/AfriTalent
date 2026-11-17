// The account page = profile + dashboard. This file holds the profile half:
// AccountHeader (cover, photo, name, rating, stats, share) and ProfileSettings (edit form + verification).
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { uploadAvatar, uploadCover, profileUrl, friendlyError, isSetupPending, getPublicProfile } from '../../lib/social'
import { ShareMenu } from '../social/SocialUI'
import UserAvatar from '../UserAvatar'
import Rating from '../Rating'

const STATUS_BADGE = {
  approved: <span className="kyc-badge kyc-verified">✓ Verified</span>,
  pending: <span className="kyc-badge kyc-pending">⏳ Under review</span>,
  rejected: <span className="kyc-badge kyc-pending" style={{ color: 'var(--color-danger)' }}>✗ Needs resubmission</span>,
  unverified: <span className="kyc-badge kyc-pending">Not started</span>,
}
const list = v => v.split(',').map(s => s.trim()).filter(Boolean).slice(0, 30)

function useUploader() {
  const { user, refreshProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  async function upload(kind, file) {
    if (!file) return
    setBusy(true); setMsg(null)
    try {
      const url = kind === 'avatar' ? await uploadAvatar(file, user.id) : await uploadCover(file, user.id)
      const { error } = await supabase.from('profiles').update(kind === 'avatar' ? { avatar_url: url } : { cover_url: url }).eq('id', user.id)
      if (error) throw error
      await refreshProfile()
      setMsg({ type: 'success', text: kind === 'avatar' ? 'Photo updated.' : 'Cover updated.' })
    } catch (e) { setMsg({ type: 'error', text: isSetupPending(e) || /cover_url/.test(e.message || '') ? 'Cover photos are being switched on — try again shortly.' : friendlyError(e) }) }
    finally { setBusy(false) }
  }
  return { upload, busy, msg }
}

export function AccountHeader({ onEdit, actions }) {
  const { user, profile, kycStatus, addressStatus } = useAuth()
  const { upload, busy, msg } = useUploader()
  const [pub, setPub] = useState(null)

  // Rating & counts come from the public profile (same numbers others see)
  useEffect(() => {
    if (!profile?.username) return
    getPublicProfile(profile.username).then(setPub).catch(() => setPub(null))
  }, [profile?.username, profile?.followers_count])

  const first = profile?.full_name?.split(' ')[0] || 'there'
  return (
    <>
      <section className="profile-hero card account-hero">
        <div className="profile-cover" style={profile?.cover_url ? { backgroundImage: `url(${profile.cover_url})` } : undefined}>
          <label className="btn btn-outline btn-sm cover-btn"><i className="fas fa-camera"></i> {busy ? 'Uploading…' : 'Cover'}
            <input type="file" accept="image/*" hidden onChange={e => upload('cover', e.target.files[0])} /></label>
        </div>
        <div className="profile-main">
          <label style={{ cursor: 'pointer', position: 'relative' }} title="Change photo">
            <UserAvatar src={profile?.avatar_url} name={profile?.full_name} email={user?.email} size={112} style={{ border: '4px solid #fff', marginTop: -60 }} />
            <span className="avatar-edit"><i className="fas fa-camera"></i></span>
            <input type="file" accept="image/*" hidden onChange={e => upload('avatar', e.target.files[0])} />
          </label>
          <div className="profile-id">
            <p className="muted" style={{ fontSize: 13 }}>Hi {first} 👋</p>
            <h1>{profile?.full_name || 'Your account'} {kycStatus === 'approved' && <i className="fas fa-check-circle verified-tick" title="Identity verified"></i>}</h1>
            <p className="profile-headline">{profile?.headline || <button type="button" className="link-btn" onClick={onEdit}>Add a headline so people know what you do</button>}</p>
            <div className="profile-stats">
              <Rating value={pub?.rating} count={pub?.ratings_count} />
              <span><b>{pub?.followers ?? profile?.followers_count ?? 0}</b> followers</span>
              <span><b>{pub?.following ?? profile?.following_count ?? 0}</b> following</span>
              <span><b>{pub?.posts ?? profile?.posts_count ?? 0}</b> posts</span>
            </div>
            <div className="profile-badges">
              <span className={`pill ${kycStatus === 'approved' ? 'pill-direct' : 'pill-muted'}`}><i className="fas fa-id-card"></i> ID {kycStatus === 'approved' ? 'verified' : kycStatus === 'pending' ? 'under review' : 'not verified'}</span>
              <span className={`pill ${addressStatus === 'approved' ? 'pill-direct' : 'pill-muted'}`}><i className="fas fa-map-marker-alt"></i> Address {addressStatus === 'approved' ? 'verified' : addressStatus === 'pending' ? 'under review' : 'not verified'}</span>
            </div>
          </div>
          <div className="profile-cta account-cta">
            <button type="button" className="btn btn-outline" onClick={onEdit}><i className="fas fa-pen"></i> Edit profile</button>
            {profile?.username && <Link to={`/u/${profile.username}`} className="btn btn-outline"><i className="far fa-eye"></i> Public view</Link>}
            {profile?.username && <ShareMenu url={profileUrl(profile.username)} text={`${profile.full_name}${pub?.rating ? ` ★ ${Number(pub.rating).toFixed(1)} (${pub.ratings_count} reviews)` : ''} on AfriTalent`} label="Share" />}
            {actions}
          </div>
        </div>
      </section>
      {msg && <div className={`notice ${msg.type === 'error' ? 'notice-error' : 'notice-info'}`}>{msg.text}</div>}
    </>
  )
}

export function ProfileSettings() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile, signOut, kycStatus, addressStatus, isJobSeeker, isBusiness } = useAuth()
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = patch => setF(prev => ({ ...prev, ...patch }))

  useEffect(() => {
    if (!profile || f) return
    setF({
      full_name: profile.full_name || '', username: profile.username || '', headline: profile.headline || '',
      profession: profile.profession || '', location: profile.location || '', website: profile.website || '',
      bio: profile.bio || '', skills: (profile.skills || []).join(', '), interests: (profile.interests || []).join(', '),
      is_public: profile.is_public !== false,
    })
  }, [profile, f])

  if (!f) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>

  async function save(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const website = f.website.trim() && !/^https?:\/\//.test(f.website.trim()) ? `https://${f.website.trim()}` : f.website.trim()
    const patch = {
      full_name: f.full_name.trim(), username: f.username.trim().toLowerCase() || null, headline: f.headline.trim() || null,
      profession: f.profession.trim() || null, location: f.location.trim() || null, website: website || null,
      bio: f.bio.trim() || null, skills: list(f.skills), interests: list(f.interests), is_public: f.is_public,
    }
    if (patch.username && !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(patch.username)) {
      setBusy(false); return setMsg({ type: 'error', text: 'Username: 3–30 characters — lowercase letters, numbers, - or _.' })
    }
    let { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
    if (error && /column .* does not exist|schema cache/i.test(error.message)) {
      const retry = await supabase.from('profiles').update({ full_name: patch.full_name }).eq('id', user.id)
      if (!retry.error) { setBusy(false); await refreshProfile(); return setMsg({ type: 'success', text: 'Name saved. The other profile fields switch on shortly.' }) }
    }
    setBusy(false)
    if (error) {
      const text = /profiles_username_key|duplicate/i.test(error.message) ? 'That username is taken — try another.' : friendlyError(error)
      return setMsg({ type: 'error', text })
    }
    await refreshProfile()
    setMsg({ type: 'success', text: 'Profile saved.' })
  }

  const field = (key, label, props = {}) => (
    <label className="field"><span>{label}</span><input className="input" value={f[key]} onChange={e => set({ [key]: e.target.value })} {...props} /></label>
  )

  return (
    <div className="dash-stack">
      {msg && <div className={`notice ${msg.type === 'error' ? 'notice-error' : 'notice-info'}`}>{msg.text}</div>}
      <form className="card" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
        <div className="section-row">
          <h3 className="section-h">Profile details</h3>
          <span className="muted" style={{ fontSize: 12 }}>{user.email}</span>
        </div>
        <div className="composer-grid">
          {field('full_name', 'Full name', { required: true, maxLength: 120 })}
          {field('username', 'Username (your public link)', { placeholder: 'e.g. ada-designs', maxLength: 30 })}
        </div>
        {f.username && <p className="muted" style={{ fontSize: 12, marginTop: -6 }}>{window.location.host}/u/<b>{f.username.toLowerCase()}</b></p>}
        {field('headline', 'Headline', { placeholder: 'Interior designer · 6 yrs · Lagos & Abuja', maxLength: 140 })}
        <div className="composer-grid">
          {field('profession', 'Profession', { placeholder: 'Architect, UI designer, tailor…', maxLength: 80 })}
          {field('location', 'Location', { placeholder: 'Lagos, Nigeria', maxLength: 120 })}
        </div>
        {field('website', 'Website / portfolio link', { placeholder: 'https://…' })}
        <label className="field"><span>About you</span><textarea className="input" rows={5} value={f.bio} onChange={e => set({ bio: e.target.value })} maxLength={2000} placeholder="What you do, who you've worked with, what you're looking for." /></label>
        {field('skills', 'Skills (comma separated)', { placeholder: 'AutoCAD, 3D rendering, space planning' })}
        {field('interests', 'Interests — shapes your feed (comma separated)', { placeholder: 'architecture, fintech, fashion' })}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={f.is_public} onChange={e => set({ is_public: e.target.checked })} /> Anyone with the link can see my profile, portfolio and reviews
        </label>
        <button className="btn btn-primary" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>

      <div className="card">
        <h3 className="section-h">Verification</h3>
        <div className="verify-row"><span>Identity (KYC)</span>{STATUS_BADGE[kycStatus]}{(kycStatus === 'unverified' || kycStatus === 'rejected') && <Link to="/kyc" className="btn btn-outline btn-sm">Verify</Link>}</div>
        <div className="verify-row"><span>Address</span>{STATUS_BADGE[addressStatus]}{(addressStatus === 'unverified' || addressStatus === 'rejected') && <Link to="/verify-address" className="btn btn-outline btn-sm">Verify</Link>}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {isJobSeeker && <Link to="/upload-resume" className="btn btn-outline btn-sm">📄 Manage resume</Link>}
          {isJobSeeker && <Link to="/matches" className="btn btn-outline btn-sm">🎯 View matches</Link>}
          {isBusiness && <Link to="/post-job" className="btn btn-outline btn-sm">➕ Post a job</Link>}
          <Link to="/forgot-password" className="btn btn-outline btn-sm">🔑 Change password</Link>
        </div>
      </div>

      <button type="button" className="btn btn-outline" onClick={async () => { await signOut(); navigate('/') }} style={{ width: '100%' }}>Sign out</button>
    </div>
  )
}
