import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, List, TrendingUp, PieChart, BarChart2,
  TableProperties, LineChart, LayoutGrid, BookCheck, Shield, Settings,
  ChevronLeft, ChevronRight, ChevronDown, LogOut,
} from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import TradeChatBot from './TradeChatBot'

interface NavItem {
  path: string
  label: string
  icon: React.ElementType
  adminOnly?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Trade Journal',
    items: [
      { path: '/dashboard', label: 'Dashboard',    icon: LayoutDashboard },
      { path: '/trades',    label: 'Trade Log',    icon: List            },
      { path: '/equity',    label: 'Equity Curve', icon: TrendingUp      },
      { path: '/segments',  label: 'Segments',     icon: PieChart        },
    ],
  },
  {
    label: 'SIP Journal',
    items: [
      { path: '/sip/summary',   label: 'Summary',    icon: LineChart       },
      { path: '/sip/trades',    label: 'Trades',     icon: TableProperties },
      { path: '/sip/holdings',  label: 'Holdings',   icon: LayoutGrid      },
      { path: '/sip/booked-pl', label: 'Booked P&L', icon: BookCheck      },
    ],
  },
]

const STANDALONE_ITEMS: NavItem[] = [
  { path: '/mf', label: 'MF Dashboard', icon: BarChart2 },
]

const BOTTOM_ITEMS: NavItem[] = [
  { path: '/admin',    label: 'Admin Panel', icon: Shield,   adminOnly: true },
  { path: '/settings', label: 'Settings',    icon: Settings                  },
]

function getInitials(name?: string | null) {
  if (!name) return 'U'
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function Layout() {
  const { user, logout, portfolioId, adminViewingAs, clearViewAs } = useAuthStore()
  const navigate = useNavigate()

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true'
  )

  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('nav_section_collapsed')
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', String(next))
      return next
    })
  }

  const toggleSection = (label: string) => {
    setSectionCollapsed((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      localStorage.setItem('nav_section_collapsed', JSON.stringify(next))
      return next
    })
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 py-2.5 rounded-lg mx-2 transition-colors text-sm font-medium
     ${collapsed ? 'justify-center px-0' : 'px-3'}
     ${isActive
       ? 'bg-brand/5 text-brand border-l-2 border-brand rounded-l-none'
       : 'text-neutral-muted hover:bg-surface-page border-l-2 border-transparent'
     }`

  return (
    <>
      <div className="flex h-screen bg-surface-page">

        {/* Sidebar */}
        <aside
          className={`bg-white border-r border-surface-border flex flex-col flex-shrink-0 transition-all duration-200 ${
            collapsed ? 'w-[60px]' : 'w-[220px]'
          }`}
        >
          {/* Logo + Toggle */}
          <div className={`flex items-center border-b border-surface-border h-14 flex-shrink-0 ${collapsed ? 'justify-center px-0' : 'px-4 justify-between'}`}>
            {!collapsed && (
              <span className="font-display text-lg font-bold text-neutral-primary tracking-tight">
                Trade<span className="text-brand">Desk</span>
              </span>
            )}
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-lg text-neutral-muted hover:bg-surface-page hover:text-neutral-primary transition-colors"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
            {/* Grouped nav items */}
            {NAV_GROUPS.map((group, gi) => {
              const isSectionCollapsed = !collapsed && !!sectionCollapsed[group.label]
              return (
                <div key={group.label} className={gi > 0 ? 'mt-2' : ''}>
                  {/* Section header — only when sidebar is expanded */}
                  {!collapsed ? (
                    <button
                      onClick={() => toggleSection(group.label)}
                      className="w-full flex items-center justify-between px-4 py-1.5 group"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-muted/70 group-hover:text-neutral-muted transition-colors">
                        {group.label}
                      </span>
                      <ChevronDown
                        size={12}
                        className={`text-neutral-muted/50 transition-transform duration-200 ${isSectionCollapsed ? '-rotate-90' : ''}`}
                      />
                    </button>
                  ) : (
                    gi > 0 && <div className="border-t border-surface-border mx-3 mb-2" />
                  )}

                  {/* Items — always visible in icon-only mode; toggleable when expanded */}
                  {!isSectionCollapsed && (
                    <div className="space-y-0.5">
                      {group.items.map(({ path, label, icon: Icon }) => (
                        <NavLink key={path} to={path} className={navLinkClass} title={collapsed ? label : undefined}>
                          <Icon size={18} className="flex-shrink-0" />
                          {!collapsed && <span className="truncate">{label}</span>}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Standalone items */}
            <div className="border-t border-surface-border my-3 mx-4" />
            <div className="space-y-0.5">
              {STANDALONE_ITEMS.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} to={path} className={navLinkClass} title={collapsed ? label : undefined}>
                  <Icon size={18} className="flex-shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-surface-border my-3 mx-4" />

            {/* Bottom nav items */}
            <div className="space-y-0.5">
              {BOTTOM_ITEMS.map(({ path, label, icon: Icon, adminOnly }) => {
                if (adminOnly && user?.role !== 'ADMIN') return null
                return (
                  <NavLink key={path} to={path} className={navLinkClass} title={collapsed ? label : undefined}>
                    <Icon size={18} className="flex-shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </NavLink>
                )
              })}
            </div>
          </nav>

          {/* User + Sign Out */}
          <div className={`border-t border-surface-border py-3 flex-shrink-0 ${collapsed ? 'flex flex-col items-center gap-2 px-0' : 'px-3'}`}>
            {collapsed ? (
              <>
                <div
                  className="w-8 h-8 rounded-full bg-brand/10 text-brand text-xs font-semibold flex items-center justify-center flex-shrink-0"
                  title={user?.full_name ?? ''}
                >
                  {getInitials(user?.full_name)}
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-1.5 rounded-lg text-neutral-muted hover:text-loss-text hover:bg-loss-bg transition-colors"
                >
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-brand/10 text-brand text-xs font-semibold flex items-center justify-center flex-shrink-0">
                  {getInitials(user?.full_name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-neutral-primary truncate">{user?.full_name}</div>
                  <div className="text-[10px] text-neutral-muted truncate">{user?.email}</div>
                </div>
                <button
                  onClick={handleLogout}
                  title="Sign Out"
                  className="p-1.5 rounded-lg text-neutral-muted hover:text-loss-text hover:bg-loss-bg transition-colors flex-shrink-0"
                >
                  <LogOut size={15} />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden bg-surface-page flex flex-col">
          {user?.role === 'ADMIN' && adminViewingAs && (
            <div className="bg-brand/10 border-b border-brand/20 px-4 py-2 flex items-center justify-between flex-shrink-0">
              <span className="text-sm text-brand font-medium">
                Viewing <strong>{adminViewingAs}</strong>'s portfolio
              </span>
              <button
                onClick={() => { clearViewAs(); navigate('/dashboard') }}
                className="text-xs bg-brand text-white px-3 py-1.5 rounded-md hover:bg-brand/90 transition-colors font-medium"
              >
                Return to my portfolio
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>

      </div>
      {portfolioId && <TradeChatBot portfolioId={portfolioId} />}
    </>
  )
}
