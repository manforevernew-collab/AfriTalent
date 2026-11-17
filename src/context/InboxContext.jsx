// Real inbox: notifications (notifications table) + conversations (support threads with the
// AfriTalent team and contract chats between clients and freelancers). Live via Supabase realtime,
// with a 60 s refresh as a fallback. Shared by the navbar badges and the Messages page.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const InboxContext = createContext(null)
const EMPTY = { notifications: [], threads: [], loaded: false, notificationsAvailable: true }
const MESSAGE_KINDS = new Set(['message'])

function firstByKey(rows, key) {
  const out = new Map()
  for (const r of rows || []) if (!out.has(r[key])) out.set(r[key], r)
  return out
}

export function InboxProvider({ children }) {
  const { user } = useAuth()
  const [state, setState] = useState(EMPTY)
  const timer = useRef(null)

  const load = useCallback(async () => {
    if (!supabase || !user) { setState(EMPTY); return }
    const uid = user.id

    const [notifRes, supportRes, contractRes] = await Promise.all([
      supabase.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(60),
      supabase.from('support_threads').select('id, subject, category, status, last_message_at, user_unread, created_at').eq('user_id', uid).order('last_message_at', { ascending: false }).limit(50),
      supabase.from('contracts').select('id, title, status, client_id, freelancer_id, updated_at, created_at').or(`client_id.eq.${uid},freelancer_id.eq.${uid}`).order('updated_at', { ascending: false }).limit(50),
    ])
    const notificationsAvailable = !notifRes.error
    const notifications = notifRes.data || []
    const supportThreads = supportRes.data || []
    const contracts = contractRes.data || []

    // Latest message per conversation + the other party's name/photo
    const otherIds = [...new Set(contracts.map(c => (c.client_id === uid ? c.freelancer_id : c.client_id)).filter(Boolean))]
    const [supMsgs, conMsgs, people] = await Promise.all([
      supportThreads.length ? supabase.from('support_messages').select('thread_id, body, from_admin, created_at').in('thread_id', supportThreads.map(t => t.id)).order('created_at', { ascending: false }).limit(200) : { data: [] },
      contracts.length ? supabase.from('contract_messages').select('contract_id, body, sender_id, kind, created_at').in('contract_id', contracts.map(c => c.id)).order('created_at', { ascending: false }).limit(300) : { data: [] },
      otherIds.length ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', otherIds) : { data: [] },
    ])
    const lastSupport = firstByKey(supMsgs.data, 'thread_id')
    const lastContract = firstByKey(conMsgs.data, 'contract_id')
    const personById = new Map((people.data || []).map(p => [p.id, p]))
    const unreadRefs = new Set(notifications.filter(n => MESSAGE_KINDS.has(n.kind) && !n.read_at && n.ref).map(n => n.ref))

    const threads = [
      ...supportThreads.map(t => {
        const last = lastSupport.get(t.id)
        return {
          key: `support-${t.id}`, type: 'support', id: t.id,
          title: t.category === 'welcome' ? 'AfriTalent Team' : 'AfriTalent Support',
          subtitle: t.subject, avatarName: 'AfriTalent', isTeam: true,
          lastAt: last?.created_at || t.last_message_at || t.created_at,
          preview: last ? `${last.from_admin ? '' : 'You: '}${last.body}` : 'No messages yet',
          unread: Math.max(t.user_unread || 0, unreadRefs.has(`support:${t.id}`) ? 1 : 0),
        }
      }),
      ...contracts.map(c => {
        const otherId = c.client_id === uid ? c.freelancer_id : c.client_id
        const other = personById.get(otherId)
        const last = lastContract.get(c.id)
        return {
          key: `contract-${c.id}`, type: 'contract', id: c.id, otherId,
          title: other?.full_name || (c.client_id === uid ? 'Freelancer' : 'Client'),
          subtitle: c.title, avatarName: other?.full_name, avatarUrl: other?.avatar_url,
          people: other ? { [other.id]: other } : {},
          lastAt: last?.created_at || c.updated_at || c.created_at,
          preview: last ? `${last.kind === 'system' ? '' : last.sender_id === uid ? 'You: ' : ''}${last.body}` : 'Contract chat — say hello 👋',
          unread: unreadRefs.has(`contract:${c.id}`) ? 1 : 0,
        }
      }),
    ].sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))

    setState({ notifications, threads, loaded: true, notificationsAvailable })
  }, [user])

  const scheduleLoad = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 400)
  }, [load])

  useEffect(() => {
    if (!supabase || !user) { setState(EMPTY); return }
    load()
    const channel = supabase.channel(`inbox:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads', filter: `user_id=eq.${user.id}` }, scheduleLoad)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contract_messages' }, scheduleLoad)
      .subscribe()
    const poll = setInterval(load, 60000)
    const onFocus = () => scheduleLoad()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(poll); clearTimeout(timer.current); window.removeEventListener('focus', onFocus); supabase.removeChannel(channel) }
  }, [user, load, scheduleLoad])

  const markNotificationRead = useCallback(async id => {
    setState(s => ({ ...s, notifications: s.notifications.map(n => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)) }))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
  }, [])

  const markAllNotificationsRead = useCallback(async () => {
    const now = new Date().toISOString()
    setState(s => ({ ...s, notifications: s.notifications.map(n => (MESSAGE_KINDS.has(n.kind) || n.read_at ? n : { ...n, read_at: now })) }))
    await supabase.from('notifications').update({ read_at: now }).eq('user_id', user.id).is('read_at', null).neq('kind', 'message')
  }, [user])

  const markThreadRead = useCallback(async thread => {
    if (!thread) return
    const now = new Date().toISOString()
    const ref = `${thread.type}:${thread.id}`
    setState(s => ({
      ...s,
      threads: s.threads.map(t => (t.key === thread.key ? { ...t, unread: 0 } : t)),
      notifications: s.notifications.map(n => (n.ref === ref && !n.read_at ? { ...n, read_at: now } : n)),
    }))
    const jobs = [supabase.from('notifications').update({ read_at: now }).eq('user_id', user.id).eq('ref', ref).is('read_at', null)]
    if (thread.type === 'support') jobs.push(supabase.from('support_threads').update({ user_unread: 0 }).eq('id', thread.id))
    await Promise.all(jobs)
  }, [user])

  const value = useMemo(() => {
    const bell = state.notifications.filter(n => !MESSAGE_KINDS.has(n.kind))
    return {
      ...state,
      bellNotifications: bell,
      unreadNotifications: bell.filter(n => !n.read_at).length,
      unreadMessages: state.threads.reduce((sum, t) => sum + (t.unread > 0 ? 1 : 0), 0),
      reload: load, markNotificationRead, markAllNotificationsRead, markThreadRead,
    }
  }, [state, load, markNotificationRead, markAllNotificationsRead, markThreadRead])

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

export const useInbox = () => useContext(InboxContext) || { ...EMPTY, bellNotifications: [], unreadNotifications: 0, unreadMessages: 0, reload() {}, markNotificationRead() {}, markAllNotificationsRead() {}, markThreadRead() {} }

export function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export const NOTIFICATION_ICON = {
  welcome: 'fas fa-hand-sparkles', kyc: 'fas fa-id-card', address: 'fas fa-map-marker-alt', account: 'fas fa-user-check',
  proposal: 'fas fa-file-signature', contract: 'fas fa-handshake', payment: 'fas fa-wallet', business: 'fas fa-building',
  message: 'fas fa-comment-dots', info: 'fas fa-bell', follow: 'fas fa-user-plus', like: 'fas fa-heart',
  comment: 'fas fa-comment', post: 'fas fa-newspaper', order: 'fas fa-shopping-bag', review: 'fas fa-star', interview: 'fas fa-calendar-check',
}
