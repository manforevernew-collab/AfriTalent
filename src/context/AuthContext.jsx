import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isProviderEnabled } from '../lib/supabase'
import { rememberNext, takeRememberedNext, PROVIDER_NAMES } from '../lib/authHelpers'
import { effectiveStatus } from '../lib/verification'

const EMPTY_VERIFICATION = { kyc: 'unverified', address: 'unverified', kycNote: null }

const TYPE_KEY = 'afri.signupType'
const USER_TYPES = ['job_seeker', 'business']
function setPendingUserType(type) {
  try { if (USER_TYPES.includes(type)) sessionStorage.setItem(TYPE_KEY, type); else sessionStorage.removeItem(TYPE_KEY) } catch { /* storage blocked */ }
}
function takePendingUserType() {
  try { const t = sessionStorage.getItem(TYPE_KEY); sessionStorage.removeItem(TYPE_KEY); return USER_TYPES.includes(t) ? t : null } catch { return null }
}

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [verification, setVerification] = useState(EMPTY_VERIFICATION)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // A failed Google/LinkedIn or email-link sign-in comes back with ?error=… / #error=… on the
    // redirect URL — show it on the login page instead of silently landing on the home page.
    const urlErr = new URLSearchParams(window.location.search).get('error_description')
      || new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_description')
    if (urlErr && !['/login', '/reset-password'].includes(window.location.pathname)) {
      navigate(`/login?error_description=${encodeURIComponent(urlErr)}`, { replace: true })
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id, { allowRedirect: true })
      else setLoading(false)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      // Only a fresh sign-in may redirect (to /setup or ?next) — not token refreshes mid-browse
      if (session?.user) fetchProfile(session.user.id, { allowRedirect: event === 'SIGNED_IN' })
      else { setProfile(null); setVerification(EMPTY_VERIFICATION); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId, { allowRedirect = false } = {}) {
    if (!supabase) {
      setLoading(false)
      return
    }

    try {
      const latest = table => supabase.from(table).select('id, status, submitted_at' + (table === 'kyc_verifications' ? ', reviewer_note' : ''))
        .eq('user_id', userId).order('id', { ascending: false }).limit(1).maybeSingle()
      const [{ data, error }, kycRes, addrRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        latest('kyc_verifications'),
        latest('address_verifications'),
      ])

      if (!error) {
        setVerification({
          kyc: effectiveStatus(data?.kyc_status, kycRes.data),
          address: effectiveStatus(data?.address_status, addrRes.data),
          kycNote: kycRes.data?.reviewer_note || null,
        })
      }

      if (error) {
        setProfile(null)
        setLoading(false)
        return
      }

      // Account type picked on the sign-up page before a Google/LinkedIn round-trip
      const pendingType = takePendingUserType()
      if (data && pendingType && !data.setup_complete && data.user_type !== pendingType) {
        const { error: typeErr } = await supabase.from('profiles').update({ user_type: pendingType }).eq('id', userId)
        if (!typeErr) data.user_type = pendingType
      }

      setProfile(data)
      setLoading(false)

      // Don't hijack the password-reset page (recovery links sign the user in)
      if (!allowRedirect || window.location.pathname === '/reset-password') return
      const next = takeRememberedNext()
      // Send brand-new members to setup — but never someone who has already submitted KYC
      const kycNow = effectiveStatus(data?.kyc_status, kycRes.data)
      const onSetupFlow = ['/setup', '/kyc', '/verify-address'].includes(window.location.pathname)
      if (data && !data.setup_complete && kycNow === 'unverified' && !onSetupFlow) {
        navigate('/setup')
      } else if (next) {
        navigate(next, { replace: true })
      }
    } catch (error) {
      console.error('Profile fetch failed:', error)
      setProfile(null)
      setLoading(false)
    }
  }

  const signInWithEmail = async (email, password) => {
    if (!supabase) return { data: null, error: new Error('Supabase is not configured.') }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signUpWithEmail = async (email, password, metadata) => {
    if (!supabase) return { data: null, error: new Error('Supabase is not configured.') }
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: metadata, emailRedirectTo: window.location.origin }
    })
    return { data, error }
  }

  // next: where to land afterwards; userType: account type chosen on the sign-up page
  const signInWithOAuth = async (provider, { next, userType } = {}) => {
    if (!supabase) return { data: null, error: new Error('Supabase is not configured.') }
    // Never send people to Supabase's raw "provider is not enabled" error page
    if (await isProviderEnabled(provider) === false) {
      const name = PROVIDER_NAMES[provider] || provider
      return { data: null, error: Object.assign(new Error(`${name} sign-in is being set up and isn't available yet. Please use your email and password for now.`), { code: 'provider' }) }
    }
    rememberNext(next)
    setPendingUserType(userType)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
        ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
      }
    })
    return { data, error }
  }

  const resendConfirmation = async (email) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') }
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } })
    return { error }
  }

  const sendPasswordReset = async (email) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    return { error }
  }

  const updatePassword = async (password) => {
    if (!supabase) return { error: new Error('Supabase is not configured.') }
    const { error } = await supabase.auth.updateUser({ password })
    return { error }
  }

  const signOut = async () => {
    if (!supabase) {
      setUser(null)
      setProfile(null)
      return
    }

    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const isAdmin = profile?.role === 'admin'
  const isBusiness = profile?.user_type === 'business' || profile?.user_type === 'recruiter'
  const isJobSeeker = profile?.user_type === 'job_seeker'
  const kycVerified = profile?.kyc_status === 'approved'
  const addressVerified = profile?.address_status === 'approved'
  const setupComplete = profile?.setup_complete === true

  return (
    <AuthContext.Provider value={{
      user, profile, loading,
      isAdmin, isBusiness, isJobSeeker, kycVerified, addressVerified, setupComplete,
      // Effective statuses: 'unverified' | 'pending' | 'approved' | 'rejected'
      kycStatus: verification.kyc, addressStatus: verification.address, kycNote: verification.kycNote,
      fullyVerified: verification.kyc === 'approved' && verification.address === 'approved',
      signInWithEmail, signUpWithEmail, signInWithOAuth, signOut,
      resendConfirmation, sendPasswordReset, updatePassword,
      refreshProfile: () => user && fetchProfile(user.id)
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
