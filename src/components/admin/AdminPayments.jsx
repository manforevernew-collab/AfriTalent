import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchPeople } from '../../lib/people'
import { adminProcessWithdrawal, adminReviewAd, formatMoney, useSettings, CONTRACT_STATUS, TX_LABEL } from '../../lib/marketplace'

export function AdminPayments() {
  const settings = useSettings()
  const cur = settings?.currency
  const [wds, setWds] = useState([])
  const [contracts, setContracts] = useState([])
  const [txs, setTxs] = useState([])
  const [people, setPeople] = useState({})
  const [refs, setRefs] = useState({})
  const [msg, setMsg] = useState(null)

  async function load() {
    const [w, c, t] = await Promise.all([
      supabase.from('withdrawal_requests').select('*').eq('status', 'pending').order('created_at'),
      supabase.from('contracts').select('*').in('status', ['funded', 'submitted', 'revision_requested', 'disputed']).order('funded_at', { ascending: true }).limit(50),
      supabase.from('wallet_transactions').select('*').order('created_at', { ascending: false }).limit(40),
    ])
    setWds(w.data || []); setContracts(c.data || []); setTxs(t.data || [])
    setPeople(await fetchPeople([...(w.data || []).map(x => x.user_id), ...(c.data || []).flatMap(x => [x.client_id, x.freelancer_id]), ...(t.data || []).map(x => x.user_id)]))
  }
  useEffect(() => { load() }, [])

  async function process(w, paid) {
    setMsg(null)
    try { await adminProcessWithdrawal(w.id, paid, refs[w.id], paid ? null : (refs[w.id] || 'Declined')); setMsg({ text: paid ? 'Marked as paid.' : 'Declined and refunded to wallet.' }); load() }
    catch (e) { setMsg({ bad: true, text: e.message }) }
  }

  return (
    <div className="dash-stack">
      <div className="card">
        <h3 className="section-h">Withdrawals to pay ({wds.length})</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Send the bank transfer, then enter its reference and mark as paid. Declining returns the money to the user's wallet.</p>
        {msg && <div className={`notice ${msg.bad ? 'notice-error' : 'notice-info'}`}>{msg.text}</div>}
        {wds.length ? <div className="table-wrap"><table className="sync-table">
          <thead><tr><th>User</th><th>Amount</th><th>Bank details</th><th>Requested</th><th>Reference / note</th><th></th></tr></thead>
          <tbody>{wds.map(w => (
            <tr key={w.id}>
              <td>{people[w.user_id]?.full_name}</td><td><strong>{formatMoney(w.amount, cur)}</strong></td>
              <td>{w.bank_name}<br /><span className="mono">{w.account_number}</span><br />{w.account_name}</td>
              <td>{new Date(w.created_at).toLocaleDateString()}</td>
              <td><input className="input" style={{ minWidth: 140 }} value={refs[w.id] || ''} onChange={e => setRefs({ ...refs, [w.id]: e.target.value })} placeholder="Transfer ref" /></td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-success btn-sm" onClick={() => process(w, true)}>Paid</button> <button className="btn btn-outline btn-sm" onClick={() => process(w, false)}>Decline</button></td>
            </tr>
          ))}</tbody></table></div> : <p className="muted">No pending withdrawals.</p>}
      </div>

      <div className="card">
        <h3 className="section-h">Funds in escrow ({contracts.length})</h3>
        {contracts.length ? <div className="list-rows">{contracts.map(c => (
          <Link key={c.id} to={`/contracts/${c.id}`} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}><strong>{c.title}</strong><div className="muted" style={{ fontSize: 12 }}>{people[c.client_id]?.full_name} → {people[c.freelancer_id]?.full_name} · funded {c.funded_at ? new Date(c.funded_at).toLocaleDateString() : '—'}</div></div>
            <span className="pill" style={{ background: CONTRACT_STATUS[c.status]?.bg, color: CONTRACT_STATUS[c.status]?.color }}>{CONTRACT_STATUS[c.status]?.label}</span>
            <strong>{formatMoney(c.amount, c.currency)}</strong>
          </Link>
        ))}</div> : <p className="muted">Nothing in escrow right now.</p>}
      </div>

      <div className="card">
        <h3 className="section-h">Latest transactions</h3>
        <div className="table-wrap"><table className="sync-table">
          <thead><tr><th>When</th><th>User</th><th>Type</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>{txs.map(t => <tr key={t.id}><td>{new Date(t.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td><td>{people[t.user_id]?.full_name}</td><td>{TX_LABEL[t.type] || t.type}</td><td>{t.description}</td><td style={{ textAlign: 'right' }}>{formatMoney(t.amount || -t.held_change || -t.pending_change, cur)}</td></tr>)}</tbody>
        </table></div>
      </div>
    </div>
  )
}

export function AdminAds() {
  const settings = useSettings()
  const [ads, setAds] = useState([])
  const [people, setPeople] = useState({})
  const [notes, setNotes] = useState({})
  const [filter, setFilter] = useState('pending_review')
  async function load() {
    const { data } = await supabase.from('ad_campaigns').select('*').eq('status', filter).order('created_at', { ascending: false }).limit(50)
    setAds(data || []); setPeople(await fetchPeople((data || []).map(a => a.user_id)))
  }
  useEffect(() => { load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps
  async function review(a, ok) { try { await adminReviewAd(a.id, ok, notes[a.id]); load() } catch (e) { alert(e.message) } }
  return (
    <div className="card">
      <div className="admin-card-head"><h3 className="section-h" style={{ margin: 0 }}>Ad campaigns</h3>
        <select className="input" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
          {['pending_review', 'active', 'rejected', 'ended'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select></div>
      <div className="list-rows" style={{ marginTop: 12 }}>
        {ads.map(a => (
          <div key={a.id} className="kyc-item">
            <div className="kyc-item-head"><div><strong>{a.title}</strong><div className="muted" style={{ fontSize: 12 }}>{people[a.user_id]?.full_name} · {a.placement} · {a.days} days · {formatMoney(a.amount, settings?.currency)}</div></div><span className="pill pill-muted">{a.impressions} views · {a.clicks} clicks</span></div>
            <p style={{ fontSize: 14, margin: '6px 0' }}>{a.body}</p>
            <div className="kyc-docs"><a className="doc-link" href={a.target_url} target="_blank" rel="noopener noreferrer nofollow">{a.target_url}</a>{a.image_url && <a className="doc-link" href={a.image_url} target="_blank" rel="noopener noreferrer">Image</a>}</div>
            {a.status === 'pending_review' && (
              <>
                <input className="input" style={{ marginTop: 8 }} value={notes[a.id] || ''} onChange={e => setNotes({ ...notes, [a.id]: e.target.value })} placeholder="Note to advertiser (optional)" />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button className="btn btn-success btn-sm" onClick={() => review(a, true)}>Approve & start</button><button className="btn btn-danger btn-sm" onClick={() => review(a, false)}>Reject & refund</button></div>
              </>
            )}
          </div>
        ))}
        {!ads.length && <p className="muted">No campaigns.</p>}
      </div>
    </div>
  )
}

export function AdminSettings() {
  const [s, setS] = useState(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { supabase.from('app_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setS(data)) }, [])
  if (!s) return null
  const major = k => (s[k] ?? 0) / 100
  async function save(e) {
    e.preventDefault()
    const { error } = await supabase.from('app_settings').update({
      require_signup_approval: s.require_signup_approval, currency: s.currency, platform_fee_percent: Number(s.platform_fee_percent),
      boost_price_per_day: s.boost_price_per_day, min_withdrawal: s.min_withdrawal, min_topup: s.min_topup, ad_price_per_day: s.ad_price_per_day, updated_at: new Date().toISOString(),
    }).eq('id', 1)
    setMsg(error ? error.message : 'Saved. Users see new prices on their next visit.')
  }
  const money = (k, label) => <div><label className="form-label">{label}</label><input className="input" inputMode="decimal" value={major(k)} onChange={e => setS({ ...s, [k]: Math.round(Number(e.target.value || 0) * 100) })} /></div>
  return (
    <form className="card biz-form" onSubmit={save}>
      <h3 className="section-h">Platform settings</h3>
      <div className="form-grid">
        <label className="biz-toggle span-2"><input type="checkbox" checked={s.require_signup_approval} onChange={e => setS({ ...s, require_signup_approval: e.target.checked })} /> New sign-ups must be approved by an admin</label>
        <div><label className="form-label">Currency</label><select className="input" value={s.currency} onChange={e => setS({ ...s, currency: e.target.value })}>{['NGN', 'GHS', 'KES', 'ZAR', 'USD'].map(c => <option key={c}>{c}</option>)}</select></div>
        <div><label className="form-label">Platform fee on gig payments (%)</label><input className="input" inputMode="decimal" value={s.platform_fee_percent} onChange={e => setS({ ...s, platform_fee_percent: e.target.value })} /></div>
        {money('boost_price_per_day', 'Boost price per day')}
        {money('min_topup', 'Minimum top-up')}
        {money('min_withdrawal', 'Minimum withdrawal')}
        {Object.keys(s.ad_price_per_day || {}).map(k => (
          <div key={k}><label className="form-label">Ad price per day · {k}</label><input className="input" inputMode="decimal" value={(s.ad_price_per_day[k] || 0) / 100} onChange={e => setS({ ...s, ad_price_per_day: { ...s.ad_price_per_day, [k]: Math.round(Number(e.target.value || 0) * 100) } })} /></div>
        ))}
      </div>
      <p className="field-hint">Changing the currency only affects new wallets and gigs — existing balances keep their currency.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><button className="btn btn-primary">Save settings</button>{msg && <span className="field-hint ok" style={{ margin: 0 }}>{msg}</span>}</div>
    </form>
  )
}
