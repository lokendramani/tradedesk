import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { adminApi, type AdminUser } from '../../api/admin'
import { sipApi } from '../../api/sip'
import { formatCurrency, formatDate, isProfit, isLoss } from '../../utils/format'
import type { Portfolio, Trade, SIPETFMaster } from '../../types'

const SEG_LABEL: Record<string, string> = { EQUITY: 'Equity', COMMODITY: 'Commodity', F_AND_O: 'F&O' }

type Tab = 'users' | 'config'

// ─── ETF Master section (inside Configuration tab) ────────────────────────────
function ETFMasterConfig() {
  const [etfs,    setEtfs]    = useState<SIPETFMaster[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')

  // inline edit state
  const [editTicker,    setEditTicker]    = useState<string | null>(null)
  const [editName,      setEditName]      = useState('')
  const [editClass,     setEditClass]     = useState('')
  const [saving,        setSaving]        = useState(false)

  // add new state
  const [showAdd,       setShowAdd]       = useState(false)
  const [newTicker,     setNewTicker]     = useState('')
  const [newName,       setNewName]       = useState('')
  const [newClass,      setNewClass]      = useState('Equity')
  const [adding,        setAdding]        = useState(false)

  const load = () => {
    setLoading(true)
    sipApi.getETFMaster()
      .then(data => setEtfs(data.slice().sort((a, b) => a.etf_name.localeCompare(b.etf_name))))
      .catch(() => setErr('Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const startEdit = (etf: SIPETFMaster) => {
    setEditTicker(etf.ticker)
    setEditName(etf.etf_name)
    setEditClass(etf.asset_class)
  }

  const cancelEdit = () => { setEditTicker(null) }

  const saveEdit = async () => {
    if (!editTicker) return
    setSaving(true); setErr('')
    try {
      const updated = await sipApi.updateETF(editTicker, { etf_name: editName, asset_class: editClass })
      setEtfs(prev => prev.map(e => e.ticker === editTicker ? updated : e))
      setEditTicker(null)
    } catch {
      setErr('Save failed')
    } finally { setSaving(false) }
  }

  const handleDelete = async (ticker: string) => {
    if (!window.confirm(`Delete ${ticker}? This cannot be undone.`)) return
    setErr('')
    try {
      await sipApi.deleteETF(ticker)
      setEtfs(prev => prev.filter(e => e.ticker !== ticker))
    } catch {
      setErr('Delete failed')
    }
  }

  const handleAdd = async () => {
    if (!newTicker.trim() || !newName.trim() || !newClass.trim()) {
      setErr('All fields required'); return
    }
    setAdding(true); setErr('')
    try {
      const created = await sipApi.createETF({ ticker: newTicker.toUpperCase(), etf_name: newName, asset_class: newClass })
      setEtfs(prev => [...prev, created].sort((a, b) => a.etf_name.localeCompare(b.etf_name)))
      setNewTicker(''); setNewName(''); setNewClass('Equity'); setShowAdd(false)
    } catch {
      setErr('Failed to add ETF')
    } finally { setAdding(false) }
  }

  const CELL = 'px-3 py-2.5 text-sm'
  const INPUT_SM = 'bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-400 w-full'

  return (
    <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1e2330] flex items-center justify-between">
        <div>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">ETF Master</span>
          <span className="ml-2 text-[10px] text-gray-600">{etfs.length} entries</span>
        </div>
        <button
          onClick={() => { setShowAdd(v => !v); setErr('') }}
          className="flex items-center gap-1.5 text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-400/20 rounded px-2.5 py-1.5 transition-colors"
        >
          <Plus size={12} /> Add ETF
        </button>
      </div>

      {err && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-400/5 border-b border-[#1e2330]">{err}</div>
      )}

      {/* Add row */}
      {showAdd && (
        <div className="px-4 py-3 bg-gray-800/50 border-b border-[#1e2330] grid grid-cols-[1fr_2fr_1fr_auto] gap-2 items-end">
          <div>
            <div className="text-[10px] text-gray-500 mb-1">Ticker</div>
            <input className={`${INPUT_SM} uppercase`} placeholder="GOLDBEES" value={newTicker}
              onChange={e => setNewTicker(e.target.value.toUpperCase())} />
          </div>
          <div>
            <div className="text-[10px] text-gray-500 mb-1">ETF Name</div>
            <input className={INPUT_SM} placeholder="Gold BEES" value={newName}
              onChange={e => setNewName(e.target.value)} />
          </div>
          <div>
            <div className="text-[10px] text-gray-500 mb-1">Asset Class</div>
            <select className={INPUT_SM} value={newClass} onChange={e => setNewClass(e.target.value)}>
              <option>Equity</option><option>Debt</option><option>International</option>
            </select>
          </div>
          <div className="flex gap-1.5 pb-0.5">
            <button onClick={handleAdd} disabled={adding}
              className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded p-1.5 disabled:opacity-50 transition-colors">
              <Check size={13} />
            </button>
            <button onClick={() => { setShowAdd(false); setErr('') }}
              className="bg-gray-700 hover:bg-gray-600 text-gray-400 rounded p-1.5 transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="py-10 text-center text-gray-600 text-sm animate-pulse">Loading...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-[#1e2330] text-[10px] text-gray-500 uppercase tracking-widest">
                <th className="text-left px-3 py-3">Ticker</th>
                <th className="text-left px-3 py-3">ETF Name</th>
                <th className="text-left px-3 py-3">Asset Class</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {etfs.map(etf => (
                <tr key={etf.ticker} className="border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                  <td className={`${CELL} text-blue-400 font-semibold`}>{etf.ticker}</td>
                  <td className={CELL}>
                    {editTicker === etf.ticker ? (
                      <input className={INPUT_SM} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                    ) : (
                      <span className="text-gray-200">{etf.etf_name}</span>
                    )}
                  </td>
                  <td className={CELL}>
                    {editTicker === etf.ticker ? (
                      <select className={INPUT_SM} value={editClass} onChange={e => setEditClass(e.target.value)}>
                        <option>Equity</option><option>Debt</option><option>International</option>
                      </select>
                    ) : (
                      <span className="text-gray-400">{etf.asset_class}</span>
                    )}
                  </td>
                  <td className={`${CELL} text-right`}>
                    {editTicker === etf.ticker ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={saveEdit} disabled={saving}
                          className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded p-1.5 disabled:opacity-50 transition-colors">
                          <Check size={12} />
                        </button>
                        <button onClick={cancelEdit}
                          className="bg-gray-700 hover:bg-gray-600 text-gray-400 rounded p-1.5 transition-colors">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => startEdit(etf)}
                          className="text-gray-500 hover:text-blue-400 transition-colors p-1">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => handleDelete(etf.ticker)}
                          className="text-gray-500 hover:text-red-400 transition-colors p-1">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('users')

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
      setSelectedUser(null); setPortfolios([]); setSelectedPortfolio(null); setTrades([])
      return
    }
    setSelectedUser(user); setSelectedPortfolio(null); setTrades([])
    setLoadingPortfolios(true)
    try { setPortfolios(await adminApi.getUserPortfolios(user.id)) }
    finally { setLoadingPortfolios(false) }
  }

  const handleSelectPortfolio = async (portfolio: Portfolio) => {
    setSelectedPortfolio(portfolio); setLoadingTrades(true)
    try { setTrades(await adminApi.getPortfolioTrades(portfolio.id)) }
    finally { setLoadingTrades(false) }
  }

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  const TAB_BASE = 'px-4 py-2 text-xs font-semibold uppercase tracking-widest border-b-2 transition-colors'
  const TAB_ACTIVE = 'border-blue-400 text-blue-400'
  const TAB_INACTIVE = 'border-transparent text-gray-500 hover:text-gray-300'

  return (
    <div className="p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100">Admin Panel</h1>
          <p className="text-xs text-gray-500 mt-0.5">{users.length} registered users</p>
        </div>
        {tab === 'users' && (
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search users..."
            className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 w-56 placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
          />
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1e2330] gap-0">
        <button className={`${TAB_BASE} ${tab === 'users'  ? TAB_ACTIVE : TAB_INACTIVE}`} onClick={() => setTab('users')}>
          Users
        </button>
        <button className={`${TAB_BASE} ${tab === 'config' ? TAB_ACTIVE : TAB_INACTIVE}`} onClick={() => setTab('config')}>
          Configuration
        </button>
      </div>

      {/* ── Users Tab ──────────────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Users column */}
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-[#1e2330] text-[10px] text-gray-500 uppercase tracking-widest">Users</div>
              <div className="overflow-y-auto max-h-96 divide-y divide-[#1e2330]">
                {loading ? (
                  <div className="px-4 py-8 text-center text-gray-600 text-sm animate-pulse">Loading...</div>
                ) : filtered.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-600 text-sm">No users found</div>
                ) : filtered.map(u => (
                  <button key={u.id} onClick={() => handleSelectUser(u)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedUser?.id === u.id ? 'bg-blue-400/10 border-l-2 border-l-blue-400' : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-200 font-semibold truncate">{u.full_name}</span>
                      {u.role === 'ADMIN' && (
                        <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded tracking-wider flex-shrink-0">ADMIN</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{u.email}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5">Joined {u.created_at}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Portfolios column */}
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
                ) : portfolios.map(p => (
                  <button key={p.id} onClick={() => handleSelectPortfolio(p)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedPortfolio?.id === p.id ? 'bg-blue-400/10 border-l-2 border-l-blue-400' : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                    }`}>
                    <div className="text-sm text-gray-200 font-semibold">{p.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded">{p.type}</span>
                      <span className="text-[10px] text-gray-500">{p.currency}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Capital: {formatCurrency(p.starting_capital)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Trade summary column */}
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-[#1e2330] flex items-center justify-between">
                <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                  Trades {selectedPortfolio ? `— ${selectedPortfolio.name}` : ''}
                </span>
                {trades.length > 0 && <span className="text-[10px] text-gray-600">{trades.length} total</span>}
              </div>
              <div className="overflow-y-auto max-h-96 divide-y divide-[#1e2330]">
                {!selectedPortfolio ? (
                  <div className="px-4 py-8 text-center text-gray-600 text-sm">Select a portfolio</div>
                ) : loadingTrades ? (
                  <div className="px-4 py-8 text-center text-gray-600 text-sm animate-pulse">Loading...</div>
                ) : trades.length === 0 ? (
                  <div className="px-4 py-8 text-center text-gray-600 text-sm">No trades yet</div>
                ) : trades.map(t => (
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
                      <span className={`text-[10px] ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{t.direction}</span>
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
                {trades.length > 0 && <span className="text-[10px] text-gray-600">{trades.length} trades</span>}
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
                        {['Scrip','Seg','Dir','Entry Date','Entry ₹','Qty','Close Date','Close ₹','Gross P&L','Charges','Net ₹','R:R','Status'].map(h => (
                          <th key={h} className="text-left text-[10px] text-gray-600 uppercase tracking-widest px-3 py-3 whitespace-nowrap bg-gray-900">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map(t => (
                        <tr key={t.id} className="border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                          <td className="px-3 py-2 font-semibold text-gray-200 whitespace-nowrap">{t.scrip_name}</td>
                          <td className="px-3 py-2 text-gray-400">{SEG_LABEL[t.segment] ?? t.segment}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${t.direction === 'LONG' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'}`}>
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
                          <td className="px-3 py-2 text-gray-400">{t.risk_reward ? `${parseFloat(String(t.risk_reward)).toFixed(2)}x` : '—'}</td>
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
        </>
      )}

      {/* ── Configuration Tab ──────────────────────────────────────────────────── */}
      {tab === 'config' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">Manage static reference data used across the app.</p>
          <ETFMasterConfig />
        </div>
      )}

    </div>
  )
}
