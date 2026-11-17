import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { safeNext, friendlyAuthError, passwordChecks, passwordOk } from '../lib/authHelpers'
import { AuthShell, Notice, SocialButtons, Field, PasswordInput, PasswordChecklist, SubmitButton, LinkButton, footerStyle, linkStyle } from '../components/auth/AuthUI'

const TYPES = [
  { id: 'job_seeker', icon: 'fa-user-tie', label: 'Job seeker', hint: 'Find jobs & gigs' },
  { id: 'business', icon: 'fa-building', label: 'Business', hint: 'Hire & get reviewed' },
]

export default function SignUp() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { signUpWithEmail, signInWithOAuth, resendConfirmation, user } = useAuth()
  const [userType, setUserType] = useState(params.get('type') === 'business' ? 'business' : 'job_seeker')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState(params.get('email') || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [sentTo, setSentTo] = useState(null) // email address the confirmation link went to
  const [resending, setResending] = useState(false)

  if (user) return <Navigate to={next} replace />

  const loginLink = (extra = '') => `/login?${new URLSearchParams({ ...(next !== '/' ? { next } : {}), ...extra })}`.replace(/\?$/, '')
  const checks = passwordChecks(password)
  const mismatch = confirm.length > 0 && confirm !== password

  async function handleSubmit(e) {
    e.preventDefault()
    setNotice(null)
    const cleanEmail = email.trim()
    if (fullName.trim().length < 2) return setNotice({ type: 'error', message: 'Please enter your full name.' })
    if (!passwordOk(password)) return setNotice({ type: 'error', message: 'Your password needs at least 8 characters, including a letter and a number.' })
    if (password !== confirm) return setNotice({ type: 'error', message: "The passwords don't match." })
    if (!agree) return setNotice({ type: 'error', message: 'Please accept the Terms and Privacy Policy to continue.' })

    setLoading(true)
    const { data, error } = await signUpWithEmail(cleanEmail, password, { full_name: fullName.trim(), user_type: userType })
    setLoading(false)
    if (error) return setNotice({ type: 'error', ...friendlyAuthError(error) })
    // With email confirmation on, Supabase returns a user with no identities when the email is already registered
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return setNotice({ type: 'error', code: 'exists', message: 'An account with this email already exists.' })
    }
    if (data?.session) return // signed in straight away (confirmation off) — AuthContext routes to /setup
    setSentTo(cleanEmail)
  }

  async function handleOAuth(provider) {
    setNotice(null)
    setLoading(true)
    const { error } = await signInWithOAuth(provider, { next, userType })
    if (error) { setNotice({ type: 'error', ...friendlyAuthError(error) }); setLoading(false) }
  }

  async function handleResend() {
    setResending(true)
    const { error } = await resendConfirmation(sentTo)
    setResending(false)
    setNotice(error ? { type: 'error', ...friendlyAuthError(error) } : { type: 'success', message: 'A new confirmation link is on its way.' })
  }

  if (sentTo) {
    return (
      <AuthShell title="Check your email" subtitle="One more step to activate your account">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(245,158,11,0.12)', color: 'var(--color-primary-dark)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, marginBottom: 16 }}>
            <i className="fas fa-envelope-open-text" />
          </div>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            We sent a confirmation link to <strong style={{ color: 'var(--color-text)' }}>{sentTo}</strong>. Click it to activate your AfriTalent account. It can take a minute to arrive, so check your spam folder too.
          </p>
        </div>
        <Notice notice={notice} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" className="btn btn-outline" onClick={handleResend} disabled={resending} style={{ justifyContent: 'center' }}>
            {resending ? 'Sending…' : 'Resend confirmation email'}
          </button>
          <Link to={loginLink({ email: sentTo })} className="btn btn-primary" style={{ justifyContent: 'center', padding: 12 }}>Go to Sign In</Link>
        </div>
        <p style={footerStyle}>
          Wrong email? <LinkButton onClick={() => { setSentTo(null); setNotice(null) }}>Use a different address</LinkButton>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create Account" subtitle="Join Africa's verified professional network">
      <div role="radiogroup" aria-label="Account type" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {TYPES.map(t => {
          const on = userType === t.id
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => setUserType(t.id)}
              style={{ padding: '12px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s ease',
                border: `2px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`, background: on ? 'rgba(245,158,11,0.06)' : 'white' }}>
              <i className={`fas ${t.icon}`} style={{ fontSize: 18, color: on ? 'var(--color-primary-dark)' : 'var(--color-text-muted)', marginBottom: 6, display: 'block' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t.label}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{t.hint}</div>
            </button>
          )
        })}
      </div>

      <SocialButtons onSelect={handleOAuth} disabled={loading} verb="Sign up" />

      <Notice notice={notice}>
        {notice?.code === 'exists' && (
          <div style={{ marginTop: 8, color: 'var(--color-text-secondary)', fontWeight: 400 }}>
            <Link to={loginLink({ email: email.trim() })} style={linkStyle}>Sign in instead</Link> or <Link to={`/forgot-password?email=${encodeURIComponent(email.trim())}`} style={linkStyle}>reset your password</Link>.
          </div>
        )}
      </Notice>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label={userType === 'business' ? 'Your full name (account owner)' : 'Full Name'} id="su-name">
          <input id="su-name" type="text" className="input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Enter your full name" required autoComplete="name" />
        </Field>
        <Field label={userType === 'business' ? 'Work email' : 'Email'} id="su-email">
          <input id="su-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" />
        </Field>
        <Field label="Password" id="su-password">
          <PasswordInput id="su-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          {password && <PasswordChecklist checks={checks} />}
        </Field>
        <Field label="Confirm password" id="su-confirm">
          <PasswordInput id="su-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
          {mismatch && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>Passwords don't match</div>}
        </Field>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--color-primary)' }} />
          <span>I agree to AfriTalent's Terms of Service and Privacy Policy, and confirm the details I provide are accurate.</span>
        </label>
        <SubmitButton loading={loading} label="Create Account" loadingLabel="Creating account..." />
      </form>

      <p style={footerStyle}>
        Already have an account? <Link to={loginLink()} style={linkStyle}>Sign In</Link>
      </p>
    </AuthShell>
  )
}
