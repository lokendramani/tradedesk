import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react'
import { sipApi } from '../../api/sip'
import type { SIPBookedPLResponse, SIPBookedSummary, SIPBookedTrade } from '../../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: number | null | undefined) =>
  v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

const plClass = (v: number | null | undefined) =>
  v == null ? 'text-neutral-muted'
  : v > 0   ? 'text-profit-text'
  :            'text-loss-text'

// ─── Summary Card ─────────────────────────────────────────────────────────────
function SCard({ label, value, variant = 'default' }: {
  label: string; value: string; variant?: 'default' | 'profit' | 'loss'
}) {
  const s = {
    default: 'bg-white border-surface-border text-neutral-primary',
    profit:  'bg-profit-bg border-profit-border text-profit-text',
    loss:    'bg-loss-bg border-loss-border text-loss-text',
  }[variant]
  return (
    <div className={`border rounded-xl px-5 py-4 ${s}`}>
      <div className="text-xs text-neutral-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono text-xl font-bold`}>{value}</div>
    </div>
  )
}

function AssetBadge({ cls }: { cls: string }) {
  const c: Record<string, string> = {
    Equity: 'bg-brand/10 text-brand',
    Debt:   'bg-yellow-50 text-yellow-700',
    Gold:   'bg-yellow-50 text-yellow-700',
    International: 'bg-purple-50 text-purple-700',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c[cls] ?? 'bg-surface-page text-neutral-muted border border-surface-border'}`}>
      {cls}
    </span>
  )
}

// ─── ETF Summary Table ────────────────────────────────────────────────────────
function SummaryTable({ rows, totals }: {
  rows: SIPBookedSummary[]
  totals: { invested: number; exit_value: number; pl: number; ret_pct: number }
}) {
  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-surface-border">
        <h2 className="font-display font-semibold text-neutral-primary text-sm">ETF-wise Summary</h2>
        <p className="text-xs text-neutral-muted mt-0.5">Grouped by ticker — all exited positions</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-page border-b border-surface-border text-[11px] text-neutral-muted uppercase tracking-wider">
              <th className="text-left px-4 py-3">Ticker / ETF</th>
              <th className="text-left px-4 py-3">Class</th>
              <th className="text-right px-4 py-3">Trades</th>
              <th className="text-right px-4 py-3 whitespace-nowrap">Total Qty</th>
              <th className="text-right px-4 py-3 whitespace-nowrap">Amt Invested</th>
              <th className="text-right px-4 py-3 whitespace-nowrap">Exit Value</th>
              <th className="text-right px-4 py-3 whitespace-nowrap">Booked P&amp;L</th>
              <th className="text-right px-4 py-3">Return</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ticker} className="border-b border-surface-border last:border-0 hover:bg-surface-page/60 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-semibold text-neutral-primary">{r.ticker}</div>
                  <div className="text-[11px] text-neutral-muted truncate max-w-[160px]">{r.etf_name}</div>
                </td>
                <td className="px-4 py-3"><AssetBadge cls={r.asset_class} /></td>
                <td className="px-4 py-3 text-right font-mono text-xs text-neutral-muted">{r.trade_count}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{r.total_qty}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{fmt(r.total_invested)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-neutral-primary">{fmt(r.total_exit_value)}</td>
                <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${plClass(r.booked_pl)}`}>
                  {r.booked_pl > 0 ? '+' : ''}{fmt(r.booked_pl)}
                </td>
                <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${plClass(r.return_pct)}`}>
                  <span className="flex items-center justify-end gap-0.5">
                    {r.return_pct > 0 ? <TrendingUp size={11} /> : r.return_pct < 0 ? <TrendingDown size={11} /> : null}
                    {fmtPct(r.return_pct)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-page border-t border-surface-border">
              <td colSpan={4} className="px-4 py-3 text-xs font-semibold text-neutral-muted">
                Total ({rows.length} ETFs · {rows.reduce((s, r) => s + r.trade_count, 0)} trades)
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs font-bold text-neutral-primary">{fmt(totals.invested)}</td>
              <td className="px-4 py-3 text-right font-mono text-xs font-bold text-neutral-primary">{fmt(totals.exit_value)}</td>
              <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${plClass(totals.pl)}`}>
                {totals.pl > 0 ? '+' : ''}{fmt(totals.pl)}
              </td>
              <td className={`px-4 py-3 text-right font-mono text-xs font-bold ${plClass(totals.ret_pct)}`}>
                {fmtPct(totals.ret_pct)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ─── Trade-wise Detail Table ──────────────────────────────────────────────────
function TradeTable({ trades }: { trades: SIPBookedTrade[] }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-3 border-b border-surface-border flex items-center justify-between hover:bg-surface-page/40 transition-colors"
      >
        <div className="text-left">
          <h2 className="font-display font-semibold text-neutral-primary text-sm">Trade-wise Detail</h2>
          <p className="text-xs text-neutral-muted mt-0.5">{trades.length} individual trades · sorted by exit date</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-neutral-muted" /> : <ChevronDown size={16} className="text-neutral-muted" />}
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-page border-b border-surface-border text-[11px] text-neutral-muted uppercase tracking-wider">
                <th className="text-left px-4 py-3">Ticker</th>
                <th className="text-left px-4 py-3">Class</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Buy Date</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Exit Date</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Hold (days)</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Buy Price</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Invested</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Exit Price</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Exit Value</th>
                <th className="text-right px-4 py-3">P&amp;L</th>
                <th className="text-right px-4 py-3">Return</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-b border-surface-border last:border-0 hover:bg-surface-page/60 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs font-semibold text-neutral-primary">{t.ticker}</div>
                    <div className="text-[11px] text-neutral-muted truncate max-w-[120px]">{t.etf_name}</div>
                  </td>
                  <td className="px-4 py-2.5"><AssetBadge cls={t.asset_class} /></td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-muted whitespace-nowrap">{t.trade_date}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-muted whitespace-nowrap">{t.exit_date}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-muted">
                    {t.hold_days != null ? t.hold_days + 'd' : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{t.qty}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{fmt(t.buy_price)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{fmt(t.trade_value)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{fmt(t.exit_price)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-medium text-neutral-primary">{fmt(t.exit_value)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${plClass(t.pl)}`}>
                    {t.pl != null ? (t.pl > 0 ? '+' : '') + fmt(t.pl) : '—'}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${plClass(t.return_pct)}`}>
                    <span className="flex items-center justify-end gap-0.5">
                      {t.return_pct != null && t.return_pct > 0 ? <TrendingUp size={10} />
                        : t.return_pct != null && t.return_pct < 0 ? <TrendingDown size={10} /> : null}
                      {fmtPct(t.return_pct)}
                    </span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SIPBookedPL() {
  const [data, setData]       = useState<SIPBookedPLResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await sipApi.getBookedPL()) }
    catch { setError('Failed to load booked P&L data') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center py-32">
      <RefreshCw size={22} className="animate-spin text-brand" />
    </div>
  )

  if (error) return (
    <div className="p-6">
      <div className="bg-loss-bg border border-loss-border text-loss-text rounded-lg px-4 py-3 text-sm">{error}</div>
    </div>
  )

  if (!data || data.summary.length === 0) return (
    <div className="p-6">
      <div className="bg-white border border-surface-border rounded-xl p-12 text-center">
        <TrendingUp size={36} className="mx-auto text-neutral-muted mb-3" />
        <h3 className="font-display font-semibold text-neutral-primary mb-1">No booked trades yet</h3>
        <p className="text-sm text-neutral-muted">Exit trades will appear here once recorded.</p>
      </div>
    </div>
  )

  const plV   = data.total_pl
  const retV  = data.total_return_pct

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-neutral-primary">Booked P&amp;L</h1>
        <p className="text-xs text-neutral-muted mt-0.5">
          {data.summary.length} ETFs · {data.trades.length} trades exited
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SCard label="Total Invested"  value={fmt(data.total_invested)} />
        <SCard label="Total Exit Value" value={fmt(data.total_exit_value)} />
        <SCard
          label="Booked P&L"
          value={(plV > 0 ? '+' : '') + fmt(plV)}
          variant={plV > 0 ? 'profit' : plV < 0 ? 'loss' : 'default'}
        />
        <SCard
          label="Overall Return"
          value={fmtPct(retV)}
          variant={retV > 0 ? 'profit' : retV < 0 ? 'loss' : 'default'}
        />
      </div>

      {/* ETF Summary Table */}
      <SummaryTable
        rows={data.summary}
        totals={{
          invested:  data.total_invested,
          exit_value: data.total_exit_value,
          pl:        data.total_pl,
          ret_pct:   data.total_return_pct,
        }}
      />

      {/* Trade-wise Detail Table */}
      <TradeTable trades={data.trades} />
    </div>
  )
}
