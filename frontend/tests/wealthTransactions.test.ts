import assert from 'node:assert/strict'
import test from 'node:test'
import type { MutualFundScheme } from '../src/api/schemeCatalogue.ts'
import type { WealthFolio, WealthSwitchRequest, WealthTransaction, WealthTransactionInput } from '../src/api/wealthTransactions.ts'
import {
  buildSwitchRequest,
  executeConfirmedWealthDelete,
  buildTransactionRows,
  calculateMFTransactionNumbers,
  calculateSIPConfirmation,
  calculateSIPCharges,
  cashflowSignError,
  filterAndSortTransactionRows,
  formatWealthApiError,
  formatWealthSIPApiError,
  formatWealthDecimal,
  paginateTransactionRows,
  resolveWealthFolioId,
  requiresFolioSelectionForRedemption,
  updateSwitchLegDraft,
  validateAvailableRedemption,
  validateWealthDecimal,
  resolveSIPConfirmationNAV,
  submitSwitchPairDrafts,
} from '../src/utils/wealthTransactions.ts'
import { getSchemePickerDisplay } from '../src/utils/schemePickerDisplay.ts'

const schemeVariant = (overrides: Partial<MutualFundScheme> = {}): MutualFundScheme => ({
  scheme_code: '12345', scheme_name: 'ICICI Prudential Example Fund', fund_house: 'ICICI Prudential',
  category_name: 'Equity', asset_class: 'EQUITY', plan_type: 'DIRECT', option_type: 'GROWTH',
  isin_growth: null, isin_div_payout: null, isin_div_reinvestment: null, ...overrides,
})

test('scheme picker emphasizes the name and distinguishes same-name plan and option variants', () => {
  const directGrowth = getSchemePickerDisplay(schemeVariant())
  const regularIdcw = getSchemePickerDisplay(schemeVariant({
    scheme_code: '12346', plan_type: 'REGULAR', option_type: 'IDCW',
  }))

  assert.equal(directGrowth.schemeName, 'ICICI Prudential Example Fund')
  assert.equal(directGrowth.planOption, 'Direct · Growth')
  assert.equal(directGrowth.schemeCode, '12345')
  assert.equal(regularIdcw.schemeName, directGrowth.schemeName)
  assert.equal(regularIdcw.planOption, 'Regular · IDCW')
  assert.equal(regularIdcw.schemeCode, '12346')
})

test('scheme picker handles missing variant fields and retains the original selection code', () => {
  const selected = schemeVariant({ plan_type: 'UNKNOWN', option_type: '', scheme_code: '99881' })
  const display = getSchemePickerDisplay(selected)

  assert.equal(display.planOption, 'Plan/option unavailable')
  assert.equal(display.schemeCode, selected.scheme_code)
})

test('transaction math derives unit value, stamp duty and cashflow while leaving exit load as manual', () => {
  assert.deepEqual(calculateMFTransactionNumbers('PURCHASE', '2026-11-18', '10', '100'), {
    amount: '1000.00', charges: '0.05', cashflow: '-1000.05', chargesSource: 'AUTOMATIC', chargesBreakdown: { stamp_duty: '0.05' },
  })
  assert.deepEqual(calculateMFTransactionNumbers('REDEMPTION', '2026-11-18', '4', '100', '12.50', true), {
    amount: '400.00', charges: '12.50', cashflow: '387.50', chargesSource: 'MANUAL', chargesBreakdown: { statement_charges: '12.50' },
  })
  assert.equal(calculateMFTransactionNumbers('SWITCH_IN', '2019-06-01', '2', '12', '0', false).charges, '0.00')
})

test('transaction amount and cashflow use decimal-safe half-up currency rounding', () => {
  const purchase = calculateMFTransactionNumbers('PURCHASE', '2026-01-01', '1.0000', '1.0050', '0.00', true)
  assert.equal(purchase.amount, '1.01')
  assert.equal(purchase.cashflow, '-1.01')

  const chargedPurchase = calculateMFTransactionNumbers('PURCHASE', '2026-01-01', '1.0000', '1.0050', '0.01', true)
  assert.equal(chargedPurchase.amount, '1.01')
  assert.equal(chargedPurchase.cashflow, '-1.02')
})

