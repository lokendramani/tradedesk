import { useEffect, useRef, useState } from 'react'
import { mfApi, type MFDashboard, type MFScheme, type MFTransaction, type ImportResult } from '../../api/mf'
import { formatCurrency } from '../../utils/format'

const TXN_TYPES = ['SIP', 'PURCHASE', 'SWITCH_IN', 'SWITCH_OUT', 'REDEMPTION', 'DIVIDEND', 'BONUS', 'OTHER']
const TXN_LABELS: Record<string, string> = {
  SIP: 'SIP', PURCHASE: 'Purchase', SWITCH_IN: 'Switch In',
  SWITCH_OUT: 'Switch Out', REDEMPTION: 'Redemption',
  DIVIDEND: 'Dividend', BONUS: 'Bonus', OTHER: 'Other',
}

function GainBadge({ value, pct }: { value: string; pct?: number }) {
  const v = parseFloat(value)
  const pos = v >= 0
  return (
    <span className={`font-mono font-semibold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
      {pos ? '+' : ''}{formatCurrency(v)}
      {pct !== undefined && (
        <span className="text-xs ml-1 opacity-75">({pos ? '+' : ''}{pct.toFixed(2)}%)</span>
      )}
    </span>
  )
}

// ── Upload modal ───────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase,  setPhase]  = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error,  setError]  = useState('')

  const handleFile = async (f: File | null) => {
    if (!f) return
    setPhase('uploading')
    try {
      const r = await mfApi.importCAS(f)
      setResult(r)
      setPhase('done')
      onDone()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } }
      setError(ax.response?.data?.message ?? 'Import failed')
      setPhase('error')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-[#1e2330] rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2330]">
          <h2 className="text-base font-semibold text-gray-100">Import CAS Statement</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">

          {phase === 'idle' && (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-700 hover:border-blue-500/50 rounded-lg p-10 text-center cursor-pointer transition-colors"
              >
                <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
                <div className="text-4xl mb-3">📄</div>
                <div className="text-sm text-gray-400">Click to select your CAS PDF</div>
                <div className="text-xs text-gray-600 mt-1">Works with CAMS and KFintech statements</div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-blue-400">
                Your CAS PDF is processed locally on the server and not shared anywhere.
              </div>
            </>
          )}

          {phase === 'uploading' && (
            <div className="py-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-sm text-gray-300">Parsing statement and loading data…</div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="space-y-4">
              <div className="bg-blue-400/10 border border-blue-400/20 rounded-lg px-4 py-3">
                <div className="text-sm text-blue-400 font-semibold mb-1">Import successful</div>
                {result.investor?.name && (
                  <div className="text-xs text-gray-400">Investor: {result.investor.name}</div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Folios',       value: result.folios   },
                  { label: 'Schemes',      value: result.schemes  },
                  { label: 'Transactions', value: result.imported },
                ].map((s) => (
                  <div key={s.label} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-blue-400 font-mono">{s.value}</div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <button onClick={onClose}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors">
                  Done
                </button>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
                {error}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setPhase('idle')}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
                  Try Again
                </button>
                <button onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
                  Close
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function MFDashboard() {
  const [dashboard,  setDashboard]  = useState<MFDashboard | null>(null)
  const [schemes,    setSchemes]    = useState<MFScheme[]>([])
  const [txns,       setTxns]       = useState<MFTransaction[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab,  setActiveTab]  = useState<'schemes' | 'transactions'>('schemes')

  // Filters
  const [filterFH,   setFilterFH]   = useState('')
  const [filterType, setFilterType] = useState('')
  const [schemeSearch, setSchemeSearch] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [dash, scm] = await Promise.all([
        mfApi.getDashboard(),
        mfApi.getSchemes(),
      ])
      setDashboard(dash)
      setSchemes(scm)
    } catch { /* no data yet */ }
    setLoading(false)
  }

  const loadTxns = async () => {
    const params: Record<string, string> = {}
    if (filterFH)   params.fund_house = filterFH
    if (filterType) params.txn_type   = filterType
    const data = await mfApi.getTransactions(params).catch(() => [])
    setTxns(data)
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (activeTab === 'transactions') loadTxns() }, [activeTab, filterFH, filterType])

  const hasData = dashboard && (dashboard.total_schemes > 0)

  const filteredSchemes = schemes.filter((s) => {
    if (filterFH && !s.fund_house.toLowerCase().includes(filterFH.toLowerCase())) return false
    if (schemeSearch && !s.scheme_name.toLowerCase().includes(schemeSearch.toLowerCase())) return false
    return true
  })

  const fundHouses = [...new Set(schemes.map((s) => s.fund_house))].sort()

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-100">MF Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">Consolidated Account Statement</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors"
        >
          + Import CAS PDF
        </button>
      </div>

      {/* No data state */}
      {!loading && !hasData && (
        <div className="bg-gray-900 border border-[#1e2330] rounded-xl p-12 text-center">
          <div className="text-4xl mb-4">📊</div>
          <div className="text-gray-400 text-sm mb-2">No MF data imported yet</div>
          <div className="text-gray-600 text-xs mb-6">
            Click "Import CAS PDF" to load your Consolidated Account Statement from CAMS or KFintech
          </div>
          <button
            onClick={() => setShowUpload(true)}
            className="px-6 py-2.5 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
          >
            Import CAS PDF
          </button>
        </div>
      )}

      {/* Summary cards */}
      {hasData && dashboard && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Total Invested</div>
              <div className="text-xl font-bold font-mono text-gray-100">{formatCurrency(dashboard.total_cost_value)}</div>
            </div>
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Current Value</div>
              <div className="text-xl font-bold font-mono text-gray-100">{formatCurrency(dashboard.total_market_value)}</div>
            </div>
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Gain / Loss</div>
              <GainBadge value={dashboard.total_gain_loss} pct={dashboard.gain_loss_pct} />
            </div>
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Folios / Schemes</div>
              <div className="text-xl font-bold font-mono text-gray-100">
                {dashboard.total_folios} <span className="text-gray-500 text-sm">/ {dashboard.total_schemes}</span>
              </div>
            </div>
          </div>

          {/* Fund house breakdown */}
          <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-[#1e2330] text-[10px] text-gray-500 uppercase tracking-widest">
              Fund House Breakdown
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-[#1e2330] text-[10px] text-gray-600 uppercase">
                    {['Fund House', 'Schemes', 'Invested', 'Current Value', 'Gain / Loss'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dashboard.fund_houses.map((fh) => (
                    <tr key={fh.fund_house} className="border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-semibold">{fh.fund_house}</td>
                      <td className="px-4 py-3 text-gray-400">{fh.schemes}</td>
                      <td className="px-4 py-3 text-gray-300">{formatCurrency(fh.cost_value)}</td>
                      <td className="px-4 py-3 text-gray-300">{formatCurrency(fh.market_value)}</td>
                      <td className="px-4 py-3"><GainBadge value={fh.gain_loss} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-gray-900 border border-[#1e2330] rounded-lg p-1 w-fit">
            {(['schemes', 'transactions'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded text-xs font-mono capitalize transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterFH}
              onChange={(e) => setFilterFH(e.target.value)}
              className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-blue-500"
            >
              <option value="">All Fund Houses</option>
              {fundHouses.map((fh) => <option key={fh} value={fh}>{fh}</option>)}
            </select>

            {activeTab === 'schemes' && (
              <input
                type="text" value={schemeSearch}
                onChange={(e) => setSchemeSearch(e.target.value)}
                placeholder="Search scheme…"
                className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 w-52
                           placeholder-gray-600 focus:outline-none focus:border-blue-500"
              />
            )}

            {activeTab === 'transactions' && (
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-blue-500"
              >
                <option value="">All Types</option>
                {TXN_TYPES.map((t) => <option key={t} value={t}>{TXN_LABELS[t]}</option>)}
              </select>
            )}

            {loading && <span className="text-xs text-gray-600 animate-pulse">Loading…</span>}
          </div>

          {/* Schemes table */}
          {activeTab === 'schemes' && (
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-480px)]">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 z-10 bg-gray-900">
                    <tr className="border-b border-[#1e2330]">
                      {['Scheme', 'Folio', 'Plan', 'Units', 'NAV', 'Invested', 'Current', 'Gain/Loss'].map((h) => (
                        <th key={h} className="text-left text-[10px] text-gray-600 uppercase tracking-widest px-3 py-3 whitespace-nowrap bg-gray-900">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSchemes.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center text-gray-600 py-10">No schemes found</td>
                      </tr>
                    ) : filteredSchemes.map((s) => (
                      <tr key={s.id} className="border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-3 py-3 max-w-xs">
                          <div className="text-gray-200 font-semibold truncate" title={s.scheme_name}>{s.scheme_name}</div>
                          <div className="text-[10px] text-gray-600 mt-0.5">{s.fund_house}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{s.folio_number}</td>
                        <td className="px-3 py-3">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            s.plan === 'DIRECT'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-gray-800 text-gray-500'
                          }`}>
                            {s.plan}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-gray-300">{parseFloat(s.closing_units || '0').toFixed(3)}</td>
                        <td className="px-3 py-3 text-gray-400">{s.closing_nav ? `₹${parseFloat(s.closing_nav).toFixed(2)}` : '—'}</td>
                        <td className="px-3 py-3 text-gray-300">{formatCurrency(s.cost_value)}</td>
                        <td className="px-3 py-3 text-gray-300">{formatCurrency(s.market_value)}</td>
                        <td className="px-3 py-3"><GainBadge value={s.gain_loss} pct={s.gain_loss_pct} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Transactions table */}
          {activeTab === 'transactions' && (
            <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden">
              <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-480px)]">
                <table className="w-full text-xs font-mono">
                  <thead className="sticky top-0 z-10 bg-gray-900">
                    <tr className="border-b border-[#1e2330]">
                      {['Date', 'Type', 'Scheme', 'Folio', 'Amount', 'Units', 'NAV', 'Balance'].map((h) => (
                        <th key={h} className="text-left text-[10px] text-gray-600 uppercase tracking-widest px-3 py-3 whitespace-nowrap bg-gray-900">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txns.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center text-gray-600 py-10">
                          No transactions — select the Transactions tab or adjust filters
                        </td>
                      </tr>
                    ) : txns.map((t) => {
                      const amt = parseFloat(t.amount)
                      return (
                        <tr key={t.id} className="border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{t.transaction_date}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                              ['SIP', 'PURCHASE', 'SWITCH_IN'].includes(t.transaction_type)
                                ? 'bg-emerald-400/10 text-emerald-400'
                                : ['REDEMPTION', 'SWITCH_OUT'].includes(t.transaction_type)
                                  ? 'bg-red-400/10 text-red-400'
                                  : 'bg-gray-800 text-gray-400'
                            }`}>
                              {TXN_LABELS[t.transaction_type] ?? t.transaction_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 max-w-xs">
                            <div className="text-gray-200 truncate" title={t.scheme_name}>{t.scheme_name}</div>
                            <div className="text-[10px] text-gray-600">{t.fund_house}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-500">{t.folio_number}</td>
                          <td className={`px-3 py-2 font-semibold ${amt >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {amt >= 0 ? '' : '−'}₹{Math.abs(amt).toLocaleString('en-IN')}
                          </td>
                          <td className="px-3 py-2 text-gray-400">{parseFloat(t.units).toFixed(3)}</td>
                          <td className="px-3 py-2 text-gray-400">₹{parseFloat(t.nav).toFixed(4)}</td>
                          <td className="px-3 py-2 text-gray-400">{parseFloat(t.unit_balance).toFixed(3)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); load() }}
        />
      )}
    </div>
  )
}
