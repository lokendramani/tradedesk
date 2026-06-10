import { useEffect, useState, useCallback, useRef } from 'react'
import { tradesApi } from '../../api/trades'
import { useAuthStore } from '../../store/authStore'
import { formatCurrency, formatDate, isProfit, isLoss } from '../../utils/format'
import type { Trade } from '../../types'

// ── Helpers ───────────────────────────────────────────────────────────────────
const SEGMENTS = ['EQUITY', 'COMMODITY', 'F_AND_O'] as const
const SEG_LABEL: Record<string, string> = { EQUITY: 'Equity', COMMODITY: 'Commodity', F_AND_O: 'F&O' }

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${cls}`}>{text}</span>
}

function InputField({
  label, value, onChange, type = 'text', required = false, step,
}: {
  label: string; value: string | number; onChange: (v: string) => void
  type?: string; required?: boolean; step?: string
}) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        required={required} step={step}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100
                   placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
      />
    </div>
  )
}

function SelectField({
  label, value, onChange, options, required = false,
}: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; required?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</label>
      <select
        value={value} onChange={(e) => onChange(e.target.value)} required={required}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100
                   focus:outline-none focus:border-blue-500 transition-colors"
      >
        <option value="">Select...</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function ModalWrapper({
  title, children, onClose, wide = false,
}: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-gray-900 border border-[#1e2330] rounded-xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2330]">
          <h2 className="text-base font-semibold text-gray-100">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

// ── Add / Edit Trade Modal ────────────────────────────────────────────────────
interface TradeForm {
  scrip_name: string; segment: string; direction: string
  legs: string; entry_date: string; entry_price: string
  quantity: string; stop_loss: string; notes: string
}

function AddEditModal({
  trade, onClose, onSave,
}: {
  trade: Trade | null; onClose: () => void; onSave: (data: Partial<Trade>) => Promise<void>
}) {
  const [form, setForm] = useState<TradeForm>(() =>
    trade ? {
      scrip_name:  trade.scrip_name,
      segment:     trade.segment,
      direction:   trade.direction,
      legs:        trade.legs?.toString() ?? '',
      entry_date:  trade.entry_date,
      entry_price: trade.entry_price.toString(),
      quantity:    trade.quantity.toString(),
      stop_loss:   trade.stop_loss?.toString() ?? '',
      notes:       trade.notes ?? '',
    } : {
      scrip_name: '', segment: '', direction: '', legs: '',
      entry_date: new Date().toISOString().slice(0, 10),
      entry_price: '', quantity: '', stop_loss: '', notes: '',
    }
  )
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (key: keyof TradeForm) => (v: string) => setForm((f) => ({ ...f, [key]: v }))

  const ep  = parseFloat(form.entry_price) || 0
  const sl  = parseFloat(form.stop_loss)   || 0
  const qty = parseFloat(form.quantity)    || 0
  const target   = ep && sl ? (form.direction === 'LONG' ? ep + 2 * Math.abs(ep - sl) : ep - 2 * Math.abs(ep - sl)) : null
  const initRisk = ep && sl && qty ? Math.abs(ep - sl) * qty : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await onSave({
        scrip_name:  form.scrip_name,
        segment:     form.segment,
        direction:   form.direction,
        legs:        form.legs ? parseInt(form.legs) : null,
        entry_date:  form.entry_date,
        entry_price: parseFloat(form.entry_price),
        quantity:    parseFloat(form.quantity),
        stop_loss:   form.stop_loss ? parseFloat(form.stop_loss) : null,
        notes:       form.notes,
      })
      onClose()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } }
      setError(ax.response?.data?.message ?? 'Failed to save trade')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalWrapper onClose={onClose} title={trade ? 'Edit Trade' : 'Add Trade'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Scrip Name"   value={form.scrip_name}  onChange={set('scrip_name')}  required />
          <SelectField label="Segment" value={form.segment} onChange={set('segment')} required
            options={[{ value: 'EQUITY', label: 'Equity' }, { value: 'COMMODITY', label: 'Commodity' }, { value: 'F_AND_O', label: 'F&O' }]} />
          <SelectField label="Direction" value={form.direction} onChange={set('direction')} required
            options={[{ value: 'LONG', label: 'Long' }, { value: 'SHORT', label: 'Short' }]} />
          {form.segment === 'F_AND_O' && (
            <InputField label="Legs" value={form.legs} onChange={set('legs')} type="number" />
          )}
          <InputField label="Entry Date"    value={form.entry_date}  onChange={set('entry_date')}  type="date"   required />
          <InputField label="Entry Price ₹" value={form.entry_price} onChange={set('entry_price')} type="number" required step="0.01" />
          <InputField label="Quantity"      value={form.quantity}    onChange={set('quantity')}    type="number" required />
          <InputField label="Stop Loss ₹"  value={form.stop_loss}   onChange={set('stop_loss')}   type="number" step="0.01" />
        </div>

        {(target !== null || initRisk !== null) && (
          <div className="bg-gray-800/50 rounded px-3 py-2 text-xs font-mono flex gap-4 flex-wrap">
            {target   !== null && <span className="text-gray-400">Target: <span className="text-emerald-400">{formatCurrency(target)}</span></span>}
            {initRisk !== null && <span className="text-gray-400">Init Risk: <span className="text-red-400">{formatCurrency(initRisk)}</span></span>}
          </div>
        )}

        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => set('notes')(e.target.value)} rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100
                       focus:outline-none focus:border-blue-500 transition-colors resize-none" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors disabled:opacity-50">
            {saving ? 'Saving...' : (trade ? 'Update' : 'Add Trade')}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}

// ── Close Trade Modal ─────────────────────────────────────────────────────────
function CloseTradeModal({
  trade, onClose, onSave,
}: {
  trade: Trade; onClose: () => void; onSave: (closeDate: string, closePrice: number) => Promise<void>
}) {
  const [closeDate,  setCloseDate]  = useState(new Date().toISOString().slice(0, 10))
  const [closePrice, setClosePrice] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const grossPL = (() => {
    const cp = parseFloat(closePrice)
    if (!cp) return null
    return trade.direction === 'LONG'
      ? (cp - trade.entry_price) * trade.quantity
      : (trade.entry_price - cp) * trade.quantity
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await onSave(closeDate, parseFloat(closePrice))
      onClose()
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } }
      setError(ax.response?.data?.message ?? 'Failed to close trade')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalWrapper onClose={onClose} title={`Close — ${trade.scrip_name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>}
        <div className="text-xs text-gray-500 bg-gray-800/50 rounded px-3 py-2 flex gap-3 flex-wrap">
          <span>Entry: <span className="text-gray-300">{formatCurrency(trade.entry_price)}</span></span>
          <span>Qty: <span className="text-gray-300">{trade.quantity}</span></span>
          <span>Direction: <span className="text-gray-300">{trade.direction}</span></span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Close Date"    value={closeDate}  onChange={setCloseDate}  type="date"   required />
          <InputField label="Close Price ₹" value={closePrice} onChange={setClosePrice} type="number" step="0.01" required />
        </div>
        {grossPL !== null && (
          <div className="bg-gray-800/50 rounded px-3 py-2 text-xs font-mono">
            Est. Gross P&amp;L: <span className={grossPL >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(grossPL)}</span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors disabled:opacity-50">
            {saving ? 'Closing...' : 'Close Trade'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}

// ── CSV Import — helpers ──────────────────────────────────────────────────────

// Proper CSV parser — handles quoted fields with commas inside
function parseCSVText(text: string): string[][] {
  const rows: string[][] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue
    const cells: string[] = []
    let i = 0
    while (i <= line.length) {
      if (i === line.length) { cells.push(''); break }
      if (line[i] === '"') {
        i++
        let cell = ''
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i += 2 }
          else if (line[i] === '"') { i++; break }
          else { cell += line[i++] }
        }
        cells.push(cell.trim())
        if (line[i] === ',') i++
      } else {
        const end = line.indexOf(',', i)
        if (end === -1) { cells.push(line.slice(i).trim()); break }
        cells.push(line.slice(i, end).trim())
        i = end + 1
      }
    }
    rows.push(cells)
  }
  return rows
}