test('SIP confirmation derives units from scheduled amount and NAV, with editable charges', () => {
  const history = [
    { nav_date: '2026-11-15', nav: '29.9900' },
    { nav_date: '2026-11-16', nav: '30.0100' },
  ]
  assert.equal(resolveSIPConfirmationNAV(history, '2026-11-16'), '30.0100')
  assert.equal(resolveSIPConfirmationNAV(history, '2026-11-16', '30.1234'), '30.1234')
  assert.equal(resolveSIPConfirmationNAV(history, '2026-11-17'), '')
  assert.equal(calculateSIPCharges('1000.00', '2026-11-16'), '0.05')
  assert.deepEqual(calculateSIPConfirmation('1000.00', '30.0100', '2026-11-16'), {
    units: '33.3206', amount: '999.95', totalAmount: '1000.00', charges: '0.05', cashflow: '-1000.00',
    chargesSource: 'AUTOMATIC', chargesBreakdown: { stamp_duty: '0.05' },
  })
  assert.equal(calculateSIPConfirmation('1000.00', '31.2500', '2026-11-16').units, '31.9984')
  assert.deepEqual(calculateSIPConfirmation('1000.00', '30.0100', '2026-11-16', '0.12'), {
    units: '33.3182', amount: '999.88', totalAmount: '1000.00', charges: '0.12', cashflow: '-1000.00',
    chargesSource: 'MANUAL', chargesBreakdown: { statement_charges: '0.12' },
  })
  const acceptance = calculateSIPConfirmation('30000.00', '2169.5000', '2026-11-16', '1.50')
  assert.equal(acceptance.amount, '29998.50')
  assert.equal(acceptance.units, '13.8274')
  assert.equal(acceptance.cashflow, '-30000.00')
  assert.throws(() => calculateSIPConfirmation('1000.00', '0.0000', '2026-11-16'), /greater than zero/)
  assert.throws(() => calculateSIPConfirmation('1000.00', '30.0100', '2026-11-16', '1000.01'), /Charges must be less/)
  assert.throws(() => calculateSIPConfirmation('1000.00', '30.0100', '2026-11-16', '-0.01'))
})

function transaction(overrides: Partial<WealthTransaction> = {}): WealthTransaction {
  const schemeName = overrides.scheme?.scheme_name ?? 'Alpha Equity Fund'
  const schemeCode = overrides.scheme?.scheme_code ?? '100001'
  return {
    id: 'transaction-1', transaction_type: 'PURCHASE', transaction_date: '2026-09-14', source: 'MANUAL',
    source_reference: '', scheme_code: schemeCode,
    scheme: { scheme_code: schemeCode, scheme_name: schemeName, fund_house: 'Alpha AMC', category_name: 'Equity', asset_class: 'EQUITY', plan_type: 'DIRECT', option_type: 'GROWTH', isin_growth: null, isin_div_payout: null, isin_div_reinvestment: null },
    instrument: { id: 'instrument-1', instrument_type: 'MUTUAL_FUND', scheme_code: schemeCode, scheme_name: schemeName, fund_house: 'Alpha AMC' },
    folio: null, switch_group_id: null,
    mf_detail: { units: '10.0000', nav: '100.0000', amount: '1000.00', charges: '2.00', cashflow: '-1002.00' },
    notes: '', created_at: '2026-09-14T10:00:00Z', updated_at: '2026-09-14T10:00:00Z',
    ...overrides,
  }
}

test('cashflow sign validation follows transaction type', () => {
  assert.equal(cashflowSignError('PURCHASE', '-101.25'), null)
  assert.match(cashflowSignError('PURCHASE', '101.25') ?? '', /negative/)
  assert.equal(cashflowSignError('SWITCH_IN', '-1.00'), null)
  assert.equal(cashflowSignError('REDEMPTION', '1.00'), null)
  assert.match(cashflowSignError('SWITCH_OUT', '-1.00') ?? '', /positive/)
  assert.equal(cashflowSignError('DIVIDEND', '0.01'), null)
  assert.equal(cashflowSignError('BONUS', '0.00'), null)
  assert.match(cashflowSignError('BONUS', '0.01') ?? '', /zero/)
  assert.equal(cashflowSignError('OTHER', '-4.50'), null)
})

