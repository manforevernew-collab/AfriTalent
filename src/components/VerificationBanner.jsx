import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { KYC_COPY, ADDRESS_COPY } from '../lib/verification'

const TONE = { warn: 'notice-warn', info: 'notice-info', error: 'notice-error' }

// Shows exactly one line per verification step that still matters, based on its real status.
// Fully verified → nothing. Pending → "under review" (no action asked). Not started / rejected → call to action.
export default function VerificationBanner({ purpose = 'send proposals and get paid', showAddress = true }) {
  const { profile, kycStatus, addressStatus, kycNote } = useAuth()
  if (!profile || profile.account_status === 'blocked') return null

  const rows = []
  if (kycStatus !== 'approved') rows.push({ key: 'kyc', ...KYC_COPY[kycStatus] })
  // Only nudge about the address once identity is no longer the blocker
  if (showAddress && addressStatus !== 'approved' && kycStatus !== 'unverified' && kycStatus !== 'rejected') rows.push({ key: 'address', ...ADDRESS_COPY[addressStatus] })
  if (!rows.length) return null

  return rows.map(r => (
    <div key={r.key} className={`notice ${TONE[r.tone]}`}>
      <i className={r.icon}></i>{' '}
      <span>
        {r.text.replace('{purpose}', purpose).replace('{note}', kycNote ? ` (${kycNote})` : '')}{' '}
        <Link to={r.to} style={{ fontWeight: 700, marginLeft: 4 }}>{r.cta}</Link>
      </span>
    </div>
  ))
}
