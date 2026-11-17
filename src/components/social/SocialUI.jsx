// Shared social / marketplace UI: media gallery, post card, composer, buy dialog, share menu.
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { formatMoney, toMinor } from '../../lib/marketplace'
import { timeAgo } from '../../context/InboxContext'
import UserAvatar from '../UserAvatar'
import {
  KIND, POST_KINDS, MAX_IMAGES, uploadMedia, createPost, deletePost, toggleLike, placeOrder,
  friendlyError, isSetupPending, shareLinks,
} from '../../lib/social'

export function SetupPending({ error }) {
  if (!error) return null
  return isSetupPending(error)
    ? <div className="notice notice-info"><i className="fas fa-tools"></i> This feature is being switched on — check back shortly.</div>
    : <div className="notice notice-error"><i className="fas fa-exclamation-circle"></i> {friendlyError(error)}</div>
}

export function MediaGallery({ media = [], compact = false }) {
  const [idx, setIdx] = useState(0)
  if (!media.length) return null
  const m = media[Math.min(idx, media.length - 1)]
  return (
    <div className={`post-media ${compact ? 'compact' : ''}`}>
      {m.type === 'video'
        ? <video src={m.url} controls preload="metadata" playsInline />
        : <img src={m.url} alt="" loading="lazy" />}
      {media.length > 1 && (
        <>
          <button type="button" className="pm-nav prev" aria-label="Previous" onClick={() => setIdx(i => (i - 1 + media.length) % media.length)}><i className="fas fa-chevron-left"></i></button>
          <button type="button" className="pm-nav next" aria-label="Next" onClick={() => setIdx(i => (i + 1) % media.length)}><i className="fas fa-chevron-right"></i></button>
          <span className="pm-count">{idx + 1}/{media.length}</span>
        </>
      )}
    </div>
  )
}

export function ShareMenu({ url, text, label = 'Share' }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const links = shareLinks(url, text)
  async function nativeOrOpen() {
    if (navigator.share) { try { await navigator.share({ title: text, url }); return } catch { /* cancelled */ } }
    setOpen(o => !o)
  }
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" className="post-action" onClick={nativeOrOpen}><i className="fas fa-share-alt"></i> {label}</button>
      {open && (
        <div className="share-pop" onMouseLeave={() => setOpen(false)}>
          <button type="button" onClick={async () => { await navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}><i className="fas fa-link"></i> {copied ? 'Copied!' : 'Copy link'}</button>
          <a href={links.whatsapp} target="_blank" rel="noreferrer"><i className="fab fa-whatsapp"></i> WhatsApp</a>
          <a href={links.linkedin} target="_blank" rel="noreferrer"><i className="fab fa-linkedin"></i> LinkedIn</a>
          <a href={links.x} target="_blank" rel="noreferrer"><i className="fab fa-x-twitter"></i> X</a>
          <a href={links.facebook} target="_blank" rel="noreferrer"><i className="fab fa-facebook"></i> Facebook</a>
        </div>
      )}
    </span>
  )
}

