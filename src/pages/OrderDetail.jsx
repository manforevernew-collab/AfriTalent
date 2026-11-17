import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatMoney } from '../lib/marketplace'
import { getOrder, publicPeople, markShipped, confirmDelivery, cancelOrder, disputeOrder, adminResolveOrder, uploadMedia, ORDER_STATUS } from '../lib/social'
import { SetupPending } from '../components/social/SocialUI'
import UserAvatar from '../components/UserAvatar'

const STEPS = ['paid', 'shipped', 'completed']

export default function OrderDetail() {
  const { id } = useParams()
  const { user, isAdmin } = useAuth()
  const [o, setO] = useState(undefined)
  const [people, setPeople] = useState({})
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ carrier: '', tracking: '', note: '', receipt: null, rating: 5, review: '', reason: '' })
  const set = patch => setForm(f => ({ ...f, ...patch }))

  async function load() {
    try {
      const row = await getOrder(id)
      setO(row || null)
      if (row) setPeople(Object.fromEntries((await publicPeople([row.buyer_id, row.seller_id])).map(p => [p.id, p])))
    } catch (e) { setError(e); setO(null) }
  }
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn, done) {
    setBusy(true); setMsg(''); setError(null)
    try { await fn(); setMsg(done); await load() } catch (e) { setError(e) }
    finally { setBusy(false) }
  }

  if (o === undefined) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  if (!o) return <div className="container" style={{ maxWidth: 640, padding: '60px 16px' }}><SetupPending error={error} />{!error && <div className="empty-state card"><p>Order not found.</p></div>}</div>

  const isBuyer = user?.id === o.buyer_id
  const isSeller = user?.id === o.seller_id
  const st = ORDER_STATUS[o.status] || { label: o.status }
  const stepIdx = STEPS.indexOf(o.status === 'delivered' ? 'shipped' : o.status)
  const seller = people[o.seller_id]; const buyer = people[o.buyer_id]

  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 820, paddingTop: 28, paddingBottom: 60 }}>
        <Link to="/dashboard?tab=orders" className="link-btn" style={{ fontSize: 13 }}><i className="fas fa-arrow-left"></i> My orders</Link>
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <span className="muted" style={{ fontSize: 13 }}>Order #{o.id} · {new Date(o.created_at).toLocaleString()}</span>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: '4px 0' }}>{o.title}</h1>
              <span className="muted">{o.quantity} × {formatMoney(o.unit_price, o.currency)}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{formatMoney(o.amount, o.currency)}</div>
              <span className="status-pill" style={{ background: st.bg, color: st.color }}>{st.label}</span>
            </div>
          </div>

          {stepIdx >= 0 && (
            <ol className="order-steps">
              {['Paid into escrow', o.kind === 'product' ? 'Shipped' : 'Delivered by seller', 'Confirmed · seller paid'].map((s, i) => (
                <li key={s} className={i <= stepIdx ? 'done' : ''}><span>{i < stepIdx || o.status === 'completed' ? '✓' : i + 1}</span>{s}</li>
              ))}
            </ol>
          )}

          <div className="order-parties">
            {[['Seller', seller], ['Buyer', buyer]].map(([label, pp]) => (
              <div key={label}>
                <span className="muted" style={{ fontSize: 12 }}>{label}</span>
                <Link to={pp?.username ? `/u/${pp.username}` : '#'} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
                  <UserAvatar src={pp?.avatar_url} name={pp?.full_name} size={32} /> {pp?.full_name || '—'}
                </Link>
              </div>
            ))}
          </div>

          {o.shipping_address && <p><strong>Deliver to:</strong> {o.shipping_address}</p>}
          {o.buyer_note && <p><strong>Buyer note:</strong> {o.buyer_note}</p>}
          {(o.carrier || o.tracking_ref || o.receipt_url || o.seller_note) && (
            <div className="notice notice-info" style={{ display: 'block' }}>
              <strong>Delivery details</strong><br />
              {o.carrier && <>Carrier: {o.carrier}<br /></>}
              {o.tracking_ref && <>Tracking: {o.tracking_ref}<br /></>}
              {o.receipt_url && <><a href={o.receipt_url} target="_blank" rel="noreferrer">View shipping receipt</a><br /></>}
              {o.seller_note && <>Seller note: {o.seller_note}<br /></>}
              {o.auto_release_at && o.status === 'shipped' && <span className="muted">Payment releases automatically on {new Date(o.auto_release_at).toLocaleDateString()} unless you open a dispute.</span>}
            </div>
          )}
          {o.dispute_reason && <div className="notice notice-error"><strong>Dispute:</strong> {o.dispute_reason}</div>}
          {o.buyer_rating && <p>Buyer rating: {'★'.repeat(o.buyer_rating)} {o.buyer_review}</p>}
          {msg && <div className="notice notice-info">{msg}</div>}
          <SetupPending error={error} />

          {/* Seller: mark shipped / delivered */}
          {isSeller && o.status === 'paid' && (
            <form className="order-box" onSubmit={e => { e.preventDefault(); act(async () => {
              const receiptUrl = form.receipt ? (await uploadMedia(form.receipt, user.id)).url : null
              await markShipped(o.id, { carrier: form.carrier, tracking: form.tracking, receiptUrl, note: form.note })
            }, 'Marked as shipped — the buyer has been notified.') }}>
              <h3 className="section-h">{o.kind === 'product' ? 'Ship this order' : 'Mark as delivered'}</h3>
              {o.kind === 'product' && (
                <div className="composer-grid">
                  <input className="input" placeholder="Carrier (GIG, DHL, Kwik…)" value={form.carrier} onChange={e => set({ carrier: e.target.value })} />
                  <input className="input" placeholder="Tracking number" value={form.tracking} onChange={e => set({ tracking: e.target.value })} />
                </div>
              )}
              {o.kind === 'product' && <label className="field"><span>Shipping receipt (photo)</span><input type="file" accept="image/*" className="input" onChange={e => set({ receipt: e.target.files[0] })} /></label>}
              <textarea className="input" rows={2} placeholder="Note to buyer (optional)" value={form.note} onChange={e => set({ note: e.target.value })} />
              <button className="btn btn-primary" disabled={busy}><i className="fas fa-truck"></i> {o.kind === 'product' ? 'Confirm shipment' : 'Mark delivered'}</button>
            </form>
          )}

          {/* Buyer: confirm delivery */}
          {isBuyer && ['paid', 'shipped', 'delivered'].includes(o.status) && (
            <form className="order-box" onSubmit={e => { e.preventDefault(); if (window.confirm('Confirm you received this order? Payment will be released to the seller.')) act(() => confirmDelivery(o.id, form.rating, form.review), 'Thanks! Payment released to the seller.') }}>
              <h3 className="section-h">Received it?</h3>
              <label className="field"><span>Rate the seller</span>
                <select className="input" value={form.rating} onChange={e => set({ rating: Number(e.target.value) })}>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}</select></label>
              <textarea className="input" rows={2} placeholder="Review (optional)" value={form.review} onChange={e => set({ review: e.target.value })} />
              <button className="btn btn-success" disabled={busy}><i className="fas fa-check"></i> Confirm delivery & release payment</button>
            </form>
          )}

          {/* Cancel / dispute */}
          {(isBuyer || isSeller) && ['paid', 'shipped', 'delivered'].includes(o.status) && (
            <div className="order-box">
              <textarea className="input" rows={2} placeholder="Reason (needed for a dispute)" value={form.reason} onChange={e => set({ reason: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(o.status === 'paid' || isSeller) && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => window.confirm('Cancel this order and refund the buyer?') && act(() => cancelOrder(o.id, form.reason), 'Order cancelled and refunded.')}>Cancel & refund</button>}
                <button type="button" className="btn btn-outline" disabled={busy} style={{ color: 'var(--color-danger)' }} onClick={() => act(() => disputeOrder(o.id, form.reason), 'Dispute opened — our team will review it.')}>Open a dispute</button>
              </div>
            </div>
          )}

          {isAdmin && ['paid', 'shipped', 'delivered', 'disputed'].includes(o.status) && (
            <div className="order-box">
              <h3 className="section-h">Admin: resolve</h3>
              <textarea className="input" rows={2} placeholder="Resolution note" value={form.note} onChange={e => set({ note: e.target.value })} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act(() => adminResolveOrder(o.id, true, form.note), 'Refunded to buyer.')}>Refund buyer</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => adminResolveOrder(o.id, false, form.note), 'Released to seller.')}>Release to seller</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