test('decimal validation and formatting honor units/NAV and currency precision', () => {
  assert.equal(validateWealthDecimal('10.1234', 4), null)
  assert.match(validateWealthDecimal('10.12345', 4) ?? '', /4 decimal/)
  assert.match(validateWealthDecimal('100.001', 2) ?? '', /2 decimal/)
  assert.match(validateWealthDecimal('-1.00', 2) ?? '', /non-negative/)
  assert.equal(validateWealthDecimal('0', 4, false), 'Enter a value greater than zero.')
  assert.equal(formatWealthDecimal('10.2', 4), '10.2000')
  assert.equal(formatWealthDecimal('100.3', 2), '100.30')
})

test('history groups paired switches and filters by either scheme, folio, type, and date range', () => {
  const source = transaction({ id: 'out', transaction_type: 'SWITCH_OUT', switch_group_id: 'switch-1', folio: 'folio-1', scheme: { ...transaction().scheme, scheme_name: 'Alpha Equity Fund' } })
  const destination = transaction({ id: 'in', transaction_type: 'SWITCH_IN', switch_group_id: 'switch-1', transaction_date: '2026-09-14', scheme: { ...transaction().scheme, scheme_code: '200002', scheme_name: 'Beta Debt Fund' }, mf_detail: { units: '9.5000', nav: '105.0000', amount: '997.50', charges: '0.00', cashflow: '-997.50' } })
  const normal = transaction({ id: 'normal', transaction_date: '2026-10-01', folio: null })
  const folios: WealthFolio[] = [{ id: 'folio-1', folio_number: 'F-1', name: '', fund_house: null, fund_house_name: null, created_at: '', updated_at: '' }]
  const rows = buildTransactionRows([destination, normal, source], folios)
  assert.equal(rows.length, 2)
  const defaults = { search: '', type: '', folio: '', from: '', to: '' }
  assert.equal(filterAndSortTransactionRows(rows, { ...defaults, search: 'Beta Debt' }, { field: 'date', direction: 'desc' })[0].type, 'SWITCH')
  assert.equal(filterAndSortTransactionRows(rows, { ...defaults, type: 'SWITCH' }, { field: 'date', direction: 'desc' }).length, 1)
  assert.equal(filterAndSortTransactionRows(rows, { ...defaults, folio: 'folio-1' }, { field: 'date', direction: 'desc' }).length, 1)
  assert.equal(filterAndSortTransactionRows(rows, { ...defaults, from: '2026-09-20' }, { field: 'date', direction: 'desc' }).length, 1)
  const switchRow = rows.find((row) => row.isSwitch)
  assert.match(switchRow?.schemeLabel ?? '', /Alpha Equity Fund → Beta Debt Fund/)
  assert.equal(switchRow?.schemePlanLabel, 'Direct · Growth → Direct · Growth')
  assert.equal(switchRow?.schemeCodeLabel, '100001 → 200002')
})

test('saved transaction history displays variant metadata and searches by it', () => {
  const direct = transaction()
  const regular = transaction({
    id: 'regular',
    scheme: { ...transaction().scheme, plan_type: 'REGULAR', option_type: 'IDCW' },
  })
  const rows = buildTransactionRows([direct, regular], [])
  assert.equal(rows[0].schemeLabel, rows[1].schemeLabel)
  assert.equal(rows[0].schemePlanLabel, 'Direct · Growth')
  assert.equal(rows[1].schemePlanLabel, 'Regular · IDCW')
  assert.equal(filterAndSortTransactionRows(rows, { search: 'IDCW', type: '', folio: '', from: '', to: '' }, { field: 'date', direction: 'desc' }).length, 1)
})