export function BuyDialog({ post, onClose, onDone }) {
  const [qty, setQty] = useState(1)
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const total = post.price * qty
  const isProduct = post.kind === 'product'
  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try { const id = await placeOrder(post.id, qty, isProduct ? address : null, note); onDone(id) }
    catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal card" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{isProduct ? 'Buy' : 'Book'}: {post.title}</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>Paid from your wallet into <strong>escrow</strong>. The seller is paid only after you confirm delivery.</p>
        {isProduct && (
          <label className="field"><span>Quantity{post.stock != null ? ` (${post.stock} available)` : ''}</span>
            <input type="number" className="input" min={1} max={post.stock ?? 1000} value={qty} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))} /></label>
        )}
        {isProduct && (
          <label className="field"><span>Delivery address</span>
            <textarea className="input" rows={2} value={address} onChange={e => setAddress(e.target.value)} placeholder="House number, street, city, state" required minLength={8} /></label>
        )}
        <label className="field"><span>Note to seller (optional)</span>
          <textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={isProduct ? 'Colour, size, delivery time…' : 'Describe what you need'} /></label>
        <div className="buy-total"><span>Total</span><strong>{formatMoney(total, post.currency)}</strong></div>
        {err && <div className="notice notice-error" style={{ marginTop: 10 }}>{err} {/wallet/i.test(err) && <Link to="/dashboard?tab=wallet">Top up</Link>}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={busy} style={{ flex: 1, justifyContent: 'center' }}><i className="fas fa-lock"></i> {busy ? 'Placing order…' : `Pay ${formatMoney(total, post.currency)} into escrow`}</button>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

export function PostCard({ post, onChange, onRemove, full = false }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [p, setP] = useState(post)
  const [buying, setBuying] = useState(false)
  const [expanded, setExpanded] = useState(full)
  const mine = user?.id === p.author_id
  const k = KIND[p.kind] || KIND.update
  const forSale = (p.kind === 'product' || p.kind === 'service') && p.price
  const longBody = (p.body || '').length > 280

  async function like() {
    if (!user) return navigate(`/login?next=/posts/${p.id}`)
    const next = { ...p, liked: !p.liked, likes_count: p.likes_count + (p.liked ? -1 : 1) }
    setP(next)
    try { await toggleLike(p, user.id); onChange?.(next) } catch { setP(p) }
  }
  async function remove() {
    if (!window.confirm('Delete this post?')) return
    try { await deletePost(p.id); onRemove?.(p.id) } catch (e) { alert(e.message) }
  }

  return (
    <article className="post-card card">
      <header className="post-head">
        <Link to={`/u/${p.author_username}`}><UserAvatar src={p.author_avatar} name={p.author_name} size={44} /></Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/u/${p.author_username}`} className="post-author">{p.author_name || 'Member'}</Link>
          {p.author_verified && <i className="fas fa-check-circle verified-tick" title="Verified"></i>}
          <div className="post-meta ellipsis">{p.author_headline ? `${p.author_headline} · ` : ''}{timeAgo(p.created_at)}</div>
        </div>
        <span className={`kind-pill kind-${p.kind}`}><i className={k.icon}></i> {k.label}</span>
        {mine && <button type="button" className="post-action" onClick={remove} aria-label="Delete post"><i className="far fa-trash-alt"></i></button>}
      </header>

      {p.title && <Link to={`/posts/${p.id}`} className="post-title">{p.title}</Link>}
      {p.body && (
        <p className="post-body">
          {expanded || !longBody ? p.body : `${p.body.slice(0, 280)}…`}
          {longBody && !expanded && <button type="button" className="link-btn" onClick={() => setExpanded(true)}> more</button>}
        </p>
      )}
      <MediaGallery media={p.media} />
      {p.tags?.length > 0 && <div className="post-tags">{p.tags.map(t => <Link key={t} to={`/feed?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}</div>}

      {forSale && (
        <div className="post-sale">
          <div>
            <strong>{formatMoney(p.price, p.currency)}</strong>
            <span className="muted">{p.kind === 'product'
              ? (p.status === 'sold_out' ? ' · Sold out' : p.stock != null ? ` · ${p.stock} in stock` : '')
              : p.delivery_days ? ` · Delivered in ${p.delivery_days} day${p.delivery_days > 1 ? 's' : ''}` : ''}
              {p.location ? ` · ${p.location}` : ''}</span>
          </div>
          {!mine && p.status === 'active' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => (user ? setBuying(true) : navigate(`/login?next=/posts/${p.id}`))}>
              <i className="fas fa-lock"></i> {p.kind === 'product' ? 'Buy now' : 'Book now'}
            </button>
          )}
        </div>
      )}

      <footer className="post-actions">
        <button type="button" className={`post-action ${p.liked ? 'on' : ''}`} onClick={like}><i className={p.liked ? 'fas fa-heart' : 'far fa-heart'}></i> {p.likes_count || ''} Like</button>
        <Link to={`/posts/${p.id}`} className="post-action"><i className="far fa-comment"></i> {p.comments_count || ''} Comment</Link>
        <ShareMenu url={`${window.location.origin}/posts/${p.id}`} text={p.title || `${p.author_name} on AfriTalent`} />
        {p.kind === 'job' && !mine && <Link to={`/u/${p.author_username}`} className="post-action"><i className="far fa-paper-plane"></i> Apply</Link>}
      </footer>
      {buying && <BuyDialog post={p} onClose={() => setBuying(false)} onDone={id => navigate(`/orders/${id}`)} />}
    </article>
  )
}

