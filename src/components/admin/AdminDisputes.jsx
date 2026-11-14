import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import ChatPanel from '../ChatPanel'
import { fetchPeople } from '../../lib/people'
import { adminResolveDispute, formatMoney, toMinor, CONTRACT_STATUS } from '../../lib/marketplace'

export default function AdminDisputes() {
  const [rows, setRows] = useState([])
  const [people, setPeople] = useState({})
  const [sel, setSel] = useState(null)
  const [showResolved, setShowResolved] = useState(false)
  const [res, setRes] = useState({ type: 'release', amount: '', note: '' })
  const [msg, setMsg] = useState(null)

  async function load() {
    const { data } = await supabase.from('disputes').select('*, contract:contracts(*)').eq('status', showResolved ? 'resolved' : 'open').order('created_at', { ascending: !showResolved }).limit(50)
    setRows(data || [])
    setPeople(await fetchPeople((data || []).flatMap(d => [d.contract?.client_id, d.contract?.freelancer_id, d.opened_by])))
    if (sel && !(data || []).some(d => d.id === sel.id)) setSel(null)
  }
  useEffect(() => { load() }, [showResolved]) // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve() {
    setMsg(null)
    try {
      await adminResolveDispute(sel.id, res.type, res.type === 'split' ? toMinor(res.amount) : null, res.note)
      setMsg({ text: 'Dispute resolved and funds moved.' }); setSel(null); load()
    } catch (e) { setMsg({ bad: true, text: e.message }) }
  }

  const c = sel?.contract
  return (
    <div className="admin-split">
      <div className="card admin-list-pane">
        <div className="admin-card-head"><h3 className="section-h" style={{ margin: 0 }}>Disputes</h3>
          <label className="biz-toggle"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Resolved</label></div>
        <div className="list-rows" style={{ marginTop: 10 }}>
          {rows.map(d => (
            <button key={d.id} className={`list-row ${sel?.id === d.id ? 'active' : ''}`} onClick={() => { setSel(d); setRes({ type: 'release', amount: '', note: '' }); setMsg(null) }}>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <strong>{d.contract?.title}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{d.reason} · by {people[d.opened_by]?.full_name}</div>
              </div>
              <strong>{formatMoney(d.contract?.amount, d.contract?.currency)}</strong>
            </button>
          ))}
          {!rows.length && <p className="muted">{showResolved ? 'No resolved disputes.' : 'No open disputes. 🎉'}</p>}
        </div>
      </div>

      <div className="card admin-detail-pane">
        {!sel ? <p className="muted" style={{ padding: 30, textAlign: 'center' }}>Select a dispute to review the contract chat and decide.</p> : (
          <>
            <div className="admin-card-head">
              <div>
                <h3 className="section-h" style={{ margin: 0 }}>{c.title}</h3>
                <div className="muted" style={{ fontSize: 13 }}>Client: <strong>{people[c.client_id]?.full_name}</strong> · Freelancer: <strong>{people[c.freelancer_id]?.full_name}</strong> · <Link to={`/contracts/${c.id}`}>Open contract</Link></div>
              </div>
              <span className="pill" style={{ background: CONTRACT_STATUS[c.status]?.bg, color: CONTRACT_STATUS[c.status]?.color }}>{CONTRACT_STATUS[c.status]?.label}</span>
            </div>
            <div className="notice notice-warn" style={{ marginTop: 12 }}><i className="fas fa-gavel"></i> <span><strong>{sel.reason}</strong>{sel.details ? ` — ${sel.details}` : ''}</span></div>
            <ChatPanel table="contract_messages" fk="contract_id" id={c.id} people={people} adminView height={320} placeholder="Message both parties as AfriTalent support…" />
            {sel.status === 'open' ? (
              <div className="resolve-box">
                <strong>Decision · {formatMoney(c.amount, c.currency)} in escrow</strong>
                <div className="resolve-options">
                  {[['release', 'Pay freelancer in full'], ['refund', 'Refund client in full'], ['split', 'Split']].map(([v, l]) => (
                    <label key={v} className={`chip ${res.type === v ? 'chip-on' : ''}`}><input type="radio" name="res" value={v} checked={res.type === v} onChange={() => setRes({ ...res, type: v })} hidden />{l}</label>
                  ))}
                </div>
                {res.type === 'split' && <input className="input" value={res.amount} onChange={e => setRes({ ...res, amount: e.target.value })} placeholder={`Amount to freelancer (of ${c.amount / 100})`} />}
                <textarea className="input" rows={2} value={res.note} onChange={e => setRes({ ...res, note: e.target.value })} placeholder="Explanation shown to both parties" />
                <p className="field-hint">The freelancer's share has the {Number(c.fee_percent)}% platform fee deducted. This moves money immediately and can't be undone.</p>
                <button className="btn btn-primary" onClick={resolve}>Resolve dispute</button>
              </div>
            ) : <p className="muted" style={{ marginTop: 10 }}>Resolved ({sel.resolution}): {sel.admin_note}</p>}
            {msg && <div className={`notice ${msg.bad ? 'notice-error' : 'notice-info'}`}>{msg.text}</div>}
          </>
        )}
      </div>
    </div>
  )
}