// Value normalizers applied before sending to API
function normDate(v: string): string {
  const s = v.trim()
  const MONTHS: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  }
  // 1-Apr-2026, 15-Mar-24, 4-April-2024, 01-January-24, etc.
  const m1 = s.match(/^(\d{1,2})[/-]([A-Za-z]{3,9})[/-](\d{2,4})$/)
  if (m1) {
    const mo = MONTHS[m1[2].toLowerCase()]
    const yr = m1[3].length === 2 ? `20${m1[3]}` : m1[3]
    if (mo) return `${yr}-${mo}-${m1[1].padStart(2, '0')}`
  }
  // DD/MM/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Fallback: native parse
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10)
}

function normSegment(v: string): string {
  const u = v.trim().toUpperCase().replace(/\s+/g, '')
  if (['F&O', 'FNO', 'F_AND_O', 'FANDO', 'FUTURES', 'OPTIONS', 'DERIVATIVE', 'DERIVATIVES'].includes(u)) return 'F_AND_O'
  if (['COMMODITY', 'COMM', 'MCX'].includes(u)) return 'COMMODITY'
  if (['EQUITY', 'EQ', 'STOCK', 'NSE', 'BSE', 'CASH'].includes(u)) return 'EQUITY'
  return v.trim()
}

function normDirection(v: string): string {
  const u = v.trim().toUpperCase()
  if (['LONG', 'BUY', 'B', 'L'].includes(u)) return 'LONG'
  if (['SHORT', 'SELL', 'S', 'SH'].includes(u)) return 'SHORT'
  return v.trim()
}

