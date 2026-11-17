import { Navigate } from 'react-router-dom'

// Profile and dashboard are one page now: /dashboard (profile header + activity tabs),
// with editing under the "Profile & settings" tab.
export default function Profile() {
  return <Navigate to="/dashboard?tab=profile" replace />
}
