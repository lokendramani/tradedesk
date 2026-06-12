import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { tradesApi } from '../../api/trades'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatPercent, isProfit, isLoss } from '../../utils/format'
import type { Stats, EquityPoint } from '../../types'

const SEGMENTS = ['Overall', 'EQUITY', 'COMMODITY', 'F_AND_O'] as const
type Segment = typeof SEGMENTS[number]
const SEG_LABELS: Record<Segment, string> = {
  Overall: 'Overall', EQUITY: 'Equity', COMMODITY: 'Commodity', F_AND_O: 'F&O',
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-surface-border rounded-lg px-3 py-2 text-xs font-mono shadow-sm">
      <div className="text-neutral-muted mb-1">{label}</div>
      <div className={payload[0].value >= 0 ? 'text-profit-text' : 'text-loss-text'}>
        {formatCurrency(payload[0].value)}
      </div>
    </div>
  )
}

type CardVariant = 'default' | 'profit' | 'loss'

const CARD_STYLES: Record<CardVariant, { card: string; label: string; value: string }> = {
  default: { card: 'bg-white border border-surface-border', label: 'text-neutral-muted', value: 'text-neutral-primary' },
  profit:  { card: 'bg-profit-bg border border-profit-border', label: 'text-profit-label', value: 'text-profit-text' },
  loss:    { card: 'bg-loss-bg border border-loss-border', label: 'text-neutral-muted', value: 'text-loss-text' },
}

function StatCard({ label, value, variant = 'default' }: { label: string; value: string | number; variant?: CardVariant }) {
  const s = CARD_STYLES[variant]
  return (
    <div className={`${s.card} rounded-lg p-4`}>
      <div className={`text-[11px] ${s.label} uppercase tracking-wide mb-2`}>{label}</div>
      <div className={`text-xl font-mono font-medium ${s.value}`}>{value}</div>
    </div>
  )
}

export default function Segments() {
  const { portfolioId } = useAuthStore()

  const [segment,      setSegment]      = useState<Segment>('Overall')
  const [month,        setMonth]        = useState('')
  const [closedMonths, setClosedMonths] = useState<string[]>([])
  const [stats,        setStats]        = useState<Stats | null>(null)
  const [equity,       setEquity]       = useState<EquityPoint[]>([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    if (!portfolioId) return
    tradesApi.getClosedMonths(portfolioId).then(setClosedMonths).catch(() => {})
  }, [portfolioId])

  const load = useCallback(async () => {
    if (!portfolioId) return
    setLoading(true)
    try {
      const seg = segment === 'Overall' ? undefined : segment
      const [yr, mo] = month ? month.split('-').map(Number) : [undefined, undefined]
      const [s, eq] = await Promise.all([
        tradesApi.getStats(portfolioId, seg, yr, mo),
        tradesApi.getEquityCurve(portfolioId, seg, undefined, yr, mo),
      ])
      setStats(s)
      setEquity(Array.isArray(eq) ? eq : [])
    } finally {
      setLoading(false)
    }
  }, [portfolioId, segment, month])

  useEffect(() => { load() }, [load])

  const monthOptions = closedMonths.map((m) => {
    const [y, mo] = m.split('-').map(Number)
    return {
      value: m,
      label: new Date(y, mo - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
    }
  })

  const equityData = equity.map((e) => ({
    date:    new Date(e.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
    capital: parseFloat(e.capital),
  }))

  const winRate  = parseFloat(stats?.win_rate ?? '0')
  const netIncome = stats?.total_net_income ?? '0'

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-display font-bold text-neutral-primary">Segments</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {loading && <span className="text-xs text-neutral-muted animate-pulse">Loading...</span>}
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-white border border-surface-border text-neutral-primary text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand"
          >
            <option value="">All Time</option>
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Segment pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {SEGMENTS.map((s) => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            className={`px-4 py-2 rounded-lg text-sm font-mono font-semibold transition-colors border ${
              segment === s
                ? 'bg-brand text-white border-brand'
                : 'bg-white text-neutral-muted border-surface-border hover:border-neutral-muted hover:text-neutral-primary'
            }`}
          >
            {SEG_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <StatCard label="Total Trades" value={stats.total_trades} />
          <StatCard label="Closed"       value={stats.closed_trades} />
          <StatCard label="Open"         value={stats.open_trades} />
          <StatCard
            label="Win Rate"
            value={formatPercent(stats.win_rate)}
            variant={winRate >= 50 ? 'profit' : 'loss'}
          />
          <StatCard
            label="Net Income"
            value={formatCurrency(netIncome)}
            variant={isProfit(netIncome) ? 'profit' : isLoss(netIncome) ? 'loss' : 'default'}
          />
          <StatCard label="Avg Profit"  value={formatCurrency(stats.avg_profit)} variant="profit" />
          <StatCard label="Avg Loss"    value={formatCurrency(stats.avg_loss)}   variant="loss"   />
          <StatCard
            label="Avg / Trade"
            value={formatCurrency(stats.avg_per_trade)}
            variant={isProfit(stats.avg_per_trade) ? 'profit' : isLoss(stats.avg_per_trade) ? 'loss' : 'default'}
          />
          <StatCard
            label="Actual R:R"
            value={stats.actual_rr ? `${parseFloat(stats.actual_rr).toFixed(2)}x` : '—'}
            variant={parseFloat(stats.actual_rr) >= 1 ? 'profit' : 'loss'}
          />
          <StatCard label="Breakeven Acc." value={formatPercent(stats.breakeven_accuracy)} />
          <StatCard label="Profit Trades"  value={stats.trade_in_profit} variant="profit" />
          <StatCard label="Loss Trades"    value={stats.trade_in_loss}   variant="loss"   />
        </div>
      )}

      {/* Equity curve for selected segment */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider">
            {month ? 'Monthly P&L Curve' : 'Equity Curve'} — {SEG_LABELS[segment]}
            {month && (
              <span className="ml-2 text-neutral-muted/60">
                ({monthOptions.find((o) => o.value === month)?.label ?? month})
              </span>
            )}
          </div>
          {month && (
            <div className="text-[10px] text-neutral-muted">
              Relative to start of period — starts at ₹0
            </div>
          )}
        </div>
        {equityData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#8A93A6', fontSize: 10 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#8A93A6', fontSize: 10 }}
                tickLine={false}
                tickFormatter={(v) => {
                  const abs = Math.abs(v)
                  return abs >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${v}`
                }}
                width={65}
              />
              <Tooltip content={<ChartTooltip />} />
              {month && <ReferenceLine y={0} stroke="#8A93A6" strokeDasharray="4 4" />}
              <Line
                type="monotone"
                dataKey="capital"
                stroke="#4C6FFF"
                strokeWidth={2}
                dot={equityData.length <= 20}
                activeDot={{ r: 4, fill: '#4C6FFF' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[280px] text-neutral-muted text-sm">
            {loading ? 'Loading...' : `No ${SEG_LABELS[segment].toLowerCase()} trades closed yet`}
          </div>
        )}
      </div>

    </div>
  )
}
