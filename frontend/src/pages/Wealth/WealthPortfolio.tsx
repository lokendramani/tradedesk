import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, BarChart3, CheckCircle2, Clock3, RefreshCw, TrendingUp } from 'lucide-react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  wealthNavApi,
  type WealthHolding,
  type WealthNAVHistoryResponse,
  type WealthNAVUpdateSummary,
} from '../../api/wealthNav'
import { useAuthStore } from '../../store/authStore'
import { wealthTransactionsApi, type WealthTransaction } from '../../api/wealthTransactions'
import { formatSchemePlanOption } from '../../utils/schemePickerDisplay'
import { buildWealthNAVChartData, getWealthNAVTooltipData, positionWealthChartTooltip, transactionMarkerColor, type WealthNAVChartRow, type WealthNAVTooltipData } from '../../utils/wealthPortfolioChart'
import {
  canTriggerWealthNAVUpdate,
  getWealthNAVUIStatus,
} from '../../utils/wealthNavUpdateState'

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
})

function errorMessage(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { detail?: unknown } } }
  return typeof candidate?.response?.data?.detail === 'string'
    ? candidate.response.data.detail
    : fallback
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
}

function amount(value: string | null | undefined) {
  if (value === null) return null
  const number = Number(value)
  return Number.isFinite(number) ? currency.format(number) : null
}

