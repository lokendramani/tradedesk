import type {
  WealthFolio,
  WealthMFTransactionDetail,
  WealthSwitchRequest,
  WealthTransaction,
  WealthTransactionInput,
  WealthTransactionType,
} from '../api/wealthTransactions'
import { formatSchemePlanOption } from './schemePickerDisplay.ts'

export interface TransactionFilters {
  search: string
  type: string
  folio: string
  from: string
  to: string
}

export interface TransactionSort {
  field: 'date' | 'scheme' | 'amount' | 'units'
  direction: 'asc' | 'desc'
}

function scaledDecimal(value: string, places: number): bigint {
  const match = value.trim().match(/^(\d+)(?:\.(\d*))?$/)
  if (!match || (match[2]?.length ?? 0) > places) throw new Error(`Enter a valid value with up to ${places} decimal places.`)
  return BigInt(match[1]) * 10n ** BigInt(places) + BigInt((match[2] ?? '').padEnd(places, '0') || '0')
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator
}

function formatScaled(value: bigint, places: number): string {
  const scale = 10n ** BigInt(places)
  return `${value / scale}.${(value % scale).toString().padStart(places, '0')}`
}

export function calculateSIPCharges(scheduledAmount: string, date: string): string {
  const amountPaise = scaledDecimal(scheduledAmount, 2)
  if (amountPaise <= 0n) throw new Error('Scheduled purchase amount must be greater than zero.')
  const chargesPaise = date >= '2020-07-01' ? roundedDivision(amountPaise, 20000n) : 0n
  return formatScaled(chargesPaise, 2)
}

export function calculateSIPConfirmation(scheduledAmount: string, nav: string, date: string, chargesOverride: string | null = null) {
  const amountPaise = scaledDecimal(scheduledAmount, 2)
  const navTenThousandths = scaledDecimal(nav, 4)
  if (amountPaise <= 0n || navTenThousandths <= 0n) throw new Error('Scheduled purchase amount and NAV must be greater than zero.')
  const chargesPaise = chargesOverride === null
    ? BigInt(calculateSIPCharges(scheduledAmount, date).replace('.', ''))
    : scaledDecimal(chargesOverride, 2)
  if (chargesPaise < 0n) throw new Error('Charges cannot be negative.')
  const netInvestmentPaise = amountPaise - chargesPaise
  if (netInvestmentPaise <= 0n) throw new Error('Charges must be less than the scheduled purchase amount.')
  const unitsTenThousandths = roundedDivision(netInvestmentPaise * 1000000n, navTenThousandths)
  if (unitsTenThousandths <= 0n) throw new Error('The net investment and NAV produce no units at four decimal places.')
  return {
    units: formatScaled(unitsTenThousandths, 4),
    amount: formatScaled(netInvestmentPaise, 2),
    totalAmount: formatScaled(amountPaise, 2),
    charges: formatScaled(chargesPaise, 2),
    cashflow: `-${formatScaled(amountPaise, 2)}`,
    chargesSource: chargesOverride === null ? 'AUTOMATIC' as const : 'MANUAL' as const,
    chargesBreakdown: chargesPaise
      ? { [chargesOverride === null ? 'stamp_duty' : 'statement_charges']: formatScaled(chargesPaise, 2) }
      : {},
  }
}

export function resolveSIPConfirmationNAV(
  history: { nav_date: string; nav: string }[],
  installmentDate: string,
  userOverride = '',
): string {
  if (userOverride.trim()) return userOverride.trim()
  return history.find(point => point.nav_date === installmentDate)?.nav ?? ''
}

