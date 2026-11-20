import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Pencil, Plus, RefreshCw, Search, Trash2, WalletCards, X } from 'lucide-react'
import { schemeCatalogueApi, type MutualFundScheme } from '../../api/schemeCatalogue'
import { formatSchemePlanOption, getSchemePickerDisplay } from '../../utils/schemePickerDisplay'
import { wealthNavApi } from '../../api/wealthNav'
import {
  wealthTransactionsApi,
  type WealthFolio,
  type WealthFundHouse,
  type WealthHolding,
  type WealthMFTransactionDetail,
  type WealthSIPInstallment,
  type WealthSIPMandate,
  type WealthSwitchRequest,
  type WealthTransaction,
  type WealthTransactionAudit,
  type WealthTransactionInput,
  type WealthTransactionType,
} from '../../api/wealthTransactions'
import {
  submitSwitchPairDrafts,
  calculateMFTransactionNumbers,
  calculateSIPConfirmation,
  calculateSIPCharges,
  buildTransactionRows,
  cashflowSignError,
  filterAndSortTransactionRows,
  formatWealthApiError,
  formatWealthSIPApiError,
  executeConfirmedWealthDelete,
  formatWealthDecimal,
  paginateTransactionRows,
  resolveWealthFolioId,
  updateSwitchLegDraft,
  validateAvailableRedemption,
  validateWealthDecimal,
  resolveSIPConfirmationNAV,
  type TransactionFilters,
  type TransactionSort,
} from '../../utils/wealthTransactions'

const money = (value: string) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)}`
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const typeLabels: Record<WealthTransactionType | 'SWITCH', string> = {
  PURCHASE: 'Purchase', REDEMPTION: 'Redemption', SWITCH_OUT: 'Switch out', SWITCH_IN: 'Switch in',
  SWITCH: 'Switch', DIVIDEND: 'Dividend', BONUS: 'Bonus', OTHER: 'Other',
}
const emptyDetail = (): WealthMFTransactionDetail => ({ units: '', nav: '', amount: '', charges: '0.00', cashflow: '', charges_source: 'AUTOMATIC', charges_breakdown: {} })
const defaultInput = (): WealthTransactionInput => ({
  transaction_type: 'PURCHASE', transaction_date: today(), source: 'MANUAL', source_reference: '',
  scheme_code: '', folio: null, mf_detail: emptyDetail(), notes: '',
})
const emptyFilters: TransactionFilters = { search: '', type: '', folio: '', from: '', to: '' }
const inputClass = 'mt-1.5 w-full rounded-lg border border-[#dedfd5] bg-white px-3 py-2.5 text-sm text-[#294638] outline-none focus:border-[#739c81] focus:ring-2 focus:ring-[#739c81]/15'
const labelClass = 'block text-[11px] font-semibold text-[#5f7067]'
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1d6247] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#164d38] disabled:cursor-wait disabled:opacity-50'

function validateDetail(type: WealthTransactionType, detail: WealthMFTransactionDetail): string | null {
  const positiveUnitsNav = ['PURCHASE', 'REDEMPTION', 'SWITCH_OUT', 'SWITCH_IN'].includes(type)
  const unitsError = validateWealthDecimal(detail.units, 4, !positiveUnitsNav && type !== 'BONUS')
  if (unitsError) return `Units: ${unitsError}`
  const navError = validateWealthDecimal(detail.nav, 4, !positiveUnitsNav)
  if (navError) return `NAV: ${navError}`
  const positiveAmount = positiveUnitsNav || type === 'DIVIDEND'
  const amountError = validateWealthDecimal(detail.amount, 2, !positiveAmount)
  if (amountError) return `Amount: ${amountError}`
  const chargesError = validateWealthDecimal(detail.charges, 2)
  if (chargesError) return `Charges: ${chargesError}`
  const cashflowError = validateWealthDecimal(detail.cashflow.replace(/^-/, ''), 2)
  if (cashflowError) return `Cashflow: ${cashflowError}`
  if (type === 'BONUS' && Number(detail.charges) !== 0) return 'Bonus transactions must have zero charges.'
  return cashflowSignError(type, detail.cashflow)
}

function SchemePicker({
  value, onChange,
}: { value: MutualFundScheme | null; onChange: (scheme: MutualFundScheme | null) => void }) {
  const [query, setQuery] = useState(value?.scheme_name ?? '')
  const [results, setResults] = useState<MutualFundScheme[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setQuery(value?.scheme_name ?? '') }, [value?.scheme_code])
  useEffect(() => {
    if (query.trim().length < 2 || query.trim() === value?.scheme_name) { setResults([]); setError(''); return }
    let current = true
    const timer = window.setTimeout(() => {
      setLoading(true)
      void schemeCatalogueApi.list({ search: query.trim(), page: 1, page_size: 100 })
        .then((page) => { if (current) setResults(page.results) })
        .catch(() => { if (current) setError('Scheme search could not be loaded.') })
        .finally(() => { if (current) setLoading(false) })
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, value?.scheme_name])
  return <div className="relative">
    <label className={labelClass}>Scheme
      <div className="relative mt-1.5"><Search size={14} className="absolute left-3 top-3 text-[#8a978e]" />
        <input className={`${inputClass} mt-0 pl-9 pr-9`} value={query} onChange={(event) => {
          const next = event.target.value; setQuery(next)
          if (!next.trim()) onChange(null)
          else if (value && next !== value.scheme_name) onChange(null)
        }} placeholder="Search scheme name, plan, option or code" autoComplete="off" />
        {loading && <LoaderCircle size={14} className="absolute right-3 top-3 animate-spin text-[#819087]" />}
      </div>
    </label>
    {value && query === value.scheme_name && <p className="mt-1 pl-1 text-[9px] text-[#687b70]">{getSchemePickerDisplay(value).planOption} · Code: {value.scheme_code}</p>}
    {error && <p role="alert" className="mt-1 text-[11px] text-[#a4533a]">{error}</p>}
    {results.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[#e0e2d8] bg-white shadow-xl">
      {results.map((scheme) => { const display = getSchemePickerDisplay(scheme); return <button key={scheme.scheme_code} type="button" onClick={() => { onChange(scheme); setQuery(scheme.scheme_name); setResults([]) }} className="block w-full border-b border-[#f0f0e9] px-3 py-2.5 text-left last:border-0 hover:bg-[#f7f7f1]">
        <span className="block text-xs font-semibold text-[#294638]">{display.schemeName}</span><span className="mt-0.5 block text-[10px] text-[#64776b]">{display.planOption}<span className="ml-1.5 text-[9px] font-normal text-[#a0aaa2]">Code: {display.schemeCode}</span></span>
      </button>})}
    </div>}
    {query.trim().length >= 2 && !loading && !error && !results.length && query !== value?.scheme_name && <p className="mt-1 text-[11px] text-[#89948c]">No matching schemes found.</p>}
  </div>
}

function ModalFrame({ title, onClose, children, wide = false, closeOnBackdrop = true }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; closeOnBackdrop?: boolean }) {
  return <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#10372e]/45 p-3 sm:p-6" onMouseDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label={title} className={`mx-auto my-3 w-full rounded-2xl border border-[#e7e2d4] bg-[#fffef9] p-4 shadow-2xl sm:my-8 sm:p-6 ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a7a35]">WealthOnCruise · Transactions</p><h2 className="mt-1 font-serif text-2xl font-bold text-[#18382f]">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-lg p-2 text-[#75847a] hover:bg-[#f1efe7]"><X size={17} /></button></div>
      {children}
    </section>
  </div>
}

function FolioSelect({ value, folios, onChange, required = false }: { value: string | null; folios: WealthFolio[]; onChange: (id: string | null) => void; required?: boolean }) {
  return <label className={labelClass}>Folio{required ? '' : ' (optional)'}
    <select className={inputClass} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">Unassigned</option>{value && !folios.some(folio => folio.id === value) && <option value={value}>Stored folio unavailable · select again</option>}{folios.map((folio) => <option key={folio.id} value={folio.id}>{folio.folio_number}{folio.name ? ` · ${folio.name}` : ''}{folio.fund_house_name ? ` · ${folio.fund_house_name}` : ''}</option>)}
    </select>
  </label>
}

