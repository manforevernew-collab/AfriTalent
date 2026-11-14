import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, requireAdmin = false, requireBusiness = false, requireJobSeeker = false }) {
  const { user, isAdmin, isBusiness, isJobSeeker, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (requireAdmin && !isAdmin) return <Navigate to="/" replace />
  if (requireBusiness && !isBusiness && !isAdmin) return <Navigate to="/" replace />
  if (requireJobSeeker && !isJobSeeker && !isAdmin) return <Navigate to="/" replace />

  return children
}