export function calculateMFTransactionNumbers(
  type: WealthTransactionType,
  date: string,
  units: string,
  nav: string,
  statementCharges = '0.00',
  manualCharges = false,
  amountOverride = '',
) {
  const unitTypes: WealthTransactionType[] = ['PURCHASE', 'REDEMPTION', 'SWITCH_OUT', 'SWITCH_IN']
  const amount = unitTypes.includes(type)
    ? (() => { const value = Number(units) * Number(nav); return Number.isFinite(value) && value > 0 ? value.toFixed(2) : '' })()
    : ''
  const stampDutyEligible = ['PURCHASE', 'SWITCH_IN'].includes(type) && date >= '2020-07-01' && amount !== ''
  const stampDuty = stampDutyEligible ? (Number(amount) * 0.00005).toFixed(2) : '0.00'
  const charges = manualCharges ? statementCharges : stampDuty
  const source: WealthMFTransactionDetail['charges_source'] = manualCharges ? 'MANUAL' : 'AUTOMATIC'
  const chargesBreakdown: Record<string, string> = manualCharges
    ? { statement_charges: statementCharges }
    : (stampDutyEligible ? { stamp_duty: stampDuty } : {})
  const cashAmount = amount || amountOverride
  const cashflow = ['PURCHASE', 'SWITCH_IN'].includes(type) && cashAmount
    ? (-(Number(cashAmount) + Number(charges))).toFixed(2)
    : ['REDEMPTION', 'SWITCH_OUT', 'DIVIDEND'].includes(type) && cashAmount
      ? (Number(cashAmount) - Number(charges)).toFixed(2)
      : type === 'BONUS' ? '0.00' : ''
  return {
    amount,
    charges,
    cashflow,
    chargesSource: source,
    chargesBreakdown,
  }
}

export interface TransactionHistoryRow {
  key: string
  date: string
  schemeSearch: string
  schemeLabel: string
  schemePlanLabel: string
  schemeCodeLabel: string
  folioIds: string[]
  folioLabel: string
  type: string
  sourceLabel: string
  unitsLabel: string
  navLabel: string
  amountLabel: string
  chargesLabel: string
  cashflowLabel: string
  amountSort: number
  unitsSort: number
  records: WealthTransaction[]
  isSwitch: boolean
}

export function buildTransactionRows(transactions: WealthTransaction[], folios: WealthFolio[]): TransactionHistoryRow[] {
  const folioNames = new Map(folios.map((folio) => [folio.id, folio.folio_number]))
  const grouped = new Map<string, WealthTransaction[]>()
  for (const item of transactions) {
    const key = item.switch_group_id ? `switch:${item.switch_group_id}` : `transaction:${item.id}`
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }
  return [...grouped.entries()].map(([key, records]) => {
    const isSwitch = Boolean(records[0].switch_group_id)
    const out = isSwitch ? records.find((item) => item.transaction_type === 'SWITCH_OUT') ?? records[0] : records[0]
    const into = isSwitch ? records.find((item) => item.transaction_type === 'SWITCH_IN') : undefined
    const values = (field: keyof WealthMFTransactionDetail) => isSwitch && into
      ? [out.mf_detail[field], into.mf_detail[field]]
      : [out.mf_detail[field]]
    const folioValues = [...new Set(records.map((item) => item.folio ? folioNames.get(item.folio) ?? 'Folio' : 'Unassigned'))]
    return {
      key,
      date: out.transaction_date,
      schemeSearch: records.map((item) => `${item.scheme.scheme_name} ${item.scheme.scheme_code} ${item.scheme.plan_type} ${item.scheme.option_type}`).join(' '),
      schemeLabel: isSwitch && into ? `${out.scheme.scheme_name} → ${into.scheme.scheme_name}` : out.scheme.scheme_name,
      schemePlanLabel: isSwitch && into
        ? `${formatSchemePlanOption(out.scheme.plan_type, out.scheme.option_type)} → ${formatSchemePlanOption(into.scheme.plan_type, into.scheme.option_type)}`
        : formatSchemePlanOption(out.scheme.plan_type, out.scheme.option_type),
      schemeCodeLabel: isSwitch && into
        ? `${out.scheme.scheme_code} → ${into.scheme.scheme_code}`
        : out.scheme.scheme_code,
      folioIds: records.map((item) => item.folio ?? 'unassigned'),
      folioLabel: folioValues.join(' / '),
      type: isSwitch ? 'SWITCH' : out.transaction_type,
      sourceLabel: [...new Set(records.map((item) => item.source))].join(' / '),
      unitsLabel: isSwitch && into ? `Out ${values('units')[0]} · In ${values('units')[1]}` : out.mf_detail.units,
      navLabel: isSwitch && into ? `Out ${values('nav')[0]} · In ${values('nav')[1]}` : out.mf_detail.nav,
      amountLabel: isSwitch && into ? `Out ${values('amount')[0]} · In ${values('amount')[1]}` : out.mf_detail.amount,
      chargesLabel: isSwitch && into ? values('charges').join(' / ') : out.mf_detail.charges,
      cashflowLabel: isSwitch && into ? values('cashflow').join(' / ') : out.mf_detail.cashflow,
      amountSort: Number(out.mf_detail.amount),
      unitsSort: Number(out.mf_detail.units),
      records,
      isSwitch,
    }
  })
}

