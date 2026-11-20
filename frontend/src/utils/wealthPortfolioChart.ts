import type { WealthTransaction } from '../api/wealthTransactions'

export interface WealthNAVChartRow {
  x: number
  nav_date: string
  nav: string | null
}

export interface WealthTransactionMarker {
  x: number
  y: number
  transaction: WealthTransaction
  firstInvestment: boolean
  offset: number
}

export type WealthNAVTooltipData =
  | { kind: 'transaction'; date: string; transactionType: string; nav: string; units: string; amount: string; firstInvestment: boolean }
  | { kind: 'published-nav'; date: string; nav: string }

export function getWealthNAVTooltipData(
  entry: { payload?: WealthNAVChartRow | WealthTransactionMarker } | null | undefined,
): WealthNAVTooltipData | null {
  const point = entry?.payload
  if (!point) return null
  if ('transaction' in point) {
    const transaction = point.transaction
    return {
      kind: 'transaction',
      date: transaction.transaction_date,
      transactionType: transaction.transaction_type,
      nav: transaction.mf_detail.nav,
      units: transaction.mf_detail.units,
      amount: transaction.mf_detail.amount,
      firstInvestment: point.firstInvestment,
    }
  }
  return point.nav === null ? null : { kind: 'published-nav', date: point.nav_date, nav: point.nav }
}

export function positionWealthChartTooltip(
  pointerX: number,
  pointerY: number,
  chartWidth: number,
  chartHeight: number,
  tooltipHeight = 116,
): { left: number; top: number; width: number } {
  const width = Math.min(280, Math.max(0, chartWidth - 16))
  const maxLeft = Math.max(8, chartWidth - width - 8)
  const maxTop = Math.max(8, chartHeight - tooltipHeight - 8)
  const preferredLeft = pointerX + 14 + width <= chartWidth - 8 ? pointerX + 14 : pointerX - width - 14
  const preferredTop = pointerY + 14 + tooltipHeight <= chartHeight - 8 ? pointerY + 14 : pointerY - tooltipHeight - 14
  return {
    left: Math.min(maxLeft, Math.max(8, preferredLeft)),
    top: Math.min(maxTop, Math.max(8, preferredTop)),
    width,
  }
}

function dateTimestamp(value: string): number {
  return Date.parse(`${value}T00:00:00Z`)
}

export function transactionMarkerColor(marker: Pick<WealthTransactionMarker, 'firstInvestment' | 'transaction'>): string {
  if (marker.firstInvestment) return '#d5af50'
  if (marker.transaction.transaction_type === 'REDEMPTION') return '#4c6fff'
  if (marker.transaction.transaction_type === 'SWITCH_IN' || marker.transaction.transaction_type === 'SWITCH_OUT') return '#8567c5'
  if (marker.transaction.transaction_type === 'PURCHASE') return '#c24545'
  return '#829087'
}

export function buildWealthNAVChartData(
  history: { nav_date: string; nav: string }[],
  transactions: WealthTransaction[],
): { lineData: WealthNAVChartRow[]; markers: WealthTransactionMarker[] } {
  const byDate = new Map<string, WealthNAVChartRow>(history.map(item => [item.nav_date, { x: dateTimestamp(item.nav_date), nav_date: item.nav_date, nav: item.nav }]))
  const ordered = [...transactions].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date)
    || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const first = ordered.find(item => ['PURCHASE', 'SWITCH_IN'].includes(item.transaction_type))
  for (const item of ordered) {
    if (!byDate.has(item.transaction_date)) byDate.set(item.transaction_date, { x: dateTimestamp(item.transaction_date), nav_date: item.transaction_date, nav: null })
  }

  const sameDayIndex = new Map<string, number>()
  const sameDayCount = new Map<string, number>()
  for (const item of ordered) sameDayCount.set(item.transaction_date, (sameDayCount.get(item.transaction_date) ?? 0) + 1)
  const markers = ordered.map(transaction => {
    const index = sameDayIndex.get(transaction.transaction_date) ?? 0
    sameDayIndex.set(transaction.transaction_date, index + 1)
    const count = sameDayCount.get(transaction.transaction_date) ?? 1
    return {
      x: dateTimestamp(transaction.transaction_date),
      y: Number(transaction.mf_detail.nav),
      transaction,
      firstInvestment: transaction.id === first?.id,
      offset: (index - (count - 1) / 2) * 8,
    }
  })
  return {
    lineData: [...byDate.values()].sort((a, b) => a.nav_date.localeCompare(b.nav_date)),
    markers,
  }
}