export default function WealthPortfolio() {
  const navigate = useNavigate()
  const user = useAuthStore(state => state.user)
  const isAdmin = Boolean(user?.is_admin || user?.role === 'ADMIN')
  const [groupBy, setGroupBy] = useState<'aggregate' | 'folio'>('aggregate')
  const [holdings, setHoldings] = useState<WealthHolding[]>([])
  const [loading, setLoading] = useState(true)
  const [holdingsError, setHoldingsError] = useState('')
  const [selectedScheme, setSelectedScheme] = useState<string | null>(null)
  const [history, setHistory] = useState<WealthNAVHistoryResponse | null>(null)
  const [schemeTransactions, setSchemeTransactions] = useState<WealthTransaction[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [chartTooltip, setChartTooltip] = useState<{ details: WealthNAVTooltipData; left: number; top: number; width: number } | null>(null)
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const [navSummary, setNavSummary] = useState<WealthNAVUpdateSummary | null>(null)
  const [navSummaryReceivedAt, setNavSummaryReceivedAt] = useState(() => Date.now())
  const [, setLeaseClockTick] = useState(0)
  const [navSummaryError, setNavSummaryError] = useState('')
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [confirmNAVUpdate, setConfirmNAVUpdate] = useState(false)

  const loadHoldings = useCallback(async () => {
    setLoading(true)
    setHoldingsError('')
    try {
      const response = await wealthNavApi.holdings(groupBy)
      setHoldings(response.holdings)
    } catch (error) {
      setHoldingsError(errorMessage(error, 'Holdings could not be loaded. Please retry.'))
    } finally {
      setLoading(false)
    }
  }, [groupBy])

  const loadNavSummary = useCallback(async () => {
    if (!isAdmin) return
    setNavSummaryError('')
    try {
      setNavSummary(await wealthNavApi.navUpdateSummary())
      setNavSummaryReceivedAt(Date.now())
    } catch (error) {
      setNavSummaryError(errorMessage(error, 'NAV update status could not be loaded.'))
    }
  }, [isAdmin])

  useEffect(() => { void loadHoldings() }, [loadHoldings])
  useEffect(() => { void loadNavSummary() }, [loadNavSummary])

  useEffect(() => {
    const latestRun = navSummary?.latest_run
    if (!latestRun || latestRun.status !== 'RUNNING') return
    const elapsedSinceResponse = Math.max(0, (Date.now() - navSummaryReceivedAt) / 1000)
    const remainingMs = Math.max(
      0,
      (navSummary.stale_after_seconds - latestRun.run_age_seconds - elapsedSinceResponse) * 1000,
    )
    const timer = window.setTimeout(() => setLeaseClockTick(tick => tick + 1), remainingMs + 1)
    return () => window.clearTimeout(timer)
  }, [navSummary, navSummaryReceivedAt])

  useEffect(() => {
    if (!selectedScheme) {
      setHistory(null)
      setHistoryError('')
      return
    }
    let active = true
    setHistoryLoading(true)
    setHistoryError('')
    Promise.all([wealthNavApi.history(selectedScheme), wealthTransactionsApi.list()])
      .then(([result, txns]) => { if (active) { setHistory(result); setSchemeTransactions(txns.filter(item => item.scheme.scheme_code === selectedScheme).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))) } })
      .catch(error => { if (active) setHistoryError(errorMessage(error, 'NAV history could not be loaded.')) })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [selectedScheme])

  const chartData = useMemo(() => {
    return buildWealthNAVChartData(history?.results ?? [], schemeTransactions)
  }, [history, schemeTransactions])

  const showChartTooltip = (details: WealthNAVTooltipData | null, event: MouseEvent<SVGCircleElement>) => {
    const bounds = chartAreaRef.current?.getBoundingClientRect()
    if (!details || !bounds) { setChartTooltip(null); return }
    const position = positionWealthChartTooltip(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      bounds.width,
      bounds.height,
    )
    setChartTooltip({ details, ...position })
  }

  const totalMarketValue = useMemo(() => holdings.reduce((total, holding) => {
    const value = holding.market_value === null ? null : Number(holding.market_value)
    return value === null || !Number.isFinite(value) ? total : total + value
  }, 0), [holdings])
  const valuedCount = holdings.filter(holding => holding.market_value !== null).length
  const latestRun = navSummary?.latest_run ?? null
  const elapsedSinceSummary = Math.max(0, (Date.now() - navSummaryReceivedAt) / 1000)
  const updateState = getWealthNAVUIStatus(
    latestRun,
    navSummary?.stale_after_seconds ?? 0,
    elapsedSinceSummary,
  )
  const canTriggerUpdate = canTriggerWealthNAVUpdate(isAdmin, updateBusy, updateState)

  const updateNAV = async () => {
    setConfirmNAVUpdate(false)
    setUpdateBusy(true)
    setUpdateError('')
    setUpdateMessage('')
    try {
      const result = await wealthNavApi.updateNAVNow()
      setUpdateMessage(`Update ${result.status.toLowerCase()}: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} missing, ${result.failed} failed.`)
      await Promise.all([loadNavSummary(), loadHoldings()])
    } catch (error) {
      setUpdateError(errorMessage(error, 'The AMFI NAV update failed. Please retry.'))
      await loadNavSummary()
    } finally {
      setUpdateBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b773d]">WealthOnCruise · Mutual funds</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold tracking-tight text-[#18382f]">Fund holdings</h1>
          <p className="mt-1 text-sm text-[#738078]">Current values use the latest available published NAV.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadHoldings()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-[#d7dfd6] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#31594a] hover:bg-[#f8faf6] disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh holdings
        </button>
      </div>

      {isAdmin && (
        <section className="mt-6 rounded-2xl border border-[#e5dcc0] bg-[#fffdf5] p-5 shadow-[0_5px_16px_rgba(32,49,38,0.03)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8b773d]">Admin · NAV management</p>
              <h2 className="mt-1 font-serif text-xl font-bold text-[#18382f]">AMFI NAVAll update</h2>
              <p className="mt-1 text-xs leading-5 text-[#738078]">Updates the latest NAV for schemes with positive remaining Wealth holdings. This action does not refresh the scheme catalogue.</p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmNAVUpdate(true)}
              disabled={!canTriggerUpdate}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1d5947] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#174b3c] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={14} className={updateBusy ? 'animate-spin' : ''} />
              {updateBusy ? 'Updating NAV…' : 'Update NAV Now'}
            </button>
          </div>
          {navSummaryError && <p role="alert" className="mt-4 text-xs text-[#a33d35]">{navSummaryError}</p>}
          {updateError && <p role="alert" className="mt-4 inline-flex items-center gap-2 text-xs text-[#a33d35]"><AlertCircle size={14} />{updateError}</p>}
          {updateMessage && <p role="status" className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-[#237457]"><CheckCircle2 size={14} />{updateMessage}</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#eee8d5] bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a9388]">Last successful update</p>
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-[#294c3f]"><Clock3 size={14} />{navSummary?.last_successful_update ? new Date(navSummary.last_successful_update).toLocaleString('en-IN') : 'No successful update yet'}</p>
            </div>
            <div className="rounded-xl border border-[#eee8d5] bg-white px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a9388]">Latest run</p>
              {navSummary?.latest_run ? (
              <p className="mt-1 text-sm font-semibold text-[#294c3f]">
                  {updateState === 'STALE' ? 'EXPIRED' : navSummary.latest_run.status} · {navSummary.latest_run.held_schemes} held · {navSummary.latest_run.inserted} inserted · {navSummary.latest_run.updated} updated · {navSummary.latest_run.skipped} missing · {navSummary.latest_run.failed} failed
                </p>
              ) : <p className="mt-1 text-sm text-[#738078]">No update has run.</p>}
              {updateState === 'STALE' && <p role="status" className="mt-1 text-xs text-[#a56832]">This run exceeded its {Math.round((navSummary?.stale_after_seconds ?? 0) / 60)} minute lease. You can retry; the server will reclaim its lock.</p>}
              {navSummary?.latest_run?.error_summary && <p className="mt-1 text-xs text-[#a56832]">{navSummary.latest_run.error_summary}</p>}
            </div>
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-[#e6e5dc] bg-white p-5 shadow-[0_5px_16px_rgba(32,49,38,0.03)]">
          <p className="text-xs font-medium text-[#738078]">Current market value</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[#18382f]">{valuedCount ? currency.format(totalMarketValue) : 'Not available'}</p>
          <p className="mt-1 text-[11px] text-[#8a9388]">{valuedCount} of {holdings.length} positions have a stored NAV; total uses valued positions only</p>
        </div>
        <div className="rounded-2xl border border-[#e6e5dc] bg-white p-5 shadow-[0_5px_16px_rgba(32,49,38,0.03)]">
          <p className="text-xs font-medium text-[#738078]">Positions</p>
          <p className="mt-2 font-mono text-2xl font-bold text-[#18382f]">{holdings.length}</p>
          <p className="mt-1 text-[11px] text-[#8a9388]">{groupBy === 'folio' ? 'Grouped by folio' : 'Aggregated by scheme'}</p>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-[#e6e5dc] bg-white shadow-[0_5px_16px_rgba(32,49,38,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#efeee8] px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-serif text-lg font-bold text-[#18382f]">Holdings</h2>
            <p className="mt-0.5 text-xs text-[#849087]">Select a scheme to view its NAV history.</p>
          </div>
          <div className="inline-flex rounded-lg bg-[#f3f2eb] p-1" role="group" aria-label="Holdings grouping">
            {(['aggregate', 'folio'] as const).map(value => (
              <button key={value} type="button" onClick={() => setGroupBy(value)} aria-pressed={groupBy === value}
                className={`rounded-md px-3 py-2 text-xs font-semibold capitalize ${groupBy === value ? 'bg-white text-[#1d5947] shadow-sm' : 'text-[#6c7b72]'}`}>
                {value === 'aggregate' ? 'By scheme' : 'By folio'}
              </button>
            ))}
          </div>
        </div>
        {holdingsError ? (
          <div className="p-10 text-center">
            <AlertCircle className="mx-auto text-[#a33d35]" size={23} />
            <p role="alert" className="mt-3 text-sm text-[#8c4c45]">{holdingsError}</p>
            <button type="button" onClick={() => void loadHoldings()} className="mt-4 rounded-lg border border-[#d7dfd6] px-3 py-2 text-xs font-semibold text-[#31594a]">Retry</button>
          </div>
        ) : loading ? (
          <div className="p-12 text-center text-sm text-[#829087]">Loading holdings…</div>
        ) : holdings.length === 0 ? (
          <div className="p-12 text-center">
            <TrendingUp className="mx-auto text-[#8a9d91]" size={23} />
            <p className="mt-3 text-sm font-semibold text-[#31594a]">No MF holdings yet</p>
            <p className="mt-1 text-xs text-[#849087]">Holdings appear here after Wealth purchase or switch-in transactions.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] table-fixed text-left text-[10px]">
              <thead className="bg-[#faf9f4] text-[10px] uppercase tracking-wide text-[#819087]">
                <tr><th className="px-2.5 py-3 font-semibold">Scheme</th>{groupBy === 'folio' && <th className="px-2 py-3 font-semibold">Folio</th>}<th className="px-2 py-3 text-right font-semibold">Units</th><th className="px-2 py-3 text-right font-semibold">Average cost NAV</th><th className="px-2 py-3 text-right font-semibold">Invested cost</th><th className="px-2 py-3 text-right font-semibold">Latest NAV</th><th className="px-2 py-3 font-semibold">NAV date</th><th className="px-2 py-3 text-right font-semibold">Unrealised P&amp;L</th><th className="px-2 py-3 text-right font-semibold">Return</th><th className="px-2.5 py-3 text-right font-semibold">Market value</th><th className="px-2 py-3 text-right font-semibold">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[#f0efe9]">
                {holdings.map(holding => (
                  <tr key={`${holding.instrument_id}-${holding.folio_id ?? 'all'}`} className="hover:bg-[#fcfcf8]">
                    <td className="max-w-[250px] px-2.5 py-3">
                      <button type="button" onClick={() => setSelectedScheme(holding.scheme_code)} className="break-words text-left font-semibold text-[#285844] hover:underline">{holding.scheme_name}</button>
                      <p className="mt-1 text-[9px] text-[#687b70]">{formatSchemePlanOption(holding.plan_type, holding.option_type)}</p>
                      <p className="font-mono text-[9px] text-[#a0aaa2]">{holding.scheme_code}</p>
                    </td>
                    {groupBy === 'folio' && <td className="px-4 py-4 text-[#54685c]">{holding.folio_number || 'Unassigned'}</td>}
                    <td className="whitespace-nowrap px-2 py-3 text-right font-mono text-[#42564a]">
                      <span>{holding.units}</span>
                      {holding.position_warning === 'NEGATIVE_NET_UNITS' && (
                        <span className="ml-2 inline-block rounded-full bg-[#fff0e8] px-2 py-0.5 font-sans text-[9px] font-semibold text-[#a14d32]" title="Net redemptions exceed purchases in this position">
                          Negative units
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3 text-right font-mono text-[#42564a]">{holding.average_cost_nav ? `₹${holding.average_cost_nav}` : '—'}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right font-mono text-[#42564a]">{amount(holding.invested_cost) ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right font-mono text-[#42564a]">{holding.latest_nav ? `₹${holding.latest_nav}` : <span className="font-sans text-[#a17c36]">Not available</span>}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-[#64766a]">{formatDate(holding.nav_date)}</td>
                    <td className={`whitespace-nowrap px-2 py-3 text-right font-mono font-semibold ${Number(holding.unrealised_pl ?? 0) >= 0 ? 'text-[#237457]' : 'text-[#a33d35]'}`}>{amount(holding.unrealised_pl) ?? '—'}{holding.cost_basis_warning && <span title="Cost basis cannot be calculated reliably for this position" className="ml-1 text-[9px] text-[#a17c36]">*</span>}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right font-mono text-[#42564a]">{holding.unrealised_return_pct === null || holding.unrealised_return_pct === undefined ? '—' : `${holding.unrealised_return_pct}%`}</td>
                    <td className="whitespace-nowrap px-2.5 py-3 text-right font-mono font-semibold text-[#1d5947]">{amount(holding.market_value) ?? <span className="font-sans font-normal text-[#a17c36]">NAV pending</span>}</td>
                    <td className="whitespace-nowrap px-2 py-3 text-right"><div className="flex justify-end gap-1"><button type="button" onClick={() => navigate(`/wealth/transactions?intent=PURCHASE&scheme_code=${encodeURIComponent(holding.scheme_code)}&scheme_name=${encodeURIComponent(holding.scheme_name)}&plan_type=${encodeURIComponent(holding.plan_type ?? '')}&option_type=${encodeURIComponent(holding.option_type ?? '')}${holding.folio_id ? `&folio=${encodeURIComponent(holding.folio_id)}` : ''}`)} className="rounded-md border border-[#d8e4d9] px-2 py-1.5 text-[10px] font-semibold text-[#315b4d]">Add</button><button type="button" onClick={() => navigate(`/wealth/transactions?intent=REDEMPTION&scheme_code=${encodeURIComponent(holding.scheme_code)}&scheme_name=${encodeURIComponent(holding.scheme_name)}&plan_type=${encodeURIComponent(holding.plan_type ?? '')}&option_type=${encodeURIComponent(holding.option_type ?? '')}${holding.folio_id ? `&folio=${encodeURIComponent(holding.folio_id)}` : ''}`)} className="rounded-md border border-[#efd9cf] px-2 py-1.5 text-[10px] font-semibold text-[#9c4d37]">Redeem</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedScheme && (
        <section className="mt-6 rounded-2xl border border-[#e6e5dc] bg-white p-5 shadow-[0_5px_16px_rgba(32,49,38,0.03)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8b773d]">NAV history · {selectedScheme}</p>
              <h2 className="mt-1 font-serif text-xl font-bold text-[#18382f]">{history?.scheme_name ?? 'Scheme NAV history'}</h2>
              {(() => { const selected = holdings.find(item => item.scheme_code === selectedScheme); return selected && <p className="mt-1 text-xs text-[#687b70]">{formatSchemePlanOption(selected.plan_type, selected.option_type)} · Code: {selected.scheme_code}</p> })()}
            </div>
            <button type="button" onClick={() => setSelectedScheme(null)} className="rounded-lg border border-[#e1e5dc] px-3 py-2 text-xs font-semibold text-[#567068]">Close chart</button>
          </div>
          {historyError ? <p role="alert" className="mt-5 text-sm text-[#a33d35]">{historyError}</p> : historyLoading ? <p className="py-14 text-center text-sm text-[#829087]">Loading stored NAV history…</p> : chartData.lineData.length || chartData.markers.length ? (
            <div className="mt-5 w-full">
              <div ref={chartAreaRef} className="relative h-[280px]" onMouseLeave={() => setChartTooltip(null)}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData.lineData} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
                    <CartesianGrid stroke="#edf0e8" strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={value => formatDate(new Date(Number(value)).toISOString().slice(0, 10))} minTickGap={35} tick={{ fill: '#829087', fontSize: 10 }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fill: '#829087', fontSize: 10 }} width={58} />
                    <Tooltip shared={false} content={() => null} />
                    <Line type="monotone" dataKey="nav" stroke="#237457" strokeWidth={2} dot={false} connectNulls activeDot={(props) => {
                      const details = getWealthNAVTooltipData({ payload: props.payload as WealthNAVChartRow })
                      return <circle cx={Number(props.cx ?? 0)} cy={Number(props.cy ?? 0)} r={4} fill="#237457" stroke="white" strokeWidth={1.5}
                        onMouseEnter={event => showChartTooltip(details, event)} onMouseMove={event => showChartTooltip(details, event)} onMouseLeave={() => setChartTooltip(null)} />
                    }} />
                    <Scatter data={chartData.markers} dataKey="y" name="Transaction" fill="#a4533a" shape={(props) => {
                      const marker = props.payload as (typeof chartData.markers)[number]
                      const details = getWealthNAVTooltipData({ payload: marker })
                      return <circle cx={Number(props.cx ?? 0) + marker.offset} cy={Number(props.cy ?? 0)} r={6} fill={transactionMarkerColor(marker)} stroke="white" strokeWidth={2}
                        onMouseEnter={event => showChartTooltip(details, event)} onMouseMove={event => showChartTooltip(details, event)} onMouseLeave={() => setChartTooltip(null)} />
                    }} />
                  </ComposedChart>
                </ResponsiveContainer>
                {chartTooltip && <div role="tooltip" className="pointer-events-none absolute z-20 rounded-lg border border-[#e5e9f0] bg-white px-3 py-2.5 text-[10px] shadow-xl" style={{ left: chartTooltip.left, top: chartTooltip.top, width: chartTooltip.width }}>
                  {chartTooltip.details.kind === 'published-nav'
                    ? <><p className="font-semibold text-[#1a1f2b]">Published NAV · {formatDate(chartTooltip.details.date)}</p><p className="mt-1 text-[#52645a]">₹{chartTooltip.details.nav}</p></>
                    : <><p className="font-semibold text-[#1a1f2b]">{chartTooltip.details.firstInvestment ? 'First investment' : chartTooltip.details.transactionType === 'PURCHASE' ? 'Subsequent purchase' : chartTooltip.details.transactionType}</p><p className="mt-1 leading-4 text-[#52645a]">{chartTooltip.details.transactionType} · {formatDate(chartTooltip.details.date)}</p><p className="leading-4 text-[#52645a]">Transaction NAV ₹{chartTooltip.details.nav} · {chartTooltip.details.units} units</p><p className="leading-4 text-[#52645a]">Amount {amount(chartTooltip.details.amount)}</p></>}
                </div>}
              </div>
              <div role="status" aria-live="polite" className="mt-2 min-h-[58px] rounded-lg border border-[#e5e9f0] bg-white px-3 py-2.5 text-[11px] shadow-sm">
                {!chartTooltip ? <p className="text-[#829087]">Hover the NAV line or a transaction marker to see its details.</p>
                  : chartTooltip.details.kind === 'published-nav' ? <><p className="font-semibold text-[#1a1f2b]">Published NAV · {formatDate(chartTooltip.details.date)}</p><p className="mt-1 text-[#52645a]">₹{chartTooltip.details.nav}</p></>
                    : <><p className="font-semibold text-[#1a1f2b]">{chartTooltip.details.firstInvestment ? 'First investment' : chartTooltip.details.transactionType === 'PURCHASE' ? 'Subsequent purchase' : chartTooltip.details.transactionType}</p><p className="mt-1 text-[#52645a]">{chartTooltip.details.transactionType} · {formatDate(chartTooltip.details.date)} · Transaction NAV ₹{chartTooltip.details.nav} · {chartTooltip.details.units} units · Amount {amount(chartTooltip.details.amount)}</p></>}
              </div>
            </div>
          ) : !historyError && !historyLoading ? <p className="py-12 text-center text-sm text-[#829087]">No NAV history is available for this scheme.</p> : null}
          {schemeTransactions.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{schemeTransactions.map((item, index) => <span key={item.id} className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${index === schemeTransactions.findIndex(tx => ['PURCHASE', 'SWITCH_IN'].includes(tx.transaction_type)) ? 'bg-[#f8f0d7] text-[#816725]' : 'bg-[#f7eeeb] text-[#8b4b3a]'}`}>{index === schemeTransactions.findIndex(tx => ['PURCHASE', 'SWITCH_IN'].includes(tx.transaction_type)) ? 'First investment · ' : ''}{formatDate(item.transaction_date)} · {item.transaction_type} · {item.mf_detail.units} units @ ₹{item.mf_detail.nav}</span>)}</div>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-[#65776d]">{[['#d5af50', 'First investment'], ['#c24545', 'Purchase / SIP'], ['#4c6fff', 'Redemption'], ['#8567c5', 'Switch']].map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full border border-white shadow" style={{ backgroundColor: color }} />{label}</span>)}</div>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[#8a9388]"><BarChart3 size={12} />History is loaded once from MFAPI and then served from stored records. Markers use each transaction’s recorded NAV.</p>
        </section>
      )}
      {confirmNAVUpdate && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#10372e]/45 p-4"><section role="dialog" aria-modal="true" aria-label="Confirm NAV update" className="w-full max-w-md rounded-2xl border border-[#e7e2d4] bg-[#fffef9] p-5 shadow-2xl"><h2 className="font-serif text-xl font-bold text-[#18382f]">Update NAV history?</h2><p className="mt-3 text-sm leading-6 text-[#65776d]">Download the latest AMFI NAVAll file and update NAV history for schemes with positive Wealth holdings?</p>{updateError && <p role="alert" className="mt-3 text-xs text-[#a33d35]">{updateError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmNAVUpdate(false)} className="rounded-lg border border-[#d9ded4] px-4 py-2.5 text-xs font-semibold text-[#567068]">Cancel</button><button type="button" onClick={() => void updateNAV()} className="rounded-lg bg-[#1d5947] px-4 py-2.5 text-xs font-semibold text-white">Update NAV</button></div></section></div>}
    </div>
  )
}
