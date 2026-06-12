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
type CardVariant = 'default' | 'profit' | 'loss'

const CARD_STYLES: Record<CardVariant, { card: string; label: string; value: string }> = {
  default: {
    card:  'bg-white border border-surface-border',
    label: 'text-neutral-muted',
    value: 'text-neutral-primary',
  },
  profit: {
    card:  'bg-profit-bg border border-profit-border',
    label: 'text-profit-label',
    value: 'text-profit-text',
  },
  loss: {
    card:  'bg-loss-bg border border-loss-border',
    label: 'text-neutral-muted',
    value: 'text-loss-text',
  },
}

function StatCard({
  label, value, sub, variant = 'default',
}: {
  label: string
  value: string | number
  sub?: string
  variant?: CardVariant
}) {
  const s = CARD_STYLES[variant]
  return (
    <div className={`${s.card} rounded-lg p-4`}>
      <div className={`text-[11px] ${s.label} uppercase tracking-wide mb-2`}>{label}</div>
      <div className={`text-2xl font-mono font-medium ${s.value}`}>{value}</div>
      {sub && <div className="text-xs text-neutral-muted mt-1">{sub}</div>}
    </div>
  )
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-surface-border rounded-lg px-3 py-2 text-xs font-mono shadow-sm">
      <div className="text-neutral-muted mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className={p.value >= 0 ? 'text-profit-text' : 'text-loss-text'}>
          {p.name ? `${p.name}: ` : ''}{formatCurrency(p.value)}
        </div>
      ))}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { portfolioId } = useAuthStore()

  const [segment,      setSegment]      = useState<Segment>('Overall')
  const [year,         setYear]         = useState<number | undefined>()
  const [month,        setMonth]        = useState<number | undefined>()
  const [closedMonths, setClosedMonths] = useState<string[]>([])
  const [portfolio,    setPortfolio]    = useState<Portfolio | null>(null)

  const [stats,    setStats]    = useState<Stats | null>(null)
  const [equity,   setEquity]   = useState<EquityPoint[]>([])
  const [monthly,  setMonthly]  = useState<MonthlyPnl[]>([])
  const [segStats, setSegStats] = useState<Record<string, Stats | null>>({})
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!portfolioId) return
    tradesApi.getClosedMonths(portfolioId).then(setClosedMonths).catch(() => {})
    portfolioApi.getAll().then((list) => {
      const p = list.find((x) => x.id === portfolioId)
      if (p) setPortfolio(p)
    }).catch(() => {})
  }, [portfolioId])

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

  const monthOptions = closedMonths.map((m) => {
    const [y, mo] = m.split('-').map(Number)
    return { value: m, label: new Date(y, mo - 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' }), y, mo }
  })

  const handleMonthChange = (val: string) => {
    if (!val) { setYear(undefined); setMonth(undefined); return }
    const opt = monthOptions.find((o) => o.value === val)
    if (opt) { setYear(opt.y); setMonth(opt.mo) }
  }

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
        { name: 'Profit',    value: stats.trade_in_profit },
        { name: 'Loss',      value: stats.trade_in_loss   },
        { name: 'Break-even', value: Math.max(0, stats.closed_trades - stats.trade_in_profit - stats.trade_in_loss) },
      ].filter((d) => d.value > 0)
    : []

  const DONUT_COLORS = ['#2ECC91', '#FF6B6B', '#8A93A6']

  const winRate = parseFloat(stats?.win_rate ?? '0')
  const netIncome = stats?.total_net_income ?? '0'

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-display font-bold text-neutral-primary">Dashboard</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Segment filter */}
          <div className="flex items-center bg-surface-page border border-surface-border rounded-lg p-1 gap-1">
            {SEGMENTS.map((s) => (
              <button
                key={s}
                onClick={() => setSegment(s)}
                className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                  segment === s
                    ? 'bg-brand text-white font-semibold'
                    : 'text-neutral-muted hover:text-neutral-primary'
                }`}
              >
                {SEG_LABELS[s]}
              </button>
            ))}
          </div>
          {/* Month filter */}
          <select
            onChange={(e) => handleMonthChange(e.target.value)}
            className="bg-white border border-surface-border text-neutral-primary text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand"
          >
            <option value="">All Time</option>
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {loading && (
            <span className="text-xs text-neutral-muted animate-pulse">Loading...</span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          <StatCard label="Total Trades"  value={stats.total_trades}  />
          <StatCard label="Closed"        value={stats.closed_trades} />
          <StatCard label="Open"          value={stats.open_trades}   />
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
          <StatCard label="Avg Profit"  value={formatCurrency(stats.avg_profit)}   variant="profit" />
          <StatCard label="Avg Loss"    value={formatCurrency(stats.avg_loss)}     variant="loss"   />
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
          <StatCard
            label="Current Capital"
            value={formatCurrency(stats.current_capital ?? stats.starting_capital)}
            variant={isProfit(netIncome) ? 'profit' : 'default'}
          />
          <StatCard
            label="Worst Case Buffer"
            value={worstCaseBuffer !== null ? formatCurrency(worstCaseBuffer) : '—'}
            variant={worstCaseBuffer !== null && worstCaseBuffer >= 0 ? 'profit' : 'loss'}
            sub={portfolio ? `Floor: ${formatCurrency(portfolio.worst_case_capital)}` : undefined}
          />
        </div>
      )}

      {/* Charts row 1: Equity curve + Win/Loss donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Equity curve */}
        <div className="lg:col-span-2 bg-white border border-surface-border rounded-lg p-4">
          <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider mb-4">Equity Curve</div>
          {equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={equityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" />
                <XAxis dataKey="date" tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="capital"
                  stroke="#4C6FFF"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#4C6FFF' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-neutral-muted text-sm">
              No equity data yet
            </div>
          )}
        </div>

        {/* Win/Loss donut */}
        <div className="bg-white border border-surface-border rounded-lg p-4">
          <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider mb-4">Trade Outcomes</div>
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
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E9F0', borderRadius: 8, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                  itemStyle={{ color: '#1A1F2B' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value) => <span style={{ color: '#8A93A6', fontSize: 11 }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-neutral-muted text-sm">
              No closed trades yet
            </div>
          )}
        </div>
      </div>

      {/* Charts row 2: Monthly P&L + Segment performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly P&L */}
        <div className="bg-white border border-surface-border rounded-lg p-4">
          <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider mb-4">Monthly P&amp;L</div>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyData} barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="pnl" name="Net P&L" radius={[3, 3, 0, 0]}>
                  {monthlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#2ECC91' : '#FF6B6B'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-neutral-muted text-sm">
              No monthly data yet
            </div>
          )}
        </div>

        {/* Segment performance */}
        <div className="bg-white border border-surface-border rounded-lg p-4">
          <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider mb-4">Segment Performance</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={segBarData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="pnl" name="Net P&L" radius={[3, 3, 0, 0]}>
                {segBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#2ECC91' : '#FF6B6B'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

    </div>
  )
}
