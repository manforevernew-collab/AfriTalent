// Minimal robots.txt support (RFC 9309): group matching by user-agent, Allow /
// Disallow with `*` and `$` wildcards, longest-match wins, Allow wins ties.
// Used before fetching any HTML page so the importer obeys each site's rules.

const cache = new Map() // origin -> { rules, fetchedAt }
const TTL = 6 * 3600e3

export function parseRobots(text, agent = 'afritalentjobbot') {
  const groups = []
  let current = null
  let lastWasAgent = false
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) { current = { agents: [], rules: [] }; groups.push(current) }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (!current) continue
      if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', path: value })
    }
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && agent.includes(a)))
  const chosen = mine.length ? mine : groups.filter(g => g.agents.includes('*'))
  // An empty "Disallow:" means "allow everything", so empty rules are simply dropped.
  return chosen.flatMap(g => g.rules).filter(r => r.path !== '')
}

function toRegex(path) {
  const anchored = path.endsWith('$')
  const body = (anchored ? path.slice(0, -1) : path).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

export function isAllowed(rules, pathWithQuery) {
  let best = null
  for (const r of rules) {
    if (!toRegex(r.path).test(pathWithQuery)) continue
    const len = r.path.length
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow }
  }
  return best ? best.allow : true
}

/** true when robots.txt for the URL's origin allows us to fetch it. Fails closed on 5xx. */
export async function robotsAllows(url, { userAgent = 'AfriTalentJobBot/2.0' } = {}) {
  const u = new URL(url)
  let entry = cache.get(u.origin)
  if (!entry || Date.now() - entry.fetchedAt > TTL) {
    let rules = []
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(15000) })
      if (res.ok) rules = parseRobots(await res.text(), userAgent.toLowerCase().split('/')[0])
      else if (res.status >= 500) rules = [{ allow: false, path: '/' }] // server trouble: don't crawl
      // 4xx (no robots.txt) => everything allowed
    } catch {
      rules = [{ allow: false, path: '/' }]
    }
    entry = { rules, fetchedAt: Date.now() }
    cache.set(u.origin, entry)
  }
  return isAllowed(entry.rules, u.pathname + u.search)
}
