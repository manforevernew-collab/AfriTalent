// One source of truth for "where is this person in verification?"
// The profile columns are authoritative once approved; until then the latest submission tells us
// whether the user has already sent documents (pending) — so we never ask them to do KYC twice.

export const STATUS = ['unverified', 'pending', 'approved', 'rejected']

export function effectiveStatus(profileStatus, latestRow) {
  if (profileStatus === 'approved') return 'approved'
  if (latestRow) {
    if (latestRow.status === 'approved') return 'approved'
    if (latestRow.status === 'rejected') return 'rejected'
    return 'pending'
  }
  return profileStatus === 'pending' || profileStatus === 'rejected' ? profileStatus : 'unverified'
}

// Needs the user to act? (no submission yet, or the last one was rejected)
export const needsAction = status => status === 'unverified' || status === 'rejected'

export const KYC_COPY = {
  unverified: { tone: 'warn', icon: 'fas fa-id-card', text: 'Verify your identity to {purpose}.', cta: 'Verify now', to: '/kyc' },
  pending: { tone: 'info', icon: 'fas fa-hourglass-half', text: 'Your ID documents are being reviewed — usually within 24 hours. No further action is needed.', cta: 'View status', to: '/kyc' },
  rejected: { tone: 'error', icon: 'fas fa-exclamation-circle', text: 'Your ID verification needs attention{note}. Please resubmit a clear, valid document.', cta: 'Resubmit', to: '/kyc' },
}

export const ADDRESS_COPY = {
  unverified: { tone: 'warn', icon: 'fas fa-map-marker-alt', text: 'Verify your address to complete your profile.', cta: 'Verify address', to: '/verify-address' },
  pending: { tone: 'info', icon: 'fas fa-hourglass-half', text: 'Your address is being reviewed.', cta: 'View status', to: '/verify-address' },
  rejected: { tone: 'error', icon: 'fas fa-exclamation-circle', text: 'Your address verification needs attention. Please resubmit with a recent utility bill.', cta: 'Resubmit', to: '/verify-address' },
}