export function Composer({ onPosted, defaultKind = 'update' }) {
  const { user, profile } = useAuth()
  const [kind, setKind] = useState(defaultKind)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [days, setDays] = useState('')
  const [location, setLocation] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(false)
  const fileInput = useRef(null)
  const sale = kind === 'product' || kind === 'service'

  function pick(e) {
    const chosen = [...e.target.files]
    e.target.value = ''
    const all = [...files, ...chosen]
    const videos = all.filter(f => f.type.startsWith('video/'))
    if (videos.length > 1) return setErr('Add one video per post.')
    if (all.length > MAX_IMAGES) return setErr(`Up to ${MAX_IMAGES} photos per post.`)
    setErr(''); setFiles(all.map(f => Object.assign(f, { preview: f.preview || URL.createObjectURL(f) })))
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (sale && (!title.trim() || !price)) return setErr('Add a title and a price.')
    if (!title.trim() && !body.trim() && !files.length) return setErr('Write something or add a photo/video.')
    setBusy(true)
    try {
      const media = []
      for (const f of files) media.push(await uploadMedia(f, user.id))
      const post = await createPost({
        kind, title: title.trim() || null, body: body.trim() || null, media,
        tags: tags.split(/[,#\s]+/).map(t => t.trim()).filter(Boolean).slice(0, 15),
        price: sale ? toMinor(price) : null, stock: kind === 'product' && stock !== '' ? Number(stock) : null,
        delivery_days: sale && days ? Number(days) : null, location: location.trim() || null,
      })
      setTitle(''); setBody(''); setTags(''); setPrice(''); setStock(''); setDays(''); setLocation(''); setFiles([]); setOpen(false)
      onPosted?.({ ...post, author_name: profile?.full_name, author_username: profile?.username, author_avatar: profile?.avatar_url, author_headline: profile?.headline, liked: false })
    } catch (e2) { setErr(e2.message) }
    finally { setBusy(false) }
  }

  if (!user) return null
  return (
    <form className="composer card" onSubmit={submit}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <UserAvatar src={profile?.avatar_url} name={profile?.full_name} size={44} />
        <textarea className="input composer-input" rows={open ? 3 : 1} value={body} onFocus={() => setOpen(true)} onChange={e => setBody(e.target.value)}
          placeholder={sale ? 'Describe it — materials, sizes, what\'s included…' : 'Share an update, your latest work or an opportunity…'} />
      </div>
      {open && (
        <>
          <div className="kind-row" role="radiogroup" aria-label="Post type">
            {POST_KINDS.map(k => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} title={k.hint} className={`kind-chip ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>
                <i className={k.icon}></i> {k.label}
              </button>
            ))}
          </div>
          {(kind !== 'update') && <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === 'job' ? 'Role title, e.g. Junior Architect (Lagos)' : 'Title'} maxLength={140} />}
          {sale && (
            <div className="composer-grid">
              <input className="input" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="Price (₦)" />
              {kind === 'product' && <input className="input" type="number" min={0} value={stock} onChange={e => setStock(e.target.value)} placeholder="Stock (blank = unlimited)" />}
              <input className="input" type="number" min={1} max={180} value={days} onChange={e => setDays(e.target.value)} placeholder="Delivery (days)" />
              <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="Location (optional)" />
            </div>
          )}
          <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags: interior, architecture, fashion…" />
          {files.length > 0 && (
            <div className="composer-previews">
              {files.map((f, i) => (
                <div key={f.preview} className="cp-item">
                  {f.type.startsWith('video/') ? <video src={f.preview} muted /> : <img src={f.preview} alt="" />}
                  <button type="button" aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))}><i className="fas fa-times"></i></button>
                </div>
              ))}
            </div>
          )}
          {err && <div className="notice notice-error">{err}</div>}
          <div className="composer-foot">
            <input ref={fileInput} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden onChange={pick} />
            <button type="button" className="btn btn-outline btn-sm" onClick={() => fileInput.current?.click()}><i className="fas fa-photo-video"></i> Photos / video</button>
            <span className="muted" style={{ fontSize: 12 }}>{sale ? 'Buyers pay into escrow — you\'re paid on delivery.' : 'Visible to everyone on AfriTalent'}</span>
            <button className="btn btn-primary btn-sm" disabled={busy} style={{ marginLeft: 'auto' }}>{busy ? 'Posting…' : 'Post'}</button>
          </div>
        </>
      )}
    </form>
  )
}
