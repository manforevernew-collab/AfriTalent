import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, purchaseBoost, useSettings } from '../lib/marketplace'

/** Pay from the wallet to feature a job, gig or business at the top of its list. */
export default function BoostButton({ type, id, until, onDone }) {
  const settings = useSettings()
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const active = until && new Date(until) > new Date()
  const price = (settings?.boost_price_per_day || 0) * days

  async function buy() {
    setBusy(true); setMsg(null)
    try {
      const newUntil = await purchaseBoost(type, id, days)
      setMsg({ text: `Boosted until ${new Date(newUntil).toLocaleDateString()}.` })
      onDone?.()
    } catch (e) { setMsg({ bad: true, text: e.message }) } finally { setBusy(false) }
  }

  return (
    <div className="boost-box">
      {active && <p className="field-hint ok"><i className="fas fa-bolt"></i> Featured until {new Date(until).toLocaleDateString()}</p>}
      <p className="muted" style={{ fontSize: 13 }}>Featured posts appear first with a highlight badge.</p>
      <div className="boost-days">
        {[1, 3, 7, 14, 30].map(d => <button key={d} type="button" className={`chip ${d === days ? 'chip-on' : ''}`} onClick={() => setDays(d)}>{d}d</button>)}
      </div>
      <button className="btn btn-primary" disabled={busy || !settings} onClick={buy}>
        <i className="fas fa-bolt"></i> {active ? 'Extend' : 'Boost'} for {formatMoney(price, settings?.currency)}
      </button>
      {msg && <p className={`field-hint ${msg.bad ? 'bad' : 'ok'}`}>{msg.text} {msg.bad && /top up/i.test(msg.text) && <Link to="/dashboard?tab=wallet">Top up</Link>}</p>}
    </div>
  )
}
