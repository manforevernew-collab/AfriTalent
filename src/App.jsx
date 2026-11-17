import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ProtectedRoute from './components/ProtectedRoute'
import KYCGuard from './components/KYCGuard'
import Home from './pages/Home'
import Businesses from './pages/Businesses'
import BusinessDetail from './pages/BusinessDetail'
import AddBusiness from './pages/AddBusiness'
import Reviews from './pages/Reviews'
import Professionals from './pages/Professionals'
import ProfessionalDetail from './pages/ProfessionalDetail'
import JobDetail from './pages/JobDetail'
import PostJob from './pages/PostJob'
import UploadResume from './pages/UploadResume'
import Matches from './pages/Matches'
import KYC from './pages/KYC'
import AddressVerify from './pages/AddressVerify'
import SetupWizard from './pages/SetupWizard'
import Login from './pages/Login'
import SignUp from './pages/SignUp'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import JobsHub from './pages/JobsHub'
import Feed from './pages/Feed'
import Market from './pages/Market'
import PostDetail from './pages/PostDetail'
import PublicProfile from './pages/PublicProfile'
import OrderDetail from './pages/OrderDetail'
import Admin from './pages/Admin'
import Profile from './pages/Profile'
import Messages from './pages/Messages'
import NotFound from './pages/NotFound'
import Dashboard, { AccountBanner } from './pages/Dashboard'
import GigNew from './pages/GigNew'
import GigDetail from './pages/GigDetail'
import Contract from './pages/Contract'

function App() {
  const { loading, user, profile } = useAuth()
  const { pathname } = useLocation()
  const adminArea = pathname.startsWith('/admin')

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Loading AfriTalent...</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {!adminArea && <Navbar />}
      <main style={{ flex: 1 }}>
        {user && !adminArea && pathname !== '/dashboard' && profile?.account_status && profile.account_status !== 'active' && (
          <div className="container" style={{ paddingTop: 16 }}><AccountBanner /></div>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/businesses" element={<Businesses />} />
          <Route path="/businesses/new" element={<ProtectedRoute><AddBusiness /></ProtectedRoute>} />
          <Route path="/businesses/:id" element={<BusinessDetail />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/professionals" element={<Professionals />} />
          <Route path="/professionals/:id" element={<ProfessionalDetail />} />
          <Route path="/jobs" element={<JobsHub />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/register" element={<Navigate to="/signup" replace />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
          <Route path="/notifications" element={<ProtectedRoute><Messages initialTab="notifications" /></ProtectedRoute>} />
          <Route path="/setup" element={<ProtectedRoute><SetupWizard /></ProtectedRoute>} />
          <Route path="/post-job" element={<ProtectedRoute requireBusiness><KYCGuard><PostJob /></KYCGuard></ProtectedRoute>} />
          <Route path="/upload-resume" element={<ProtectedRoute requireJobSeeker><KYCGuard><UploadResume /></KYCGuard></ProtectedRoute>} />
          <Route path="/matches" element={<ProtectedRoute requireJobSeeker><KYCGuard><Matches /></KYCGuard></ProtectedRoute>} />
          <Route path="/kyc" element={<ProtectedRoute><KYC /></ProtectedRoute>} />
          <Route path="/verify-address" element={<ProtectedRoute><AddressVerify /></ProtectedRoute>} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/gigs" element={<Navigate to="/jobs?tab=gigs" replace />} />
          <Route path="/feed" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
          <Route path="/market" element={<Market />} />
          <Route path="/posts/:id" element={<PostDetail />} />
          <Route path="/u/:handle" element={<PublicProfile />} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
          <Route path="/gigs/new" element={<ProtectedRoute><GigNew /></ProtectedRoute>} />
          <Route path="/gigs/:id" element={<GigDetail />} />
          <Route path="/contracts/:id" element={<ProtectedRoute><Contract /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {!adminArea && <Footer />}
    </div>
  )
}

export default App
