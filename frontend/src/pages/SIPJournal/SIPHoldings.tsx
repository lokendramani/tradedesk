import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, TrendingUp, TrendingDown, X, MinusCircle } from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { sipApi } from '../../api/sip'
import type { SIPHolding, SIPHoldingsResponse } from '../../types'

// ─── Sell Modal ───────────────────────────────────────────────────────────────
const INPUT = 'w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-neutral-primary focus:outline-none focus:border-brand'

function SellModal({ holding, onClose, onDone }: {
  holding: SIPHolding
  onClose: () => void
  onDone: () => void
}) {
  const [qty, setQty]           = useState('')
  const [exitDate, setExitDate] = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')
  const [result, setResult]     = useState<{ message: string; trades_closed: number; splits_created: number } | null>(null)

  const maxQty = holding.qty

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const qtyNum = parseFloat(qty)
    if (qtyNum <= 0 || qtyNum > maxQty) {
      setErr(`Qty must be between 0.0001 and ${maxQty}`)
      return
    }
    setSaving(true); setErr('')
    try {
      const r = await sipApi.sell(holding.ticker, qtyNum, exitDate, parseFloat(exitPrice))
      setResult(r)
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setErr(ax.response?.data?.error ?? 'Sell failed')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-surface-border rounded-xl shadow-lg w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div>
            <h2 className="font-display font-semibold text-neutral-primary">Sell — {holding.ticker}</h2>
            <p className="text-xs text-neutral-muted mt-0.5">{holding.etf_name}</p>
          </div>
          <button onClick={onClose} className="text-neutral-muted hover:text-neutral-primary"><X size={18} /></button>
        </div>

        {result ? (
          <div className="p-5 space-y-4">
            <div className="bg-profit-bg border border-profit-border rounded-lg p-4 text-sm">
              <div className="font-semibold text-profit-text mb-1">Sell recorded</div>
              <div className="text-neutral-muted text-xs space-y-0.5">
                <div>{result.message}</div>
                <div>{result.trades_closed} trade{result.trades_closed !== 1 ? 's' : ''} closed
                  {result.splits_created > 0 && ` · ${result.splits_created} trade split (partial)`}
                </div>
              </div>
            </div>
            <button onClick={() => { onDone(); onClose() }}
              className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="p-5 space-y-3">
            {/* Available qty indicator */}
            <div className="bg-surface-page border border-surface-border rounded-lg px-4 py-2.5 flex items-center justify-between text-xs">
              <span className="text-neutral-muted">Available qty</span>
              <span className="font-mono font-semibold text-neutral-primary">{maxQty} units</span>
            </div>

            {err && (
              <div className="bg-loss-bg border border-loss-border text-loss-text text-xs rounded-lg px-3 py-2">{err}</div>
            )}

            <div>
              <label className="block text-xs text-neutral-muted mb-1">Sell Qty</label>
              <input
                type="number" step="0.0001" max={maxQty} min="0.0001"
                className={INPUT} value={qty}
                onChange={e => setQty(e.target.value)} required
                placeholder={`Max ${maxQty}`}
              />
              {qty && parseFloat(qty) < maxQty && (
                <p className="text-[11px] text-neutral-muted mt-1">
                  Partial sell — {(maxQty - parseFloat(qty)).toFixed(4)} units will remain open
                </p>
              )}
              {qty && parseFloat(qty) === maxQty && (
                <p className="text-[11px] text-profit-text mt-1">Full exit — all units will be closed</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-neutral-muted mb-1">Exit Date</label>
              <input type="date" className={INPUT} value={exitDate} onChange={e => setExitDate(e.target.value)} required />
            </div>

            <div>
              <label className="block text-xs text-neutral-muted mb-1">Exit Price ₹</label>
              <input type="number" step="0.01" className={INPUT} value={exitPrice} onChange={e => setExitPrice(e.target.value)} required />
            </div>

            {exitPrice && qty && (
              <div className="bg-surface-page rounded-lg px-4 py-2.5 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-neutral-muted">Exit Value</span>
                  <span className="font-mono font-medium text-neutral-primary">
                    ₹{(parseFloat(qty) * parseFloat(exitPrice)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}

            <button type="submit" disabled={saving}
              className="w-full bg-loss-text hover:opacity-90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
              {saving ? 'Processing...' : 'Confirm Sell (FIFO)'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const PIE_COLORS = [
  '#4C6FFF', '#2ECC91', '#F39C12', '#9B59B6', '#E74C3C',
  '#1ABC9C', '#3498DB', '#E67E22', '#FF6B6B', '#8A93A6',
]

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

// ─── Summary Card ─────────────────────────────────────────────────────────────
function SCard({
  label, value, sub, variant = 'default',
}: {
  label: string
  value: string
  sub?: string
  variant?: 'default' | 'profit' | 'loss'
}) {
  const styles = {
    default: 'bg-white border-surface-border text-neutral-primary',
    profit:  'bg-profit-bg border-profit-border text-profit-text',
    loss:    'bg-loss-bg border-loss-border text-loss-text',
  }
  return (
    <div className={`border rounded-xl px-5 py-4 ${styles[variant]}`}>
      <div className="text-xs text-neutral-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono text-xl font-bold ${styles[variant]}`}>{value}</div>
      {sub && <div className="text-xs text-neutral-muted mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Custom Pie tooltip ───────────────────────────────────────────────────────
function PieTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { pct: number } }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-white border border-surface-border rounded-lg px-3 py-2 shadow-md text-xs">
      <div className="font-semibold text-neutral-primary mb-0.5">{d.name}</div>
      <div className="text-neutral-muted">{fmt(d.value)}</div>
      <div className="text-brand font-medium">{d.payload.pct.toFixed(1)}%</div>
    </div>
  )
}

// ─── Pie Chart wrapper ────────────────────────────────────────────────────────
function AllocationPie({
  title, data, colorMap,
}: {
  title: string
  data: { name: string; value: number; pct: number }[]
  colorMap: Record<string, string>
}) {
  return (
    <div className="bg-white border border-surface-border rounded-xl p-5 flex-1 min-w-0">
      <h3 className="font-display font-semibold text-neutral-primary text-sm mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            outerRadius={90}
            innerRadius={48}
            paddingAngle={2}
          >
            {data.map((entry) => (
              <Cell key={entry.name} fill={colorMap[entry.name] ?? '#8A93A6'} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(v) => <span className="text-xs text-neutral-muted">{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SIPHoldings() {
  const [data, setData]             = useState<SIPHoldingsResponse | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState('')
  const [selling, setSelling]       = useState<SIPHolding | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await sipApi.getHoldings()) }
    catch { setError('Failed to load holdings') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleRefresh = async () => {
    setRefreshing(true)
    try { await sipApi.refreshPrices(); await load() }
    catch { setError('Price refresh failed') }
    finally { setRefreshing(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <RefreshCw size={22} className="animate-spin text-brand" />
    </div>
  )

  if (error) return (
    <div className="p-6">
      <div className="bg-loss-bg border border-loss-border text-loss-text rounded-lg px-4 py-3 text-sm flex items-center gap-2">
        <AlertTriangle size={15} /> {error}
      </div>
    </div>
  )

  const holdings = data?.holdings ?? []

  if (holdings.length === 0) return (
    <div className="p-6">
      <div className="bg-white border border-surface-border rounded-xl p-12 text-center">
        <TrendingUp size={36} className="mx-auto text-neutral-muted mb-3" />
        <h3 className="font-display font-semibold text-neutral-primary mb-1">No active holdings</h3>
        <p className="text-sm text-neutral-muted">All positions have been exited, or no trades imported yet.</p>
      </div>
    </div>
  )

  // Assign colors per ticker (consistent across both charts)
  const colorMap: Record<string, string> = {}
  holdings.forEach((h, i) => { colorMap[h.ticker] = PIE_COLORS[i % PIE_COLORS.length] })

  // Pie data
  const investedPie = holdings.map(h => ({
    name: h.ticker, value: h.invested,
    pct: data!.total_invested ? (h.invested / data!.total_invested) * 100 : 0,
  }))

  const hasCurrentValues = holdings.every(h => h.current_value != null)
  const totalCurrent = data?.total_current ?? holdings.reduce((s, h) => s + (h.current_value ?? 0), 0)
  const currentPie = hasCurrentValues
    ? holdings.map(h => ({
        name: h.ticker, value: h.current_value!,
        pct: totalCurrent ? (h.current_value! / totalCurrent) * 100 : 0,
      }))
    : []

  const totalPL    = holdings.reduce((s, h) => s + (h.pl ?? 0), 0)
  const totalInv   = data?.total_invested ?? 0
  const totalRetPct = totalInv ? (totalPL / totalInv) * 100 : null

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-neutral-primary">Active Holdings</h1>
          <p className="text-xs text-neutral-muted mt-0.5">{holdings.length} ETFs · open positions only</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 bg-white border border-surface-border text-neutral-primary hover:bg-surface-page rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh Prices'}
        </button>
      </div>

      {/* Stale price notice */}
      {data?.has_stale_prices && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs rounded-lg px-4 py-2.5 flex items-center gap-2">
          <AlertTriangle size={13} />
          Prices are from your last CSV import. Click "Refresh Prices" to fetch live data from NSE.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <SCard label="Fresh Cash Invested" value={fmt(data?.fresh_invested ?? null)} />
        <SCard label="Total Invested" value={fmt(totalInv)} />
        <SCard
          label="Current Value"
          value={fmt(totalCurrent)}
          variant={totalCurrent > totalInv ? 'profit' : totalCurrent < totalInv ? 'loss' : 'default'}
        />
        <SCard
          label="Unrealised P&L"
          value={fmt(totalPL)}
          variant={totalPL > 0 ? 'profit' : totalPL < 0 ? 'loss' : 'default'}
        />
        <SCard
          label="Avg Return"
          value={fmtPct(totalRetPct)}
          variant={totalRetPct != null && totalRetPct > 0 ? 'profit' : totalRetPct != null && totalRetPct < 0 ? 'loss' : 'default'}
        />
      </div>

      {/* Pie Charts */}
      <div className="flex flex-col md:flex-row gap-4">
        <AllocationPie
          title="Allocation by Invested Value"
          data={investedPie}
          colorMap={colorMap}
        />
        {currentPie.length > 0 ? (
          <AllocationPie
            title="Allocation by Current Value (CMP)"
            data={currentPie}
            colorMap={colorMap}
          />
        ) : (
          <div className="bg-white border border-surface-border rounded-xl p-5 flex-1 flex items-center justify-center text-center">
            <div>
              <RefreshCw size={28} className="mx-auto text-neutral-muted mb-2" />
              <p className="text-sm font-medium text-neutral-primary">CMP not available</p>
              <p className="text-xs text-neutral-muted mt-1">Refresh prices to see<br />current allocation</p>
            </div>
          </div>
        )}
      </div>

      {/* Holdings Table */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-surface-border">
          <h2 className="font-display font-semibold text-neutral-primary text-sm">Position Detail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-page border-b border-surface-border text-[11px] text-neutral-muted uppercase tracking-wider">
                <th className="text-left px-4 py-3">ETF</th>
                <th className="text-left px-4 py-3">Class</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Avg Buy</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Invested</th>
                <th className="text-right px-4 py-3">CMP</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Curr. Value</th>
                <th className="text-right px-4 py-3">P&amp;L</th>
                <th className="text-right px-4 py-3">Return</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Alloc %</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const profit  = (h.pl ?? 0) > 0
                const loss    = (h.pl ?? 0) < 0
                const allocPct = totalInv ? ((h.invested / totalInv) * 100).toFixed(1) : '—'
                const color   = colorMap[h.ticker]
                return (
                  <tr key={h.ticker} className="border-b border-surface-border last:border-0 hover:bg-surface-page/60 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                        <div>
                          <div className="font-mono text-xs font-semibold text-neutral-primary">{h.ticker}</div>
                          <div className="text-[11px] text-neutral-muted truncate max-w-[140px]">{h.etf_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <AssetBadge cls={h.asset_class} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{h.qty}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{fmt(h.avg_price)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-medium text-neutral-primary">{fmt(h.invested)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">
                      {h.cmp != null ? (
                        <span className={h.price_stale ? 'text-neutral-muted' : ''}>
                          {fmt(h.cmp)}
                          {h.price_stale && <span className="ml-1 text-[10px] text-yellow-600">~</span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-medium text-neutral-primary">
                      {fmt(h.current_value)}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${profit ? 'text-profit-text' : loss ? 'text-loss-text' : 'text-neutral-muted'}`}>
                      {h.pl != null ? (profit ? '+' : '') + fmt(h.pl) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${profit ? 'text-profit-text' : loss ? 'text-loss-text' : 'text-neutral-muted'}`}>
                      {h.pl_pct != null ? (
                        <span className="flex items-center justify-end gap-0.5">
                          {profit ? <TrendingUp size={11} /> : loss ? <TrendingDown size={11} /> : null}
                          {fmtPct(h.pl_pct)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-16 bg-surface-page rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(parseFloat(allocPct as string), 100)}%`, background: color }}
                          />
                        </div>
                        <span className="font-mono text-xs text-neutral-muted w-8 text-right">{allocPct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelling(h)}
                        className="flex items-center gap-1 text-[11px] font-medium text-loss-text hover:bg-loss-bg border border-loss-border rounded-md px-2 py-1 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MinusCircle size={11} /> Sell
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="bg-surface-page border-t border-surface-border font-semibold">
                <td colSpan={4} className="px-4 py-3 text-xs text-neutral-muted">Total ({holdings.length} ETFs)</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{fmt(totalInv)}</td>
                <td />
                <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{fmt(totalCurrent)}</td>
                <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${totalPL > 0 ? 'text-profit-text' : totalPL < 0 ? 'text-loss-text' : 'text-neutral-muted'}`}>
                  {(totalPL > 0 ? '+' : '') + fmt(totalPL)}
                </td>
                <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${totalRetPct != null && totalRetPct > 0 ? 'text-profit-text' : totalRetPct != null && totalRetPct < 0 ? 'text-loss-text' : 'text-neutral-muted'}`}>
                  {fmtPct(totalRetPct)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {selling && (
        <SellModal
          holding={selling}
          onClose={() => setSelling(null)}
          onDone={load}
        />
      )}
    </div>
  )
}

const ASSET_COLORS: Record<string, string> = {
  Equity:        'bg-brand/10 text-brand',
  Debt:          'bg-yellow-50 text-yellow-700',
  Gold:          'bg-yellow-50 text-yellow-700',
  International: 'bg-purple-50 text-purple-700',
}
function AssetBadge({ cls }: { cls: string }) {
  const color = ASSET_COLORS[cls] ?? 'bg-surface-page text-neutral-muted border border-surface-border'
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>{cls}</span>
}
