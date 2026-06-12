import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { tradesApi } from '../../api/trades'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatDate } from '../../utils/format'
import type { EquityPoint } from '../../types'

const SEGMENTS = ['Overall', 'EQUITY', 'COMMODITY', 'F_AND_O'] as const
type Segment = typeof SEGMENTS[number]
const SEG_LABELS: Record<Segment, string> = {
  Overall: 'Overall', EQUITY: 'Equity', COMMODITY: 'Commodity', F_AND_O: 'F&O',
}

const BASIS_PARAM: Record<'net' | 'gross', string> = {
  net:   'net_income',
  gross: 'gross_pl',
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number }[]; label?: string
}) {
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

export default function Equity() {
  const { portfolioId } = useAuthStore()

  const [segment, setSegment] = useState<Segment>('Overall')
  const [basis,   setBasis]   = useState<'net' | 'gross'>('net')
  const [equity,  setEquity]  = useState<EquityPoint[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!portfolioId) return
    setLoading(true)
    try {
      const seg  = segment === 'Overall' ? undefined : segment
      const data = await tradesApi.getEquityCurve(portfolioId, seg, BASIS_PARAM[basis])
      setEquity(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [portfolioId, segment, basis])

  useEffect(() => { load() }, [load])

  const equityData = equity.map((e) => ({
    date:    formatDate(e.date),
    capital: parseFloat(e.capital),
  }))

  const dailyPnl = equityData.map((e, i) => ({
    date: e.date,
    pnl:  i === 0 ? 0 : e.capital - equityData[i - 1].capital,
  })).slice(1)

  const lastCapital  = equityData.length ? equityData[equityData.length - 1].capital : null
  const firstCapital = equityData.length ? equityData[0].capital : null
  const totalReturn  = firstCapital !== null && lastCapital !== null ? lastCapital - firstCapital : null
  const maxCapital   = equityData.length ? Math.max(...equityData.map((e) => e.capital)) : 0
  const minCapital   = equityData.length ? Math.min(...equityData.map((e) => e.capital)) : 0

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-display font-bold text-neutral-primary">Equity Curve</h1>
        <div className="flex items-center gap-2 flex-wrap">

          {/* Segment filter */}
          <div className="flex items-center bg-surface-page border border-surface-border rounded-lg p-1 gap-1">
            {SEGMENTS.map((s) => (
              <button key={s} onClick={() => setSegment(s)}
                className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                  segment === s
                    ? 'bg-brand text-white font-semibold'
                    : 'text-neutral-muted hover:text-neutral-primary'
                }`}>
                {SEG_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Net / Gross toggle */}
          <div className="flex items-center bg-surface-page border border-surface-border rounded-lg p-1 gap-1">
            {(['net', 'gross'] as const).map((b) => (
              <button key={b} onClick={() => setBasis(b)}
                className={`px-3 py-1 rounded text-xs font-mono capitalize transition-colors ${
                  basis === b
                    ? 'bg-white text-neutral-primary font-semibold shadow-sm'
                    : 'text-neutral-muted hover:text-neutral-primary'
                }`}>
                {b}
              </button>
            ))}
          </div>

          {loading && <span className="text-xs text-neutral-muted animate-pulse">Loading...</span>}
        </div>
      </div>

      {/* Summary stats */}
      {equityData.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Current Capital"   value={formatCurrency(lastCapital)} />
          <StatCard
            label={`Total ${basis === 'net' ? 'Net' : 'Gross'} Return`}
            value={totalReturn !== null ? formatCurrency(totalReturn) : '—'}
            variant={totalReturn !== null && totalReturn >= 0 ? 'profit' : 'loss'}
          />
          <StatCard label="Peak Capital"   value={formatCurrency(maxCapital)} variant="profit" />
          <StatCard label="Trough Capital" value={formatCurrency(minCapital)} variant="loss" />
        </div>
      )}

      {/* Equity curve chart */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider">
            Equity Curve — {SEG_LABELS[segment]}
          </div>
          <div className="text-[10px] text-neutral-muted">
            {basis === 'net' ? 'Net Income (after charges)' : 'Gross P&L (before charges)'}
          </div>
        </div>
        {equityData.length > 1 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" />
              <XAxis dataKey="date" tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} width={60} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="capital" stroke="#4C6FFF" strokeWidth={2}
                dot={false} activeDot={{ r: 4, fill: '#4C6FFF' }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[320px] text-neutral-muted text-sm">
            {loading ? 'Loading...' : 'No closed trades yet'}
          </div>
        )}
      </div>

      {/* Daily P&L bars */}
      <div className="bg-white border border-surface-border rounded-lg p-5">
        <div className="text-[11px] font-semibold text-neutral-muted uppercase tracking-wider mb-4">Daily P&amp;L</div>
        {dailyPnl.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyPnl} barSize={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#8A93A6', fontSize: 9 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#8A93A6', fontSize: 10 }} tickLine={false}
                tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} width={55} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="#E5E9F0" />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                {dailyPnl.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#2ECC91' : '#FF6B6B'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[200px] text-neutral-muted text-sm">
            No daily P&amp;L data yet
          </div>
        )}
      </div>

    </div>
  )
}
