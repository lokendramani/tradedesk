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
    <div className="bg-gray-900 border border-[#1e2330] rounded-lg px-3 py-2 text-xs font-mono">
      <div className="text-gray-400 mb-1">{label}</div>
      <div className={payload[0].value >= 0 ? 'text-emerald-400' : 'text-red-400'}>
        {formatCurrency(payload[0].value)}
      </div>
    </div>
  )
}

function StatCard({
  label, value, valueClass,
}: {
  label: string; value: string | number; valueClass?: string
}) {
  return (
    <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-lg font-bold font-mono ${valueClass ?? 'text-gray-100'}`}>{value}</div>
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

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-100">Segments</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {loading && <span className="text-xs text-gray-600 animate-pulse">Loading...</span>}
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
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
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-gray-900 text-gray-400 border-[#1e2330] hover:border-gray-600 hover:text-gray-200'
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
            valueClass={parseFloat(stats.win_rate) >= 50 ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatCard
            label="Net Income"
            value={formatCurrency(stats.total_net_income)}
            valueClass={isProfit(stats.total_net_income) ? 'text-emerald-400' : isLoss(stats.total_net_income) ? 'text-red-400' : 'text-gray-100'}
          />
          <StatCard
            label="Avg Profit"
            value={formatCurrency(stats.avg_profit)}
            valueClass="text-emerald-400"
          />
          <StatCard
            label="Avg Loss"
            value={formatCurrency(stats.avg_loss)}
            valueClass="text-red-400"
          />
          <StatCard
            label="Avg / Trade"
            value={formatCurrency(stats.avg_per_trade)}
            valueClass={isProfit(stats.avg_per_trade) ? 'text-emerald-400' : isLoss(stats.avg_per_trade) ? 'text-red-400' : 'text-gray-100'}
          />
          <StatCard
            label="Actual R:R"
            value={stats.actual_rr ? `${parseFloat(stats.actual_rr).toFixed(2)}x` : '—'}
            valueClass={parseFloat(stats.actual_rr) >= 1 ? 'text-emerald-400' : 'text-red-400'}
          />
          <StatCard
            label="Breakeven Acc."
            value={formatPercent(stats.breakeven_accuracy)}
          />
          <StatCard
            label="Profit Trades"
            value={stats.trade_in_profit}
            valueClass="text-emerald-400"
          />
          <StatCard
            label="Loss Trades"
            value={stats.trade_in_loss}
            valueClass="text-red-400"
          />
        </div>
      )}

      {/* Equity curve for selected segment */}
      <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs text-gray-500 uppercase tracking-widest">
            {month ? 'Monthly P&L Curve' : 'Equity Curve'} — {SEG_LABELS[segment]}
            {month && (
              <span className="ml-2 text-gray-600">
                ({monthOptions.find((o) => o.value === month)?.label ?? month})
              </span>
            )}
          </div>
          {month && (
            <div className="text-[10px] text-gray-600">
              Relative to start of period — starts at ₹0
            </div>
          )}
        </div>
        {equityData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#5a6480', fontSize: 10 }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#5a6480', fontSize: 10 }}
                tickLine={false}
                tickFormatter={(v) => {
                  const abs = Math.abs(v)
                  return abs >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${v}`
                }}
                width={65}
              />
              <Tooltip content={<ChartTooltip />} />
              {month && <ReferenceLine y={0} stroke="#5a6480" strokeDasharray="4 4" />}
              <Line
                type="monotone"
                dataKey="capital"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={equityData.length <= 20}
                activeDot={{ r: 4, fill: '#3b82f6' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[280px] text-gray-600 text-sm">
            {loading ? 'Loading...' : `No ${SEG_LABELS[segment].toLowerCase()} trades closed yet`}
          </div>
        )}
      </div>

    </div>
  )
}
