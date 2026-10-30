import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

import Login from './pages/Auth/Login'
import Register from './pages/Auth/Register'
import PortfolioSetup from './pages/Auth/PortfolioSetup'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard/Dashboard'
import Trades from './pages/Trades/Trades'
import Equity from './pages/Equity/Equity'
import Segments from './pages/Segments/Segments'
import AdminPanel from './pages/Admin/AdminPanel'
import MFDashboard from './pages/MFDashboard/MFDashboard'
import SIPJournal from './pages/SIPJournal/SIPJournal'
import SIPTrades from './pages/SIPJournal/SIPTrades'
import SIPHoldings from './pages/SIPJournal/SIPHoldings'
import SIPBookedPL from './pages/SIPJournal/SIPBookedPL'
import {
  AccessRequired,
  HomeRedirect,
  ModuleAccessDenied,
  ModuleSwitcher,
} from './pages/ModuleAccess/ModuleAccess'
import WealthLayout from './pages/Wealth/WealthLayout'
import WealthDashboard from './pages/Wealth/WealthDashboard'
import WealthSection from './pages/Wealth/WealthSection'
import MonthlyCashFlow from './pages/Wealth/MonthlyCashFlow'
import Milestones from './pages/Wealth/Milestones'
import SchemeCatalogue from './pages/Wealth/SchemeCatalogue'
import type { ModuleCode } from './types'
import { getTradePathRedirect } from './utils/moduleRouting'
import { getPortfolioRootState } from './utils/portfolioSetup'

function ProtectedRoute() {
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn)
  return isLoggedIn ? <Outlet /> : <Navigate to="/login" replace />
}

function ModuleGuard({ module, children }: { module: ModuleCode; children?: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  if (!user) return <Navigate to="/login" replace />
  if (!user.modules?.includes(module)) return <ModuleAccessDenied module={module} />
  return children ? <>{children}</> : <Outlet />
}

function TradeDeskRoot() {
  const user = useAuthStore((state) => state.user)
  const initializeUser = useAuthStore((state) => state.initializeUser)
  const portfolioId = useAuthStore((state) => state.portfolioId)
  const status = useAuthStore((state) => state.portfolioInitializationStatus)
  const error = useAuthStore((state) => state.portfolioInitializationError)
  const rootState = getPortfolioRootState(status, portfolioId)

  if (rootState === 'ready') return <Layout />
  if (rootState === 'needs-setup') return <PortfolioSetup />
  if (rootState === 'lookup-error') {
    return (
      <main className="min-h-screen bg-surface-page px-6 py-16">
        <section className="mx-auto max-w-xl rounded-xl border border-surface-border bg-white p-8 shadow-sm">
          <h1 className="font-display text-2xl font-bold text-neutral-primary">Could not load your portfolio</h1>
          <p role="alert" className="mt-3 text-sm leading-6 text-loss-text">
            {error || 'Your portfolio could not be checked. No portfolio was created.'}
          </p>
          <button type="button" disabled={status === 'loading'}
            onClick={() => { if (user) void initializeUser(user) }}
            className="mt-6 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-50">
            Retry portfolio check
          </button>
        </section>
      </main>
    )
  }
  return <AppLoader />
}

function AdminRoute() {
  const user = useAuthStore((state) => state.user)
  return user?.role === 'ADMIN' ? <AdminPanel /> : <Navigate to="/" replace />
}

function TradePathRedirect() {
  const location = useLocation()
  return (
    <Navigate to={getTradePathRedirect(location.pathname, location.search, location.hash)} replace />
  )
}

function AppLoader() {
  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="text-center">
        <div className="font-display text-2xl font-bold text-neutral-primary mb-2">
          Trade<span className="text-brand">Desk</span>
        </div>
        <div className="text-xs text-neutral-muted animate-pulse">Loading...</div>
      </div>
    </div>
  )
}

export default function App() {
  const init = useAuthStore((state) => state.init)
  const isInitializing = useAuthStore((state) => state.isInitializing)

  useEffect(() => {
    void init()
  }, [init])

  if (isInitializing) return <AppLoader />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route element={<ProtectedRoute />}>
          <Route path="access" element={<AccessRequired />} />
          <Route path="modules" element={<ModuleSwitcher />} />
          <Route path="wealth" element={
            <ModuleGuard module="wealth">
              <WealthLayout />
            </ModuleGuard>
          }>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<WealthDashboard />} />
            <Route path="funds" element={<SchemeCatalogue />} />
            <Route path="portfolio" element={<WealthSection />} />
            <Route path="monthly-expense" element={<MonthlyCashFlow />} />
            <Route path="milestones" element={<Milestones />} />
            <Route path="transactions" element={<WealthSection />} />
            <Route path="*" element={<Navigate to="/wealth/dashboard" replace />} />
          </Route>

          <Route element={<ModuleGuard module="tradedesk" />}>
            <Route path="trade/*" element={<TradePathRedirect />} />
            <Route path="/" element={<TradeDeskRoot />}>
              <Route index element={<HomeRedirect />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="trades" element={<Trades />} />
              <Route path="equity" element={<Equity />} />
              <Route path="segments" element={<Segments />} />
              <Route path="admin" element={<AdminRoute />} />
              <Route path="mf" element={<MFDashboard />} />
              <Route path="sip">
                <Route index element={<Navigate to="/sip/trades" replace />} />
                <Route path="trades" element={<SIPTrades />} />
                <Route path="holdings" element={<SIPHoldings />} />
                <Route path="booked-pl" element={<SIPBookedPL />} />
                <Route path="summary" element={<SIPJournal />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<HomeRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
