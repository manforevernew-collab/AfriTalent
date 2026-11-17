import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { friendlyAuthError, readUrlAuthError, passwordChecks, passwordOk } from '../lib/authHelpers'
import { AuthShell, Notice, Field, PasswordInput, PasswordChecklist, SubmitButton, footerStyle, linkStyle } from '../components/auth/AuthUI'

// Landing page for the "Reset your password" email link. Supabase signs the person in from
// the link (recovery session), then they choose a new password here.
export default function ResetPassword() {
  const navigate = useNavigate()
  const { user, loading: authLoading, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(() => {
    const e = readUrlAuthError()
    return e ? { type: 'error', ...e } : null
  })

  if (authLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" /></div>
  }

  if (!user) {
    return (
      <AuthShell title="Link expired" subtitle="This password reset link is invalid or has already been used">
        <Notice notice={notice} />
        <Link to="/forgot-password" className="btn btn-primary" style={{ justifyContent: 'center', padding: 12, width: '100%' }}>Request a new link</Link>
        <p style={footerStyle}><Link to="/login" style={linkStyle}>Back to Sign In</Link></p>
      </AuthShell>
    )
  }

  const mismatch = confirm.length > 0 && confirm !== password

  async function handleSubmit(e) {
    e.preventDefault()
    setNotice(null)
    if (!passwordOk(password)) return setNotice({ type: 'error', message: 'Your password needs at least 8 characters, including a letter and a number.' })
    if (password !== confirm) return setNotice({ type: 'error', message: "The passwords don't match." })
    setLoading(true)
    const { error } = await updatePassword(password)
    if (error) { setLoading(false); return setNotice({ type: 'error', ...friendlyAuthError(error) }) }
    // Sign out everywhere so the new password is required next time
    await supabase?.auth.signOut({ scope: 'global' })
    navigate(`/login?reset=done&email=${encodeURIComponent(user.email || '')}`, { replace: true })
  }

  return (
    <AuthShell title="Choose a new password" subtitle={user.email ? `For ${user.email}` : 'Set a new password for your account'}>
      <Notice notice={notice} />
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="New password" id="rp-password">
          <PasswordInput id="rp-password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
          {password && <PasswordChecklist checks={passwordChecks(password)} />}
        </Field>
        <Field label="Confirm new password" id="rp-confirm">
          <PasswordInput id="rp-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
          {mismatch && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 6 }}>Passwords don't match</div>}
        </Field>
        <SubmitButton loading={loading} label="Update password" loadingLabel="Updating..." />
      </form>
    </AuthShell>
  )
}
