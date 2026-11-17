import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'

function Gate({ icon, title, text, to, cta }) {
  return (
    <div className="container" style={{ maxWidth: 560, padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{title}</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>{text}</p>
      {to && <Link to={to} className="btn btn-primary" style={{ padding: '12px 28px' }}>{cta}</Link>}
    </div>
  )
}

// Gates features on verification, using the real status so nobody is asked to submit twice.
export default function KYCGuard({ children }) {
  const { kycVerified, addressVerified, kycStatus, addressStatus } = useAuth()

  if (!kycVerified) {
    if (kycStatus === 'pending' || kycStatus === 'approved') {
      return <Gate icon="⏳" title="Verification in review"
        text="Thanks — your ID documents are with our verification team (usually within 24 hours). This feature unlocks automatically once you're approved; we'll notify you."
        to="/dashboard" cta="Go to dashboard" />
    }
    return <Gate icon="🛡️" title={kycStatus === 'rejected' ? 'Please resubmit your ID' : 'KYC Verification Required'}
      text={kycStatus === 'rejected'
        ? 'Your last ID submission could not be verified. Upload a clear photo of a valid document to continue.'
        : 'To access this feature, you need to complete identity verification. This helps us maintain a trusted professional network.'}
      to="/kyc" cta={kycStatus === 'rejected' ? 'Resubmit ID' : 'Start KYC Verification'} />
  }

  if (!addressVerified) {
    if (addressStatus === 'pending' || addressStatus === 'approved') {
      return <Gate icon="⏳" title="Address in review" text="Your address details are being reviewed. This feature unlocks once they're approved." to="/dashboard" cta="Go to dashboard" />
    }
    return <Gate icon="📍" title="Address Verification Required"
      text="Please verify your address with GPS location and a utility bill to continue." to="/verify-address" cta="Verify Address" />
  }

  return children
}
