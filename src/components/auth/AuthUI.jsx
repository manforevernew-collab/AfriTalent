// Building blocks shared by Login, SignUp, ForgotPassword and ResetPassword.
// Visual design matches the original AfriTalent login card.
import { useState } from 'react'

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 420, paddingTop: 60, paddingBottom: 80 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{title}</h1>
          {subtitle && <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Notice({ notice, children }) {
  if (!notice) return null
  const ok = notice.type === 'success'
  const info = notice.type === 'info'
  return (
    <div role={ok || info ? 'status' : 'alert'} style={{
      padding: '12px 16px', borderRadius: 10, fontSize: 13, marginBottom: 16, fontWeight: 500, lineHeight: 1.5,
      background: ok ? 'rgba(22,163,74,0.06)' : info ? 'rgba(245,158,11,0.08)' : 'rgba(220,38,38,0.06)',
      color: ok ? 'var(--color-success)' : info ? 'var(--color-primary-darker)' : 'var(--color-danger)',
    }}>
      {notice.message}
      {children}
    </div>
  )
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
)
const LinkedInIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
)

const IndeedIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" stroke="#2557A7" strokeWidth="2.6" strokeLinecap="round" d="M4.5 9.5C8 4.2 14.5 2.2 20 4"/>
    <circle fill="#2557A7" cx="12.5" cy="10.5" r="3.1"/>
    <rect fill="#2557A7" x="10.3" y="14.6" width="4.4" height="8" rx="2.2"/>
  </svg>
)

// Social sign-in / sign-up. The first sign-in with any provider creates the account
// (name, email and photo are imported by the database trigger).
export const SOCIAL_PROVIDERS = [
  { id: 'google', name: 'Google', icon: <GoogleIcon /> },
  { id: 'linkedin_oidc', name: 'LinkedIn', icon: <LinkedInIcon /> },
  { id: 'custom:indeed', name: 'Indeed', icon: <IndeedIcon /> },
]

export function SocialButtons({ onSelect, disabled, verb = 'Continue' }) {
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
        {SOCIAL_PROVIDERS.map(p => (
          <button key={p.id} type="button" className="btn btn-outline" onClick={() => onSelect(p.id)} disabled={disabled} style={{ justifyContent: 'center' }}>
            {p.icon} {verb} with {p.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
      </div>
    </>
  )
}

const labelStyle = { fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }

export function Field({ label, id, aside, children }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label htmlFor={id} style={labelStyle}>{label}</label>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function PasswordInput({ id, value, onChange, autoComplete, placeholder = '••••••••', minLength = 6 }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} type={show ? 'text' : 'password'} className="input" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} required minLength={minLength} autoComplete={autoComplete} style={{ paddingRight: 64 }} />
      <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 6px' }}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export function PasswordChecklist({ checks }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
      {checks.map(c => (
        <li key={c.label} style={{ fontSize: 12, color: c.ok ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
          <i className={`fas ${c.ok ? 'fa-check-circle' : 'fa-circle'}`} style={{ marginRight: 5, fontSize: c.ok ? 11 : 6, verticalAlign: 'middle' }} />{c.label}
        </li>
      ))}
    </ul>
  )
}

export function SubmitButton({ loading, label, loadingLabel, disabled }) {
  return (
    <button type="submit" className="btn btn-primary" disabled={loading || disabled} style={{ padding: '12px', marginTop: 4 }}>
      {loading
        ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><div className="spinner" style={{ width: 16, height: 16, borderColor: 'white', borderTopColor: 'transparent' }} /> {loadingLabel}</span>
        : label}
    </button>
  )
}

export function LinkButton({ onClick, children, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ background: 'none', border: 'none', color: 'var(--color-accent)', fontWeight: 600, cursor: disabled ? 'default' : 'pointer', fontSize: 13, padding: 0, opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  )
}

export const footerStyle = { textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--color-text-secondary)' }
export const linkStyle = { color: 'var(--color-accent)', fontWeight: 600, fontSize: 13 }
