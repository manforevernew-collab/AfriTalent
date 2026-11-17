import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getPost, getComments, addComment, deleteComment } from '../lib/social'
import { PostCard, SetupPending } from '../components/social/SocialUI'
import UserAvatar from '../components/UserAvatar'
import { timeAgo } from '../context/InboxContext'

export default function PostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [post, setPost] = useState(undefined)
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([getPost(id, user?.id), getComments(id)])
      .then(([p, c]) => { if (alive) { setPost(p); setComments(c || []) } })
      .catch(e => { if (alive) { setError(e); setPost(null) } })
    return () => { alive = false }
  }, [id, user?.id])

  async function send(e) {
    e.preventDefault()
    if (!user) return navigate(`/login?next=/posts/${id}`)
    if (!text.trim()) return
    setBusy(true)
    try {
      const c = await addComment(Number(id), text.trim())
      setComments(list => [...list, { ...c, author_name: profile?.full_name, author_username: profile?.username, author_avatar: profile?.avatar_url }])
      setText('')
    } catch (e2) { setError(e2) }
    finally { setBusy(false) }
  }

  if (post === undefined) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 720, paddingTop: 28, paddingBottom: 60 }}>
        <Link to="/feed" className="link-btn" style={{ fontSize: 13 }}><i className="fas fa-arrow-left"></i> Back to feed</Link>
        <div style={{ marginTop: 12 }}><SetupPending error={error} /></div>
        {post ? <PostCard post={post} full onRemove={() => navigate('/feed')} /> : !error && <div className="empty-state card"><p>This post isn't available.</p></div>}
        {post && (
          <section className="card" style={{ marginTop: 16 }}>
            <h3 className="section-h">Comments ({comments.length})</h3>
            {comments.map(c => (
              <div key={c.id} className="comment">
                <Link to={`/u/${c.author_username}`}><UserAvatar src={c.author_avatar} name={c.author_name} size={34} /></Link>
                <div style={{ flex: 1 }}>
                  <div><Link to={`/u/${c.author_username}`} style={{ fontWeight: 600 }}>{c.author_name}</Link> <span className="muted" style={{ fontSize: 12 }}>{timeAgo(c.created_at)}</span></div>
                  <p style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.body}</p>
                </div>
                {(user?.id === c.author_id || user?.id === post.author_id) && (
                  <button type="button" className="post-action" aria-label="Delete comment" onClick={async () => { await deleteComment(c.id).catch(() => {}); setComments(l => l.filter(x => x.id !== c.id)) }}><i className="far fa-trash-alt"></i></button>
                )}
              </div>
            ))}
            <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input className="input" value={text} onChange={e => setText(e.target.value)} placeholder={user ? 'Write a comment…' : 'Sign in to comment'} maxLength={2000} />
              <button className="btn btn-primary" disabled={busy}>Post</button>
            </form>
          </section>
        )}
      </div>
    </div>
  )
}
