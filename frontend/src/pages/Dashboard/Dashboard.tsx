import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { tradesApi } from '../../api/trades'
import { portfolioApi } from '../../api/portfolio'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatPercent, formatDate, isProfit, isLoss } from '../../utils/format'
import type { Stats, EquityPoint, MonthlyPnl, Portfolio } from '../../types'

const SEGMENTS = ['Overall', 'EQUITY', 'COMMODITY', 'F_AND_O'] as const
type Segment = typeof SEGMENTS[number]

const SEG_LABELS: Record<Segment, string> = {
  Overall: 'Overall', EQUITY: 'Equity', COMMODITY: 'Commodity', F_AND_O: 'F&O',
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, valueClass,
}: {
  label: string
  value: string | number
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
      <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">{label}</div>
      <div className={`text-xl font-bold font-mono ${valueClass ?? 'text-gray-100'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-1">{sub}</div>}
    </div>
  )
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-[#1e2330] rounded-lg px-3 py-2 text-xs font-mono">
      <div className="text-gray-400 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className={p.value >= 0 ? 'text-emerald-400' : 'text-red-400'}>
          {p.name ? `${p.name}: ` : ''}{formatCurrency(p.value)}
        </div>
      ))}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { portfolioId } = useAuthStore()

  const [segment,     setSegment]     = useState<Segment>('Overall')
  const [year,        setYear]        = useState<number | undefined>()
  const [month,       setMonth]       = useState<number | undefined>()
  const [closedMonths, setClosedMonths] = useState<string[]>([])
  const [portfolio,   setPortfolio]   = useState<Portfolio | null>(null)

  const [stats,       setStats]       = useState<Stats | null>(null)
  const [equity,      setEquity]      = useState<EquityPoint[]>([])
  const [monthly,     setMonthly]     = useState<MonthlyPnl[]>([])
  const [segStats,    setSegStats]    = useState<Record<string, Stats | null>>({})
  const [loading,     setLoading]     = useState(true)

  // Load closed months and portfolio on mount
  useEffect(() => {
    if (!portfolioId) return
    tradesApi.getClosedMonths(portfolioId).then(setClosedMonths).catch(() => {})
    portfolioApi.getAll().then((list) => {
      const p = list.find((x) => x.id === portfolioId)
      if (p) setPortfolio(p)
    }).catch(() => {})
  }, [portfolioId])

  // Load stats + charts when filter changes
  const load = useCallback(async () => {
    if (!portfolioId) return
    setLoading(true)
    try {
      const seg = segment === 'Overall' ? undefined : segment
      const [s, eq, mp] = await Promise.all([
        tradesApi.getStats(portfolioId, seg, year, month),
        tradesApi.getEquityCurve(portfolioId, seg),
        tradesApi.getMonthlyPnl(portfolioId, seg),
      ])
      setStats(s)
      setEquity(Array.isArray(eq) ? eq : [])
      setMonthly(Array.isArray(mp) ? mp : [])

      // Load per-segment stats for bar chart (always overall filters for comparison)
      const [eqStat, comStat, fnoStat] = await Promise.all([
        tradesApi.getStats(portfolioId, 'EQUITY').catch(() => null),
        tradesApi.getStats(portfolioId, 'COMMODITY').catch(() => null),
        tradesApi.getStats(portfolioId, 'F_AND_O').catch(() => null),
      ])
      setSegStats({ EQUITY: eqStat, COMMODITY: comStat, F_AND_O: fnoStat })
    } finally {
      setLoading(false)
    }
  }, [portfolioId, segment, year, month])

  useEffect(() => { load() }, [load])

  // Parse closed months for filter dropdown
  const monthOptions = closedMonths.map((m) => {
    const [y, mo] = m.split('-').map(Number)
    return { value: m, label: new Date(y, mo - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' }), y, mo }
  })

  const handleMonthChange = (val: string) => {
    if (!val) { setYear(undefined); setMonth(undefined); return }
    const opt = monthOptions.find((o) => o.value === val)
    if (opt) { setYear(opt.y); setMonth(opt.mo) }
  }

  // Derived values
  const worstCaseBuffer = stats && portfolio
    ? (parseFloat(stats.current_capital ?? stats.starting_capital) - portfolio.worst_case_capital)
    : null

  const equityData = equity.map((e) => ({
    date: formatDate(e.date),
    capital: parseFloat(e.capital),
  }))

  const monthlyData = monthly.map((m) => ({
    month: (() => {
      const [y, mo] = m.month.split('-').map(Number)
      return new Date(y, mo - 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' })
    })(),
    pnl: parseFloat(m.net_income),
  }))

  const segBarData = [
    { name: 'Equity',    pnl: parseFloat(segStats.EQUITY?.total_net_income ?? '0') },
    { name: 'Commodity', pnl: parseFloat(segStats.COMMODITY?.total_net_income ?? '0') },
    { name: 'F&O',       pnl: parseFloat(segStats.F_AND_O?.total_net_income ?? '0') },
  ]

  const donutData = stats
    ? [
        { name: 'Profit', value: stats.trade_in_profit },
        { name: 'Loss',   value: stats.trade_in_loss   },
        { name: 'Break-even', value: Math.max(0, stats.closed_trades - stats.trade_in_profit - stats.trade_in_loss) },
      ].filter((d) => d.value > 0)
    : []

  const DONUT_COLORS = ['#00e5a0', '#ff4560', '#5a6480']

  return (
    <div className="p-6 space-y-6">

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-100">Dashboard</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Segment filter */}
          <div className="flex items-center bg-gray-900 border border-[#1e2330] rounded-lg p-1 gap-1">
            {SEGMENTS.map((s) => (
              <button
                key={s}
                onClick={() => setSegment(s)}
                className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                  segment === s
                    ? 'bg-emerald-400 text-gray-900 font-semibold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {SEG_LABELS[s]}
              </button>
            ))}
          </div>
          {/* Month filter */}
          <select
            onChange={(e) => handleMonthChange(e.target.value)}
            className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-400"
          >
            <option value="">All Time</option>
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {loading && (
            <span className="text-xs text-gray-600 animate-pulse">Loading...</span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <StatCard label="Total Trades"     value={stats.total_trades}  />
          <StatCard label="Closed"           value={stats.closed_trades} />
          <StatCard label="Open"             value={stats.open_trades}   />
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
            label="Current Capital"
            value={formatCurrency(stats.current_capital ?? stats.starting_capital)}
            valueClass={isProfit(stats.total_net_income) ? 'text-emerald-400' : 'text-gray-100'}
          />
          <StatCard
            label="Worst Case Buffer"
            value={worstCaseBuffer !== null ? formatCurrency(worstCaseBuffer) : '—'}
            valueClass={worstCaseBuffer !== null && worstCaseBuffer >= 0 ? 'text-emerald-400' : 'text-red-400'}
            sub={portfolio ? `Floor: ${formatCurrency(portfolio.worst_case_capital)}` : undefined}
          />
        </div>
      )}

      {/* Charts row 1: Equity curve + Win/Loss donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Equity curve */}
        <div className="lg:col-span-2 bg-gray-900 border border-[#1e2330] rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">Equity Curve</div>
          {equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={equityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
                <XAxis dataKey="date" tick={{ fill: '#5a6480', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#5a6480', fontSize: 10 }} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="capital"
                  stroke="#00e5a0"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#00e5a0' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">
              No equity data yet
            </div>
          )}
        </div>

        {/* Win/Loss donut */}
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">Trade Outcomes</div>
          {donutData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  paddingAngle={3}
                >
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, name) => [v ?? 0, name ?? '']}
                  contentStyle={{ background: '#111318', border: '1px solid #1e2330', borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }}
                  itemStyle={{ color: '#e8eaf0' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ color: '#5a6480', fontSize: 11 }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-gray-600 text-sm">
              No closed trades yet
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2: Monthly P&L + Segment performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly P&L */}
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">Monthly P&amp;L</div>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#5a6480', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#5a6480', fontSize: 10 }} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="pnl" name="Net P&L" radius={[3, 3, 0, 0]}>
                  {monthlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#00e5a0' : '#ff4560'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-gray-600 text-sm">
              No monthly data yet
            </div>
          )}
        </div>

        {/* Segment performance */}
        <div className="bg-gray-900 border border-[#1e2330] rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-4">Segment Performance</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={segBarData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#5a6480', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: '#5a6480', fontSize: 10 }} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pnl" name="Net P&L" radius={[3, 3, 0, 0]}>
                {segBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#00e5a0' : '#ff4560'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  )
}
