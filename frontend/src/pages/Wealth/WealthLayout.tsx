import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  ChartNoAxesCombined,
  CircleDollarSign,
  Compass,
  LayoutDashboard,
  LogOut,
  Menu,
  Milestone,
  ReceiptText,
  WalletCards,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

const wealthNav = [
  { to: '/wealth/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/wealth/funds', label: 'My funds', icon: ChartNoAxesCombined },
  { to: '/wealth/portfolio', label: 'Portfolio', icon: WalletCards },
  { to: '/wealth/monthly-expense', label: 'Monthly expense', icon: CircleDollarSign },
  { to: '/wealth/milestones', label: 'Milestones', icon: Milestone },
  { to: '/wealth/transactions', label: 'Transactions', icon: ReceiptText },
]

function initials(name?: string | null) {
  if (!name) return 'U'
  return name.split(' ').map((word) => word[0]).slice(0, 2).join('').toUpperCase()
}

export default function WealthLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const hasMultipleModules = (user?.modules?.length ?? 0) > 1

  useEffect(() => {
    document.title = 'WealthOnCruise'
    return () => { document.title = 'TradeDesk' }
  }, [])

  const signOut = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#f5f3eb] text-[#18382f] lg:flex">
      <aside className="hidden w-[238px] shrink-0 flex-col bg-[#10372e] text-white lg:flex">
        <div className="flex h-[78px] items-center gap-2 border-b border-white/10 px-6">
          <Compass size={20} className="text-[#e7c66f]" />
          <span className="font-serif text-[19px] font-bold tracking-tight">WealthOnCruise</span>
        </div>
        <nav aria-label="WealthOnCruise navigation" className="flex-1 space-y-1 px-3 py-5">
          {wealthNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-3 text-[13px] transition-colors ${
                isActive
                  ? 'bg-[#d5af50] font-semibold text-[#18382f] shadow-sm'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          {hasMultipleModules && (
            <button
              type="button"
              onClick={() => navigate('/modules')}
              className="mb-3 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-white/75 hover:bg-white/10 hover:text-white"
            >
              <ArrowLeftRight size={16} /> Switch application
            </button>
          )}
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e7c66f]/20 text-xs font-semibold text-[#f1d889]">
              {initials(user?.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{user?.full_name || 'Your account'}</p>
              <p className="truncate text-[10px] text-white/55">{user?.email}</p>
            </div>
            <button type="button" onClick={signOut} aria-label="Sign out" className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="border-b border-[#dfdfd3] bg-[#fffef9] px-4 py-3 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-serif text-lg font-bold text-[#173c31]">
              <Compass size={19} className="text-[#b68d2f]" /> WealthOnCruise
            </div>
            <button type="button" onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-[#567068] hover:bg-[#f2f0e6]">
              <LogOut size={17} />
            </button>
          </div>
          <nav aria-label="WealthOnCruise navigation" className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {wealthNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium ${
                  isActive ? 'bg-[#d5af50] text-[#18382f]' : 'bg-[#f3f1e8] text-[#577168]'
                }`}
              >
                <Icon size={14} /> {label}
              </NavLink>
            ))}
          </nav>
          {hasMultipleModules && (
            <button type="button" onClick={() => navigate('/modules')} className="mt-2 flex items-center gap-1.5 px-2 text-[11px] font-medium text-[#557067]">
              <Menu size={13} /> Switch application
            </button>
          )}
        </header>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
