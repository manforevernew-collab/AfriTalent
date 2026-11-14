import { supabase } from './supabase'

const cache = new Map()

/** { [userId]: { full_name, avatar_url, user_type } } for display purposes. */
export async function fetchPeople(ids) {
  const want = [...new Set(ids.filter(Boolean))].filter(id => !cache.has(id))
  if (want.length) {
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_url, user_type, kyc_status').in('id', want)
    for (const p of data || []) cache.set(p.id, p)
    for (const id of want) if (!cache.has(id)) cache.set(id, { id, full_name: 'AfriTalent member' })
  }
  return Object.fromEntries(ids.filter(Boolean).map(id => [id, cache.get(id)]))
}

export function Avatar({ person, size = 36 }) {
  const name = person?.full_name || '?'
  if (person?.avatar_url && /^https:\/\//.test(person.avatar_url)) {
    return <img src={person.avatar_url} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />
  }
  return <span className="mini-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.trim().charAt(0).toUpperCase()}</span>
}