test('history sorting and client-side pagination are stable and bounded', () => {
  const rows = buildTransactionRows([
    transaction({ id: '1', transaction_date: '2026-09-01', mf_detail: { ...transaction().mf_detail, amount: '300.00' } }),
    transaction({ id: '2', transaction_date: '2026-10-01', scheme: { ...transaction().scheme, scheme_name: 'Zeta Fund' }, mf_detail: { ...transaction().mf_detail, amount: '100.00' } }),
    transaction({ id: '3', transaction_date: '2026-11-01', scheme: { ...transaction().scheme, scheme_name: 'Beta Fund' }, mf_detail: { ...transaction().mf_detail, amount: '200.00' } }),
  ], [])
  const filters = { search: '', type: '', folio: '', from: '', to: '' }
  assert.deepEqual(filterAndSortTransactionRows(rows, filters, { field: 'amount', direction: 'asc' }).map((row) => row.amountSort), [100, 200, 300])
  assert.deepEqual(filterAndSortTransactionRows(rows, filters, { field: 'date', direction: 'desc' }).map((row) => row.date), ['2026-11-01', '2026-10-01', '2026-09-01'])
  assert.deepEqual(paginateTransactionRows(rows, 2, 2), { rows: [rows[2]], pageCount: 2 })
  assert.deepEqual(paginateTransactionRows([], 9, 2), { rows: [], pageCount: 1 })
})

test('API errors are converted into readable field and detail messages', () => {
  assert.equal(formatWealthApiError({ response: { data: { mf_detail: { cashflow: ['Must be positive.'] }, detail: 'Rejected.' } } }), 'mf_detail.cashflow: Must be positive. Rejected.')
  assert.equal(formatWealthApiError({ response: { data: { detail: 'Not found.' } } }), 'Not found.')
  assert.equal(formatWealthApiError({ response: { status: 400, data: { switch_out: { folio: ['“46549589” is not a valid UUID.'] } } } }), 'switch_out.folio: “46549589” is not a valid UUID.')
  assert.equal(formatWealthApiError({ response: { status: 400, data: { switch_out: { folio: ['Invalid pk "46549589" - object does not exist.'] }, switch_in: { folio: ['Choose a valid folio.'] } } } }), 'switch_out.folio: Invalid pk "46549589" - object does not exist. switch_in.folio: Choose a valid folio.')
  assert.equal(formatWealthApiError({ response: { status: 400, data: 'Bad request details' } }), 'Bad request details')
  assert.equal(formatWealthApiError(new Error('network')), 'The request could not be completed. Please try again.')
  assert.equal(formatWealthSIPApiError({ response: { headers: { 'content-type': 'text/html' }, data: '<html><body>Debug</body></html>' } }), 'The SIP request could not be completed. Please try again.')
  assert.equal(formatWealthSIPApiError({ response: { data: '<!DOCTYPE html><html><body>Debug</body></html>' } }), 'The SIP request could not be completed. Please try again.')
  assert.equal(formatWealthSIPApiError({ response: { data: { status: ['Choose a valid status.'] } } }), 'status: Choose a valid status.')
})

test('wealth deletion requires confirmation and does not submit blocked or repeated calls', async () => {
  let deleteCount = 0
  const deleteRequest = async () => { deleteCount += 1 }

  assert.equal(await executeConfirmedWealthDelete(false, false, deleteRequest), false)
  assert.equal(deleteCount, 0)
  assert.equal(await executeConfirmedWealthDelete(true, true, deleteRequest), false)
  assert.equal(deleteCount, 0)
  assert.equal(await executeConfirmedWealthDelete(true, false, deleteRequest), true)
  assert.equal(deleteCount, 1)

  await assert.rejects(executeConfirmedWealthDelete(true, false, async () => { throw new Error('blocked') }), /blocked/)
  assert.equal(deleteCount, 1)
})

test('switch request builder sends both typed legs in a single paired payload', () => {
  const source: WealthTransactionInput = { transaction_type: 'PURCHASE', transaction_date: '2026-10-01', scheme_code: '100001', mf_detail: { units: '4.0000', nav: '10.0000', amount: '40.00', charges: '0.00', cashflow: '40.00' } }
  const destination: WealthTransactionInput = { ...source, scheme_code: '200002', mf_detail: { ...source.mf_detail, cashflow: '-40.00' } }
  const request = buildSwitchRequest(source, destination)
  assert.equal(request.switch_out.transaction_type, 'SWITCH_OUT')
  assert.equal(request.switch_in.transaction_type, 'SWITCH_IN')
  assert.equal(request.switch_out.scheme_code, '100001')
  assert.equal(request.switch_in.scheme_code, '200002')
  assert.equal(request.switch_out.transaction_date, request.switch_in.transaction_date)
})

