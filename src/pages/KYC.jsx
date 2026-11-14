import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import KycForm from '../components/KycForm'

export default function KYC() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [userType, setUserType] = useState(profile?.user_type || 'job_seeker')

  useEffect(() => { if (profile?.user_type) setUserType(profile.user_type) }, [profile])

  if (profile?.kyc_status === 'approved') {
    return (
      <div className="container" style={{ maxWidth: 560, padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>KYC Verified</h1>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Your identity has been verified.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')} style={{ marginTop: 20 }}>Go Home</button>
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
        {profile?.kyc_status === 'pending' && (
          <div className="notice notice-info" style={{ marginBottom: 20 }}><i className="fas fa-hourglass-half"></i> Your documents are with our verification team. You can resubmit below if anything changed.</div>
        )}
        <div style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 6 }}>Account type</span>
          <div style={{ display: 'flex', gap: 12 }}>
            {typeBtn('job_seeker', '👤 Job Seeker')}
            {typeBtn('business', '🏢 Business')}
          </div>
        </div>
        <KycForm key={userType} userType={userType} onDone={() => navigate('/verify-address')} />
      </div>
    </div>
  )
}