// Extract meaningful CSV headers (stop at first blank/numeric column)
function extractHeaders(headerRow: string[]): string[] {
  const result: string[] = []
  for (const h of headerRow) {
    const clean = h.trim()
    if (!clean) break                          // blank = separator, stop here
    if (/^\d+(\.\d+)?$/.test(clean)) break    // purely numeric = summary data
    result.push(clean)
  }
  return result
}

// Auto-detect which CSV header maps to which trade field
const AUTO_KEYWORDS: Record<string, string[]> = {
  scrip_name:    ['scripname', 'scrip', 'symbol', 'stock', 'instrument', 'security', 'name', 'scrip_name'],
  segment:       ['segment', 'market', 'assetclass', 'type'],
  direction:     ['direction', 'long/short', 'longorshort', 'side', 'buy/sell', 'longshort'],
  entry_date:    ['date', 'entrydate', 'entry_date', 'entrydt', 'tradedate', 'opendate'],
  entry_price:   ['entryprice', 'entry_price', 'buyprice', 'openprice', 'price'],
  quantity:      ['qty', 'quantity', 'lot', 'lots', 'shares', 'volume', 'vol'],
  stop_loss:     ['sl', 'stoploss', 'stop_loss', 'stoplosslevel', 'stop'],
  target:        ['target', 'targetprice', 'target_price', 'tp'],
  initial_risk:  ['initialrisk', 'initial_risk', 'risk', 'riskamount'],
  legs:          ['legs', 'leg', 'lotcount', 'contracts'],
  close_date:    ['closedate', 'close_date', 'exitdate', 'closingdate'],
  close_price:   ['closeprice', 'close_price', 'exitprice', 'closingprice'],
  gross_pl:      ['profit/loss', 'profitloss', 'gross_pl', 'grosspl', 'pl', 'pnl', 'grossprofit'],
  charges:       ['charges', 'charge', 'brokerage', 'fees', 'fee', 'commission'],
  net_income:    ['netincome', 'net_income', 'netpl', 'netprofit', 'net'],
  risk_reward:   ['risk/reward', 'riskreward', 'riskrew', 'rr', 'rratio'],
  notes:         ['remark', 'remarks', 'notes', 'note', 'comment', 'comments', 'description'],
}

function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const [field, keywords] of Object.entries(AUTO_KEYWORDS)) {
    const match = headers.find((h) =>
      keywords.includes(h.toLowerCase().replace(/[\s_/]/g, ''))
    )
    if (match) mapping[field] = match
  }
  return mapping
}

