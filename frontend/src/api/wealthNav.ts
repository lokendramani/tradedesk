import client from './client'

export interface WealthHolding {
  instrument_id: string
  scheme_code: string
  scheme_name: string
  plan_type?: string | null
  option_type?: string | null
  folio_id: string | null
  folio_number: string | null
  units: string
  position_warning: 'NEGATIVE_NET_UNITS' | null
  latest_nav: string | null
  nav_date: string | null
  market_value: string | null
  average_cost_nav?: string | null
  invested_cost?: string | null
  unrealised_pl?: string | null
  unrealised_return_pct?: string | null
  realized_pl?: string | null
  dividend_income?: string | null
  cost_basis_warning?: string | null
}

export interface WealthHoldingsResponse {
  group_by: 'aggregate' | 'folio'
  holdings: WealthHolding[]
}

export interface WealthNAVHistoryResponse {
  scheme_code: string
  scheme_name: string
  results: { nav_date: string; nav: string }[]
}

export interface WealthNAVUpdateRun {
  run_id: string
  trigger_type: string
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'
  started_at: string
  run_age_seconds: number
  completed_at: string | null
  held_schemes: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  error_summary: string
}

export interface WealthNAVUpdateSummary {
  stale_after_seconds: number
  last_successful_update: string | null
  latest_run: WealthNAVUpdateRun | null
}

export const wealthNavApi = {
  async holdings(groupBy: 'aggregate' | 'folio'): Promise<WealthHoldingsResponse> {
    const response = await client.get('/wealth/holdings/', { params: { group_by: groupBy } })
    return response.data
  },
  async history(schemeCode: string, navDate?: string): Promise<WealthNAVHistoryResponse> {
    const params = navDate ? { from: navDate, to: navDate } : undefined
    const response = await client.get(`/wealth/schemes/${encodeURIComponent(schemeCode)}/nav-history/`, { params })
    return response.data
  },
  async navUpdateSummary(): Promise<WealthNAVUpdateSummary> {
    const response = await client.get('/wealth/nav-updates/')
    return response.data
  },
  async updateNAVNow(): Promise<WealthNAVUpdateRun> {
    const response = await client.post('/wealth/nav-updates/')
    return response.data
  },
}
