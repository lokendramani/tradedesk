import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

// Pages
import Login      from './pages/Auth/Login'
import Register   from './pages/Auth/Register'
import Layout     from './components/Layout'
import Dashboard  from './pages/Dashboard/Dashboard'
import Trades     from './pages/Trades/Trades'
import Equity     from './pages/Equity/Equity'
import Segments   from './pages/Segments/Segments'
import AdminPanel   from './pages/Admin/AdminPanel'
import MFDashboard  from './pages/MFDashboard/MFDashboard'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, user } = useAuthStore()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (user?.role !== 'ADMIN') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function AppLoader() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center font-mono">
      <div className="text-center">
        <div className="text-2xl font-bold text-gray-100 mb-2">
          Trade<span className="text-blue-400">Desk</span>
        </div>
        <div className="text-xs text-gray-600 animate-pulse">Loading...</div>
      </div>
    </div>
  )
}

export default function App() {
  const { init, isInitializing } = useAuthStore()

  useEffect(() => {
    init()
  }, [])

  if (isInitializing) return <AppLoader />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index              element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard"   element={<Dashboard />} />
          <Route path="trades"      element={<Trades />} />
          <Route path="equity"      element={<Equity />} />
          <Route path="segments"    element={<Segments />} />
          <Route path="admin"       element={<AdminRoute><AdminPanel /></AdminRoute>} />
          <Route path="mf"          element={<MFDashboard />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
