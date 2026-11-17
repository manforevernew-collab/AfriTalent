import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useInbox, timeAgo, NOTIFICATION_ICON } from '../context/InboxContext'
import ChatPanel from '../components/ChatPanel'
import UserAvatar from '../components/UserAvatar'

function ThreadAvatar({ thread, size = 42 }) {
  if (thread.isTeam) {
    return <span className="avatar" style={{ width: size, height: size, minWidth: size, fontSize: 16, background: '#fff1d6', color: '#b45309' }}><i className="fas fa-headset"></i></span>
  }
  return <UserAvatar src={thread.avatarUrl} name={thread.avatarName} size={size} />
}

function NewSupportChat({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function start(e) {
    e.preventDefault()
    setErr('')
    if (subject.trim().length < 3 || body.trim().length < 2) return setErr('Add a subject and a message.')
    setBusy(true)
    const { data, error } = await supabase.from('support_threads').insert({ subject: subject.trim() }).select().single()
    if (!error) await supabase.from('support_messages').insert({ thread_id: data.id, body: body.trim() })
    setBusy(false)
    if (error) return setErr(error.message)
    setSubject(''); setBody(''); setOpen(false)
    onCreated(`support-${data.id}`)
  }

  if (!open) {
    return <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)} style={{ width: '100%', justifyContent: 'center' }}><i className="fas fa-headset"></i> Message AfriTalent support</button>
  }
  return (
    <form onSubmit={start} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input className="input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" autoFocus />
      <textarea className="input" rows={3} value={body} onChange={e => setBody(e.target.value)} placeholder="How can we help?" />
      {err && <span style={{ fontSize: 12, color: 'var(--color-danger)' }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} style={{ flex: 1, justifyContent: 'center' }}>{busy ? 'Sending…' : 'Start chat'}</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

export default function Messages({ initialTab = 'messages' }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { threads, bellNotifications, unreadNotifications, unreadMessages, loaded, notificationsAvailable,
    markThreadRead, markNotificationRead, markAllNotificationsRead, reload } = useInbox()
  const [searchParams, setSearchParams] = useSearchParams()

  const activeTab = (searchParams.get('tab') || initialTab) === 'notifications' ? 'notifications' : 'messages'
  const threadParam = searchParams.get('thread')
  const [selectedKey, setSelectedKey] = useState(threadParam || null)
  const [mobileShowChat, setMobileShowChat] = useState(Boolean(threadParam))

  useEffect(() => { if (threadParam) { setSelectedKey(threadParam); setMobileShowChat(true) } }, [threadParam])

  const selected = useMemo(() => threads.find(t => t.key === selectedKey) || (selectedKey ? null : threads[0]) || null, [threads, selectedKey])

  // Opening a conversation marks it read
  useEffect(() => { if (selected?.unread) markThreadRead(selected) }, [selected?.key, selected?.unread]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeTab(tab) { setSearchParams({ tab }) }
  function openThread(key) { setSelectedKey(key); setMobileShowChat(true); setSearchParams({ tab: 'messages', thread: key }, { replace: true }) }
  function openNotification(n) {
    if (!n.read_at) markNotificationRead(n.id)
    if (n.link) navigate(n.link)
  }

  const tabBtn = (id, label, count) => (
    <button type="button" className={`btn ${activeTab === id ? 'btn-primary' : 'btn-outline'}`} onClick={() => changeTab(id)} style={{ gap: 8 }}>
      {label}
      {count > 0 && <span style={{ minWidth: 20, height: 20, borderRadius: 999, background: activeTab === id ? 'rgba(255,255,255,0.25)' : '#ef4444', color: 'white', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{count}</span>}
    </button>
  )

  return (
    <div className="page-enter" style={{ background: '#f8fafc', minHeight: 'calc(100vh - 64px)' }}>
      <div className="container" style={{ paddingTop: 32, paddingBottom: 48 }}>
        <div className="card" style={{ overflow: 'hidden', borderRadius: 18, padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700 }}>Inbox</h1>
              <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Conversations with clients, freelancers and the AfriTalent team</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {tabBtn('messages', 'Messages', unreadMessages)}
              {tabBtn('notifications', 'Notifications', unreadNotifications)}
            </div>
          </div>

          {!loaded ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>
          ) : activeTab === 'messages' ? (
            <div className={`inbox-grid ${mobileShowChat ? 'show-chat' : ''}`}>
              <aside className="inbox-list">
                <div style={{ padding: 12, borderBottom: '1px solid var(--color-border)' }}>
                  <NewSupportChat onCreated={key => { reload(); openThread(key) }} />
                </div>
                {threads.length === 0 && (
                  <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
                    <i className="far fa-comments" style={{ fontSize: 28, display: 'block', marginBottom: 10 }}></i>
                    No conversations yet. Chats appear here when you hire or get hired on a <Link to="/gigs" style={{ fontWeight: 600 }}>gig</Link>, or when you message support.
                  </div>
                )}
                {threads.map(t => (
                  <button key={t.key} type="button" onClick={() => openThread(t.key)}
                    className={`inbox-item ${selected?.key === t.key ? 'on' : ''} ${t.unread ? 'unread' : ''}`}>
                    <ThreadAvatar thread={t} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong className="ellipsis">{t.title}</strong>
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{timeAgo(t.lastAt)}</span>
                      </div>
                      <div className="ellipsis" style={{ fontSize: 12, color: 'var(--color-primary-darker)', fontWeight: 500 }}>{t.subtitle}</div>
                      <div className="ellipsis" style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{t.preview}</div>
                    </div>
                    {t.unread > 0 && <span className="inbox-dot" aria-label="Unread" />}
                  </button>
                ))}
              </aside>

              <section className="inbox-chat">
                {selected ? (
                  <>
                    <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                      <button type="button" className="btn btn-ghost btn-sm inbox-back" onClick={() => setMobileShowChat(false)} aria-label="Back to conversations"><i className="fas fa-arrow-left"></i></button>
                      <ThreadAvatar thread={selected} size={38} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong className="ellipsis" style={{ display: 'block' }}>{selected.title}</strong>
                        <span className="ellipsis" style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block' }}>{selected.subtitle}</span>
                      </div>
                      {selected.type === 'contract' && <Link to={`/contracts/${selected.id}`} className="btn btn-outline btn-sm">View contract</Link>}
                    </header>
                    <ChatPanel key={selected.key}
                      table={selected.type === 'support' ? 'support_messages' : 'contract_messages'}
                      fk={selected.type === 'support' ? 'thread_id' : 'contract_id'}
                      id={selected.id} people={selected.people || {}} height={460}
                      placeholder={selected.type === 'support' ? 'Reply to the AfriTalent team…' : `Message ${selected.title}…`} />
                  </>
                ) : (
                  <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)' }}>Select a conversation</div>
                )}
              </section>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{unreadNotifications ? `${unreadNotifications} unread` : 'You are all caught up'}</span>
                {unreadNotifications > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={markAllNotificationsRead}>Mark all as read</button>}
              </div>
              {!notificationsAvailable && (
                <div className="notice notice-info" style={{ margin: 16 }}><i className="fas fa-info-circle"></i> Notifications are being set up and will appear here shortly.</div>
              )}
              {notificationsAvailable && bellNotifications.length === 0 && (
                <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>
                  <i className="far fa-bell" style={{ fontSize: 30, display: 'block', marginBottom: 10 }}></i>No notifications yet
                </div>
              )}
              {bellNotifications.map(n => (
                <button key={n.id} type="button" onClick={() => openNotification(n)} className={`notif-row ${n.read_at ? '' : 'unread'}`}>
                  <span className="notif-icon"><i className={NOTIFICATION_ICON[n.kind] || NOTIFICATION_ICON.info}></i></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong style={{ fontSize: 14 }}>{n.title}</strong>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body && <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>{n.body}</p>}
                  </div>
                  {!n.read_at && <span className="inbox-dot" aria-label="Unread" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {user && <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12, textAlign: 'center' }}>Messages update live. Never share passwords or pay outside AfriTalent escrow.</p>}
      </div>
    </div>
  )
}
