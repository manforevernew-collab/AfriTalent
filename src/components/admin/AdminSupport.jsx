import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import ChatPanel from '../ChatPanel'
import { fetchPeople } from '../../lib/people'
import { StatusPill } from './AdminUsers'

/** Support inbox. `startWith` = a user object to open/create a conversation with. */
export default function AdminSupport({ startWith, onStarted }) {
  const [threads, setThreads] = useState([])
  const [people, setPeople] = useState({})
  const [active, setActive] = useState(null)
  const [filter, setFilter] = useState('open')
  const [statuses, setStatuses] = useState({})

  async function load() {
    const { data } = await supabase.from('support_threads').select('*').eq('status', filter).order('last_message_at', { ascending: false }).limit(100)
    setThreads(data || [])
    const ids = (data || []).map(t => t.user_id)
    setPeople(await fetchPeople(ids))
    if (ids.length) {
      const { data: prof } = await supabase.from('profiles').select('id, account_status').in('id', ids)
      setStatuses(Object.fromEntries((prof || []).map(p => [p.id, p.account_status])))
    }
  }
  useEffect(() => { load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ch = supabase.channel('admin-support-threads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!startWith) return
    ;(async () => {
      const { data: existing } = await supabase.from('support_threads').select('*').eq('user_id', startWith.id).eq('status', 'open').order('last_message_at', { ascending: false }).limit(1).maybeSingle()
      let t = existing
      if (!t) {
        const { data } = await supabase.from('support_threads').insert({ user_id: startWith.id, subject: 'Message from AfriTalent', category: 'admin' }).select().single()
        t = data
      }
      if (t) { setFilter('open'); setActive(t); load() }
      onStarted?.()
    })()
  }, [startWith]) // eslint-disable-line react-hooks/exhaustive-deps

  async function open(t) {
    setActive(t)
    if (t.admin_unread) { await supabase.from('support_threads').update({ admin_unread: 0 }).eq('id', t.id); load() }
  }
  async function setStatus(status) {
    await supabase.from('support_threads').update({ status }).eq('id', active.id)
    setActive({ ...active, status }); load()
  }

  return (
    <div className="admin-split">
      <div className="card admin-list-pane">
        <div className="admin-card-head">
          <h3 className="section-h" style={{ margin: 0 }}>Support inbox</h3>
          <select className="input" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open</option><option value="closed">Closed</option></select>
        </div>
        <div className="list-rows" style={{ marginTop: 10 }}>
          {threads.map(t => (
            <button key={t.id} className={`list-row ${active?.id === t.id ? 'active' : ''}`} onClick={() => open(t)}>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <strong>{people[t.user_id]?.full_name}</strong>
                <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</div>
              </div>
              {t.admin_unread > 0 && <span className="badge-dot">{t.admin_unread}</span>}
            </button>
          ))}
          {!threads.length && <p className="muted">No {filter} conversations.</p>}
        </div>
      </div>
      <div className="card admin-detail-pane" style={{ padding: 0 }}>
        {active ? (
          <>
            <div className="admin-card-head" style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <div><strong>{people[active.user_id]?.full_name}</strong> <StatusPill s={statuses[active.user_id] || 'active'} /><div className="muted" style={{ fontSize: 12 }}>{active.subject}</div></div>
              {active.status === 'open' ? <button className="btn btn-outline btn-sm" onClick={() => setStatus('closed')}>Mark resolved</button> : <button className="btn btn-outline btn-sm" onClick={() => setStatus('open')}>Reopen</button>}
            </div>
            <ChatPanel key={active.id} table="support_messages" fk="thread_id" id={active.id} people={people} adminView height={460} placeholder="Reply as AfriTalent support…" />
          </>
        ) : <p className="muted" style={{ padding: 30, textAlign: 'center' }}>Select a conversation.</p>}
      </div>
    </div>
  )
}