function DetailFields({ value, onChange, calculatedAmount = false, calculatedCashflow = false, calculatedCharges = false }: { value: WealthMFTransactionDetail; onChange: (value: WealthMFTransactionDetail) => void; calculatedAmount?: boolean; calculatedCashflow?: boolean; calculatedCharges?: boolean }) {
  const fields: { key: 'units' | 'nav' | 'amount' | 'charges' | 'cashflow'; label: string; places: number; step: string; min: string }[] = [
    { key: 'units', label: 'Units', places: 4, step: '0.0001', min: '0' },
    { key: 'nav', label: 'NAV', places: 4, step: '0.0001', min: '0' },
    { key: 'amount', label: 'Amount (INR)', places: 2, step: '0.01', min: '0' },
    { key: 'charges', label: 'Charges (INR)', places: 2, step: '0.01', min: '0' },
    { key: 'cashflow', label: 'Cashflow (INR)', places: 2, step: '0.01', min: '-9999999999999999' },
  ]
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {fields.map((field) => <label key={field.key} className={labelClass}>{field.label}
      <input type="number" inputMode="decimal" step={field.step} min={field.min} max="9999999999999999" value={value[field.key]} onChange={(event) => onChange({ ...value, [field.key]: event.target.value })} required={!((field.key === 'amount' && calculatedAmount) || (field.key === 'cashflow' && calculatedCashflow) || (field.key === 'charges' && calculatedCharges))} readOnly={(field.key === 'amount' && calculatedAmount) || (field.key === 'cashflow' && calculatedCashflow) || (field.key === 'charges' && calculatedCharges)} className={`${inputClass} ${(field.key === 'amount' && calculatedAmount) || (field.key === 'cashflow' && calculatedCashflow) || (field.key === 'charges' && calculatedCharges) ? 'bg-[#f5f5ef]' : ''}`} />
      <span className="mt-1 block text-[9px] font-normal text-[#929b94]">Up to {field.places} decimal places</span>
    </label>)}
  </div>
}

