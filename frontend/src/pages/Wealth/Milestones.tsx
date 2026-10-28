import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check, CircleAlert, Flame, LoaderCircle, Pencil, Plus, Target, Trash2, WalletCards, X } from 'lucide-react'
import { cashFlowApi, type CashFlowProfile } from '../../api/cashFlow'
import {
  wealthMilestonesApi,
  type WealthMilestone,
  type WealthMilestoneCollection,
  type WealthMilestoneInput,
} from '../../api/wealthMilestones'
import {
  calculateFireEstimates,
  calculateMilestoneProjection,
  compareMonthlySurplus,
  createFireMilestoneDraft,
  type FireGoalKind,
  type MilestoneDraft,
} from '../../utils/wealthMilestones'

const money = (value: number | string) => `₹${new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0)}`

const defaultDraft = (): MilestoneDraft => ({
  name: '',
  presentAmount: '',
  targetYear: '',
  inflationRate: '7.00',
  expectedReturnRate: '12.00',
})

function getApiErrors(error: unknown) {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data
  if (!data) return { summary: 'We could not save the milestone. Please try again.', fields: {} as Record<string, string> }
  const fields: Record<string, string> = {}
  for (const [field, value] of Object.entries(data)) {
    const message = Array.isArray(value) ? value.join(' ') : String(value)
    if (['name', 'present_amount', 'target_year', 'inflation_rate', 'expected_return_rate'].includes(field)) {
      fields[field] = message
    }
  }
  const nonField = Object.entries(data)
    .filter(([field]) => !['name', 'present_amount', 'target_year', 'inflation_rate', 'expected_return_rate'].includes(field))
    .map(([, value]) => Array.isArray(value) ? value.join(' ') : String(value))
    .join(' ')
  return { summary: nonField || Object.keys(fields).length ? nonField : 'We could not save the milestone. Please try again.', fields }
}

function fieldErrorClass(hasError: boolean) {
  return `mt-1.5 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-[#294638] outline-none focus:border-[#739c81] focus:ring-2 focus:ring-[#739c81]/15 ${hasError ? 'border-[#d99a83]' : 'border-[#dedfd5]'}`
}

