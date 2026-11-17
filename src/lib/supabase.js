import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

if (!hasSupabaseConfig) {
  console.warn('Missing Supabase credentials. The app will run in demo mode without auth.')
}

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
  : null

export const isSupabaseConfigured = hasSupabaseConfig

// Which social sign-in providers are switched on in Supabase (public endpoint).
// Resolves to e.g. { google: true, linkedin_oidc: false }, or null if it can't be checked.
let providersPromise
export function getEnabledProviders() {
  if (!hasSupabaseConfig) return Promise.resolve(null)
  providersPromise ??= fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } })
    .then(r => (r.ok ? r.json() : null))
    .then(s => s?.external ?? null)
    .catch(() => null)
  return providersPromise
}

// Is this sign-in provider switched on? Built-in providers are listed in /auth/v1/settings;
// custom ones ("custom:indeed") are probed — Supabase answers 400 when a provider is off and
// redirects (opaque with redirect:'manual') when it's on. Resolves true/false, or null if unknown.
export async function isProviderEnabled(provider) {
  if (!hasSupabaseConfig) return null
  if (!provider.startsWith('custom:')) {
    const list = await getEnabledProviders()
    return list ? Boolean(list[provider]) : null
  }
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(window.location.origin)}`,
      { redirect: 'manual', headers: { apikey: supabaseAnonKey } })
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) return true
    if (res.status === 400 || res.status === 404) return false
    return null
  } catch { return null }
}
