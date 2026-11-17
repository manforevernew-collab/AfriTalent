import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { friendlyAuthError } from '../lib/authHelpers'
import { AuthShell, Notice, Field, SubmitButton, footerStyle, linkStyle } from '../components/auth/AuthUI'

export default function ForgotPassword() {
  const [params] = useSearchParams()
  const { sendPasswordReset } = useAuth()
  const [email, setEmail] = useState(params.get('email') || '')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setNotice(null)
    setLoading(true)
    const { error } = await sendPasswordReset(email.trim())
    setLoading(false)
    const friendly = error && friendlyAuthError(error)
    // Don't reveal whether an account exists — only surface errors the person can act on
    if (friendly && ['rate', 'network', 'email_invalid', 'email'].includes(friendly.code)) return setNotice({ type: 'error', ...friendly })
    setSent(true)
  }

  return (
    <AuthShell title="Reset Password" subtitle={sent ? 'Check your inbox' : "Enter your email and we'll send you a reset link"}>
      {sent ? (
        <>
          <Notice notice={{ type: 'success', message: `If an AfriTalent account exists for ${email.trim()}, a password reset link is on its way. It can take a minute to arrive — check your spam folder too.` }} />
          <Link to={`/login?email=${encodeURIComponent(email.trim())}`} className="btn btn-primary" style={{ justifyContent: 'center', padding: 12, width: '100%' }}>Back to Sign In</Link>
          <p style={footerStyle}>
            Didn't get it? <button type="button" onClick={() => setSent(false)} style={{ background: 'none', border: 'none', ...linkStyle, cursor: 'pointer', padding: 0 }}>Try again</button>
          </p>
        </>
      ) : (
        <>
          <Notice notice={notice} />
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Email" id="fp-email">
              <input id="fp-email" type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email" autoFocus />
            </Field>
            <SubmitButton loading={loading} label="Send reset link" loadingLabel="Sending..." />
          </form>
          <p style={footerStyle}>
            Remembered it? <Link to="/login" style={linkStyle}>Sign In</Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}
