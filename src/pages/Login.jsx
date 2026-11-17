import { useState } from 'react'
import { useNavigate, Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { safeNext, friendlyAuthError, readUrlAuthError } from '../lib/authHelpers'
import { AuthShell, Notice, SocialButtons, Field, PasswordInput, SubmitButton, LinkButton, footerStyle, linkStyle } from '../components/auth/AuthUI'

export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { signInWithEmail, signInWithOAuth, resendConfirmation, user } = useAuth()
  const [email, setEmail] = useState(params.get('email') || '')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(() => {
    const urlErr = readUrlAuthError()
    if (urlErr) return { type: 'error', ...urlErr }
    if (params.get('reset') === 'done') return { type: 'success', message: 'Password updated. Please sign in with your new password.' }
    return null
  })
  const [resending, setResending] = useState(false)

  if (user) return <Navigate to={next} replace />

  const signupLink = `/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`

  async function handleSubmit(e) {
    e.preventDefault()
    setNotice(null)
    setLoading(true)
    const { error } = await signInWithEmail(email.trim(), password)
    setLoading(false)
    if (error) return setNotice({ type: 'error', ...friendlyAuthError(error) })
    navigate(next, { replace: true })
  }

  async function handleOAuth(provider) {
    setNotice(null)
    setLoading(true)
    const { error } = await signInWithOAuth(provider, { next })
    if (error) { setNotice({ type: 'error', ...friendlyAuthError(error) }); setLoading(false) }
  }

  async function handleResend() {
    setResending(true)
    const { error } = await resendConfirmation(email.trim())
    setResending(false)
    setNotice(error
      ? { type: 'error', ...friendlyAuthError(error) }
      : { type: 'success', message: `We've sent a new confirmation link to ${email.trim()}. Check your inbox (and spam folder).` })
  }

  return (
    <AuthShell title="Welcome Back" subtitle="Sign in to your AfriTalent account">
      <SocialButtons onSelect={handleOAuth} disabled={loading} />

      <Notice notice={notice}>
        {notice?.code === 'unconfirmed' && email && (
          <div style={{ marginTop: 8 }}><LinkButton onClick={handleResend} disabled={resending}>{resending ? 'Sending…' : 'Resend confirmation email'}</LinkButton></div>
        )}
        {notice?.code === 'invalid' && (
          <div style={{ marginTop: 8, color: 'var(--color-text-secondary)', fontWeight: 400 }}>
            <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`} style={linkStyle}>Reset your password</Link> or <Link to={signupLink} style={linkStyle}>create an account</Link>.
          </div>
        )}
      </Notice>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Email" id="login-email">
          <input id="login-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" autoFocus />
        </Field>
        <Field label="Password" id="login-password"
          aside={<Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email.trim())}` : ''}`} style={{ ...linkStyle, fontSize: 12 }}>Forgot password?</Link>}>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <SubmitButton loading={loading} label="Sign In" loadingLabel="Signing in..." />
      </form>

      <p style={footerStyle}>
        Don't have an account? <Link to={signupLink} style={linkStyle}>Sign Up</Link>
      </p>
    </AuthShell>
  )
}
