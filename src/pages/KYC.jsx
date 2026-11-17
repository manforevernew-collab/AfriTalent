import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import KycForm from '../components/KycForm'
import VerificationStatusCard from '../components/VerificationStatusCard'

export default function KYC() {
  const navigate = useNavigate()
  const { user, profile, kycStatus, kycNote, addressStatus, refreshProfile } = useAuth()
  const [userType, setUserType] = useState(profile?.user_type || 'job_seeker')
  const [editing, setEditing] = useState(false)
  const [submittedAt, setSubmittedAt] = useState(null)

  useEffect(() => { if (profile?.user_type) setUserType(profile.user_type) }, [profile])
  useEffect(() => {
    if (!user) return
    supabase.from('kyc_verifications').select('submitted_at').eq('user_id', user.id).order('id', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setSubmittedAt(data?.submitted_at || null))
  }, [user, kycStatus])

  const nextStep = () => navigate(addressStatus === 'unverified' || addressStatus === 'rejected' ? '/verify-address' : '/dashboard')

  // Already submitted (pending) or verified → show status, don't ask again
  if ((kycStatus === 'approved' || kycStatus === 'pending') && !editing) {
    return (
      <div className="page-enter">
        <div className="container" style={{ maxWidth: 620, paddingTop: 40, paddingBottom: 60 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>Identity Verification</h1>
          <VerificationStatusCard kind="identity" status={kycStatus} submittedAt={submittedAt} onUpdate={() => setEditing(true)}>
            <button className="btn btn-primary" onClick={nextStep}>
              {addressStatus === 'unverified' || addressStatus === 'rejected' ? 'Continue to address verification →' : 'Go to dashboard'}
            </button>
          </VerificationStatusCard>
        </div>
      </div>
    )
  }

  const typeBtn = (value, text) => (
    <button type="button" onClick={() => setUserType(value)} className="btn" style={{
      flex: 1, justifyContent: 'center',
      background: userType === value ? 'var(--color-primary)' : 'var(--color-bg-muted)',
      color: userType === value ? 'white' : 'var(--color-text)',
      border: '1px solid var(--color-border)',
    }}>{text}</button>
  )

  return (
    <div className="page-enter">
      <div className="container" style={{ maxWidth: 620, paddingTop: 40, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Identity Verification</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>
          Upload a government-issued ID. Documents are stored privately and only our verification team can view them.
        </p>
        {kycStatus === 'rejected' && (
          <div className="notice notice-error" style={{ marginBottom: 20 }}><i className="fas fa-exclamation-circle"></i> Your last submission couldn't be verified{kycNote ? ` — ${kycNote}` : ''}. Please upload a clear photo of a valid document.</div>
        )}
        {editing && (
          <div className="notice notice-info" style={{ marginBottom: 20 }}><i className="fas fa-info-circle"></i> You're updating documents that are already under review. Resubmitting restarts the review. <button type="button" onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', color: 'inherit', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Cancel</button></div>
        )}
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Account type</span>
          <div style={{ display: 'flex', gap: 12 }}>
            {typeBtn('job_seeker', '👤 Job Seeker')}
            {typeBtn('business', '🏢 Business')}
          </div>
        </div>
        <KycForm key={userType} userType={userType} onDone={() => { setEditing(false); refreshProfile(); nextStep() }} />
      </div>
    </div>
  )
}