function TransactionEditor({
  initial, initialScheme, existing, folios, holdings, editing, onClose, onSave,
}: {
  initial: WealthTransactionInput
  initialScheme?: MutualFundScheme | null
  existing?: WealthTransaction
  folios: WealthFolio[]
  holdings: WealthHolding[]
  editing: boolean
  onClose: () => void
  onSave: (input: WealthTransactionInput) => Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  const [scheme, setScheme] = useState<MutualFundScheme | null>(initialScheme ?? (initial.scheme_code ? {
    scheme_code: initial.scheme_code, scheme_name: initial.scheme_code, fund_house: '', category_name: '', asset_class: 'UNKNOWN', plan_type: 'UNKNOWN', option_type: 'UNKNOWN', isin_growth: null, isin_div_payout: null, isin_div_reinvestment: null,
  } : null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manualCharges, setManualCharges] = useState(Boolean(existing && existing.mf_detail.charges_source !== 'AUTOMATIC'))
  const currentPosition = Number(holdings.find((item) => item.scheme_code === scheme?.scheme_code && item.folio_id === (draft.folio || null))?.units ?? '0')
  const restoresEditedRedemption = existing?.transaction_type === 'REDEMPTION'
    && existing.scheme.scheme_code === scheme?.scheme_code
    && existing.folio === (draft.folio || null)
  const available = String(currentPosition + (restoresEditedRedemption ? Number(existing?.mf_detail.units ?? 0) : 0))
  const type = draft.transaction_type
  const setDetail = (mf_detail: WealthMFTransactionDetail) => setDraft((current) => ({ ...current, mf_detail }))
  const autoAmount = ['PURCHASE', 'REDEMPTION', 'SWITCH_OUT', 'SWITCH_IN'].includes(type)
  const autoCashflow = ['PURCHASE', 'REDEMPTION', 'SWITCH_OUT', 'SWITCH_IN', 'DIVIDEND', 'BONUS'].includes(type)
  const autoCharges = ['PURCHASE', 'SWITCH_IN'].includes(type) && draft.transaction_date >= '2020-07-01' && draft.transaction_date >= '2025-08-08' && !manualCharges
  useEffect(() => {
    const next = { ...draft.mf_detail }
    if (autoAmount) {
      next.amount = calculateMFTransactionNumbers(type, draft.transaction_date, next.units, next.nav).amount
    }
    const numbers = calculateMFTransactionNumbers(type, draft.transaction_date, next.units, next.nav, next.charges, manualCharges, next.amount)
    if (autoCharges || ['PURCHASE', 'SWITCH_IN', 'REDEMPTION', 'SWITCH_OUT'].includes(type)) next.charges = numbers.charges
    next.charges_source = numbers.chargesSource
    next.charges_breakdown = numbers.chargesBreakdown
    if (autoCashflow && type !== 'BONUS') next.cashflow = numbers.cashflow
    else if (type === 'BONUS') next.cashflow = '0.00'
    if (JSON.stringify(next) !== JSON.stringify(draft.mf_detail)) setDraft(current => ({ ...current, mf_detail: next }))
  }, [draft.transaction_date, draft.mf_detail.units, draft.mf_detail.nav, draft.mf_detail.amount, draft.mf_detail.charges, type, autoAmount, autoCashflow, autoCharges, manualCharges])
  const changeType = (next: WealthTransactionType) => setDraft((current) => ({ ...current, transaction_type: next, source: current.source === 'SIP' && next !== 'PURCHASE' ? 'MANUAL' : current.source }))
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    if (!scheme) { setError('Choose a mutual fund scheme.'); return }
    if (draft.source === 'SIP' && type !== 'PURCHASE') { setError('SIP source is only valid for purchase transactions.'); return }
    const detailError = validateDetail(type, draft.mf_detail)
    if (detailError) { setError(detailError); return }
    if (type === 'REDEMPTION') {
      const unitsError = validateAvailableRedemption(draft.mf_detail.units, available)
      if (unitsError) { setError(unitsError); return }
    }
    setBusy(true)
    try { await onSave({ ...draft, scheme_code: scheme.scheme_code, source: draft.source || 'MANUAL' }) }
    catch (saveError) { setError(formatWealthApiError(saveError)); setBusy(false) }
  }
  return <ModalFrame title={editing ? 'Edit transaction' : 'Add transaction'} onClose={() => !busy && onClose()} closeOnBackdrop={false}>
    <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
      {error && <p role="alert" className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] px-3 py-2.5 text-xs leading-5 text-[#9c4d37]">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>Transaction type
          <select className={inputClass} value={type} onChange={(event) => changeType(event.target.value as WealthTransactionType)}>
            {(['PURCHASE', 'REDEMPTION', 'DIVIDEND', 'BONUS', 'OTHER'] as WealthTransactionType[]).map((item) => <option key={item} value={item}>{typeLabels[item]}</option>)}
          </select>
        </label>
        <label className={labelClass}>Transaction date<input type="date" required className={inputClass} value={draft.transaction_date} onChange={(event) => setDraft({ ...draft, transaction_date: event.target.value })} /></label>
      </div>
      <SchemePicker value={scheme} onChange={(next) => { setScheme(next); setDraft((current) => ({ ...current, scheme_code: next?.scheme_code ?? '' })) }} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FolioSelect value={draft.folio ?? null} folios={folios} onChange={(folio) => setDraft({ ...draft, folio })} />
        <label className={labelClass}>Source
          <select className={inputClass} value={draft.source ?? 'MANUAL'} onChange={(event) => setDraft({ ...draft, source: event.target.value as WealthTransactionInput['source'] })}>
            <option value="MANUAL">Manual</option>{type === 'PURCHASE' && <option value="SIP">SIP</option>}<option value="IMPORT">Import</option><option value="OTHER">Other</option>
          </select>
        </label>
      </div>
      <label className={labelClass}>Source reference<input className={inputClass} maxLength={120} value={draft.source_reference ?? ''} onChange={(event) => setDraft({ ...draft, source_reference: event.target.value })} /></label>
      {type === 'REDEMPTION' && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6e0cd] bg-[#faf8f0] px-3 py-2.5 text-xs text-[#596f63]">Available units in this scheme and folio: <strong className="font-mono">{formatWealthDecimal(available, 4)}</strong><span className="ml-1 text-[10px] text-[#8d968f]">(full or partial redemption; limit validated in this form)</span><button type="button" onClick={() => setDetail({ ...draft.mf_detail, units: Number(available).toFixed(4) })} className="rounded-md border border-[#e1d9bd] bg-white px-2 py-1 text-[10px] font-semibold text-[#715d2c]">Redeem all</button></div>}
      <DetailFields value={draft.mf_detail} onChange={setDetail} calculatedAmount={autoAmount} calculatedCashflow={autoCashflow} calculatedCharges={['PURCHASE', 'REDEMPTION', 'SWITCH_OUT', 'SWITCH_IN'].includes(type) && !manualCharges} />
      {type !== 'BONUS' && type !== 'OTHER' && <label className="flex items-start gap-2 text-[10px] leading-4 text-[#687a6e]"><input type="checkbox" checked={manualCharges} onChange={event => setManualCharges(event.target.checked)} className="mt-0.5" />Use statement charges / manual override. Scheme exit loads and any applicable historical charges must be entered from the transaction statement.</label>}
      <p className="text-[10px] leading-4 text-[#8a9388]">Amount is Units × NAV. Purchase and switch-in charges include SEBI stamp duty at 0.005% from 1 July 2020. Historical charges, scheme and holding-period-specific exit load, and STT for eligible equity-oriented fund redemptions must be checked against the statement. Cashflow is calculated from amount and charges.</p>
      <label className={labelClass}>Notes<textarea rows={2} className={inputClass} value={draft.notes ?? ''} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
      <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078] hover:bg-[#f0efe8]">Cancel</button><button type="submit" disabled={busy} className={buttonClass}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{busy ? 'Saving…' : editing ? 'Save changes' : 'Create transaction'}</button></div>
    </form>
  </ModalFrame>
}

function SwitchLeg({ title, transactionType, date, scheme, setScheme, folio, setFolio, detail, setDetail, folios }: {
  transactionType: 'SWITCH_OUT' | 'SWITCH_IN'; date: string;
  title: string; scheme: MutualFundScheme | null; setScheme: (value: MutualFundScheme | null) => void
  folio: string | null; setFolio: (value: string | null) => void
  detail: WealthMFTransactionDetail; setDetail: (value: WealthMFTransactionDetail) => void; folios: WealthFolio[]
}) {
  const [manual, setManual] = useState(detail.charges_source !== 'AUTOMATIC')
  useEffect(() => {
    const numbers = calculateMFTransactionNumbers(transactionType, date, detail.units, detail.nav, detail.charges, manual)
    const next = { ...detail, amount: numbers.amount, charges: numbers.charges, charges_source: numbers.chargesSource, charges_breakdown: numbers.chargesBreakdown, cashflow: numbers.cashflow }
    if (JSON.stringify(next) !== JSON.stringify(detail)) setDetail(next)
  }, [date, detail.units, detail.nav, detail.amount, detail.charges, transactionType, manual])
  return <section className="space-y-3 rounded-xl border border-[#e7e5dc] bg-white p-3 sm:p-4"><h3 className="font-serif text-base font-bold text-[#24483d]">{title}</h3><SchemePicker value={scheme} onChange={setScheme} /><FolioSelect value={folio} folios={folios} onChange={setFolio} /><DetailFields value={detail} onChange={setDetail} calculatedAmount calculatedCashflow calculatedCharges={!manual} /><label className="flex items-start gap-2 text-[10px] leading-4 text-[#687a6e]"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} className="mt-0.5" />Enter charges from statement. Historical transaction charges and scheme-specific exit loads are not inferred.</label></section>
}

function SwitchEditor({ folios, initialRecords, onClose, onSave }: { folios: WealthFolio[]; initialRecords?: WealthTransaction[]; onClose: () => void; onSave: (input: WealthSwitchRequest) => Promise<void> }) {
  const initialOut = initialRecords?.find(item => item.transaction_type === 'SWITCH_OUT')
  const initialIn = initialRecords?.find(item => item.transaction_type === 'SWITCH_IN')
  const [date, setDate] = useState(initialOut?.transaction_date ?? today())
  const [sourceScheme, setSourceScheme] = useState<MutualFundScheme | null>(initialOut?.scheme ?? null)
  const [destinationScheme, setDestinationScheme] = useState<MutualFundScheme | null>(initialIn?.scheme ?? null)
  const [sourceDraft, setSourceDraft] = useState(() => ({
    folio: resolveWealthFolioId(initialOut?.folio ?? null, folios),
    mf_detail: initialOut?.mf_detail ?? emptyDetail(),
  }))
  const [destinationDraft, setDestinationDraft] = useState(() => ({
    folio: resolveWealthFolioId(initialIn?.folio ?? null, folios),
    mf_detail: initialIn?.mf_detail ?? emptyDetail(),
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    if (!sourceScheme || !destinationScheme) { setError('Choose both source and destination schemes.'); return }
    if (sourceScheme.scheme_code === destinationScheme.scheme_code) { setError('Choose a different destination scheme.'); return }
    if (sourceDraft.folio && !folios.some(item => item.id === sourceDraft.folio || item.folio_number === sourceDraft.folio)) { setError('Switch out folio: select a valid folio from your list before saving.'); return }
    if (destinationDraft.folio && !folios.some(item => item.id === destinationDraft.folio || item.folio_number === destinationDraft.folio)) { setError('Switch in folio: select a valid folio from your list before saving.'); return }
    const sourceError = validateDetail('SWITCH_OUT', sourceDraft.mf_detail)
    if (sourceError) { setError(`Source leg · ${sourceError}`); return }
    const destinationError = validateDetail('SWITCH_IN', destinationDraft.mf_detail)
    if (destinationError) { setError(`Destination leg · ${destinationError}`); return }
    const source: Omit<WealthTransactionInput, 'folio' | 'mf_detail'> = { ...defaultInput(), transaction_type: 'SWITCH_OUT', transaction_date: date, source: 'MANUAL', scheme_code: sourceScheme.scheme_code }
    const destination: Omit<WealthTransactionInput, 'folio' | 'mf_detail'> = { ...defaultInput(), transaction_type: 'SWITCH_IN', transaction_date: date, source: 'MANUAL', scheme_code: destinationScheme.scheme_code }
    setBusy(true)
    try { await submitSwitchPairDrafts(source, sourceDraft, destination, destinationDraft, folios, onSave) }
    catch (saveError) { setError(formatWealthApiError(saveError)); setBusy(false) }
  }
  return <ModalFrame title={initialRecords ? 'Edit switch pair' : 'Record a switch'} onClose={() => !busy && onClose()} wide closeOnBackdrop={false}>
    <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
      {error && <p role="alert" className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] px-3 py-2.5 text-xs text-[#9c4d37]">{error}</p>}
      <label className={labelClass}>Transaction date<input type="date" required className={inputClass} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <div className="grid gap-4 xl:grid-cols-2"><SwitchLeg title="Source · switch out" transactionType="SWITCH_OUT" date={date} scheme={sourceScheme} setScheme={setSourceScheme} folio={sourceDraft.folio} setFolio={folio => setSourceDraft(current => updateSwitchLegDraft(current, { folio }))} detail={sourceDraft.mf_detail} setDetail={mf_detail => setSourceDraft(current => updateSwitchLegDraft(current, { mf_detail }))} folios={folios} /><SwitchLeg title="Destination · switch in" transactionType="SWITCH_IN" date={date} scheme={destinationScheme} setScheme={setDestinationScheme} folio={destinationDraft.folio} setFolio={folio => setDestinationDraft(current => updateSwitchLegDraft(current, { folio }))} detail={destinationDraft.mf_detail} setDetail={mf_detail => setDestinationDraft(current => updateSwitchLegDraft(current, { mf_detail }))} folios={folios} /></div>
      <p className="text-[10px] leading-4 text-[#8a9388]">Both legs are submitted together with the same date. Outflow must be positive; inflow must be negative. Each folio must match its scheme AMC.</p>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078]">Cancel</button><button type="submit" disabled={busy} className={buttonClass}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{busy ? 'Saving both legs…' : initialRecords ? 'Save both legs' : 'Save switch pair'}</button></div>
    </form>
  </ModalFrame>
}

function FolioManager({ folios, houses, onClose, onChanged }: { folios: WealthFolio[]; houses: WealthFundHouse[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [selected, setSelected] = useState<WealthFolio | null>(null)
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [fundHouse, setFundHouse] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WealthFolio | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteLock = useRef(false)
  const edit = (folio: WealthFolio | null) => { setSelected(folio); setNumber(folio?.folio_number ?? ''); setName(folio?.name ?? ''); setFundHouse(folio?.fund_house ?? ''); setError('') }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const payload = { folio_number: number.trim(), name: name.trim(), fund_house: fundHouse || null }
      if (selected) await wealthTransactionsApi.updateFolio(selected.id, payload)
      else await wealthTransactionsApi.createFolio(payload)
      await onChanged(); setNotice(selected ? 'Folio updated.' : 'Folio created.'); edit(null)
    } catch (saveError) { setError(formatWealthApiError(saveError)) }
    finally { setBusy(false) }
  }
  const removeFolio = async () => {
    if (!deleteTarget || deleteTarget.can_delete === false || deleteLock.current) return
    deleteLock.current = true; setDeleteBusy(true); setDeleteError('')
    try {
      await executeConfirmedWealthDelete(true, false, () => wealthTransactionsApi.deleteFolio(deleteTarget.id))
      const deletedFolioNumber = deleteTarget.folio_number
      setDeleteTarget(null); setNotice(`Folio ${deletedFolioNumber} deleted.`)
      try { await onChanged() } catch { setError('Folio deleted, but its list could not refresh. Close and reopen Manage folios to reload it.') }
    } catch (deleteFailure) { setDeleteError(formatWealthApiError(deleteFailure)) }
    finally { deleteLock.current = false; setDeleteBusy(false) }
  }
  return <ModalFrame title="Manage folios" onClose={() => !busy && !deleteBusy && onClose()}>
    {notice && <p role="status" className="mt-4 rounded-lg border border-[#d4e5d8] bg-[#f0f7f1] px-3 py-2.5 text-xs text-[#246747]">{notice}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-[#efd9cf] bg-[#fcf2ee] px-3 py-2.5 text-xs text-[#9c4d37]">{error}</p>}
    <form onSubmit={(event) => void save(event)} className="mt-4 rounded-xl border border-[#e7e5dc] bg-[#fbfaf6] p-3.5">
      <h3 className="text-xs font-bold text-[#294638]">{selected ? 'Edit folio' : 'Add folio'}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>Folio number<input required maxLength={80} className={inputClass} value={number} onChange={(event) => setNumber(event.target.value)} /></label>
        <label className={labelClass}>Folio name (optional)<input maxLength={120} className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className={`${labelClass} sm:col-span-2`}>Fund house (AMC)
          <select className={inputClass} value={fundHouse} onChange={(event) => setFundHouse(event.target.value)}><option value="">Not assigned</option>{houses.map((house) => <option key={house.id} value={house.id}>{house.name}</option>)}</select>
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">{selected && <button type="button" onClick={() => edit(null)} className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[#718078]">Cancel edit</button>}<button disabled={busy} className={buttonClass}>{busy ? 'Saving…' : selected ? 'Save folio' : 'Create folio'}</button></div>
    </form>
    <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-[#e7e5dc] bg-white">
      {!folios.length ? <p className="p-5 text-center text-xs text-[#89948c]">No folios yet. Create one above or leave transactions unassigned.</p> : folios.map((folio) => <div key={folio.id} className="flex items-center justify-between gap-3 border-b border-[#f0f0e9] px-3.5 py-3 last:border-0"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#294638]">{folio.folio_number}{folio.name ? ` · ${folio.name}` : ''}</p><p className="mt-0.5 truncate text-[10px] text-[#89948c]">{folio.fund_house_name || 'No AMC assigned'}</p>{folio.can_delete === false && <p className="mt-1 text-[9px] leading-4 text-[#9c4d37]">{folio.delete_block_reason || 'This folio is still in use.'}</p>}</div><div className="flex shrink-0 gap-1.5"><button type="button" onClick={() => edit(folio)} className="rounded-md border border-[#e1e4da] px-2.5 py-1.5 text-[10px] font-semibold text-[#46685a]">Edit</button><button type="button" disabled={deleteBusy || folio.can_delete === false} onClick={() => { setDeleteTarget(folio); setDeleteError('') }} className="rounded-md border border-[#efd9cf] px-2.5 py-1.5 text-[10px] font-semibold text-[#a4533a] disabled:cursor-not-allowed disabled:opacity-40">Delete</button></div></div>)}
    </div>
    {deleteTarget && <ModalFrame title="Delete folio" onClose={() => !deleteBusy && setDeleteTarget(null)} closeOnBackdrop={false}>
      <div className="mt-4 space-y-3 text-sm text-[#53675e]"><p>Delete folio <strong>{deleteTarget.folio_number}{deleteTarget.name ? ` · ${deleteTarget.name}` : ''}</strong>?</p><p className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] p-3 text-xs">Only a folio with no transaction history and no linked SIP mandates can be deleted. Deletion will not remove or reassign any transactions.</p>{deleteError && <p role="alert" className="text-xs text-[#9c4d37]">{deleteError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078]">Cancel</button><button type="button" disabled={deleteBusy || deleteTarget.can_delete === false} onClick={() => void removeFolio()} className="rounded-lg bg-[#a4533a] px-4 py-2.5 text-xs font-semibold text-white">{deleteBusy ? 'Deleting…' : 'Delete folio'}</button></div></div>
    </ModalFrame>}
  </ModalFrame>
}

function AuditViewer({ records, onClose }: { records: WealthTransaction[]; onClose: () => void }) {
  const [audits, setAudits] = useState<WealthTransactionAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    Promise.all(records.map((record) => wealthTransactionsApi.audit(record.id)))
      .then((results) => { if (current) setAudits(results.flat().sort((a, b) => b.created_at.localeCompare(a.created_at))) })
      .catch((loadError) => { if (current) setError(formatWealthApiError(loadError, 'Audit history could not be loaded.')) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [records])
  return <ModalFrame title="Audit history" onClose={onClose}>
    <p className="mt-2 text-xs text-[#7b8980]">{records.map((record) => `${record.scheme.scheme_name} · ${getSchemePickerDisplay(record.scheme).planOption}`).join(' · ')}</p>
    {loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#718078]"><LoaderCircle size={15} className="animate-spin" />Loading audit entries…</div>
      : error ? <p role="alert" className="mt-4 text-sm text-[#9c4d37]">{error}</p>
        : !audits.length ? <p className="py-9 text-center text-sm text-[#89948c]">No audit history found.</p>
          : <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">{audits.map((audit) => <article key={audit.id} className="rounded-xl border border-[#e7e5dc] bg-white p-3.5"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-[#f3f1e8] px-2.5 py-1 text-[10px] font-bold text-[#6d704f]">{audit.action}</span><time className="text-[10px] text-[#89948c]">{new Date(audit.created_at).toLocaleString('en-IN')}</time></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{audit.before && Object.keys(audit.before).length > 0 && <div><p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[#89948c]">Before</p><pre className="max-h-48 overflow-auto rounded-lg bg-[#f7f7f2] p-2 text-[9px] leading-4 text-[#50665b]">{JSON.stringify(audit.before, null, 2)}</pre></div>}{audit.after && Object.keys(audit.after).length > 0 && <div><p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[#89948c]">After</p><pre className="max-h-48 overflow-auto rounded-lg bg-[#f7f7f2] p-2 text-[9px] leading-4 text-[#50665b]">{JSON.stringify(audit.after, null, 2)}</pre></div>}</div></article>)}</div>}
  </ModalFrame>
}

function SIPManager({ folios, initialScheme, initialFolio, onClose, onChanged }: { folios: WealthFolio[]; initialScheme?: MutualFundScheme | null; initialFolio?: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [scheme, setScheme] = useState<MutualFundScheme | null>(initialScheme ?? null)
  const [folio, setFolio] = useState<string | null>(initialFolio ?? null)
  const [amount, setAmount] = useState('')
  const [day, setDay] = useState('1')
  const [start, setStart] = useState(today())
  const [generateFrom, setGenerateFrom] = useState(today())
  const [end, setEnd] = useState('')
  const [mandates, setMandates] = useState<WealthSIPMandate[]>([])
  const [installments, setInstallments] = useState<WealthSIPInstallment[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WealthSIPMandate | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteLock = useRef(false)
  const [confirmation, setConfirmation] = useState<{ item: WealthSIPInstallment; nav: string; charges: string; chargesEdited: boolean; actualDate: string; loading: boolean; unavailable: boolean; error: string } | null>(null)
  const refresh = async () => {
    const [plans, due] = await Promise.all([wealthTransactionsApi.sipMandates(), wealthTransactionsApi.sipInstallments('PENDING')])
    setMandates(plans); setInstallments(due)
  }
  useEffect(() => { void refresh().catch(e => setError(formatWealthSIPApiError(e, 'SIP plans could not be loaded.'))) }, [])
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('')
    if (!scheme) { setError('Choose a scheme.'); return }
    setBusy(true)
    try {
      await wealthTransactionsApi.createSIPMandate({ scheme_code: scheme.scheme_code, folio, monthly_amount: amount, sip_day: Number(day), start_date: start, generate_from_date: generateFrom, end_date: end || null })
      await refresh(); await onChanged(); setAmount('')
    } catch (e) { setError(formatWealthSIPApiError(e)) } finally { setBusy(false) }
  }
  const openConfirmation = async (item: WealthSIPInstallment) => {
    setBusy(true)
    setError('')
    try {
      const persistedItem = await wealthTransactionsApi.updateSIPInstallment(item.id, {
        scheduled_date: item.scheduled_date,
        amount: item.amount,
      })
      setInstallments(rows => rows.map(row => row.id === item.id ? persistedItem : row))
      setConfirmation({ item: persistedItem, nav: '', charges: calculateSIPCharges(persistedItem.amount, persistedItem.scheduled_date), chargesEdited: false, actualDate: persistedItem.scheduled_date, loading: true, unavailable: false, error: '' })
    } catch {
      setError('The pending installment could not be saved. Check its date and amount, then try again.')
      setBusy(false)
      return
    }
    setBusy(false)
    try {
      const history = await wealthNavApi.history(item.scheme_code, item.scheduled_date)
      const nav = resolveSIPConfirmationNAV(history.results, item.scheduled_date)
      setConfirmation(current => current?.item.id === item.id ? { ...current, nav, loading: false, unavailable: !nav } : current)
    } catch {
      setConfirmation(current => current?.item.id === item.id ? { ...current, loading: false, unavailable: true } : current)
    }
  }
  const confirmInstallment = async () => {
    if (!confirmation) return
    let values: ReturnType<typeof calculateSIPConfirmation>
    try { values = calculateSIPConfirmation(confirmation.item.amount, confirmation.nav, confirmation.actualDate, confirmation.chargesEdited ? confirmation.charges : null) }
    catch (e) { setConfirmation(current => current ? { ...current, error: e instanceof Error ? e.message : 'Enter valid confirmation values.' } : current); return }
    setBusy(true)
    try {
      await wealthTransactionsApi.confirmSIPInstallment(confirmation.item.id, {
        actual_date: confirmation.actualDate, actual_nav: confirmation.nav,
        actual_charges: values.charges, charges_source: values.chargesSource,
      })
      await refresh(); await onChanged(); setConfirmation(null)
    } catch (e) {
      setConfirmation(current => current ? { ...current, error: formatWealthSIPApiError(e) } : current)
    } finally { setBusy(false) }
  }
  const changeConfirmationDate = async (actualDate: string) => {
    if (!confirmation) return
    const item = confirmation.item
    setConfirmation(current => current ? { ...current, actualDate, nav: '', loading: Boolean(actualDate), unavailable: !actualDate, error: '', charges: current.chargesEdited ? current.charges : calculateSIPCharges(item.amount, actualDate) } : current)
    if (!actualDate) return
    try {
      const history = await wealthNavApi.history(item.scheme_code, actualDate)
      const nav = resolveSIPConfirmationNAV(history.results, actualDate)
      setConfirmation(current => current?.item.id === item.id && current.actualDate === actualDate
        ? { ...current, nav, loading: false, unavailable: !nav }
        : current)
    } catch {
      setConfirmation(current => current?.item.id === item.id && current.actualDate === actualDate
        ? { ...current, loading: false, unavailable: true }
        : current)
    }
  }
  const changeStatus = async (mandate: WealthSIPMandate) => {
    try { await wealthTransactionsApi.updateSIPMandate(mandate.id, { status: mandate.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }); await refresh() }
    catch (e) { setError(formatWealthSIPApiError(e)) }
  }
  const removeMandate = async () => {
    if (!deleteTarget || deleteTarget.can_delete === false || deleteLock.current) return
    deleteLock.current = true; setDeleteBusy(true); setDeleteError('')
    try {
      await executeConfirmedWealthDelete(true, false, () => wealthTransactionsApi.deleteSIPMandate(deleteTarget.id))
      const deletedSchemeName = deleteTarget.scheme_name
      setDeleteTarget(null); setNotice(`${deletedSchemeName} SIP mandate deleted.`)
      try { await refresh(); await onChanged() } catch { setError('SIP mandate deleted, but the plan list could not refresh. Close and reopen Monthly SIP plans to reload it.') }
    } catch (deleteFailure) { setDeleteError(formatWealthSIPApiError(deleteFailure)) }
    finally { deleteLock.current = false; setDeleteBusy(false) }
  }
  return <ModalFrame title="Monthly SIP plans" onClose={() => !busy && !deleteBusy && onClose()} wide closeOnBackdrop={false}>
    <p className="mt-2 text-xs leading-5 text-[#718078]">The app creates due installments when this screen loads. They remain pending and do not change holdings. Confirm an installment after it appears on the fund statement.</p>
    {notice && <p role="status" className="mt-3 rounded-lg border border-[#d4e5d8] bg-[#f0f7f1] p-3 text-xs text-[#246747]">{notice}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[#fcf2ee] p-3 text-xs text-[#9c4d37]">{error}</p>}
    <form onSubmit={event => void create(event)} className="mt-4 space-y-3 rounded-xl border border-[#e7e5dc] bg-[#fbfaf6] p-3.5">
      <h3 className="text-xs font-bold text-[#294638]">Create monthly mandate</h3><SchemePicker value={scheme} onChange={setScheme} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><FolioSelect value={folio} folios={folios} onChange={setFolio} />
        <label className={labelClass}>Monthly amount<input required type="number" min="0.01" step="0.01" className={inputClass} value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label className={labelClass}>Monthly debit day (1–31)<input required type="number" min="1" max="31" className={inputClass} value={day} onChange={e => setDay(e.target.value)} /></label>
        <label className={labelClass}>SIP start date<input required type="date" className={inputClass} value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className={labelClass}>Generate installments from<input required type="date" min={start} className={inputClass} value={generateFrom} onChange={e => setGenerateFrom(e.target.value)} /></label>
        <label className={labelClass}>End date (optional)<input type="date" min={start} className={inputClass} value={end} onChange={e => setEnd(e.target.value)} /></label>
      </div>
      <div className="flex justify-end"><button disabled={busy} className={buttonClass}>Create monthly SIP</button></div>
    </form>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-[#e7e5dc] bg-white p-3"><h3 className="text-xs font-bold text-[#294638]">Mandates</h3><div className="mt-2 max-h-52 overflow-auto">{mandates.map(plan => <div key={plan.id} className="border-t border-[#f0f0e9] py-2.5 text-[10px]"><div className="flex items-center justify-between gap-3"><span className="min-w-0"><b className="block truncate text-[#31594a]">{plan.scheme_name}</b><span className="block text-[9px] text-[#687b70]">{formatSchemePlanOption(plan.plan_type, plan.option_type)}</span><span className="text-[#89948c]">₹{plan.monthly_amount} · monthly, day {plan.sip_day} · {plan.status}</span></span><span className="flex shrink-0 gap-1.5">{plan.status !== 'COMPLETED' && <button type="button" onClick={() => void changeStatus(plan)} className="rounded-md border px-2 py-1 font-semibold">{plan.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>}<button type="button" disabled={deleteBusy || plan.can_delete === false} onClick={() => { setDeleteTarget(plan); setDeleteError('') }} className="rounded-md border border-[#efd9cf] px-2 py-1 font-semibold text-[#a4533a] disabled:cursor-not-allowed disabled:opacity-40">Delete</button></span></div>{plan.can_delete === false && <p className="mt-1 text-[9px] leading-4 text-[#9c4d37]">{plan.delete_block_reason || 'Delete linked confirmed purchases before deleting this mandate.'}</p>}</div>)}{!mandates.length && <p className="py-5 text-center text-[10px] text-[#89948c]">No SIP mandates yet.</p>}</div></section>
      <section className="rounded-xl border border-[#e7e5dc] bg-white p-3"><h3 className="text-xs font-bold text-[#294638]">Pending installments</h3><div className="mt-2 max-h-52 overflow-auto">{installments.map(item => <div key={item.id} className="border-t border-[#f0f0e9] py-2.5 text-[10px]"><b className="block text-[#31594a]">{item.scheme_name}</b><span className="block text-[9px] text-[#687b70]">{formatSchemePlanOption(item.plan_type, item.option_type)}</span>{item.transaction_id_snapshot && <p className="mt-1 text-[9px] text-[#8a7040]">Previous purchase deleted · audit reference {item.transaction_id_snapshot}</p>}<div className="mt-1 flex flex-wrap items-end gap-2"><label className="text-[#89948c]">Date<input type="date" className="ml-1 rounded border px-1 py-1 text-[#31594a]" value={item.scheduled_date} onChange={e => setInstallments(rows => rows.map(row => row.id === item.id ? { ...row, scheduled_date: e.target.value } : row))} onBlur={e => void wealthTransactionsApi.updateSIPInstallment(item.id, { scheduled_date: e.target.value }).catch(err => setError(formatWealthSIPApiError(err)))} /></label><label className="text-[#89948c]">Amount<input type="number" min="0.01" step="0.01" className="ml-1 w-24 rounded border px-1 py-1 text-[#31594a]" value={item.amount} onChange={e => setInstallments(rows => rows.map(row => row.id === item.id ? { ...row, amount: e.target.value } : row))} onBlur={e => void wealthTransactionsApi.updateSIPInstallment(item.id, { amount: e.target.value }).catch(err => setError(formatWealthSIPApiError(err)))} /></label><button type="button" disabled={busy} onClick={() => void openConfirmation(item)} className="rounded-md bg-[#1d6247] px-2 py-1.5 font-semibold text-white">Confirm purchase</button></div></div>)}{!installments.length && <p className="py-5 text-center text-[10px] text-[#89948c]">No pending installments.</p>}</div></section>
    </div>
    {confirmation && <ModalFrame title="Confirm SIP purchase" onClose={() => !busy && setConfirmation(null)} closeOnBackdrop={false}>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-[#687a6e]">{confirmation.item.scheme_name} · {formatSchemePlanOption(confirmation.item.plan_type, confirmation.item.option_type)} · scheduled {confirmation.item.scheduled_date}</p>
        {confirmation.loading ? <p className="text-xs text-[#718078]">Looking up NAV for this scheme and date…</p> : confirmation.unavailable ? <p className="rounded-lg bg-[#faf6e9] p-3 text-xs text-[#79652e]">No historical NAV was found for this date. Enter the NAV shown on your fund statement.</p> : <p className="text-xs text-[#237457]">Historical NAV loaded. Check it against your statement; you can edit it below.</p>}
        <label className={labelClass}>Statement Date<input type="date" value={confirmation.actualDate} onChange={e => void changeConfirmationDate(e.target.value)} className={inputClass} /></label>
        <label className={labelClass}>Statement NAV<input type="number" min="0.0001" step="0.0001" value={confirmation.nav} onChange={e => setConfirmation(current => current ? { ...current, nav: e.target.value, error: '' } : current)} className={inputClass} /></label>
        <label className={labelClass}>Charges<input type="number" min="0" step="0.01" value={confirmation.charges} onChange={e => setConfirmation(current => current ? { ...current, charges: e.target.value, chargesEdited: true, error: '' } : current)} className={inputClass} /></label>
        {confirmation.nav && (() => { try { const values = calculateSIPConfirmation(confirmation.item.amount, confirmation.nav, confirmation.actualDate, confirmation.chargesEdited ? confirmation.charges : null); return <div className="grid grid-cols-2 gap-2 rounded-lg bg-[#f5f5ef] p-3 text-xs text-[#54685c]"><span>Total purchase amount</span><b className="text-right font-mono">{money(values.totalAmount)}</b><span>Charges deducted</span><b className="text-right font-mono">{money(values.charges)}</b><span>Net investment amount</span><b className="text-right font-mono">{money(values.amount)}</b><span>Calculated units</span><b className="text-right font-mono">{values.units}</b><span>Total cashflow</span><b className="text-right font-mono">{money(values.cashflow)}</b></div> } catch { return null } })()}
        {confirmation.error && <p role="alert" className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] px-3 py-2.5 text-xs text-[#9c4d37]">{confirmation.error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setConfirmation(null)} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078]">Cancel</button><button type="button" disabled={busy || confirmation.loading || !confirmation.actualDate || !confirmation.nav} onClick={() => void confirmInstallment()} className={buttonClass}>{busy ? 'Confirming…' : 'Confirm purchase'}</button></div>
      </div>
    </ModalFrame>}
    {deleteTarget && <ModalFrame title="Delete SIP mandate" onClose={() => !deleteBusy && setDeleteTarget(null)} closeOnBackdrop={false}>
      <div className="mt-4 space-y-3 text-sm text-[#53675e]"><p>Delete the <strong>{deleteTarget.scheme_name}</strong> ({formatSchemePlanOption(deleteTarget.plan_type, deleteTarget.option_type)}) monthly SIP mandate?</p><p className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] p-3 text-xs">Pending installments will be removed. Existing transaction audit history is preserved. A mandate with a surviving confirmed purchase cannot be hard-deleted.</p>{deleteError && <p role="alert" className="text-xs text-[#9c4d37]">{deleteError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078]">Cancel</button><button type="button" disabled={deleteBusy || deleteTarget.can_delete === false} onClick={() => void removeMandate()} className="rounded-lg bg-[#a4533a] px-4 py-2.5 text-xs font-semibold text-white">{deleteBusy ? 'Deleting…' : 'Delete mandate'}</button></div></div>
    </ModalFrame>}
  </ModalFrame>
}

function SwitchAuditButton({ records, onClick }: { records: WealthTransaction[]; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded-md border border-[#e1e4da] px-2 py-1.5 text-[10px] font-semibold text-[#46685a]">Audit ({records.length})</button>
}

function GlobalAuditViewer({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<WealthTransactionAudit[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void wealthTransactionsApi.auditLog().then(setRows).catch(e => setError(formatWealthApiError(e, 'Audit log could not be loaded.'))) }, [])
  return <ModalFrame title="Transaction audit log" onClose={onClose} wide>
    <p className="mt-2 text-xs text-[#7b8980]">All transaction changes for your account, including deleted transactions.</p>
    {error && <p role="alert" className="mt-3 text-xs text-[#9c4d37]">{error}</p>}
    <div className="mt-4 max-h-[65vh] space-y-2 overflow-auto">{rows.map(audit => { const snapshot = audit.action === 'DELETED' ? audit.before : audit.after; const schemeName = String(snapshot.scheme_name ?? snapshot.scheme_code ?? 'Transaction'); const schemeCode = String(snapshot.scheme_code ?? ''); const variant = formatSchemePlanOption(String(snapshot.plan_type ?? ''), String(snapshot.option_type ?? '')); return <article key={audit.id} className="rounded-lg border border-[#e7e5dc] bg-white p-3"><div className="flex justify-between gap-3 text-[10px]"><b className="text-[#31594a]">{audit.action} · {schemeName}</b><time className="text-[#89948c]">{new Date(audit.created_at).toLocaleString('en-IN')}</time></div>{variant !== 'Plan/option unavailable' && <p className="mt-1 text-[9px] text-[#687b70]">{variant} · Code: {schemeCode}</p>}<p className="mt-1 text-[9px] text-[#89948c]">Transaction {audit.transaction_id_snapshot}</p><pre className="mt-2 max-h-40 overflow-auto rounded bg-[#f7f7f2] p-2 text-[9px]">{JSON.stringify(snapshot, null, 2)}</pre></article>})}{!error && !rows.length && <p className="py-8 text-center text-xs text-[#89948c]">No audit records.</p>}</div>
  </ModalFrame>
}

export default function Transactions() {
  const [searchParams] = useSearchParams()
  const [transactions, setTransactions] = useState<WealthTransaction[]>([])
  const [folios, setFolios] = useState<WealthFolio[]>([])
  const [houses, setHouses] = useState<WealthFundHouse[]>([])
  const [holdings, setHoldings] = useState<WealthHolding[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [sort, setSort] = useState<TransactionSort>({ field: 'date', direction: 'desc' })
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [editor, setEditor] = useState<{ initial: WealthTransactionInput; existing?: WealthTransaction; initialScheme?: MutualFundScheme | null } | null>(null)
  const [switchEditor, setSwitchEditor] = useState<{ groupId?: string; records?: WealthTransaction[] } | null>(null)
  const [foliosOpen, setFoliosOpen] = useState(false)
  const [auditRecords, setAuditRecords] = useState<WealthTransaction[] | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'switch'; records: WealthTransaction[] } | { kind: 'transaction'; item: WealthTransaction } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [globalAuditOpen, setGlobalAuditOpen] = useState(false)
  const [sipOpen, setSipOpen] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [mutating, setMutating] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setLoadError('')
    try {
      const [transactionRows, folioRows, fundHouses, holdingResult] = await Promise.all([
        wealthTransactionsApi.list(), wealthTransactionsApi.folios(), wealthTransactionsApi.fundHouses(), wealthTransactionsApi.holdings('folio'),
      ])
      setTransactions(transactionRows); setFolios(folioRows); setHouses(fundHouses); setHoldings(holdingResult.holdings)
    } catch (error) { setLoadError(formatWealthApiError(error, 'Transaction data could not be loaded. Check your connection and retry.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load, reload])
  useEffect(() => {
    const intent = searchParams.get('intent')
    const schemeCode = searchParams.get('scheme_code')
    if (!intent || !schemeCode || loading) return
    const schemeName = searchParams.get('scheme_name') || schemeCode
    const planType = searchParams.get('plan_type') || 'UNKNOWN'
    const optionType = searchParams.get('option_type') || 'UNKNOWN'
    const folioParam = searchParams.get('folio')
    const eligibleFolios = [...new Set(holdings.filter(row => row.scheme_code === schemeCode && Number(row.units) > 0 && row.folio_id).map(row => row.folio_id as string))]
    const selectedFolio = folioParam || (eligibleFolios.length === 1 ? eligibleFolios[0] : null)
    if (intent === 'SIP') {
      setSipOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
      return
    }
    const initial = { ...defaultInput(), transaction_type: intent === 'REDEMPTION' ? 'REDEMPTION' as const : 'PURCHASE' as const, scheme_code: schemeCode, folio: selectedFolio }
    setEditor({ initial, initialScheme: { scheme_code: schemeCode, scheme_name: schemeName, fund_house: '', category_name: '', asset_class: 'UNKNOWN', plan_type: planType, option_type: optionType, isin_growth: null, isin_div_payout: null, isin_div_reinvestment: null } })
    window.history.replaceState({}, '', window.location.pathname)
  }, [searchParams, loading, holdings])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(null), 4500); return () => window.clearTimeout(timer) }, [toast])

  const historyRows = useMemo(() => buildTransactionRows(transactions, folios), [transactions, folios])
  const filteredRows = useMemo(() => filterAndSortTransactionRows(historyRows, filters, sort), [historyRows, filters, sort])
  const pageResult = useMemo(() => paginateTransactionRows(filteredRows, page, 15), [filteredRows, page])
  useEffect(() => { setPage(1) }, [filters])

  const refreshTransactionsAndHoldings = async () => {
    const [transactionRows, holdingResult] = await Promise.all([wealthTransactionsApi.list(), wealthTransactionsApi.holdings('folio')])
    setTransactions(transactionRows); setHoldings(holdingResult.holdings)
  }
  const saveTransaction = async (input: WealthTransactionInput) => {
    setMutating(true)
    try {
      if (editor?.existing) await wealthTransactionsApi.update(editor.existing.id, input)
      else await wealthTransactionsApi.create(input)
      await refreshTransactionsAndHoldings()
      setEditor(null); setToast({ type: 'success', message: editor?.existing ? 'Transaction updated.' : 'Transaction created.' })
    } catch (error) { setToast({ type: 'error', message: formatWealthApiError(error) }); throw error }
    finally { setMutating(false) }
  }
  const saveSwitch = async (input: WealthSwitchRequest) => {
    setMutating(true)
    try {
      if (switchEditor?.groupId) await wealthTransactionsApi.updateSwitchPair(switchEditor.groupId, input)
      else await wealthTransactionsApi.switchPair(input)
      await refreshTransactionsAndHoldings(); setSwitchEditor(null); setToast({ type: 'success', message: switchEditor?.groupId ? 'Switch pair updated.' : 'Switch pair created.' })
    }
    catch (error) { setToast({ type: 'error', message: formatWealthApiError(error) }); throw error }
    finally { setMutating(false) }
  }
  const performDelete = async () => {
    if (!deleteTarget) return
    setMutating(true)
    setDeleteError('')
    try {
      if (deleteTarget.kind === 'switch') {
        const groupId = deleteTarget.records[0]?.switch_group_id
        if (!groupId) throw new Error('This switch pair is missing its group identifier.')
        await wealthTransactionsApi.deleteSwitchPair(groupId)
      } else await wealthTransactionsApi.delete(deleteTarget.item.id)
      await refreshTransactionsAndHoldings()
      setDeleteTarget(null)
      setToast({ type: 'success', message: deleteTarget.kind === 'switch' ? 'Both switch records were deleted.' : 'Transaction deleted.' })
    } catch (error) { setDeleteError(formatWealthApiError(error)) }
    finally { setMutating(false) }
  }
  const refreshFolios = async () => { setFolios(await wealthTransactionsApi.folios()) }
  const startEdit = (item: WealthTransaction) => setEditor({ existing: item, initial: {
    transaction_type: item.transaction_type, transaction_date: item.transaction_date, source: item.source,
    source_reference: item.source_reference, scheme_code: item.scheme.scheme_code, folio: item.folio,
    mf_detail: { ...item.mf_detail }, notes: item.notes,
  } })
  const changeSort = (field: TransactionSort['field']) => setSort((current) => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }))

  return <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-7 sm:py-10 xl:px-10">
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b773d]">WealthOnCruise</p>
    <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-serif text-3xl font-bold tracking-tight text-[#18382f]">Transactions</h1><p className="mt-1 text-sm text-[#738078]">Track mutual fund purchases, redemptions, and switches.</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFoliosOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9ded4] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#315b4d]"><WalletCards size={14} />Manage folios</button><button type="button" onClick={() => setSipOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9ded4] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#315b4d]">SIP plans</button><button type="button" onClick={() => setGlobalAuditOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9ded4] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#315b4d]">Audit log</button><button type="button" onClick={() => setSwitchEditor({})} className="inline-flex items-center gap-1.5 rounded-lg border border-[#c9d8cb] bg-[#edf4ee] px-3.5 py-2.5 text-xs font-semibold text-[#315b4d]">Record switch</button><button type="button" onClick={() => setEditor({ initial: defaultInput() })} className={buttonClass}><Plus size={14} />Add transaction</button></div>
    </div>
    {toast && <div role={toast.type === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg border px-4 py-3 text-xs ${toast.type === 'error' ? 'border-[#efd9cf] bg-[#fcf2ee] text-[#9c4d37]' : 'border-[#d4e5d8] bg-[#f0f7f1] text-[#246747]'}`}>{toast.message}</div>}
    <section className="mt-6 rounded-2xl border border-[#e7e5dc] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.04)] sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className={`${labelClass} xl:col-span-1`}>Search scheme<div className="relative mt-1.5"><Search size={14} className="absolute left-3 top-3 text-[#8a978e]" /><input className={`${inputClass} mt-0 pl-9`} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Scheme name or code" /></div></label>
        <label className={labelClass}>Transaction type<select className={inputClass} value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">All types</option>{(['PURCHASE', 'REDEMPTION', 'SWITCH', 'DIVIDEND', 'BONUS', 'OTHER'] as const).map((value) => <option key={value} value={value}>{typeLabels[value]}</option>)}</select></label>
        <label className={labelClass}>Folio<select className={inputClass} value={filters.folio} onChange={(event) => setFilters({ ...filters, folio: event.target.value })}><option value="">All folios</option><option value="unassigned">Unassigned</option>{folios.map((folio) => <option key={folio.id} value={folio.id}>{folio.folio_number}</option>)}</select></label>
        <label className={labelClass}>From date<input type="date" className={inputClass} value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label className={labelClass}>To date<input type="date" className={inputClass} value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      </div>
    </section>
    <section className="mt-4 overflow-hidden rounded-2xl border border-[#e7e5dc] bg-white shadow-[0_5px_16px_rgba(32,49,38,0.04)]">
      {loading ? <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-[#718078]"><LoaderCircle size={17} className="animate-spin" />Loading transactions…</div>
        : loadError ? <div className="p-10 text-center"><p role="alert" className="text-sm text-[#9c4d37]">{loadError}</p><button type="button" onClick={() => setReload((value) => value + 1)} className="mt-3 rounded-lg border border-[#d7ded5] px-3 py-2 text-xs font-semibold text-[#315b4d]">Retry</button></div>
          : !filteredRows.length ? <div className="px-6 py-14 text-center"><h2 className="font-serif text-lg font-bold text-[#18382f]">{transactions.length ? 'No matching transactions' : 'No transactions yet'}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#7c8981]">{transactions.length ? 'Adjust the search or filters to see transactions.' : 'Add a purchase or redemption to start your WealthOnCruise transaction history.'}</p>{!transactions.length && <button type="button" onClick={() => setEditor({ initial: defaultInput() })} className={`${buttonClass} mt-4`}><Plus size={14} />Add transaction</button>}</div>
            : <>
              <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left">
                <thead className="border-b border-[#ecece5] bg-[#fafaf6] text-[9px] uppercase tracking-[0.1em] text-[#78857d]"><tr>
                  <th className="px-4 py-3"><SortButton field="date" sort={sort} onClick={changeSort}>Date</SortButton></th><th className="px-4 py-3"><SortButton field="scheme" sort={sort} onClick={changeSort}>Scheme</SortButton></th><th className="px-4 py-3">Folio</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Source</th><th className="px-4 py-3"><SortButton field="units" sort={sort} onClick={changeSort}>Units</SortButton></th><th className="px-4 py-3">NAV</th><th className="px-4 py-3"><SortButton field="amount" sort={sort} onClick={changeSort}>Amount</SortButton></th><th className="px-4 py-3">Charges</th><th className="px-4 py-3">Cashflow</th><th className="px-4 py-3">Actions</th>
                </tr></thead>
                <tbody className="divide-y divide-[#f0f0ea]">{pageResult.rows.map((row) => <tr key={row.key} className="align-top text-[11px] text-[#53675e] hover:bg-[#fcfcf8]">
                  <td className="whitespace-nowrap px-4 py-3.5">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(`${row.date}T00:00:00`))}</td><td className="max-w-[240px] px-4 py-3.5 font-semibold text-[#24483d]">{row.schemeLabel}<span className="mt-1 block truncate text-[9px] font-normal text-[#687b70]">{row.schemePlanLabel}</span><span className="block truncate text-[8px] font-normal text-[#a0aaa2]">Code: {row.schemeCodeLabel}</span></td><td className="px-4 py-3.5">{row.folioLabel}</td><td className="whitespace-nowrap px-4 py-3.5"><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${row.isSwitch ? 'bg-[#edf0fa] text-[#596591]' : 'bg-[#f3f1e8] text-[#6d704f]'}`}>{typeLabels[row.type as keyof typeof typeLabels] ?? row.type}</span></td><td className="px-4 py-3.5">{row.sourceLabel}</td><td className="whitespace-nowrap px-4 py-3.5 font-mono">{row.unitsLabel}</td><td className="whitespace-nowrap px-4 py-3.5 font-mono">{row.navLabel}</td><td className="whitespace-nowrap px-4 py-3.5 font-mono">{row.isSwitch ? `Out ${money(row.records.find((item) => item.transaction_type === 'SWITCH_OUT')?.mf_detail.amount ?? '0')} · In ${money(row.records.find((item) => item.transaction_type === 'SWITCH_IN')?.mf_detail.amount ?? '0')}` : money(row.amountLabel)}</td><td className="whitespace-nowrap px-4 py-3.5 font-mono">{row.isSwitch ? `Out ${money(row.records.find((item) => item.transaction_type === 'SWITCH_OUT')?.mf_detail.charges ?? '0')} · In ${money(row.records.find((item) => item.transaction_type === 'SWITCH_IN')?.mf_detail.charges ?? '0')}` : money(row.chargesLabel)}</td><td className="whitespace-nowrap px-4 py-3.5 font-mono">{row.isSwitch ? `Out ${money(row.records.find((item) => item.transaction_type === 'SWITCH_OUT')?.mf_detail.cashflow ?? '0')} · In ${money(row.records.find((item) => item.transaction_type === 'SWITCH_IN')?.mf_detail.cashflow ?? '0')}` : money(row.cashflowLabel)}</td>
                  <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">{row.isSwitch ? <><SwitchAuditButton records={row.records} onClick={() => setAuditRecords(row.records)} /><button type="button" title="Edit both switch legs" aria-label="Edit switch pair" disabled={mutating} onClick={() => setSwitchEditor({ groupId: row.records[0].switch_group_id ?? undefined, records: row.records })} className="rounded-md border border-[#e1e4da] p-1.5 text-[#46685a]"><Pencil size={13} /></button><button type="button" title="Delete both switch legs" aria-label="Delete switch pair" disabled={mutating} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'switch', records: row.records }) }} className="rounded-md border border-[#efd9cf] p-1.5 text-[#a4533a]"><Trash2 size={13} /></button></> : <><button type="button" title="View audit history" aria-label="View audit history" onClick={() => setAuditRecords(row.records)} className="rounded-md border border-[#e1e4da] p-1.5 text-[#46685a]"><Clock3 size={13} /></button><button type="button" title="Edit transaction" aria-label="Edit transaction" disabled={mutating} onClick={() => startEdit(row.records[0])} className="rounded-md border border-[#e1e4da] p-1.5 text-[#46685a] disabled:opacity-40"><Pencil size={13} /></button><button type="button" title="Delete transaction" aria-label="Delete transaction" disabled={mutating} onClick={() => { setDeleteError(''); setDeleteTarget({ kind: 'transaction', item: row.records[0] }) }} className="rounded-md border border-[#efd9cf] p-1.5 text-[#a4533a] disabled:opacity-40"><Trash2 size={13} /></button></>}</div></td>
                </tr>)}</tbody>
              </table></div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ecece5] px-4 py-3 text-xs text-[#78857d]"><span>{filteredRows.length.toLocaleString()} transactions · Page {pageResult.pageCount === 1 ? 1 : Math.min(page, pageResult.pageCount)} of {pageResult.pageCount}</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex items-center gap-1 rounded-md border border-[#e1e2d8] px-3 py-2 font-medium text-[#315b4d] disabled:opacity-40"><ChevronLeft size={14} />Previous</button><button type="button" disabled={page >= pageResult.pageCount} onClick={() => setPage((value) => Math.min(pageResult.pageCount, value + 1))} className="inline-flex items-center gap-1 rounded-md border border-[#e1e2d8] px-3 py-2 font-medium text-[#315b4d] disabled:opacity-40">Next<ChevronRight size={14} /></button></div></div>
            </>}
    </section>
    <div className="mt-3 flex items-center justify-between text-[10px] text-[#89948c]"><span>Transactions are stored in your WealthOnCruise account.</span><button type="button" onClick={() => setReload((value) => value + 1)} disabled={loading || mutating} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white disabled:opacity-40"><RefreshCw size={11} />Refresh</button></div>
    {editor && <TransactionEditor key={editor.existing?.id ?? 'new'} initial={editor.initial} initialScheme={editor.existing?.scheme ?? editor.initialScheme ?? null} existing={editor.existing} folios={folios} holdings={holdings} editing={Boolean(editor.existing)} onClose={() => setEditor(null)} onSave={saveTransaction} />}
    {switchEditor && <SwitchEditor key={switchEditor.groupId ?? 'new-switch'} folios={folios} initialRecords={switchEditor.records} onClose={() => setSwitchEditor(null)} onSave={saveSwitch} />}
    {foliosOpen && <FolioManager folios={folios} houses={houses} onClose={() => setFoliosOpen(false)} onChanged={refreshFolios} />}
    {auditRecords && <AuditViewer records={auditRecords} onClose={() => setAuditRecords(null)} />}
    {globalAuditOpen && <GlobalAuditViewer onClose={() => setGlobalAuditOpen(false)} />}
    {deleteTarget && <ModalFrame title={deleteTarget.kind === 'switch' ? 'Delete switch pair' : 'Delete transaction'} onClose={() => !mutating && setDeleteTarget(null)} closeOnBackdrop={false}>
      <div className="mt-4 space-y-3 text-sm text-[#53675e]">
        {deleteTarget.kind === 'switch' ? <div className="rounded-lg bg-[#f7f7f2] p-3 text-xs">{deleteTarget.records.map(record => <p key={record.id}>{typeLabels[record.transaction_type]} · {record.scheme.scheme_name} · {formatSchemePlanOption(record.scheme.plan_type, record.scheme.option_type)} · {record.transaction_date}</p>)}</div> : <p className="rounded-lg bg-[#f7f7f2] p-3 text-xs">{typeLabels[deleteTarget.item.transaction_type]} · {deleteTarget.item.scheme.scheme_name} · {formatSchemePlanOption(deleteTarget.item.scheme.plan_type, deleteTarget.item.scheme.option_type)} · {deleteTarget.item.transaction_date}</p>}
        <p className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] p-3 text-xs font-semibold text-[#9c4d37]">This deletion cannot be undone. The transaction will remain in the audit history.</p>
        {deleteError && <p role="alert" className="text-xs text-[#9c4d37]">{deleteError}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={mutating} onClick={() => setDeleteTarget(null)} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078]">Cancel</button><button type="button" disabled={mutating} onClick={() => void performDelete()} className="rounded-lg bg-[#a4533a] px-4 py-2.5 text-xs font-semibold text-white">{mutating ? 'Deleting…' : 'Delete'}</button></div>
      </div>
    </ModalFrame>}
    {sipOpen && <SIPManager folios={folios} initialScheme={searchParams.get('scheme_code') ? { scheme_code: searchParams.get('scheme_code')!, scheme_name: searchParams.get('scheme_name') || searchParams.get('scheme_code')!, fund_house: '', category_name: '', asset_class: 'UNKNOWN', plan_type: searchParams.get('plan_type') || 'UNKNOWN', option_type: searchParams.get('option_type') || 'UNKNOWN', isin_growth: null, isin_div_payout: null, isin_div_reinvestment: null } : null} initialFolio={searchParams.get('folio')} onClose={() => setSipOpen(false)} onChanged={refreshTransactionsAndHoldings} />}
  </div>
}

function SortButton({ field, sort, onClick, children }: { field: TransactionSort['field']; sort: TransactionSort; onClick: (field: TransactionSort['field']) => void; children: ReactNode }) {
  return <button type="button" onClick={() => onClick(field)} className="inline-flex items-center gap-1 font-semibold uppercase tracking-[0.1em]">{children}<ChevronDown size={11} className={sort.field === field && sort.direction === 'asc' ? 'rotate-180' : ''} /></button>
}
