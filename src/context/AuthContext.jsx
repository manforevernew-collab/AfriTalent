import { createContext, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, getEnabledProviders } from '../lib/supabase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    }).catch(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    if (!supabase) {
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        setProfile(null)
        setLoading(false)
        return
      }

      setProfile(data)
      setLoading(false)

      if (data && !data.setup_complete && data.kyc_status === 'unverified') {
        navigate('/setup')
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

  const signInWithOAuth = async (provider) => {
    if (!supabase) return { data: null, error: new Error('Supabase is not configured.') }
    // Never send people to Supabase's raw "provider is not enabled" error page
    const enabled = await getEnabledProviders()
    if (enabled && !enabled[provider]) {
      const name = { google: 'Google', linkedin_oidc: 'LinkedIn' }[provider] || provider
      return { data: null, error: new Error(`${name} sign-in isn't available yet. Please use your email and password.`) }
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin }
    })
    return { data, error }
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
      signInWithEmail, signUpWithEmail, signInWithOAuth, signOut,
      refreshProfile: () => user && fetchProfile(user.id)
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
