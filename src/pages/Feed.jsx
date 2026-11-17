import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getFeed } from '../lib/social'
import { PostCard, Composer, SetupPending } from '../components/social/SocialUI'
import UserAvatar from '../components/UserAvatar'

const SCOPES = [
  { id: 'for_you', label: 'For you' },
  { id: 'following', label: 'Following' },
]

// Shared infinite list used by Feed, Market and profile pages
export function PostList({ scope = 'for_you', author = null, kinds = null, search = null, empty, grid = false, prepend }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  const load = useCallback(async (before = null) => {
    setLoading(true); setError(null)
    try {
      const rows = await getFeed({ scope, before, author, kinds, search, limit: 15 })
      setPosts(prev => (before ? [...prev, ...rows] : rows))
      setDone(rows.length < 15)
    } catch (e) { setError(e) }
    finally { setLoading(false) }
  }, [scope, author, search, kinds?.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => { if (prepend) setPosts(prev => [prepend, ...prev.filter(p => p.id !== prepend.id)]) }, [prepend])

  return (
    <>
      <SetupPending error={error} />
      <div className={grid ? 'post-grid' : 'post-stack'}>
        {posts.map(p => <PostCard key={p.id} post={p} onRemove={id => setPosts(list => list.filter(x => x.id !== id))} />)}
      </div>
      {!loading && !error && posts.length === 0 && (empty || <div className="empty-state card"><i className="far fa-newspaper"></i><p>Nothing here yet.</p></div>)}
      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><div className="spinner" /></div>}
      {!loading && !done && posts.length > 0 && (
        <button type="button" className="btn btn-outline" style={{ margin: '16px auto', display: 'flex' }} onClick={() => load(posts[posts.length - 1].created_at)}>Load more</button>
      )}
    </>
  )
}

export default function Feed() {
  const { user, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const scope = SCOPES.some(s => s.id === params.get('scope')) ? params.get('scope') : 'for_you'
  const tag = params.get('tag')
  const [fresh, setFresh] = useState(null)

  return (
    <div className="page-enter">
      <div className="container feed-layout">
        <aside className="feed-side">
          {user && (
            <div className="card me-card">
              <div className="me-cover" style={profile?.cover_url ? { backgroundImage: `url(${profile.cover_url})` } : undefined} />
              <UserAvatar src={profile?.avatar_url} name={profile?.full_name} size={64} style={{ margin: '-32px auto 8px', border: '3px solid #fff' }} />
              <strong>{profile?.full_name}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{profile?.headline || 'Add a headline to your profile'}</span>
              <div className="me-stats">
                <span><b>{profile?.followers_count ?? 0}</b> followers</span>
                <span><b>{profile?.posts_count ?? 0}</b> posts</span>
              </div>
              {profile?.username && <Link to={`/u/${profile.username}`} className="btn btn-outline btn-sm" style={{ justifyContent: 'center' }}>View my profile</Link>}
              <Link to="/dashboard?tab=profile" className="link-btn" style={{ fontSize: 13 }}>Edit profile</Link>
            </div>
          )}
        </aside>

        <main className="feed-main">
          <Composer onPosted={p => setFresh(p)} />
          <div className="feed-tabs">
            {SCOPES.map(s => (
              <button key={s.id} type="button" className={scope === s.id ? 'on' : ''} onClick={() => setParams({ scope: s.id })}>{s.label}</button>
            ))}
            {tag && <span className="pill pill-muted">#{tag} <button type="button" className="link-btn" onClick={() => setParams({ scope })}>×</button></span>}
          </div>
          <PostList key={`${scope}-${tag}`} scope={scope} search={tag} prepend={fresh}
            empty={<div className="empty-state card"><i className="fas fa-user-friends"></i>
              <p>{scope === 'following' ? 'Follow people to see their posts here.' : 'No posts yet — be the first to share your work!'}</p></div>} />
        </main>

        <aside className="feed-side right">
          <div className="card">
            <h3 className="section-h">Get discovered</h3>
            <ul className="tips">
              <li><i className="fas fa-images"></i> Post your best work as <b>Portfolio</b> — recruiters browse it on your profile.</li>
              <li><i className="fas fa-store"></i> Sell products or services — buyers pay into escrow and you're paid on delivery.</li>
              <li><i className="fas fa-share-alt"></i> Share your profile link on WhatsApp & LinkedIn.</li>
            </ul>
            <Link to="/market" className="btn btn-outline btn-sm" style={{ justifyContent: 'center', width: '100%' }}>Browse the market</Link>
          </div>
        </aside>
      </div>
    </div>
  )
}