const IMPORT_FIELDS = [
  { key: 'scrip_name',   label: 'Scrip Name',    required: true,  desc: 'Stock ticker or instrument name (e.g. RELIANCE, NIFTY25000CE)' },
  { key: 'segment',      label: 'Segment',        required: true,  desc: 'EQUITY, COMMODITY, or F&O' },
  { key: 'direction',    label: 'Direction',      required: true,  desc: 'LONG (buy) or SHORT (sell). Also accepts BUY/SELL or B/S' },
  { key: 'entry_date',   label: 'Entry Date',     required: true,  desc: 'Trade entry date. Accepts YYYY-MM-DD, DD-MMM-YYYY, DD-MMM-YY, DD/MM/YYYY' },
  { key: 'entry_price',  label: 'Entry Price ₹',  required: true,  desc: 'Price per share/unit at entry' },
  { key: 'quantity',     label: 'Quantity',        required: true,  desc: 'Number of shares, units, or lots' },
  { key: 'stop_loss',    label: 'Stop Loss ₹',    required: false, desc: 'Stop-loss price level. Used to auto-calculate Initial Risk and Target' },
  { key: 'target',       label: 'Target ₹',       required: false, desc: 'Target price. Auto-calculated as entry ± 2× SL distance if not provided' },
  { key: 'initial_risk', label: 'Initial Risk ₹', required: false, desc: 'Risk in ₹ (= |entry − SL| × qty). Auto-calculated if Stop Loss is provided' },
  { key: 'legs',         label: 'Legs (F&O)',      required: false, desc: 'Number of lots/legs for F&O trades. Used for brokerage (₹130 per leg)' },
  { key: 'close_date',   label: 'Close Date',     required: false, desc: 'Date you exited the trade (same formats as Entry Date)' },
  { key: 'close_price',  label: 'Close Price ₹',  required: false, desc: 'Price per share/unit at exit' },
  { key: 'gross_pl',     label: 'Gross P&L ₹',    required: false, desc: 'Auto-calculated from entry/exit prices and quantity' },
  { key: 'charges',      label: 'Charges ₹',      required: false, desc: 'Auto-calculated: Equity 0.11%, Commodity 0.02%, F&O ₹130/leg' },
  { key: 'net_income',   label: 'Net Income ₹',   required: false, desc: 'Gross P&L minus charges. Auto-calculated' },
  { key: 'risk_reward',  label: 'Risk/Reward',     required: false, desc: 'Net Income ÷ Initial Risk ratio. Auto-calculated' },
  { key: 'notes',        label: 'Notes/Remarks',  required: false, desc: 'Any trade notes, logic, or comments' },
]

// ── CSV Import Modal ──────────────────────────────────────────────────────────
type ImportMode = 'smart' | 'append_from_date' | 'replace'

const IMPORT_MODES: { value: ImportMode; label: string; desc: string }[] = [
  { value: 'smart',            label: 'Smart',            desc: 'Skip duplicates automatically'       },
  { value: 'append_from_date', label: 'Append from Date', desc: 'Only import trades on/after a date'  },
  { value: 'replace',          label: 'Replace All',      desc: 'Delete all trades, then import fresh' },
]

