import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

/**
 * Realtime chat over a messages table.
 *  table: 'contract_messages' | 'support_messages'
 *  fk:    'contract_id' | 'thread_id'
 *  people: { [userId]: { full_name } }
 */
export default function ChatPanel({ table, fk, id, people = {}, placeholder = 'Write a message…', disabled, disabledText, height = 420, adminView = false }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const end = useRef(null)

  useEffect(() => {
    let alive = true
    supabase.from(table).select('*').eq(fk, id).order('created_at').limit(500).then(({ data }) => { if (alive) setMessages(data || []) })
    const channel = supabase.channel(`${table}:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: `${fk}=eq.${id}` }, payload => {
        setMessages(m => (m.some(x => x.id === payload.new.id) ? m : [...m, payload.new]))
      })
      .subscribe()
    // fallback refresh in case realtime is unavailable
    const poll = setInterval(() => {
      supabase.from(table).select('*').eq(fk, id).order('created_at').limit(500).then(({ data }) => { if (alive && data) setMessages(data) })
    }, 15000)
    return () => { alive = false; clearInterval(poll); supabase.removeChannel(channel) }
  }, [table, fk, id])

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length])

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setSending(true); setError('')
    const { data, error: err } = await supabase.from(table).insert({ [fk]: id, body }).select().single()
    setSending(false)
    if (err) return setError(/row-level security/i.test(err.message) ? 'You cannot send messages right now (account restricted).' : err.message)
    setText('')
    setMessages(m => (m.some(x => x.id === data.id) ? m : [...m, data]))
  }

  const label = m => {
    if (m.kind === 'system') return 'AfriTalent'
    if (m.kind === 'admin' || m.from_admin) return 'AfriTalent support'
    if (m.sender_id === user?.id) return 'You'
    return people[m.sender_id]?.full_name || 'Member'
  }
  const side = m => {
    const staff = m.kind === 'admin' || m.from_admin
    if (adminView) return staff ? 'me' : 'them'
    return m.sender_id === user?.id && !staff ? 'me' : 'them'
  }

  return (
    <div className="chat">
      <div className="chat-log" style={{ height }}>
        {messages.length === 0 && <p className="muted" style={{ textAlign: 'center', marginTop: 40 }}>No messages yet.</p>}
        {messages.map(m => (
          <div key={m.id} className={`chat-msg ${m.kind === 'system' ? 'system' : side(m)} ${m.kind || ''} ${m.from_admin ? 'admin' : ''}`}>
            {m.kind !== 'system' && <div className="chat-who">{label(m)}</div>}
            <div className="chat-bubble">
              {m.kind === 'submission' && <div className="chat-tag"><i className="fas fa-paperclip"></i> Work submitted</div>}
              {m.kind === 'revision' && <div className="chat-tag"><i className="fas fa-redo"></i> Changes requested</div>}
              {m.body}
            </div>
            <div className="chat-time">{new Date(m.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {disabled ? <div className="chat-disabled">{disabledText}</div> : (
        <form className="chat-input" onSubmit={send}>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={2} aria-label="Message"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }} />
          <button className="btn btn-primary" disabled={sending || !text.trim()} aria-label="Send"><i className="fas fa-paper-plane"></i></button>
        </form>
      )}
      {error && <div className="field-hint bad" style={{ padding: '0 12px 10px' }}>{error}</div>}
    </div>
  )
}
