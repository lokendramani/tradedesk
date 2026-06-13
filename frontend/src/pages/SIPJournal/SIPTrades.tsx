import { useState, useEffect, useCallback } from 'react'
import { Upload, Plus, Trash2, RefreshCw, X, AlertCircle } from 'lucide-react'
import { sipApi } from '../../api/sip'
import type { SIPTrade } from '../../types'

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

const INPUT = 'w-full bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-neutral-primary placeholder-neutral-muted focus:outline-none focus:border-brand'

// ─── Upload Modal ─────────────────────────────────────────────────────────────
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<'pick' | 'loading' | 'done' | 'error'>('pick')
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)
  const [errMsg, setErrMsg] = useState('')

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

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-surface-border rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="font-display font-semibold text-neutral-primary">Import SIP CSV</h2>
          <button onClick={onClose} className="text-neutral-muted hover:text-neutral-primary"><X size={18} /></button>
        </div>
        <div className="p-5">
          {phase === 'pick' && (
            <>
              <div
                className="border-2 border-dashed border-surface-border rounded-xl p-10 text-center cursor-pointer hover:border-brand transition-colors"
                onClick={() => document.getElementById('sip-file-input')?.click()}
                onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
                onDragOver={(e) => e.preventDefault()}
              >
                <Upload size={32} className="mx-auto text-neutral-muted mb-3" />
                <p className="text-sm text-neutral-muted">
                  Drag &amp; drop CSV or <span className="text-brand font-medium">browse</span>
                </p>
                <p className="text-xs text-neutral-muted mt-2">
                  Columns: Date, ETF, AssetClass, Ticker, Qty, Price
                </p>
              </div>
              <input id="sip-file-input" type="file" accept=".csv" className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
            </>
          )}
          {phase === 'loading' && (
            <div className="text-center py-8">
              <RefreshCw size={28} className="animate-spin mx-auto text-brand mb-3" />
              <p className="text-sm text-neutral-muted">Uploading...</p>
            </div>
          )}
          {phase === 'done' && result && (
            <div className="space-y-3">
              <div className="bg-profit-bg border border-profit-border rounded-lg p-4 text-sm">
                <div className="font-semibold text-profit-text mb-1">Import complete</div>
                <div className="text-neutral-muted">{result.imported} trades imported</div>
              </div>
              {result.errors.length > 0 && (
                <div className="bg-loss-bg border border-loss-border rounded-lg p-3 text-xs text-loss-text space-y-1 max-h-40 overflow-y-auto">
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
function AddTradeModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ trade_date: '', etf_name: '', asset_class: 'Equity', ticker: '', qty: '', price: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await sipApi.addTrade({ ...form, qty: parseFloat(form.qty), price: parseFloat(form.price) } as Partial<SIPTrade>)
      onDone(); onClose()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setErr(ax.response?.data?.error ?? 'Failed to save')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-surface-border rounded-xl shadow-lg w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="font-display font-semibold text-neutral-primary">Add Trade</h2>
          <button onClick={onClose} className="text-neutral-muted hover:text-neutral-primary"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {err && <div className="bg-loss-bg border border-loss-border text-loss-text text-xs rounded-lg px-3 py-2">{err}</div>}
          <div>
            <label className="block text-xs text-neutral-muted mb-1">Buy Date</label>
            <input type="date" className={INPUT} value={form.trade_date} onChange={e => set('trade_date', e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs text-neutral-muted mb-1">ETF Name</label>
            <input type="text" className={INPUT} value={form.etf_name} onChange={e => set('etf_name', e.target.value)} placeholder="Gold BEES" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-muted mb-1">Asset Class</label>
              <select className={INPUT} value={form.asset_class} onChange={e => set('asset_class', e.target.value)}>
                <option>Equity</option><option>Debt</option><option>Gold</option><option>International</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-neutral-muted mb-1">Ticker</label>
              <input type="text" className={`${INPUT} uppercase`} value={form.ticker} onChange={e => set('ticker', e.target.value.toUpperCase())} placeholder="GOLDBEES" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-muted mb-1">Qty</label>
              <input type="number" step="0.0001" className={INPUT} value={form.qty} onChange={e => set('qty', e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-neutral-muted mb-1">Buy Price ₹</label>
              <input type="number" step="0.01" className={INPUT} value={form.price} onChange={e => set('price', e.target.value)} required />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : 'Add Trade'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Close Trade Modal ────────────────────────────────────────────────────────
// ─── Asset class badge ────────────────────────────────────────────────────────
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SIPTrades() {
  const [trades, setTrades] = useState<SIPTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showAdd, setShowAdd]       = useState(false)
  const [clearing, setClearing]     = useState(false)
  const [sortAsc, setSortAsc]  = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await sipApi.listTrades()
      setTrades(data)
    } catch {
      setError('Failed to load trades')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleClear = async () => {
    if (!window.confirm('Delete all SIP trades? This cannot be undone.')) return
    setClearing(true)
    try { await sipApi.clearData(); setTrades([]) }
    catch { setError('Failed to clear') }
    finally { setClearing(false) }
  }

  const sorted = [...trades].sort((a, b) => {
    const diff = a.trade_date.localeCompare(b.trade_date)
    return sortAsc ? diff : -diff
  })

  const openCount    = trades.filter(t => !t.exit_date).length
  const closedCount  = trades.filter(t =>  t.exit_date).length
  const totalInvested = trades.reduce((s, t) => s + (t.trade_value ?? 0), 0)

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-neutral-primary">SIP Trades</h1>
          <p className="text-xs text-neutral-muted mt-0.5">
            {trades.length} trades &nbsp;·&nbsp; {openCount} open &nbsp;·&nbsp; {closedCount} exited &nbsp;·&nbsp; Total invested {fmt(totalInvested)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleClear} disabled={clearing || trades.length === 0}
            className="flex items-center gap-1.5 bg-white border border-loss-border text-loss-text hover:bg-loss-bg rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40">
            <Trash2 size={14} /> {clearing ? 'Clearing...' : 'Clear All'}
          </button>
          <button onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 bg-white border border-surface-border text-neutral-primary hover:bg-surface-page rounded-lg px-3 py-2 text-sm font-medium transition-colors">
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 bg-brand hover:bg-brand/90 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors">
            <Plus size={14} /> Add Trade
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-loss-bg border border-loss-border text-loss-text text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <RefreshCw size={22} className="animate-spin text-brand" />
        </div>
      ) : trades.length === 0 ? (
        <div className="bg-white border border-surface-border rounded-xl p-12 text-center">
          <Upload size={36} className="mx-auto text-neutral-muted mb-3" />
          <h3 className="font-display font-semibold text-neutral-primary mb-1">No trades yet</h3>
          <p className="text-sm text-neutral-muted mb-5">Import your SIP CSV to get started.</p>
          <button onClick={() => setShowUpload(true)}
            className="bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition-colors">
            Import CSV
          </button>
        </div>
      ) : (
        <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-page border-b border-surface-border text-[11px] text-neutral-muted uppercase tracking-wider">
                  <th
                    className="text-left px-4 py-3 cursor-pointer hover:text-brand select-none whitespace-nowrap"
                    onClick={() => setSortAsc(v => !v)}
                  >
                    Date {sortAsc ? '↑' : '↓'}
                  </th>
                  <th className="text-left px-4 py-3">ETF</th>
                  <th className="text-left px-4 py-3">Class</th>
                  <th className="text-left px-4 py-3">Ticker</th>
                  <th className="text-right px-4 py-3">Qty</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Buy Price</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Trade Value</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Exit Date</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Exit Price</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Exit Value</th>
                  <th className="text-right px-4 py-3">P&amp;L</th>
                  <th className="text-center px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => {
                  const pl = t.pl
                  const isProfit = pl != null && pl > 0
                  const isLoss   = pl != null && pl < 0
                  return (
                    <tr key={t.id} className="border-b border-surface-border last:border-0 hover:bg-surface-page/60 group transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-neutral-muted whitespace-nowrap">{t.trade_date}</td>
                      <td className="px-4 py-2.5 max-w-[160px]">
                        <span className="text-xs text-neutral-primary truncate block" title={t.etf_name}>{t.etf_name}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <AssetBadge cls={t.asset_class} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-neutral-primary">{t.ticker}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{t.qty}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">{fmt(t.price)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-medium text-neutral-primary">{fmt(t.trade_value)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-muted whitespace-nowrap">
                        {t.exit_date ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-neutral-primary">
                        {t.exit_price != null ? fmt(t.exit_price) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-medium text-neutral-primary">
                        {t.exit_value != null ? fmt(t.exit_value) : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold whitespace-nowrap ${
                        isProfit ? 'text-profit-text' : isLoss ? 'text-loss-text' : 'text-neutral-muted'
                      }`}>
                        {pl != null ? (isProfit ? '+' : '') + fmt(pl) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {t.exit_date
                          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-page text-neutral-muted border border-surface-border">Exited</span>
                          : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand/10 text-brand">Open</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onDone={load} />}
      {showAdd    && <AddTradeModal onClose={() => setShowAdd(false)} onDone={load} />}
    </div>
  )
}
