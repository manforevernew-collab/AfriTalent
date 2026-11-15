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
