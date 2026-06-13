import { useState, useEffect, useRef, useCallback } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { RefreshCw, Upload, Plus, X, ChevronDown, ChevronRight, AlertCircle, Trash2 } from 'lucide-react'
import { sipApi } from '../../api/sip'
import type { SIPDashboard, SIPSummary, SIPHolding, SIPBookedTicker, SIPWeekPoint, SIPTrade } from '../../types'

// ─── Formatting helpers ────────────────────────────────────────────────────────

const fmtCurrency = (v: number | null | undefined) =>
  v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })

const fmtPct = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

const fmtXirr = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

const fmtAlpha = (v: number | null | undefined) =>
  v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'pp'

// ─── Stat Card ────────────────────────────────────────────────────────────────

type CardVariant = 'default' | 'profit' | 'loss'

const CARD: Record<CardVariant, { card: string; label: string; value: string }> = {
  default: { card: 'bg-white border border-surface-border',           label: 'text-neutral-muted',  value: 'text-neutral-primary' },
  profit:  { card: 'bg-profit-bg border border-profit-border',        label: 'text-profit-label',   value: 'text-profit-text' },
  loss:    { card: 'bg-loss-bg border border-loss-border',            label: 'text-neutral-muted',  value: 'text-loss-text' },
}

function StatCard({
  label, value, sub, sub2, sub2Variant, variant = 'default',
}: { label: string; value: string; sub?: string; sub2?: string; sub2Variant?: 'profit' | 'loss' | 'muted'; variant?: CardVariant }) {
  const s = CARD[variant]
  const sub2Class =
    sub2Variant === 'profit' ? 'text-profit-text font-semibold' :
    sub2Variant === 'loss'   ? 'text-loss-text font-semibold'   :
    'text-neutral-muted'
  return (
    <div className={`${s.card} rounded-xl p-4`}>
      <div className={`text-xs uppercase tracking-wider font-medium mb-1.5 ${s.label}`}>{label}</div>
      <div className={`text-xl font-mono font-semibold ${s.value}`}>{value}</div>
      {sub  && <div className="text-xs text-neutral-muted mt-1">{sub}</div>}
      {sub2 && <div className={`text-xs mt-0.5 ${sub2Class}`}>{sub2}</div>}
    </div>
  )
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [phase, setPhase]       = useState<'pick' | 'loading' | 'done' | 'error'>('pick')
  const [result, setResult]     = useState<{ imported: number; duplicates_skipped: number; errors: string[] } | null>(null)
  const [errMsg, setErrMsg]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setPhase('loading')
    try {
      const r = await sipApi.uploadCsv(file)
      setResult(r)
      setPhase('done')
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { errors?: string[]; error?: string } } }
      const errs = ax.response?.data?.errors
      setErrMsg(errs ? errs.join('\n') : ax.response?.data?.error ?? 'Upload failed')
      setPhase('error')
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-surface-border rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="font-display font-semibold text-neutral-primary">Import SIP CSV</h2>
          <button onClick={onClose} className="text-neutral-muted hover:text-neutral-primary">
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {phase === 'pick' && (
            <>
              <div
                className="border-2 border-dashed border-surface-border rounded-xl p-10 text-center cursor-pointer hover:border-brand transition-colors"
                onClick={() => inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
              >
                <Upload size={32} className="mx-auto text-neutral-muted mb-3" />
                <p className="text-sm text-neutral-muted">
                  Drag &amp; drop your CSV or <span className="text-brand font-medium">browse</span>
                </p>
                <p className="text-xs text-neutral-muted mt-2">
                  Columns: Date, ETF, AssetClass, Ticker, Qty, Price, ExitDate, ExitPrice
                </p>
              </div>
              <input ref={inputRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
            </>
          )}

          {phase === 'loading' && (
            <div className="text-center py-8">
              <RefreshCw size={28} className="animate-spin mx-auto text-brand mb-3" />
              <p className="text-sm text-neutral-muted">Uploading &amp; calculating...</p>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="space-y-3">
              <div className="bg-profit-bg border border-profit-border rounded-lg p-4 text-sm">
                <div className="font-semibold text-profit-text mb-1">Import complete</div>
                <div className="text-neutral-muted">{result.imported} trades imported</div>
                {result.duplicates_skipped > 0 && (
                  <div className="text-neutral-muted">{result.duplicates_skipped} duplicates skipped</div>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="bg-loss-bg border border-loss-border rounded-lg p-3 text-xs text-loss-text space-y-1">
                  {result.errors.map((err, i) => <div key={i}>{err}</div>)}
                </div>
              )}
              <button onClick={() => { onDone(); onClose() }}
                className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors">
                Done
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-3">
              <div className="bg-loss-bg border border-loss-border rounded-lg p-4 text-sm">
                <div className="font-semibold text-loss-text mb-1">Upload failed</div>
                <pre className="text-xs text-neutral-muted whitespace-pre-wrap">{errMsg}</pre>
              </div>
              <button onClick={() => setPhase('pick')}
                className="w-full bg-white border border-surface-border text-neutral-primary font-medium rounded-lg py-2.5 text-sm hover:bg-surface-page transition-colors">
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Add Trade Modal ──────────────────────────────────────────────────────────

const INPUT = 'w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-neutral-primary placeholder-neutral-muted focus:outline-none focus:border-brand transition-colors'

function AddTradeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ trade_date: '', etf_name: '', asset_class: 'Equity', ticker: '', qty: '', price: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      await sipApi.addTrade({
        trade_date:  form.trade_date,
        etf_name:    form.etf_name,
        asset_class: form.asset_class,
        ticker:      form.ticker.toUpperCase(),
        qty:         parseFloat(form.qty),
        price:       parseFloat(form.price),
        notes:       form.notes,
      } as Partial<SIPTrade>)
      onDone()
      onClose()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setErr(ax.response?.data?.error ?? 'Failed to save trade')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-surface-border rounded-xl shadow-lg w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="font-display font-semibold text-neutral-primary">Add SIP Trade</h2>
          <button onClick={onClose} className="text-neutral-muted hover:text-neutral-primary"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {err && <div className="bg-loss-bg border border-loss-border text-loss-text text-xs rounded-lg px-3 py-2">{err}</div>}

          <div>
            <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Buy Date</label>
            <input type="date" className={INPUT} value={form.trade_date} onChange={(e) => set('trade_date', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">ETF Name</label>
            <input type="text" className={INPUT} value={form.etf_name} onChange={(e) => set('etf_name', e.target.value)} placeholder="Nifty BeES" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Asset Class</label>
              <select className={INPUT} value={form.asset_class} onChange={(e) => set('asset_class', e.target.value)}>
                <option>Equity</option>
                <option>Debt</option>
                <option>Gold</option>
                <option>International</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Ticker</label>
              <input type="text" className={`${INPUT} font-mono uppercase`} value={form.ticker} onChange={(e) => set('ticker', e.target.value)} placeholder="NIFTYBEES" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Qty</label>
              <input type="number" step="0.0001" className={`${INPUT} font-mono`} value={form.qty} onChange={(e) => set('qty', e.target.value)} placeholder="10" required />
            </div>
            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Price ₹</label>
              <input type="number" step="0.01" className={`${INPUT} font-mono`} value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="250.00" required />
            </div>
          </div>
          <div>
            <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Notes</label>
            <input type="text" className={INPUT} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
          </div>
          <button type="submit" disabled={saving}
            className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50 mt-1">
            {saving ? 'Saving...' : 'Add Trade'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Close Trade Modal ────────────────────────────────────────────────────────

function CloseTradeModal({ trade, onClose, onDone }: { trade: SIPTrade; onClose: () => void; onDone: () => void }) {
  const [exitDate, setExitDate]   = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await sipApi.closeTrade(trade.id, exitDate, parseFloat(exitPrice))
      onDone()
      onClose()
    } catch {
      setErr('Failed to record exit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-surface-border rounded-xl shadow-lg w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="font-display font-semibold text-neutral-primary">Record Exit — {trade.ticker}</h2>
          <button onClick={onClose} className="text-neutral-muted hover:text-neutral-primary"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {err && <div className="bg-loss-bg border border-loss-border text-loss-text text-xs rounded-lg px-3 py-2">{err}</div>}
          <div>
            <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Exit Date</label>
            <input type="date" className={INPUT} value={exitDate} onChange={(e) => setExitDate(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Exit Price ₹</label>
            <input type="number" step="0.01" className={`${INPUT} font-mono`} value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} required />
          </div>
          <button type="submit" disabled={saving}
            className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Record Exit'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Holdings Table ───────────────────────────────────────────────────────────

function HoldingsTable({ holdings, onExit }: { holdings: SIPHolding[]; onExit: (t: SIPTrade) => void }) {
  if (holdings.length === 0) {
    return <p className="text-sm text-neutral-muted text-center py-6">No active holdings</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border bg-surface-page text-xs text-neutral-muted uppercase tracking-wider">
            <th className="text-left px-4 py-3">ETF</th>
            <th className="text-right px-4 py-3">Qty</th>
            <th className="text-right px-4 py-3">Invested</th>
            <th className="text-right px-4 py-3">Current Value</th>
            <th className="text-right px-4 py-3">P&amp;L</th>
            <th className="text-right px-4 py-3">Return</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h) => {
            const plPos = (h.pl ?? 0) >= 0
            return (
              <tr key={h.ticker} className="border-b border-surface-border hover:bg-surface-page/60 transition-colors group">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs font-semibold text-neutral-primary">{h.ticker}</div>
                  <div className="text-xs text-neutral-muted">{h.etf_name}</div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-neutral-primary">{h.qty.toFixed(4)}</td>
                <td className="px-4 py-3 text-right font-mono text-neutral-primary">{fmtCurrency(h.invested)}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {h.current_value != null ? (
                    <span className={h.price_stale ? 'text-neutral-muted' : 'text-neutral-primary'}>
                      {fmtCurrency(h.current_value)}
                      {h.price_stale && <span className="ml-1 text-[10px] text-neutral-muted" title="Stale price">⚠</span>}
                    </span>
                  ) : (
                    <span className="text-neutral-muted">—</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-medium ${plPos ? 'text-profit-text' : 'text-loss-text'}`}>
                  {fmtCurrency(h.pl)}
                </td>
                <td className={`px-4 py-3 text-right font-mono text-sm ${plPos ? 'text-profit-text' : 'text-loss-text'}`}>
                  {fmtPct(h.pl_pct)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => onExit({ id: '', trade_date: '', etf_name: h.etf_name, asset_class: '', ticker: h.ticker, qty: h.qty, price: 0, trade_value: h.invested } as SIPTrade)}
                    className="text-xs text-neutral-muted hover:text-brand transition-colors opacity-0 group-hover:opacity-100"
                  >
                    Exit
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Booked P&L Table ─────────────────────────────────────────────────────────

function BookedTable({ rows }: { rows: SIPBookedTicker[] }) {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-semibold text-neutral-primary mb-3"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Booked P&amp;L by ETF
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border bg-surface-page text-xs text-neutral-muted uppercase tracking-wider">
                <th className="text-left px-4 py-3">ETF</th>
                <th className="text-right px-4 py-3">Trades</th>
                <th className="text-right px-4 py-3">Booked P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className="border-b border-surface-border hover:bg-surface-page/60">
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-semibold text-neutral-primary">{r.ticker}</div>
                    <div className="text-xs text-neutral-muted">{r.etf_name}</div>
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-muted">{r.trade_count}</td>
                  <td className={`px-4 py-3 text-right font-mono font-medium ${r.booked_pl >= 0 ? 'text-profit-text' : 'text-loss-text'}`}>
                    {fmtCurrency(r.booked_pl)}
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

// ─── Weekly Cashflow Table ────────────────────────────────────────────────────

function WeeklyCashflowTable({ data }: { data: SIPWeekPoint[] }) {
  const [open, setOpen] = useState(false)
  if (data.length === 0) return null

  const totalBuy      = data.reduce((s, r) => s + r.weekly_buy, 0)
  const totalRecycled = data.reduce((s, r) => s + r.exits_recycled, 0)
  const totalFresh    = data.reduce((s, r) => s + r.fresh_cash, 0)
  const lastCumFresh  = data[data.length - 1].cumulative_fresh

  const fmtAmt = (v: number) =>
    v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="bg-white border border-surface-border rounded-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <h2 className="font-display font-semibold text-neutral-primary">Weekly Cashflow</h2>
        {open ? <ChevronDown size={16} className="text-neutral-muted" /> : <ChevronRight size={16} className="text-neutral-muted" />}
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-surface-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-page text-[11px] text-neutral-muted uppercase tracking-wider">
                <th className="text-left px-4 py-3">Week</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Weekly Buy (₹)</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Exits Recycled (₹)</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Fresh Cash (₹)</th>
                <th className="text-right px-4 py-3 whitespace-nowrap">Cumulative Fresh (₹)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const hasRecycled = row.exits_recycled > 0
                return (
                  <tr
                    key={row.week}
                    className={`border-t border-surface-border ${hasRecycled ? 'bg-yellow-50' : 'hover:bg-surface-page/60'} transition-colors`}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-neutral-primary">{row.week}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{fmtAmt(row.weekly_buy)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {hasRecycled
                        ? <span className="text-yellow-700 font-semibold">{fmtAmt(row.exits_recycled)}</span>
                        : <span className="text-neutral-muted">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-neutral-primary">{fmtAmt(row.fresh_cash)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{fmtAmt(row.cumulative_fresh)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-page border-t-2 border-surface-border font-bold text-xs">
                <td className="px-4 py-3 text-neutral-muted uppercase tracking-wider">Total</td>
                <td className="px-4 py-3 text-right font-mono text-neutral-primary">{fmtAmt(totalBuy)}</td>
                <td className="px-4 py-3 text-right font-mono text-yellow-700">{totalRecycled > 0 ? fmtAmt(totalRecycled) : '—'}</td>
                <td className="px-4 py-3 text-right font-mono text-neutral-primary">{fmtAmt(totalFresh)}</td>
                <td className="px-4 py-3 text-right font-mono text-brand">{fmtAmt(lastCumFresh)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Portfolio vs Invested Chart ──────────────────────────────────────────────

function PortfolioChart({ data }: { data: SIPWeekPoint[] }) {
  if (data.length === 0) return null

  const formatted = data.map((d) => ({
    week:     d.week.slice(0, 7), // YYYY-MM
    invested: Math.round(d.cumulative_fresh),
    value:    d.portfolio_value != null ? Math.round(d.portfolio_value) : undefined,
    n50:      d.n50_value   != null ? Math.round(d.n50_value)   : undefined,
    n500:     d.n500_value  != null ? Math.round(d.n500_value)  : undefined,
  }))

  const hasN50  = formatted.some((d) => d.n50  != null)
  const hasN500 = formatted.some((d) => d.n500 != null)

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={formatted} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" />
        <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#8A93A6', fontFamily: 'JetBrains Mono' }} />
        <YAxis
          tickFormatter={(v) => '₹' + (v >= 100000 ? (v / 100000).toFixed(1) + 'L' : (v / 1000).toFixed(0) + 'K')}
          tick={{ fontSize: 11, fill: '#8A93A6', fontFamily: 'JetBrains Mono' }}
        />
        <Tooltip
          contentStyle={{ background: '#fff', border: '1px solid #E5E9F0', borderRadius: 8, fontSize: 12 }}
          formatter={(v) => fmtCurrency(typeof v === 'number' ? v : null)}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="invested" name="Fresh Invested"   stroke="#4C6FFF" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="value"    name="Portfolio Value"  stroke="#2ECC91" strokeWidth={2} dot={false} connectNulls />
        {hasN50  && <Line type="monotone" dataKey="n50"  name="Nifty 50 (if invested)"  stroke="#F39C12" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />}
        {hasN500 && <Line type="monotone" dataKey="n500" name="Nifty 500 (if invested)" stroke="#9B59B6" strokeWidth={1.5} dot={false} strokeDasharray="5 3" connectNulls />}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCards({ s }: { s: SIPSummary }) {
  const plVariant = (v: number | null): CardVariant =>
    v == null ? 'default' : v >= 0 ? 'profit' : 'loss'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      <StatCard label="Fresh Invested" value={fmtCurrency(s.fresh_invested)} variant="default" />
      <StatCard label="Portfolio Value" value={fmtCurrency(s.portfolio_value)}
        sub={`XIRR: ${fmtXirr(s.your_xirr)}`}
        variant={plVariant(s.unrealised_pl)} />
      <StatCard label="Unrealised P&L" value={fmtCurrency(s.unrealised_pl)}
        sub={fmtPct(s.portfolio_value && s.fresh_invested
          ? ((s.portfolio_value - s.fresh_invested) / s.fresh_invested) * 100 : null)}
        variant={plVariant(s.unrealised_pl)} />
      <StatCard label="Booked P&L" value={fmtCurrency(s.booked_pl)}
        variant={plVariant(s.booked_pl)} />
      <StatCard label="Your XIRR" value={fmtXirr(s.your_xirr)}
        sub="annualised" variant={plVariant(s.your_xirr)} />
      <StatCard label="If in Nifty 50"
        value={fmtCurrency(s.n50_portfolio_value)}
        sub={s.n50_xirr != null ? `XIRR: ${fmtXirr(s.n50_xirr)}` : undefined}
        sub2={s.alpha_n50 != null ? `You beat by ${fmtAlpha(s.alpha_n50)}` : undefined}
        sub2Variant={s.alpha_n50 != null ? (s.alpha_n50 >= 0 ? 'profit' : 'loss') : undefined}
        variant={plVariant(s.n50_xirr)} />
      <StatCard label="If in Nifty 500"
        value={fmtCurrency(s.n500_portfolio_value)}
        sub={s.n500_xirr != null ? `XIRR: ${fmtXirr(s.n500_xirr)}` : undefined}
        sub2={s.alpha_n500 != null ? `You beat by ${fmtAlpha(s.alpha_n500)}` : undefined}
        sub2Variant={s.alpha_n500 != null ? (s.alpha_n500 >= 0 ? 'profit' : 'loss') : undefined}
        variant={plVariant(s.n500_xirr)} />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SIPJournal() {
  const [data, setData]             = useState<SIPDashboard | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [showUpload, setShowUpload]     = useState(false)
  const [showAddTrade, setShowAddTrade] = useState(false)
  const [closingTrade, setClosingTrade] = useState<SIPTrade | null>(null)
  const [clearing, setClearing]         = useState(false)
  const [error, setError]               = useState('')

  const load = useCallback(async (showSpinner = true) => {
    setError('')
    if (showSpinner) setLoading(true)
    try {
      const d = await sipApi.getDashboard()
      setData(d)
      setLastUpdated(new Date().toLocaleTimeString('en-IN'))
    } catch {
      setError('Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(true) }, [load])

  const handleClear = async () => {
    if (!window.confirm('Delete all SIP trades and snapshots? This cannot be undone.')) return
    setClearing(true)
    try {
      await sipApi.clearData()
      await load()
    } catch {
      setError('Failed to clear data')
    } finally {
      setClearing(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await sipApi.refreshPrices()
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  const isEmpty = data && data.active_holdings.length === 0 && data.booked_pl_by_ticker.length === 0

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-neutral-primary">SIP Journal</h1>
          {lastUpdated && <p className="text-xs text-neutral-muted mt-0.5">Updated {lastUpdated}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            disabled={clearing}
            className="flex items-center gap-2 bg-white border border-loss-border text-loss-text hover:bg-loss-bg rounded-lg px-3 py-2 text-sm transition-colors font-medium disabled:opacity-50"
          >
            <Trash2 size={15} /> {clearing ? 'Clearing...' : 'Clear All'}
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 bg-white border border-surface-border text-neutral-primary hover:bg-surface-page rounded-lg px-3 py-2 text-sm transition-colors font-medium"
          >
            <Upload size={15} /> Import CSV
          </button>
          <button
            onClick={() => setShowAddTrade(true)}
            className="flex items-center gap-2 bg-white border border-surface-border text-neutral-primary hover:bg-surface-page rounded-lg px-3 py-2 text-sm transition-colors font-medium"
          >
            <Plus size={15} /> Add Trade
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 bg-brand hover:bg-brand/90 text-white rounded-lg px-3 py-2 text-sm transition-colors font-medium disabled:opacity-50"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh Prices'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-loss-bg border border-loss-border text-loss-text text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={24} className="animate-spin text-brand" />
        </div>
      )}

      {/* Stale prices warning */}
      {!loading && data?.summary.has_stale_prices && (
        <div className="bg-surface-page border border-surface-border rounded-lg px-4 py-2.5 text-xs text-neutral-muted flex items-center gap-2">
          <AlertCircle size={13} className="text-neutral-muted" />
          Some prices are stale. Click "Refresh Prices" to fetch live data.
        </div>
      )}

      {/* Empty state */}
      {!loading && isEmpty && (
        <div className="bg-white border border-surface-border rounded-xl p-10 text-center">
          <Upload size={36} className="mx-auto text-neutral-muted mb-3" />
          <h3 className="font-display font-semibold text-neutral-primary mb-1">No SIP trades yet</h3>
          <p className="text-sm text-neutral-muted mb-4">Import a CSV or add your first trade to get started.</p>
          <button onClick={() => setShowUpload(true)}
            className="bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg px-5 py-2.5 text-sm transition-colors">
            Import CSV
          </button>
        </div>
      )}

      {/* Dashboard content */}
      {!loading && data && !isEmpty && (
        <>
          <SummaryCards s={data.summary} />

          {/* Benchmark missing warning */}
          {data.summary.benchmark_missing_weeks > 0 && (
            <div className="text-xs text-neutral-muted flex items-center gap-1.5">
              <AlertCircle size={12} />
              {data.summary.benchmark_missing_weeks} week(s) missing benchmark prices — alpha may be understated.
            </div>
          )}

          {/* Chart */}
          {data.weekly_chart_data.length > 1 && (
            <div className="bg-white border border-surface-border rounded-xl p-5">
              <h2 className="font-display font-semibold text-neutral-primary mb-4">Portfolio Growth</h2>
              <PortfolioChart data={data.weekly_chart_data} />
            </div>
          )}

          {/* Weekly Cashflow Table */}
          {data.weekly_chart_data.length > 0 && (
            <WeeklyCashflowTable data={data.weekly_chart_data} />
          )}

          {/* Active Holdings */}
          <div className="bg-white border border-surface-border rounded-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h2 className="font-display font-semibold text-neutral-primary">Active Holdings</h2>
              <span className="text-xs text-neutral-muted">{data.active_holdings.length} positions</span>
            </div>
            <HoldingsTable
              holdings={data.active_holdings}
              onExit={(t) => setClosingTrade(t)}
            />
          </div>

          {/* Booked P&L */}
          {data.booked_pl_by_ticker.length > 0 && (
            <div className="bg-white border border-surface-border rounded-xl p-5">
              <BookedTable rows={data.booked_pl_by_ticker} />
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {showUpload    && <UploadModal  onClose={() => setShowUpload(false)}   onDone={load} />}
      {showAddTrade  && <AddTradeModal onClose={() => setShowAddTrade(false)} onDone={load} />}
      {closingTrade  && <CloseTradeModal trade={closingTrade} onClose={() => setClosingTrade(null)} onDone={load} />}
    </div>
  )
}
