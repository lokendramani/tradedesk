import { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

interface NavItem {
  path: string
  label: string
}

interface Module {
  id: string
  label: string
  icon: string
  items?: NavItem[]
  comingSoon?: boolean
}

const modules: Module[] = [
  {
    id: 'trading',
    label: 'TRADING JOURNAL',
    icon: '📊',
    items: [
      { path: '/dashboard', label: 'Dashboard'    },
      { path: '/trades',    label: 'Trade Log'    },
      { path: '/equity',    label: 'Equity Curve' },
      { path: '/segments',  label: 'Segments'     },
    ],
  },
  {
    id: 'mf',
    label: 'MF JOURNAL',
    icon: '📈',
    items: [
      { path: '/mf', label: 'MF Dashboard' },
    ],
  },
]

const tradingPaths = ['/dashboard', '/trades', '/equity', '/segments']
const mfPaths      = ['/mf']

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  const isInTrading = tradingPaths.some((p) => location.pathname.startsWith(p))
  const isInMF      = mfPaths.some((p) => location.pathname.startsWith(p))
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ trading: isInTrading, mf: isInMF })

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 font-mono">

      {/* Sidebar */}
      <aside className="w-60 bg-gray-900 border-r border-[#1e2330] flex flex-col flex-shrink-0">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-[#1e2330]">
          <span className="text-xl font-bold tracking-tight text-gray-100">
            Trade<span className="text-blue-400">Desk</span>
          </span>
          <div className="text-[10px] text-blue-400/60 mt-0.5 tracking-widest uppercase">
            Pro Trading Journal
          </div>
        </div>

        {/* Modules */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {modules.map((mod) => (
            <div key={mod.id} className="mb-1">
              {/* Module header */}
              <button
                onClick={() => !mod.comingSoon && setExpanded((prev) => ({ ...prev, [mod.id]: !prev[mod.id] }))}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold tracking-widest transition-colors ${
                  mod.comingSoon
                    ? 'text-gray-600 cursor-default'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{mod.icon}</span>
                  <span>{mod.label}</span>
                </div>
                {mod.comingSoon ? (
                  <span className="text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded tracking-wider">
                    SOON
                  </span>
                ) : (
                  <span className="text-gray-600 text-xs">
                    {expanded[mod.id] ? '▾' : '▸'}
                  </span>
                )}
              </button>

              {/* Sub-items */}
              {!mod.comingSoon && expanded[mod.id] && mod.items && (
                <div className="ml-4 border-l border-[#1e2330]">
                  {mod.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      className={({ isActive }) =>
                        `flex items-center gap-2 pl-4 pr-3 py-2.5 text-sm transition-all border-l-2 -ml-px ${
                          isActive
                            ? 'text-blue-400 border-blue-400 bg-blue-400/5'
                            : 'text-gray-500 border-transparent hover:text-gray-200 hover:bg-gray-800/50'
                        }`
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Divider */}
          <div className="border-t border-[#1e2330] my-2 mx-4" />

          {/* Admin Panel (admin only) */}
          {user?.role === 'ADMIN' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-widest transition-colors ${
                  isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-200'
                }`
              }
            >
              <span className="text-base">🛡️</span>
              <span>ADMIN PANEL</span>
            </NavLink>
          )}

          {/* Settings */}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2.5 text-xs font-semibold tracking-widest transition-colors ${
                isActive ? 'text-blue-400' : 'text-gray-500 hover:text-gray-200'
              }`
            }
          >
            <span className="text-base">⚙️</span>
            <span>SETTINGS</span>
          </NavLink>
        </nav>

        {/* User info + Logout */}
        <div className="px-4 py-4 border-t border-[#1e2330]">
          <div className="text-xs text-gray-300 font-semibold truncate mb-0.5">
            {user?.full_name}
          </div>
          <div className="text-xs text-gray-600 mb-3 truncate">
            {user?.email}
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-gray-500 hover:text-red-400
                       border border-gray-700 hover:border-red-400/50
                       rounded px-3 py-1.5 transition-all text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-950">
        <Outlet />
      </main>

    </div>
  )
}