export function filterAndSortTransactionRows(
  rows: TransactionHistoryRow[], filters: TransactionFilters, sort: TransactionSort,
): TransactionHistoryRow[] {
  const query = filters.search.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (query && !row.schemeSearch.toLocaleLowerCase().includes(query)) return false
    if (filters.type && row.type !== filters.type) return false
    if (filters.folio && !row.folioIds.includes(filters.folio)) return false
    if (filters.from && row.date < filters.from) return false
    if (filters.to && row.date > filters.to) return false
    return true
  }).sort((a, b) => {
    const cmp = sort.field === 'scheme' ? a.schemeLabel.localeCompare(b.schemeLabel)
      : sort.field === 'amount' ? a.amountSort - b.amountSort
        : sort.field === 'units' ? a.unitsSort - b.unitsSort : a.date.localeCompare(b.date)
    return sort.direction === 'asc' ? cmp : -cmp
  })
}

export function paginateTransactionRows<T>(rows: T[], page: number, pageSize: number): { rows: T[]; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), pageCount }
}

export function formatWealthDecimal(value: string, places: 2 | 4): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  return number.toFixed(places)
}

export function validateWealthDecimal(value: string, places: 2 | 4, allowZero = true): string | null {
  const normalized = value.trim()
  if (!normalized) return 'This value is required.'
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return 'Enter a valid number.'
  const decimals = normalized.replace(/^-/, '').split('.')[1]?.length ?? 0
  if (decimals > places) return `Use no more than ${places} decimal places.`
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    return allowZero ? 'Enter a non-negative number.' : 'Enter a value greater than zero.'
  }
  return null
}

export function cashflowSignError(type: WealthTransactionType, cashflow: string): string | null {
  const amount = Number(cashflow)
  if (!Number.isFinite(amount)) return 'Enter a valid cashflow.'
  if (['PURCHASE', 'SWITCH_IN'].includes(type) && amount >= 0) return 'Cashflow must be negative for a purchase or switch-in.'
  if (['REDEMPTION', 'SWITCH_OUT', 'DIVIDEND'].includes(type) && amount <= 0) return 'Cashflow must be positive for a redemption, switch-out, or dividend.'
  if (type === 'BONUS' && amount !== 0) return 'Bonus transactions must have zero cashflow.'
  return null
}

export function validateAvailableRedemption(units: string, available: string): string | null {
  const requested = Number(units)
  const held = Number(available)
  if (!Number.isFinite(requested) || requested <= 0) return 'Enter redemption units greater than zero.'
  if (!Number.isFinite(held) || requested > held + 1e-8) return `Redemption exceeds available units (${formatWealthDecimal(available || '0', 4)}).`
  return null
}

export function buildSwitchRequest(source: WealthTransactionInput, destination: WealthTransactionInput): WealthSwitchRequest {
  return {
    switch_out: { ...source, transaction_type: 'SWITCH_OUT' },
    switch_in: { ...destination, transaction_type: 'SWITCH_IN' },
  }
}

