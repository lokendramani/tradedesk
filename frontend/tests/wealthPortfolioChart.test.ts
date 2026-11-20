import assert from 'node:assert/strict'
import test from 'node:test'
import type { WealthTransaction } from '../src/api/wealthTransactions.ts'
import { buildWealthNAVChartData, getWealthNAVTooltipData, positionWealthChartTooltip, transactionMarkerColor } from '../src/utils/wealthPortfolioChart.ts'

function transaction(id: string, date: string, type: WealthTransaction['transaction_type'], nav: string): WealthTransaction {
  return {
    id, transaction_type: type, transaction_date: date, source: 'MANUAL', source_reference: '',
    scheme: {
      scheme_code: '141226', scheme_name: 'Test Fund', fund_house: 'Test AMC', category_name: '',
      asset_class: 'EQUITY', plan_type: 'DIRECT', option_type: 'GROWTH', isin_growth: null,
      isin_div_payout: null, isin_div_reinvestment: null,
    },
    instrument: { id: 'instrument-1', instrument_type: 'MUTUAL_FUND', scheme_code: '141226', scheme_name: 'Test Fund', fund_house: 'Test AMC' },
    folio: null, switch_group_id: null,
    mf_detail: { units: '2.0000', nav, amount: '200.00', charges: '0.00', cashflow: '-200.00' },
    notes: '', created_at: `${date}T10:00:00Z`, updated_at: `${date}T10:00:00Z`,
  }
}

test('transaction markers use recorded NAV and preserve same-day events separately', () => {
  const result = buildWealthNAVChartData(
    [{ nav_date: '2026-01-01', nav: '100.0000' }],
    [
      transaction('first', '2026-01-01', 'PURCHASE', '101.2500'),
      transaction('same-day', '2026-01-01', 'REDEMPTION', '102.5000'),
      transaction('later', '2026-01-03', 'PURCHASE', '103.7500'),
    ],
  )

  assert.equal(result.lineData.find(point => point.nav_date === '2026-01-01')?.nav, '100.0000')
  assert.equal(result.lineData.find(point => point.nav_date === '2026-01-03')?.nav, null)
  assert.deepEqual(result.markers.map(marker => marker.y), [101.25, 102.5, 103.75])
  assert.deepEqual(result.markers.map(marker => marker.firstInvestment), [true, false, false])
  assert.equal(new Set(result.markers.slice(0, 2).map(marker => marker.offset)).size, 2)
  assert.equal(result.markers.length, 3)
  assert.deepEqual(result.markers.map(marker => transactionMarkerColor(marker)), ['#d5af50', '#4c6fff', '#c24545'])
})

test('chart marker colors distinguish switch events from later purchases', () => {
  const result = buildWealthNAVChartData([], [
    transaction('first', '2026-01-01', 'PURCHASE', '10.0000'),
    transaction('switch', '2026-01-02', 'SWITCH_IN', '11.0000'),
    transaction('sell', '2026-01-03', 'REDEMPTION', '12.0000'),
    transaction('switch-out', '2026-01-04', 'SWITCH_OUT', '13.0000'),
  ])
  assert.deepEqual(result.markers.map(marker => transactionMarkerColor(marker)), ['#d5af50', '#8567c5', '#4c6fff', '#8567c5'])
})

test('October 2026 transaction uses the date scale near the end of multi-year NAV history', () => {
  const result = buildWealthNAVChartData([
    { nav_date: '2017-07-01', nav: '10.0000' },
    { nav_date: '2026-11-18', nav: '150.0000' },
  ], [transaction('first-october', '2026-10-30', 'PURCHASE', '149.2500')])
  const marker = result.markers[0]
  const firstX = result.lineData[0].x
  const lastX = result.lineData[result.lineData.length - 1].x
  assert.equal(marker.x, Date.parse('2026-10-30T00:00:00Z'))
  assert.ok((marker.x - firstX) / (lastX - firstX) > 0.98)
  assert.equal(result.lineData.find(row => row.nav_date === '2017-07-01')?.nav, '10.0000')
  assert.equal(result.lineData.find(row => row.nav_date === '2026-11-18')?.nav, '150.0000')
})

test('NAV point tooltip and transaction marker tooltip remain separate events', () => {
  const result = buildWealthNAVChartData(
    [{ nav_date: '2017-07-01', nav: '10.0000' }, { nav_date: '2026-11-18', nav: '150.0000' }],
    [transaction('investment', '2026-10-30', 'PURCHASE', '149.2500')],
  )
  assert.deepEqual(getWealthNAVTooltipData({ payload: result.lineData[0] }), {
    kind: 'published-nav', date: '2017-07-01', nav: '10.0000',
  })
  assert.deepEqual(getWealthNAVTooltipData({ payload: result.markers[0] }), {
    kind: 'transaction', date: '2026-10-30', transactionType: 'PURCHASE', nav: '149.2500', units: '2.0000', amount: '200.00', firstInvestment: true,
  })
  assert.notEqual(result.markers[0].transaction.mf_detail.nav, result.lineData.find(row => row.nav_date === '2026-11-18')?.nav)
  assert.equal(getWealthNAVTooltipData({ payload: result.lineData.find(row => row.nav === null)! }), null)
})

test('first investment tooltip is labeled distinctly from later purchases', () => {
  const result = buildWealthNAVChartData([], [
    transaction('first-buy', '2026-10-30', 'PURCHASE', '149.2500'),
    transaction('later-buy', '2026-11-02', 'PURCHASE', '150.0000'),
  ])
  const first = getWealthNAVTooltipData({ payload: result.markers[0] })
  const later = getWealthNAVTooltipData({ payload: result.markers[1] })
  assert.equal(first?.kind === 'transaction' && first.firstInvestment, true)
  assert.equal(later?.kind === 'transaction' && later.firstInvestment, false)
})

test('hover tooltip position flips and clamps near chart edges', () => {
  const nearTopLeft = positionWealthChartTooltip(4, 4, 800, 280)
  assert.deepEqual(nearTopLeft, { left: 18, top: 18, width: 280 })
  const nearBottomRight = positionWealthChartTooltip(795, 275, 800, 280)
  assert.ok(nearBottomRight.left >= 8)
  assert.ok(nearBottomRight.left + nearBottomRight.width <= 792)
  assert.ok(nearBottomRight.top >= 8)
  assert.ok(nearBottomRight.top + 116 <= 272)
})