test('switch edit submission keeps both original folio UUIDs through every detail edit', async () => {
  const folio = { id: '46549589-3a42-4cd3-9b0d-47eea0f22c88', folio_number: '46549589' }
  const outDraft = { folio: resolveWealthFolioId(folio.id, [folio]), mf_detail: { units: '100.0000', nav: '10.0000', amount: '1000.00', charges: '0.00', cashflow: '1000.00' } }
  const inDraft = { folio: resolveWealthFolioId(folio.id, [folio]), mf_detail: { units: '100.0000', nav: '10.0000', amount: '1000.00', charges: '0.00', cashflow: '-1000.00' } }
  const source: Omit<WealthTransactionInput, 'folio' | 'mf_detail'> = { transaction_type: 'SWITCH_OUT', transaction_date: '2026-10-30', scheme_code: '100001' }
  const destination: Omit<WealthTransactionInput, 'folio' | 'mf_detail'> = { transaction_type: 'SWITCH_IN', transaction_date: '2026-10-30', scheme_code: '200002' }
  const edits = [
    ['units', '100'], ['nav', '10'], ['amount', '1000'], ['charges', '1'], ['cashflow', '-999'],
  ] as const

  for (const [field, value] of edits) {
    const sourceDraft = updateSwitchLegDraft(outDraft, { mf_detail: { [field]: value } })
    const destinationDraft = updateSwitchLegDraft(inDraft, { mf_detail: { [field]: value } })
    let request: WealthSwitchRequest | undefined
    await submitSwitchPairDrafts(source, sourceDraft, destination, destinationDraft, [folio], async payload => { request = payload })
    assert.ok(request, `${field} edit did not invoke the paired save handler`)
    assert.equal(request.switch_out.folio, folio.id, `${field} edit changed switch_out folio`)
    assert.equal(request.switch_in.folio, folio.id, `${field} edit changed switch_in folio`)
    assert.notEqual(request.switch_out.folio, folio.folio_number)
    assert.notEqual(request.switch_in.folio, folio.folio_number)
    assert.equal(request.switch_out.scheme_code, '100001')
    assert.equal(request.switch_in.scheme_code, '200002')
    assert.equal(request.switch_out.mf_detail[field], value)
    assert.equal(request.switch_in.mf_detail[field], value)
  }
  // Also protect the PATCH boundary if a legacy/display-number value re-enters form state.
  let canonicalized: WealthSwitchRequest | undefined
  await submitSwitchPairDrafts(source, { ...outDraft, folio: folio.folio_number }, destination, { ...inDraft, folio: folio.folio_number }, [folio], async payload => { canonicalized = payload })
  assert.equal(canonicalized?.switch_out.folio, folio.id)
  assert.equal(canonicalized?.switch_in.folio, folio.id)
  assert.equal(resolveWealthFolioId(null, [folio]), null)
  assert.equal(resolveWealthFolioId('unmatched-reference', [folio]), 'unmatched-reference')
})

test('redemption unit validation blocks nonpositive and excess requests', () => {
  assert.equal(validateAvailableRedemption('5.0000', '5.0000'), null)
  assert.match(validateAvailableRedemption('5.0001', '5.0000') ?? '', /exceeds available/)
  assert.match(validateAvailableRedemption('0', '5.0000') ?? '', /greater than zero/)
  assert.match(validateAvailableRedemption('1.0000', '-2.0000') ?? '', /exceeds available/)
})

test('redemption from an aggregated scheme requires a source folio when units are assigned', () => {
  const holdings = [
    { scheme_code: '100001', folio_id: 'folio-a', units: '3.0000' },
    { scheme_code: '100001', folio_id: 'folio-b', units: '2.0000' },
  ]
  assert.equal(requiresFolioSelectionForRedemption('100001', null, holdings), true)
  assert.equal(requiresFolioSelectionForRedemption('100001', 'folio-a', holdings), false)
  assert.equal(requiresFolioSelectionForRedemption('100002', null, holdings), false)
  assert.equal(requiresFolioSelectionForRedemption('100001', null, [
    ...holdings,
    { scheme_code: '100001', folio_id: null, units: '1.0000' },
  ]), false)
})