export interface SwitchLegDraft {
  folio: string | null
  mf_detail: WealthMFTransactionDetail
}

export function updateSwitchLegDraft(
  draft: SwitchLegDraft,
  patch: { folio?: string | null; mf_detail?: Partial<WealthMFTransactionDetail> },
): SwitchLegDraft {
  return { ...draft, ...patch, mf_detail: patch.mf_detail ? { ...draft.mf_detail, ...patch.mf_detail } : draft.mf_detail }
}

export function buildSwitchRequestFromDrafts(
  switchOut: Omit<WealthTransactionInput, 'folio' | 'mf_detail'>,
  switchOutDraft: SwitchLegDraft,
  switchIn: Omit<WealthTransactionInput, 'folio' | 'mf_detail'>,
  switchInDraft: SwitchLegDraft,
): WealthSwitchRequest {
  return buildSwitchRequest(
    { ...switchOut, ...switchOutDraft },
    { ...switchIn, ...switchInDraft },
  )
}

/** Final form-to-API boundary used by SwitchEditor when saving either leg. */
export async function submitSwitchPairDrafts(
  switchOut: Omit<WealthTransactionInput, 'folio' | 'mf_detail'>,
  switchOutDraft: SwitchLegDraft,
  switchIn: Omit<WealthTransactionInput, 'folio' | 'mf_detail'>,
  switchInDraft: SwitchLegDraft,
  folios: Pick<WealthFolio, 'id' | 'folio_number'>[],
  onSave: (request: WealthSwitchRequest) => Promise<void>,
): Promise<void> {
  const normalizeFolio = (value: string | null, leg: 'Switch out' | 'Switch in') => {
    if (value === null) return null
    const match = folios.find(folio => folio.id === value || folio.folio_number === value)
    if (!match) throw new Error(`${leg} folio is not in your folio list. Select it again before saving.`)
    return match.id
  }

  const request = buildSwitchRequestFromDrafts(
    switchOut,
    { ...switchOutDraft, folio: normalizeFolio(switchOutDraft.folio, 'Switch out') },
    switchIn,
    { ...switchInDraft, folio: normalizeFolio(switchInDraft.folio, 'Switch in') },
  )
  await onSave(request)
}

export function resolveWealthFolioId(value: string | null, folios: Pick<WealthFolio, 'id' | 'folio_number'>[]): string | null {
  if (!value) return null
  return folios.find(folio => folio.id === value || folio.folio_number === value)?.id ?? value
}

export function formatWealthApiError(error: unknown, fallback = 'The request could not be completed. Please try again.'): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data
  if (typeof data === 'string' && data.trim()) return data.trim()
  if (!data || typeof data !== 'object') return fallback
  const messages: string[] = []
  const collect = (value: unknown, prefix = '') => {
    if (Array.isArray(value)) { value.forEach((item) => collect(item, prefix)); return }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) collect(nested, key === 'detail' || key === 'non_field_errors' ? prefix : (prefix ? `${prefix}.${key}` : key))
      return
    }
    if (value !== undefined && value !== null) messages.push(`${prefix ? `${prefix}: ` : ''}${String(value)}`)
  }
  collect(data)
  return messages.join(' ') || fallback
}

export function formatWealthSIPApiError(error: unknown, fallback = 'The SIP request could not be completed. Please try again.'): string {
  const response = (error as { response?: { data?: unknown; headers?: Record<string, unknown> } })?.response
  const contentType = String(response?.headers?.['content-type'] ?? '').toLowerCase()
  const data = response?.data
  if (contentType.includes('text/html') || (typeof data === 'string' && /^\uFEFF?\s*(?:<!doctype\s+html\b|<html\b)/i.test(data))) {
    return fallback
  }
  return formatWealthApiError(error, fallback)
}

export async function executeConfirmedWealthDelete(
  confirmed: boolean,
  inProgress: boolean,
  deleteRequest: () => Promise<void>,
): Promise<boolean> {
  if (!confirmed || inProgress) return false
  await deleteRequest()
  return true
}
