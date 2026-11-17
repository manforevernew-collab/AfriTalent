// Shared helpers for the login / sign-up / password pages.

// Only same-site paths ("/businesses/1"), never "//evil.com" or "https://…"
export function safeNext(value) {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/'
}

// Where to send someone after sign-in, kept across the OAuth round-trip
const NEXT_KEY = 'afri.next'
export function rememberNext(next) {
  try { if (next && next !== '/') sessionStorage.setItem(NEXT_KEY, next); else sessionStorage.removeItem(NEXT_KEY) } catch { /* storage blocked */ }
}
export function takeRememberedNext() {
  try { const v = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); return v ? safeNext(v) : null } catch { return null }
}

export const PROVIDER_NAMES = { google: 'Google', linkedin_oidc: 'LinkedIn', 'custom:indeed': 'Indeed' }

// Supabase error → message a person can act on. `code` lets pages offer follow-up actions.
export function friendlyAuthError(error) {
  if (!error) return null
  const raw = String(error.message || error.error_description || error)
  const m = raw.toLowerCase()
  const status = error.status
  if (m.includes('invalid login credentials')) return { code: 'invalid', message: 'Incorrect email or password.' }
  if (m.includes('email not confirmed')) return { code: 'unconfirmed', message: 'Please confirm your email address first. Check your inbox for the link we sent.' }
  if (m.includes('already registered') || m.includes('already exists')) return { code: 'exists', message: 'An account with this email already exists.' }
  if (m.includes('provider is not enabled') || m.includes('unsupported provider')) return { code: 'provider', message: "That sign-in option isn't available yet. Please use your email and password." }
  if (status === 429 || m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return { code: 'rate', message: 'Too many attempts. Please wait a minute and try again.' }
  if (m.includes('password should be') || m.includes('weak password') || m.includes('password is known')) return { code: 'weak', message: 'Please choose a stronger password (at least 8 characters with letters and numbers, and not a common password).' }
  if (m.includes('same as the old') || m.includes('should be different')) return { code: 'same', message: 'Your new password must be different from your current one.' }
  if (m.includes('email address not authorized') || m.includes('error sending')) return { code: 'email', message: "We couldn't send the email right now. Please try again shortly or contact support." }
  if (m.includes('invalid email') || m.includes('unable to validate email')) return { code: 'email_invalid', message: 'Please enter a valid email address.' }
  if (m.includes('expired') || m.includes('invalid') && m.includes('link')) return { code: 'expired', message: 'This link has expired or was already used. Please request a new one.' }
  if (m.includes('failed to fetch') || m.includes('network')) return { code: 'network', message: 'Network problem. Check your connection and try again.' }
  return { code: 'other', message: raw }
}

// Errors Supabase puts in the URL when an OAuth / email link fails (?error=… or #error=…)
export function readUrlAuthError(location = window.location) {
  const sources = [new URLSearchParams(location.search), new URLSearchParams(String(location.hash || '').replace(/^#/, ''))]
  for (const p of sources) {
    const desc = p.get('error_description') || p.get('error')
    if (desc) return friendlyAuthError({ message: desc.replace(/\+/g, ' ') })
  }
  return null
}

export function passwordChecks(pw) {
  return [
    { ok: pw.length >= 8, label: 'At least 8 characters' },
    { ok: /[a-z]/i.test(pw), label: 'A letter' },
    { ok: /\d/.test(pw), label: 'A number' },
  ]
}
export const passwordOk = pw => passwordChecks(pw).every(c => c.ok)
