import { useEffect, useState } from 'react'
import { adminApi, type AdminUser } from '../../api/admin'
import { formatCurrency, formatDate, isProfit, isLoss } from '../../utils/format'
import type { Portfolio, Trade } from '../../types'

const SEG_LABEL: Record<string, string> = { EQUITY: 'Equity', COMMODITY: 'Commodity', F_AND_O: 'F&O' }

export default function AdminPanel() {
  const [users,     setUsers]     = useState<AdminUser[]>([])
  const [search,    setSearch]    = useState('')
  const [loading,   setLoading]   = useState(true)

  const [selectedUser,      setSelectedUser]      = useState<AdminUser | null>(null)
  const [portfolios,        setPortfolios]        = useState<Portfolio[]>([])
  const [loadingPortfolios, setLoadingPortfolios] = useState(false)

  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null)
  const [trades,            setTrades]            = useState<Trade[]>([])
  const [loadingTrades,     setLoadingTrades]     = useState(false)

  useEffect(() => {
    adminApi.getUsers()
      .then(setUsers)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSelectUser = async (user: AdminUser) => {
    if (selectedUser?.id === user.id) {
      setSelectedUser(null)
      setPortfolios([])
      setSelectedPortfolio(null)
      setTrades([])
      return
    }
    setSelectedUser(user)
    setSelectedPortfolio(null)
    setTrades([])
    setLoadingPortfolios(true)
    try {
      setPortfolios(await adminApi.getUserPortfolios(user.id))
    } finally {
      setLoadingPortfolios(false)
    }
  }

  const handleSelectPortfolio = async (portfolio: Portfolio) => {
    setSelectedPortfolio(portfolio)
    setLoadingTrades(true)
    try {
      setTrades(await adminApi.getPortfolioTrades(portfolio.id))
    } finally {
      setLoadingTrades(false)
    }
  }

  const filtered = users.filter((u) =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Admin Panel</h1>
          <p className="text-xs text-gray-500 mt-0.5">{users.length} registered users</p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users..."
          className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 w-56
                     placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* Three-column picker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Users */}
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#1e2330] text-[10px] text-gray-500 uppercase tracking-widest">
            Users
          </div>
          <div className="overflow-y-auto max-h-96 divide-y divide-[#1e2330]">
            {loading ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm animate-pulse">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm">No users found</div>
            ) : filtered.map((u) => (
              <button
                key={u.id}
                onClick={() => handleSelectUser(u)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  selectedUser?.id === u.id ? 'bg-blue-400/10 border-l-2 border-l-blue-400' : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-200 font-semibold truncate">{u.full_name}</span>
                  {u.role === 'ADMIN' && (
                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded tracking-wider flex-shrink-0">
                      ADMIN
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{u.email}</div>
                <div className="text-[10px] text-gray-600 mt-0.5">Joined {u.created_at}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Portfolios */}
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#1e2330] text-[10px] text-gray-500 uppercase tracking-widest">
            Portfolios {selectedUser ? `— ${selectedUser.full_name}` : ''}
          </div>
          <div className="overflow-y-auto max-h-96 divide-y divide-[#1e2330]">
            {!selectedUser ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm">Select a user</div>
            ) : loadingPortfolios ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm animate-pulse">Loading...</div>
            ) : portfolios.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm">No portfolios</div>
            ) : portfolios.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectPortfolio(p)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  selectedPortfolio?.id === p.id ? 'bg-blue-400/10 border-l-2 border-l-blue-400' : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="text-sm text-gray-200 font-semibold">{p.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">{p.type}</span>
                  <span className="text-[10px] text-gray-500">{p.currency}</span>
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Capital: {formatCurrency(p.starting_capital)}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Trade summary */}
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-[#1e2330] flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">
              Trades {selectedPortfolio ? `— ${selectedPortfolio.name}` : ''}
            </span>
            {trades.length > 0 && (
              <span className="text-[10px] text-gray-600">{trades.length} total</span>
            )}
          </div>
          <div className="overflow-y-auto max-h-96 divide-y divide-[#1e2330]">
            {!selectedPortfolio ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm">Select a portfolio</div>
            ) : loadingTrades ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm animate-pulse">Loading...</div>
            ) : trades.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-600 text-sm">No trades yet</div>
            ) : trades.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-200 font-semibold font-mono">{t.scrip_name}</span>
                  <span className={`text-xs font-mono ${
                    t.is_closed
                      ? (isProfit(t.net_income) ? 'text-emerald-400' : isLoss(t.net_income) ? 'text-red-400' : 'text-gray-500')
                      : 'text-blue-400'
                  }`}>
                    {t.is_closed ? (t.net_income !== null ? formatCurrency(t.net_income) : '—') : 'OPEN'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`text-[10px] ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.direction}
                  </span>
                  <span className="text-[10px] text-gray-600">{formatDate(t.entry_date)}</span>
                  <span className="text-[10px] text-gray-600">{SEG_LABEL[t.segment] ?? t.segment}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Full read-only trade table */}
      {selectedPortfolio && (
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[#1e2330] flex items-center justify-between">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest">
              Full Trade Log — {selectedPortfolio.name} (Read Only)
            </span>
            {trades.length > 0 && (
              <span className="text-[10px] text-gray-600">{trades.length} trades</span>
            )}
          </div>

          {loadingTrades ? (
            <div className="py-12 text-center text-gray-600 text-sm animate-pulse">Loading trades...</div>
          ) : trades.length === 0 ? (
            <div className="py-12 text-center text-gray-600 text-sm">No trades in this portfolio</div>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[50vh]">
              <table className="w-full text-xs font-mono">
                <thead className="sticky top-0 z-20 bg-gray-900">
                  <tr className="border-b border-[#1e2330]">
                    {['Scrip', 'Seg', 'Dir', 'Entry Date', 'Entry ₹', 'Qty',
                      'Close Date', 'Close ₹', 'Gross P&L', 'Charges', 'Net ₹', 'R:R', 'Status'].map((h) => (
                      <th key={h} className="text-left text-[10px] text-gray-600 uppercase tracking-widest px-3 py-3 whitespace-nowrap bg-gray-900">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => (
                    <tr key={t.id} className="border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-3 py-2 font-semibold text-gray-200 whitespace-nowrap">{t.scrip_name}</td>
                      <td className="px-3 py-2 text-gray-400">{SEG_LABEL[t.segment] ?? t.segment}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          t.direction === 'LONG' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'
                        }`}>
                          {t.direction}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{formatDate(t.entry_date)}</td>
                      <td className="px-3 py-2 text-gray-300">{formatCurrency(t.entry_price)}</td>
                      <td className="px-3 py-2 text-gray-300">{t.quantity}</td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{t.close_date ? formatDate(t.close_date) : '—'}</td>
                      <td className="px-3 py-2 text-gray-300">{t.close_price ? formatCurrency(t.close_price) : '—'}</td>
                      <td className={`px-3 py-2 ${isProfit(t.gross_pl) ? 'text-emerald-400' : isLoss(t.gross_pl) ? 'text-red-400' : 'text-gray-500'}`}>
                        {t.gross_pl !== null ? formatCurrency(t.gross_pl) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{t.charges ? formatCurrency(t.charges) : '—'}</td>
                      <td className={`px-3 py-2 font-semibold ${isProfit(t.net_income) ? 'text-emerald-400' : isLoss(t.net_income) ? 'text-red-400' : 'text-gray-500'}`}>
                        {t.net_income !== null ? formatCurrency(t.net_income) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {t.risk_reward ? `${parseFloat(String(t.risk_reward)).toFixed(2)}x` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {t.is_closed
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">Closed</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400">Open</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
