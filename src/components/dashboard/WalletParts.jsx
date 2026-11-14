import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatMoney, toMinor, TX_LABEL, startTopup, requestWithdrawal, useSettings } from '../../lib/marketplace'

export function StatCard({ icon, label, value, hint, tone }) {
  return (
    <div className={`stat-card ${tone || ''}`}>
      <div className="stat-icon"><i className={icon}></i></div>
      <div><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{hint && <div className="stat-hint">{hint}</div>}</div>
    </div>
  )
}

export function TxList({ userId, types, limit = 30, refreshKey }) {
  const settings = useSettings()
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let q = supabase.from('wallet_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
    if (types) q = q.in('type', types)
    q.then(({ data }) => setRows(data || []))
  }, [userId, types?.join(','), limit, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
  if (!rows.length) return <p className="muted" style={{ padding: 12 }}>No transactions yet.</p>
  return (
    <div className="table-wrap">
      <table className="sync-table tx-table">
        <thead><tr><th>Date</th><th>Description</th><th>Type</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
        <tbody>{rows.map(t => {
          const shown = t.amount !== 0 ? t.amount : -t.held_change || -t.pending_change
          return (
            <tr key={t.id}>
              <td>{new Date(t.created_at).toLocaleDateString()}</td>
              <td>{t.contract_id ? <Link to={`/contracts/${t.contract_id}`}>{t.description}</Link> : t.description}</td>
              <td><span className="pill pill-muted">{TX_LABEL[t.type] || t.type}</span></td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: t.amount > 0 ? 'var(--color-success)' : t.amount < 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                {t.amount > 0 ? '+' : ''}{formatMoney(t.amount !== 0 ? t.amount : 0, settings?.currency)}{t.amount === 0 && shown ? <span className="muted"> ({formatMoney(Math.abs(shown), settings?.currency)} {t.held_change ? 'escrow' : 'payout'})</span> : null}
              </td>
              <td style={{ textAlign: 'right' }} className="muted">{formatMoney(t.balance_after, settings?.currency)}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

export function TopupForm() {
  const settings = useSettings()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  async function go(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const { authorization_url } = await startTopup(Number(String(amount).replace(/[^\d.]/g, '')))
      window.location.assign(authorization_url)
    } catch (err) { setMsg(err.message); setBusy(false) }
  }
  return (
    <form onSubmit={go} className="inline-form">
      <div className="money-input"><span>{formatMoney(0, settings?.currency).replace(/[\d.,\s]/g, '')}</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder={String((settings?.min_topup || 100000) / 100 * 10)} aria-label="Top-up amount" /></div>
      <button className="btn btn-primary" disabled={busy || !amount}>{busy ? 'Redirecting…' : 'Add funds'}</button>
      <div className="field-hint" style={{ width: '100%' }}><i className="fas fa-lock"></i> Secure checkout by Paystack — card, bank transfer or USSD.</div>
      {msg && <div className="field-hint bad" style={{ width: '100%' }}>{msg}</div>}
    </form>
  )
}

export function WithdrawForm({ balance, onDone }) {
  const { kycVerified } = useAuth()
  const settings = useSettings()
  const [f, setF] = useState({ amount: '', bank: '', number: '', name: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const min = settings?.min_withdrawal || 0

  async function go(e) {
    e.preventDefault()
    const amount = toMinor(f.amount)
    if (amount > balance) return setMsg({ bad: true, text: 'Amount is more than your available balance.' })
    setBusy(true); setMsg(null)
    try { await requestWithdrawal(amount, f.bank, f.number.replace(/\s/g, ''), f.name); setMsg({ text: 'Withdrawal requested. Payouts are processed within 1–2 business days.' }); setF({ amount: '', bank: '', number: '', name: '' }); onDone?.() }
    catch (err) { setMsg({ bad: true, text: err.message }) } finally { setBusy(false) }
  }

  if (!kycVerified) return <p className="muted">Verify your identity to withdraw funds. <Link to="/kyc">Start verification</Link></p>
  return (
    <form onSubmit={go} className="form-grid">
      <div><label className="form-label" htmlFor="wd-amt">Amount (min {formatMoney(min, settings?.currency)})</label><input id="wd-amt" className="input" inputMode="decimal" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></div>
      <div><label className="form-label" htmlFor="wd-bank">Bank</label><input id="wd-bank" className="input" value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })} placeholder="e.g. GTBank" /></div>
      <div><label className="form-label" htmlFor="wd-num">Account number</label><input id="wd-num" className="input" inputMode="numeric" value={f.number} onChange={e => setF({ ...f, number: e.target.value })} /></div>
      <div><label className="form-label" htmlFor="wd-name">Account name</label><input id="wd-name" className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
      <div className="span-2" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy || !f.amount}>{busy ? 'Requesting…' : 'Request withdrawal'}</button>
        {msg && <span className={`field-hint ${msg.bad ? 'bad' : 'ok'}`} style={{ margin: 0 }}>{msg.text}</span>}
      </div>
    </form>
  )
}

export function WithdrawalHistory({ userId, refreshKey }) {
  const settings = useSettings()
  const [rows, setRows] = useState([])
  useEffect(() => { supabase.from('withdrawal_requests').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10).then(({ data }) => setRows(data || [])) }, [userId, refreshKey])
  if (!rows.length) return null
  return (
    <table className="sync-table" style={{ marginTop: 12 }}>
      <thead><tr><th>Requested</th><th>Amount</th><th>To</th><th>Status</th></tr></thead>
      <tbody>{rows.map(w => <tr key={w.id}><td>{new Date(w.created_at).toLocaleDateString()}</td><td>{formatMoney(w.amount, settings?.currency)}</td><td>{w.bank_name} ••••{w.account_number.slice(-4)}</td><td><span className="pill pill-muted">{w.status}</span>{w.admin_note ? <span className="muted"> {w.admin_note}</span> : null}</td></tr>)}</tbody>
    </table>
  )
}