function MilestoneForm({
  draft,
  currentYear,
  saving,
  errors,
  summaryError,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: MilestoneDraft
  currentYear: number
  saving: boolean
  errors: Record<string, string>
  summaryError: string
  onChange: (next: MilestoneDraft) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const projection = calculateMilestoneProjection(draft, currentYear)
  const fieldError = (name: string) => errors[name]

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-[#10372e]/45 p-3 sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="milestone-form-title" className="mx-auto my-4 max-w-2xl rounded-2xl border border-[#e7e2d4] bg-[#fffef9] p-4 shadow-2xl sm:my-8 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a7a35]">WealthOnCruise · Goal planning</p>
            <h2 id="milestone-form-title" className="mt-1 font-serif text-2xl font-bold text-[#18382f]">{draft.name ? 'Add or edit milestone' : 'Add milestone'}</h2>
            <p className="mt-1 text-xs leading-5 text-[#78867e]">Derived values update as you adjust the goal inputs.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close milestone form" className="rounded-lg p-2 text-[#75847a] hover:bg-[#f1efe7]"><X size={17} /></button>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-3.5">
          {summaryError && <p role="alert" className="rounded-lg border border-[#efd9cf] bg-[#fcf2ee] px-3 py-2.5 text-xs leading-5 text-[#9c4d37]">{summaryError}</p>}
          <label className="block text-[11px] font-semibold text-[#5f7067]">
            Goal name
            <input autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} maxLength={120} required aria-invalid={Boolean(fieldError('name'))} className={fieldErrorClass(Boolean(fieldError('name')))} placeholder="e.g. Home purchase" />
            {fieldError('name') && <span role="alert" className="mt-1 block text-[11px] font-normal text-[#a4533a]">{fieldError('name')}</span>}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[#5f7067]">
              Present amount (INR)
              <input type="number" min="0.01" step="0.01" inputMode="decimal" value={draft.presentAmount} onChange={(event) => onChange({ ...draft, presentAmount: event.target.value })} required aria-invalid={Boolean(fieldError('present_amount'))} className={fieldErrorClass(Boolean(fieldError('present_amount')))} placeholder="e.g. 2500000.00" />
              {fieldError('present_amount') && <span role="alert" className="mt-1 block text-[11px] font-normal text-[#a4533a]">{fieldError('present_amount')}</span>}
            </label>
            <label className="block text-[11px] font-semibold text-[#5f7067]">
              Target year <span className="font-normal text-[#89948c]">(current year {currentYear})</span>
              <input type="number" min={currentYear + 1} max={currentYear + 100} step="1" inputMode="numeric" value={draft.targetYear} onChange={(event) => onChange({ ...draft, targetYear: event.target.value })} required aria-invalid={Boolean(fieldError('target_year'))} className={fieldErrorClass(Boolean(fieldError('target_year')))} placeholder={String(currentYear + 5)} />
              {fieldError('target_year') && <span role="alert" className="mt-1 block text-[11px] font-normal text-[#a4533a]">{fieldError('target_year')}</span>}
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[#5f7067]">
              Inflation rate (% p.a.)
              <input type="number" min="0" max="100" step="0.01" value={draft.inflationRate} onChange={(event) => onChange({ ...draft, inflationRate: event.target.value })} required aria-invalid={Boolean(fieldError('inflation_rate'))} className={fieldErrorClass(Boolean(fieldError('inflation_rate')))} />
              {fieldError('inflation_rate') && <span role="alert" className="mt-1 block text-[11px] font-normal text-[#a4533a]">{fieldError('inflation_rate')}</span>}
            </label>
            <label className="block text-[11px] font-semibold text-[#5f7067]">
              Expected annual investment return (%)
              <input type="number" min="0" max="100" step="0.01" value={draft.expectedReturnRate} onChange={(event) => onChange({ ...draft, expectedReturnRate: event.target.value })} required aria-invalid={Boolean(fieldError('expected_return_rate'))} className={fieldErrorClass(Boolean(fieldError('expected_return_rate')))} />
              {fieldError('expected_return_rate') && <span role="alert" className="mt-1 block text-[11px] font-normal text-[#a4533a]">{fieldError('expected_return_rate')}</span>}
            </label>
          </div>

          <section aria-live="polite" className="rounded-xl border border-[#e6e0cd] bg-[#faf8f0] p-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a7a35]">Live projection</p>
            {projection.yearsRemaining !== null && projection.yearsRemaining > 0 && projection.futureAmount !== null && projection.requiredMonthlySip !== null ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div><p className="text-[9px] text-[#89948c]">Time remaining</p><p className="mt-1 text-xs font-semibold text-[#294638]">{projection.yearsRemaining} years</p></div>
                <div><p className="text-[9px] text-[#89948c]">Future amount</p><p className="mt-1 text-xs font-semibold text-[#294638]">{money(projection.futureAmount)}</p></div>
                <div><p className="text-[9px] text-[#89948c]">Monthly SIP needed</p><p className="mt-1 text-xs font-semibold text-[#1f694b]">{money(projection.requiredMonthlySip)}</p></div>
              </div>
            ) : <p className="mt-1.5 text-xs leading-5 text-[#7c8981]">Enter a present amount and future target year to see the inflation-adjusted amount and required SIP.</p>}
            <p className="mt-2 text-[9px] leading-4 text-[#929b94]">SIP estimate assumes deposits at the beginning of each month.</p>
          </section>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-4 py-2.5 text-xs font-semibold text-[#718078] hover:bg-[#f0efe8] disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d6247] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#164d38] disabled:opacity-50">
              {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{saving ? 'Saving…' : 'Save milestone'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

export default function Milestones() {
  const [milestones, setMilestones] = useState<WealthMilestone[]>([])
  const [currentYear, setCurrentYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [cashFlow, setCashFlow] = useState<CashFlowProfile | null>(null)
  const [cashFlowState, setCashFlowState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cashFlowError, setCashFlowError] = useState('')
  const [draft, setDraft] = useState<MilestoneDraft | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [monthlyExpenses, setMonthlyExpenses] = useState('')

  useEffect(() => {
    let current = true
    wealthMilestonesApi.list()
      .then((collection: WealthMilestoneCollection) => {
        if (!current) return
        setCurrentYear(collection.current_year)
        setMilestones(collection.milestones)
      })
      .catch(() => { if (current) setLoadError('We could not load your milestones. Please try again.') })
      .finally(() => { if (current) setLoading(false) })

    cashFlowApi.getCurrent()
      .then((profile) => { if (current) { setCashFlow(profile); setCashFlowState('ready') } })
      .catch(() => { if (current) { setCashFlowState('error'); setCashFlowError('Your current monthly cash flow could not be loaded.') } })

    return () => { current = false }
  }, [])

  const totalRequiredSip = useMemo(
    () => milestones.reduce((total, milestone) => total + (Number(milestone.required_monthly_sip) || 0), 0),
    [milestones],
  )
  const fireEstimates = calculateFireEstimates(monthlyExpenses)

  const openNewMilestone = (preset?: MilestoneDraft) => {
    setEditingId(null)
    setFormErrors({})
    setFormError('')
    setDraft(preset ?? defaultDraft())
  }

  const openEditMilestone = (milestone: WealthMilestone) => {
    setEditingId(milestone.id)
    setFormErrors({})
    setFormError('')
    setDraft({
      name: milestone.name,
      presentAmount: milestone.present_amount,
      targetYear: String(milestone.target_year),
      inflationRate: milestone.inflation_rate,
      expectedReturnRate: milestone.expected_return_rate,
    })
  }

  const closeForm = () => {
    if (saving) return
    setDraft(null)
    setEditingId(null)
    setFormErrors({})
    setFormError('')
  }

  const saveMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    const payload: WealthMilestoneInput = {
      name: draft.name.trim(),
      present_amount: draft.presentAmount,
      target_year: Number(draft.targetYear),
      inflation_rate: draft.inflationRate,
      expected_return_rate: draft.expectedReturnRate,
    }
    setSaving(true)
    setFormErrors({})
    setFormError('')
    setToast(null)
    try {
      const saved = editingId
        ? await wealthMilestonesApi.update(editingId, payload)
        : await wealthMilestonesApi.create(payload)
      setMilestones((current) => {
        const updated = editingId
          ? current.map((milestone) => milestone.id === saved.id ? saved : milestone)
          : [...current, saved]
        return updated.sort((left, right) => left.target_year - right.target_year || left.name.localeCompare(right.name))
      })
      setDraft(null)
      setEditingId(null)
      setToast({ type: 'success', message: editingId ? 'Milestone updated.' : 'Milestone added.' })
    } catch (error) {
      const parsed = getApiErrors(error)
      setFormErrors(parsed.fields)
      setFormError(parsed.summary)
    } finally {
      setSaving(false)
    }
  }

  const deleteMilestone = async (milestone: WealthMilestone) => {
    if (!window.confirm(`Delete the “${milestone.name}” milestone?`)) return
    setToast(null)
    try {
      await wealthMilestonesApi.delete(milestone.id)
      setMilestones((current) => current.filter((item) => item.id !== milestone.id))
      setToast({ type: 'success', message: 'Milestone deleted.' })
    } catch {
      setToast({ type: 'error', message: 'We could not delete that milestone. Please try again.' })
    }
  }

  const addFireEstimate = (kind: FireGoalKind, corpus: number) => {
    openNewMilestone(createFireMilestoneDraft(kind, corpus))
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[#708076]"><LoaderCircle className="animate-spin" size={18} /> Loading your milestones…</div>
  }

  if (loadError || currentYear === null) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <CircleAlert className="mx-auto text-[#a4533a]" size={25} />
        <h1 className="mt-3 font-serif text-2xl font-bold text-[#18382f]">Could not load milestones</h1>
        <p role="alert" className="mt-2 text-sm text-[#8a6559]">{loadError || 'The current local year could not be loaded.'}</p>
      </div>
    )
  }

  const noCashFlowEntries = cashFlowState === 'ready' && Boolean(cashFlow && cashFlow.entries.length === 0)
  const surplus = Number(cashFlow?.totals.surplus ?? 0)
  const surplusComparison = compareMonthlySurplus(totalRequiredSip, surplus)

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 xl:px-9">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8b773d]">WealthOnCruise · Goal planning</p>
          <h1 className="mt-1 font-serif text-3xl font-bold tracking-tight text-[#18382f] sm:text-[34px]">Milestones</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-5 text-[#738078]">Plan future goals with inflation-adjusted targets and a monthly SIP estimate.</p>
        </div>
        <button type="button" onClick={() => openNewMilestone()} className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d6247] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#164d38]"><Plus size={15} /> Add milestone</button>
      </div>

      {toast && (
        <div role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'} aria-atomic="true" className={`fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-md items-start gap-2 rounded-xl border px-4 py-3 text-xs leading-5 shadow-[0_12px_32px_rgba(24,56,47,0.18)] sm:bottom-6 sm:right-6 ${toast.type === 'error' ? 'border-[#efd9cf] bg-[#fcf2ee] text-[#9c4d37]' : 'border-[#d4e5d8] bg-[#f0f7f1] text-[#246747]'}`}>
          {toast.type === 'error' ? <CircleAlert size={15} className="mt-0.5 shrink-0" /> : <Check size={15} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message" className="-mr-1 -mt-1 rounded-md p-1 text-current/70 hover:bg-black/5 hover:text-current"><X size={14} /></button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-2xl border border-[#d4e5d8] bg-[#f0f7f1] px-4 py-4 shadow-[0_4px_14px_rgba(32,49,38,0.035)] sm:px-5">
          <p className="text-xs font-semibold text-[#1f694b]/75">Total required monthly SIP</p>
          <p className="mt-2 font-serif text-[26px] font-bold tracking-tight text-[#1f694b]">{money(totalRequiredSip)}</p>
          <p className="mt-1 text-[10px] text-[#527a63]">Across milestones with a future target date.</p>
        </section>
        <section className="rounded-2xl border border-[#eadfbd] bg-[#fcf8eb] px-4 py-4 shadow-[0_4px_14px_rgba(32,49,38,0.035)] sm:px-5">
          <p className="text-xs font-semibold text-[#8d6b23]/80">Monthly cash-flow comparison</p>
          {cashFlowState === 'loading' ? <p className="mt-2 text-sm text-[#8a7951]">Loading saved surplus…</p> : null}
          {noCashFlowEntries && (
            <div className="mt-2">
              <p className="text-xs leading-5 text-[#7e744f]">No monthly cash-flow entries are saved yet, so available surplus is unknown.</p>
              <Link to="/wealth/monthly-expense" className="mt-2 inline-flex text-xs font-semibold text-[#277250] hover:underline">Set up Current Monthly Cash Flow</Link>
            </div>
          )}
          {cashFlowState === 'error' && <p role="alert" className="mt-2 text-xs leading-5 text-[#9c4d37]">{cashFlowError} Surplus comparison is unavailable.</p>}
          {cashFlowState === 'ready' && !noCashFlowEntries && cashFlow && (
            <>
              <p className="mt-2 font-serif text-[24px] font-bold text-[#8d6b23]">{money(surplus)}</p>
              <p className="mt-1 text-[10px] text-[#8b805e]">{surplus >= 0 ? 'Saved monthly investable surplus' : 'Saved monthly cash-flow shortfall'}</p>
              <p className="mt-3 border-t border-[#eadfbd] pt-2 text-xs font-semibold text-[#68572e]">
                {surplusComparison.covered ? 'Surplus after these milestone SIPs' : 'Additional monthly amount needed'}: {money(Math.abs(surplusComparison.difference))}
              </p>
            </>
          )}
        </section>
      </div>

      <section className="mt-4 rounded-2xl border border-[#e8e5da] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.035)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9a7a35]">Your plan</p>
            <h2 className="mt-1 font-serif text-xl font-bold text-[#18382f]">Savings milestones</h2>
            <p className="mt-1 text-xs text-[#78867e]">Present amounts are adjusted for inflation through each target year.</p>
          </div>
          <span className="rounded-full border border-[#dce8dd] bg-[#f5faf5] px-3 py-1.5 text-[10px] font-medium text-[#4e7560]">Local year · {currentYear}</span>
        </div>

        {milestones.length === 0 ? (
          <div className="mt-4 rounded-xl bg-[#faf9f5] px-5 py-8 text-center">
            <Target className="mx-auto text-[#b1842e]" size={24} />
            <p className="mt-2 text-sm font-semibold text-[#445e4e]">No milestones yet</p>
            <p className="mt-1 text-xs text-[#849087]">Add a goal to see its future amount and monthly SIP estimate.</p>
            <button type="button" onClick={() => openNewMilestone()} className="mt-4 inline-flex items-center gap-1 rounded-lg bg-[#eaf3ec] px-3 py-2 text-xs font-semibold text-[#276a4b] hover:bg-[#deecdf]"><Plus size={13} /> Add your first milestone</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {milestones.map((milestone) => (
              <article key={milestone.id} className="rounded-xl border border-[#ece9df] bg-[#fffefb] p-3.5 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[#294638]">{milestone.name}</h3>
                    <p className="mt-1 text-[10px] text-[#89948c]">Present amount · {money(milestone.present_amount)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => openEditMilestone(milestone)} aria-label={`Edit ${milestone.name}`} className="rounded-md p-2 text-[#839087] hover:bg-[#edf3ed] hover:text-[#276a4b]"><Pencil size={14} /></button>
                    <button type="button" onClick={() => { void deleteMilestone(milestone) }} aria-label={`Delete ${milestone.name}`} className="rounded-md p-2 text-[#a1958e] hover:bg-[#faefeb] hover:text-[#a4533a]"><Trash2 size={14} /></button>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><dt className="text-[9px] uppercase tracking-wide text-[#98a198]">Target · time left</dt><dd className="mt-1 text-xs font-semibold text-[#455e4e]">{milestone.target_year} · {milestone.years_remaining > 0 ? `${milestone.years_remaining} years` : 'Target year reached'}</dd></div>
                  <div><dt className="text-[9px] uppercase tracking-wide text-[#98a198]">Future amount</dt><dd className="mt-1 text-xs font-semibold tabular-nums text-[#455e4e]">{money(milestone.future_amount)}</dd></div>
                  <div><dt className="text-[9px] uppercase tracking-wide text-[#98a198]">Required monthly SIP</dt><dd className="mt-1 text-xs font-semibold tabular-nums text-[#1f694b]">{milestone.required_monthly_sip === null ? '—' : money(milestone.required_monthly_sip)}</dd></div>
                  <div><dt className="text-[9px] uppercase tracking-wide text-[#98a198]">Assumptions</dt><dd className="mt-1 text-[10px] text-[#718078]">Inflation {milestone.inflation_rate}% · Return {milestone.expected_return_rate}%</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-[#e8e5da] bg-white p-4 shadow-[0_5px_16px_rgba(32,49,38,0.035)] sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fcf4e2] text-[#a27c28]"><Flame size={18} /></span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9a7a35]">Retirement estimate</p>
            <h2 className="mt-1 font-serif text-xl font-bold text-[#18382f]">Simple FIRE calculator</h2>
            <p className="mt-1 text-xs text-[#78867e]">Uses monthly expenses only. FIRE corpus estimates are shown in today’s rupees.</p>
          </div>
        </div>
        <div className="mt-4 max-w-sm">
          <label htmlFor="fire-monthly-expenses" className="text-[11px] font-semibold text-[#5f7067]">Monthly expenses (INR)</label>
          <input id="fire-monthly-expenses" type="number" min="0.01" step="0.01" inputMode="decimal" value={monthlyExpenses} onChange={(event) => setMonthlyExpenses(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#dedfd5] bg-white px-3 py-2.5 text-sm text-[#294638] outline-none focus:border-[#739c81] focus:ring-2 focus:ring-[#739c81]/15" placeholder="Enter monthly expenses" />
        </div>
        {Number(monthlyExpenses) > 0 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[#faf9f5] p-3"><p className="text-[10px] text-[#849087]">Annual expenses</p><p className="mt-1 text-sm font-semibold text-[#455e4e]">{money(fireEstimates.annualExpense)}</p></div>
            <div className="rounded-xl border border-[#e5e9df] bg-[#fbfdf9] p-3"><p className="text-[10px] text-[#849087]">Lean FIRE · 25×</p><p className="mt-1 text-sm font-semibold text-[#1f694b]">{money(fireEstimates.leanCorpus)}</p><button type="button" onClick={() => addFireEstimate('Lean FIRE', fireEstimates.leanCorpus)} className="mt-2 text-[10px] font-semibold text-[#277250] hover:underline">Add to milestones</button></div>
            <div className="rounded-xl border border-[#eadfbd] bg-[#fffdf7] p-3"><p className="text-[10px] text-[#849087]">Fat FIRE · 30×</p><p className="mt-1 text-sm font-semibold text-[#8d6b23]">{money(fireEstimates.fatCorpus)}</p><button type="button" onClick={() => addFireEstimate('Fat FIRE', fireEstimates.fatCorpus)} className="mt-2 text-[10px] font-semibold text-[#8d6b23] hover:underline">Add to milestones</button></div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-[#89948c]">Enter monthly expenses to see today’s annual expense and corpus estimates.</p>
        )}
      </section>

      <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-4 text-[#929b94]"><CalendarClock size={13} className="mt-px shrink-0" /> Projections use the current local year and are recalculated whenever milestones are loaded. SIP estimates assume beginning-of-month investments.</p>
      <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[#929b94]"><WalletCards size={13} /> Estimates are planning illustrations and do not create investment transactions.</p>

      {draft && <MilestoneForm draft={draft} currentYear={currentYear} saving={saving} errors={formErrors} summaryError={formError} onChange={setDraft} onClose={closeForm} onSubmit={saveMilestone} />}
    </div>
  )
}