function ImportModal({
  onClose, portfolioId, onDone,
}: {
  onClose: () => void
  portfolioId: string
  onDone: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  type Phase = 'upload' | 'mapping' | 'importing' | 'done'
  const [phase,    setPhase]    = useState<Phase>('upload')
  const [headers,  setHeaders]  = useState<string[]>([])
  const [colIndex, setColIndex] = useState<Record<string, number>>({})
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping,  setMapping]  = useState<Record<string, string>>({})
  const [fileName, setFileName] = useState('')
  const [mode,     setMode]     = useState<ImportMode>('smart')
  const [fromDate, setFromDate] = useState('')
  const [progress, setProgress] = useState({
    done: 0, total: 0, imported: 0, duplicates: 0, errors: [] as string[],
  })

  const handleFile = (f: File | null) => {
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const allRows = parseCSVText(text)
      if (allRows.length < 2) return
      const hdrs = extractHeaders(allRows[0])
      const idxMap: Record<string, number> = {}
      allRows[0].forEach((h, i) => { idxMap[h.trim()] = i })
      const rows = allRows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''))
      setHeaders(hdrs)
      setColIndex(idxMap)
      setDataRows(rows)
      setMapping(autoDetectMapping(hdrs))
      setPhase('mapping')
    }
    reader.readAsText(f)
  }

  const getCell = (row: string[], header: string) => {
    const idx = colIndex[header]
    return idx !== undefined ? (row[idx] ?? '').trim() : ''
  }

  const buildTradeData = (row: string[]): { trade: Partial<Trade>; scrip_name: string } | null => {
    const get = (field: string) => getCell(row, mapping[field] ?? '')
    const name = get('scrip_name')
    if (!name) return null
    const entry_price = parseFloat(get('entry_price'))
    const quantity    = parseFloat(get('quantity'))
    if (isNaN(entry_price) || isNaN(quantity)) return null

    const trade: Partial<Trade> = {
      scrip_name:  name,
      segment:     normSegment(get('segment'))    as Trade['segment'],
      direction:   normDirection(get('direction')) as Trade['direction'],
      entry_date:  normDate(get('entry_date')),
      entry_price,
      quantity,
    }
    const sl = get('stop_loss'); const target = get('target')
    const initRisk = get('initial_risk'); const legs = get('legs'); const note = get('notes')
    if (sl)       trade.stop_loss    = parseFloat(sl)
    if (target)   trade.target       = parseFloat(target)
    if (initRisk) trade.initial_risk = parseFloat(initRisk)
    if (legs)     trade.legs         = parseInt(legs)
    if (note)     trade.notes        = note

    const close_date = get('close_date'); const close_price = get('close_price')
    const gross_pl   = get('gross_pl');   const charges     = get('charges')
    const net_income = get('net_income'); const risk_reward = get('risk_reward')
    if (close_date)  trade.close_date  = normDate(close_date)
    if (close_price) trade.close_price = parseFloat(close_price)
    if (gross_pl)    trade.gross_pl    = parseFloat(gross_pl)
    if (charges)     trade.charges     = parseFloat(charges)
    if (net_income)  trade.net_income  = parseFloat(net_income)
    if (risk_reward) trade.risk_reward = parseFloat(risk_reward)

    return { trade, scrip_name: name }
  }

  const handleImport = async () => {
    const allTrades = dataRows
      .map((r) => buildTradeData(r))
      .filter((r): r is { trade: Partial<Trade>; scrip_name: string } => r !== null)
      .map((r) => r.trade)

    setProgress({ done: 0, total: allTrades.length, imported: 0, duplicates: 0, errors: [] })
    setPhase('importing')

    try {
      const result = await tradesApi.bulkImport(
        portfolioId,
        allTrades,
        mode,
        fromDate || undefined,
      )
      setProgress({
        done:       allTrades.length,
        total:      allTrades.length,
        imported:   result.imported,
        duplicates: result.duplicates,
        errors:     result.errors,
      })
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } }
      setProgress((p) => ({
        ...p,
        errors: [ax.response?.data?.message ?? 'Import failed — check server connection'],
      }))
    }

    setPhase('done')
    onDone()
  }

  const previewRows = dataRows.slice(0, 3).map((row) => ({
    scrip:     getCell(row, mapping.scrip_name  ?? ''),
    segment:   normSegment(getCell(row, mapping.segment    ?? '')),
    direction: normDirection(getCell(row, mapping.direction ?? '')),
    date:      normDate(getCell(row, mapping.entry_date   ?? '')),
    price:     getCell(row, mapping.entry_price ?? ''),
    qty:       getCell(row, mapping.quantity    ?? ''),
  }))

  return (
    <ModalWrapper onClose={onClose} title="Import Trades from CSV" wide>
      <div className="space-y-4">

        {/* ── Upload phase ── */}
        {phase === 'upload' && (
          <div className="space-y-3">
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-700 hover:border-blue-500/50 rounded-lg p-10 text-center cursor-pointer transition-colors"
            >
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
              <div className="text-3xl mb-3">📂</div>
              <div className="text-sm text-gray-400">Click to select your CSV file</div>
              <div className="text-xs text-gray-600 mt-1">Columns are auto-detected and mapped</div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-600">Don't have the right format?</span>
              <button
                onClick={async (e) => { e.stopPropagation(); await tradesApi.downloadSampleCsv(portfolioId) }}
                className="text-xs text-blue-400 hover:text-blue-300 border border-blue-400/30 hover:border-blue-400/60 rounded px-3 py-1.5 transition-colors"
              >
                ↓ Download Sample CSV
              </button>
            </div>
          </div>
        )}

        {/* ── Mapping phase ── */}
        {phase === 'mapping' && (
          <>
            {/* File + row count */}
            <div className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2">
              <span className="text-xs text-blue-400 font-mono">{fileName}</span>
              <span className="text-xs text-gray-500">{dataRows.length} trade row{dataRows.length !== 1 ? 's' : ''} detected</span>
            </div>

            {/* ── Import mode selector ── */}
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Import Mode</div>
              <div className="grid grid-cols-3 gap-2">
                {IMPORT_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={`px-3 py-2.5 rounded border text-left transition-colors ${
                      mode === m.value
                        ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                        : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                    }`}
                  >
                    <div className="text-xs font-semibold">{m.label}</div>
                    <div className="text-[10px] text-gray-600 mt-0.5 leading-tight">{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* From date picker */}
              {mode === 'append_from_date' && (
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-[10px] text-gray-500 uppercase tracking-widest whitespace-nowrap">
                    Import from date
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100
                               focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  {fromDate && (
                    <span className="text-[10px] text-gray-500">
                      {dataRows.filter((row) => normDate(getCell(row, mapping.entry_date ?? '')) >= fromDate).length} rows match
                    </span>
                  )}
                </div>
              )}

              {/* Replace warning */}
              {mode === 'replace' && (
                <div className="mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
                  <span className="text-red-400 text-base flex-shrink-0 leading-tight">⚠</span>
                  <div className="text-xs text-red-400">
                    <strong>Warning:</strong> This will permanently delete all existing trades in this portfolio before importing. This cannot be undone.
                  </div>
                </div>
              )}
            </div>

            {/* Mapping grid */}
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Map Columns</div>
              <div className="grid grid-cols-2 gap-2">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="flex items-center gap-1 text-[10px] text-gray-600 mb-0.5">
                      {field.label}
                      {field.required && <span className="text-red-400">*</span>}
                      <span title={field.desc} className="text-gray-600 hover:text-gray-300 cursor-help leading-none">ⓘ</span>
                    </label>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                      className={`w-full bg-gray-800 border rounded px-2 py-1.5 text-xs text-gray-100
                                 focus:outline-none focus:border-blue-500 transition-colors ${
                        mapping[field.key]
                          ? 'border-blue-400/40'
                          : field.required ? 'border-red-500/30' : 'border-gray-700'
                      }`}
                    >
                      <option value="">— Skip —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview */}
            {previewRows.some((r) => r.scrip) && (
              <div>
                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Preview (first 3 rows)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="text-[10px] text-gray-600 uppercase">
                        {['Scrip', 'Seg', 'Dir', 'Date', 'Price', 'Qty'].map((h) => (
                          <th key={h} className="text-left pr-4 pb-1">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="text-gray-400">
                          <td className="pr-4 py-1 text-gray-200">{r.scrip || '—'}</td>
                          <td className="pr-4 py-1">{r.segment || '—'}</td>
                          <td className={`pr-4 py-1 ${r.direction === 'LONG' ? 'text-emerald-400' : r.direction === 'SHORT' ? 'text-red-400' : ''}`}>
                            {r.direction || '—'}
                          </td>
                          <td className="pr-4 py-1">{r.date || '—'}</td>
                          <td className="pr-4 py-1">{r.price || '—'}</td>
                          <td className="py-1">{r.qty || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={
                  !mapping.scrip_name || !mapping.entry_date || !mapping.entry_price ||
                  (mode === 'append_from_date' && !fromDate)
                }
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors disabled:opacity-40"
              >
                {mode === 'replace' ? '⚠ Replace & Import' : `Import ${dataRows.length} Trades`}
              </button>
            </div>
          </>
        )}

        {/* ── Importing phase ── */}
        {phase === 'importing' && (
          <div className="py-10 text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-sm text-gray-300">
              {mode === 'replace'
                ? `Replacing all trades — sending ${progress.total} rows…`
                : mode === 'append_from_date'
                  ? `Importing trades from ${fromDate} — sending ${progress.total} rows…`
                  : `Importing ${progress.total} trades (checking duplicates)…`}
            </div>
            <div className="text-xs text-gray-600">This completes in one request — no waiting per row</div>
          </div>
        )}

        {/* ── Done phase ── */}
        {phase === 'done' && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-3 text-center">
                <div className="text-xl font-bold text-blue-400 font-mono">{progress.imported}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Imported</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-3 text-center">
                <div className="text-xl font-bold text-gray-400 font-mono">{progress.duplicates}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Duplicates</div>
              </div>
              <div className={`rounded-lg px-3 py-3 text-center ${
                progress.errors.length > 0
                  ? 'bg-red-500/10 border border-red-500/20'
                  : 'bg-gray-800/50 border border-gray-700'
              }`}>
                <div className={`text-xl font-bold font-mono ${progress.errors.length > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  {progress.errors.length}
                </div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">Errors</div>
              </div>
            </div>

            {progress.errors.length > 0 && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 max-h-32 overflow-y-auto">
                {progress.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-400 py-0.5">{e}</div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={onClose}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors">
                Done
              </button>
            </div>
          </div>
        )}

      </div>
    </ModalWrapper>
  )
}

// ── Delete confirm ────────────────────────────────────────────────────────────
function DeleteConfirm({
  trade, onClose, onConfirm,
}: {
  trade: Trade; onClose: () => void; onConfirm: () => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  return (
    <ModalWrapper onClose={onClose} title="Delete Trade">
      <p className="text-sm text-gray-300 mb-4">
        Delete <span className="text-white font-semibold">{trade.scrip_name}</span> ({formatDate(trade.entry_date)})?
        This cannot be undone.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors">
          Cancel
        </button>
        <button
          onClick={async () => { setLoading(true); await onConfirm(); setLoading(false) }}
          disabled={loading}
          className="px-4 py-2 text-sm bg-red-500 hover:bg-red-400 text-white font-semibold rounded transition-colors disabled:opacity-50">
          {loading ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </ModalWrapper>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
type ModalType = 'add' | 'edit' | 'close' | 'import' | 'delete' | null

export default function Trades() {
  const { portfolioId } = useAuthStore()
  const [trades,        setTrades]        = useState<Trade[]>([])
  const [loading,       setLoading]       = useState(true)
  const [modal,         setModal]         = useState<ModalType>(null)
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)

  const [search,    setSearch]    = useState('')
  const [segment,   setSegment]   = useState('')
  const [direction, setDirection] = useState('')
  const [status,    setStatus]    = useState('')
  const [result,    setResult]    = useState('')

  const load = useCallback(async () => {
    if (!portfolioId) return
    setLoading(true)
    try {
      const data = await tradesApi.getAll(portfolioId, {
        segment:     segment    || undefined,
        direction:   direction  || undefined,
        only_open:   status === 'open'   || undefined,
        only_closed: status === 'closed' || undefined,
        only_profit: result === 'profit' || undefined,
        only_loss:   result === 'loss'   || undefined,
        search:      search || undefined,
      })
      setTrades(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }, [portfolioId, segment, direction, status, result, search])

  useEffect(() => { load() }, [load])

  const openAdd    = () => { setSelectedTrade(null); setModal('add') }
  const openEdit   = (t: Trade) => { setSelectedTrade(t); setModal('edit') }
  const openClose  = (t: Trade) => { setSelectedTrade(t); setModal('close') }
  const openDelete = (t: Trade) => { setSelectedTrade(t); setModal('delete') }
  const closeModal = () => { setModal(null); setSelectedTrade(null) }

  const handleAdd    = async (data: Partial<Trade>) => { if (!portfolioId) return; await tradesApi.create(portfolioId, data); await load() }
  const handleEdit   = async (data: Partial<Trade>) => { if (!portfolioId || !selectedTrade) return; await tradesApi.update(portfolioId, selectedTrade.id, data); await load() }
  const handleClose  = async (cd: string, cp: number) => { if (!portfolioId || !selectedTrade) return; await tradesApi.close(portfolioId, selectedTrade.id, cd, cp); await load() }
  const handleDelete = async () => { if (!portfolioId || !selectedTrade) return; await tradesApi.delete(portfolioId, selectedTrade.id); closeModal(); await load() }

  const clearFilters = () => { setSegment(''); setDirection(''); setStatus(''); setResult(''); setSearch('') }
  const hasFilters   = !!(segment || direction || status || result || search)

  return (
    <div className="p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-gray-100">Trade Log</h1>
        <div className="flex items-center gap-2">
          {trades.length > 0 && portfolioId && (
            <button
              onClick={() => tradesApi.exportCsv(portfolioId)}
              className="px-3 py-2 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded transition-colors"
            >
              ↓ Export CSV
            </button>
          )}
          <button onClick={() => setModal('import')}
            className="px-3 py-2 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded transition-colors">
            Import CSV
          </button>
          <button onClick={openAdd}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded transition-colors">
            + Add Trade
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scrip..."
          className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 w-40
                     placeholder-gray-600 focus:outline-none focus:border-blue-500"
        />
        <select value={segment} onChange={(e) => setSegment(e.target.value)}
          className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-blue-500">
          <option value="">All Segments</option>
          {SEGMENTS.map((s) => <option key={s} value={s}>{SEG_LABEL[s]}</option>)}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)}
          className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-blue-500">
          <option value="">All Directions</option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-blue-500">
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
        <select value={result} onChange={(e) => setResult(e.target.value)}
          className="bg-gray-900 border border-[#1e2330] text-gray-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-blue-500">
          <option value="">All Results</option>
          <option value="profit">Profit</option>
          <option value="loss">Loss</option>
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-300 underline">Clear</button>
        )}
        {loading && <span className="text-xs text-gray-600 animate-pulse">Loading...</span>}
        <span className="text-xs text-gray-600 ml-auto">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-[#1e2330] rounded-lg overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-220px)]">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 z-20 bg-gray-900">
              <tr className="border-b border-[#1e2330]">
                {['Scrip', 'Seg', 'Dir', 'Entry Date', 'Entry ₹', 'Qty', 'SL ₹', 'Target ₹',
                  'Init Risk', 'Close Date', 'Close ₹', 'Gross P&L', 'Charges', 'Net ₹', 'R:R', 'Status', 'Actions'].map((h) => (
                  <th key={h} className={`text-left text-[10px] text-gray-600 uppercase tracking-widest px-3 py-3 whitespace-nowrap bg-gray-900 ${
                    h === 'Actions' ? 'sticky right-0 z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.5)]' : ''
                  }`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={17} className="text-center text-gray-600 py-12">
                    {loading ? 'Loading trades...' : 'No trades found'}
                  </td>
                </tr>
              ) : trades.map((t) => (
                <tr key={t.id} className="group border-b border-[#1e2330]/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-3 font-semibold text-gray-200 whitespace-nowrap">{t.scrip_name}</td>
                  <td className="px-3 py-3">
                    <Badge text={SEG_LABEL[t.segment] ?? t.segment} cls="bg-gray-800 text-gray-400" />
                  </td>
                  <td className="px-3 py-3">
                    <Badge text={t.direction} cls={t.direction === 'LONG' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-red-400/10 text-red-400'} />
                  </td>
                  <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{formatDate(t.entry_date)}</td>
                  <td className="px-3 py-3 text-gray-300">{formatCurrency(t.entry_price)}</td>
                  <td className="px-3 py-3 text-gray-300">{t.quantity}</td>
                  <td className="px-3 py-3 text-gray-500">{t.stop_loss ? formatCurrency(t.stop_loss) : '—'}</td>
                  <td className="px-3 py-3 text-gray-500">{t.target ? formatCurrency(t.target) : '—'}</td>
                  <td className="px-3 py-3 text-gray-500">{t.initial_risk ? formatCurrency(t.initial_risk) : '—'}</td>
                  <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{t.close_date ? formatDate(t.close_date) : '—'}</td>
                  <td className="px-3 py-3 text-gray-300">{t.close_price ? formatCurrency(t.close_price) : '—'}</td>
                  <td className={`px-3 py-3 ${isProfit(t.gross_pl) ? 'text-emerald-400' : isLoss(t.gross_pl) ? 'text-red-400' : 'text-gray-500'}`}>
                    {t.gross_pl !== null ? formatCurrency(t.gross_pl) : '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-500">{t.charges ? formatCurrency(t.charges) : '—'}</td>
                  <td className={`px-3 py-3 font-semibold ${isProfit(t.net_income) ? 'text-emerald-400' : isLoss(t.net_income) ? 'text-red-400' : 'text-gray-500'}`}>
                    {t.net_income !== null ? formatCurrency(t.net_income) : '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-400">
                    {t.risk_reward ? `${parseFloat(String(t.risk_reward)).toFixed(2)}x` : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {t.is_closed
                      ? <Badge text="Closed" cls="bg-gray-800 text-gray-500" />
                      : <Badge text="Open"   cls="bg-blue-400/10 text-blue-400" />}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap sticky right-0 bg-gray-900 group-hover:bg-[#1e242f] transition-colors shadow-[-4px_0_8px_rgba(0,0,0,0.4)]">
                    <div className="flex items-center gap-1">
                      {!t.is_closed && (
                        <button onClick={() => openClose(t)}
                          className="text-[10px] px-2 py-1 bg-blue-400/10 text-blue-400 hover:bg-blue-400/20 rounded transition-colors">
                          Close
                        </button>
                      )}
                      <button onClick={() => openEdit(t)}
                        className="text-[10px] px-2 py-1 bg-gray-800 text-gray-400 hover:text-gray-200 rounded transition-colors">
                        Edit
                      </button>
                      <button onClick={() => openDelete(t)}
                        className="text-[10px] px-2 py-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded transition-colors">
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {modal === 'add'    && <AddEditModal    trade={null}          onClose={closeModal} onSave={handleAdd}    />}
      {modal === 'edit'   && selectedTrade && <AddEditModal    trade={selectedTrade} onClose={closeModal} onSave={handleEdit}   />}
      {modal === 'close'  && selectedTrade && <CloseTradeModal trade={selectedTrade} onClose={closeModal} onSave={handleClose}  />}
      {modal === 'delete' && selectedTrade && <DeleteConfirm   trade={selectedTrade} onClose={closeModal} onConfirm={handleDelete} />}
      {modal === 'import' && portfolioId && <ImportModal onClose={closeModal} portfolioId={portfolioId} onDone={load} />}
    </div>
  )
}
