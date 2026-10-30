import client from './client'

export interface MutualFundScheme {
  scheme_code: string
  scheme_name: string
  fund_house: string
  category_name: string
  asset_class: string
  plan_type: string
  option_type: string
  isin_growth: string | null
  isin_div_payout: string | null
  isin_div_reinvestment: string | null
}

export interface SchemeCataloguePage {
  count: number
  next: string | null
  previous: string | null
  results: MutualFundScheme[]
}

export interface SchemeCatalogueFilters {
  fund_houses: string[]
  categories: string[]
  asset_classes: { value: string; label: string }[]
  plan_types: { value: string; label: string }[]
  option_types: { value: string; label: string }[]
}

export interface SchemeCatalogueRefreshResult {
  status: string
  inserted: number
  updated: number
  unchanged: number
  rejected: number
}

export const schemeCatalogueApi = {
  async list(params: Record<string, string | number>): Promise<SchemeCataloguePage> {
    const response = await client.get('/wealth/schemes/', { params })
    return response.data
  },
  async filters(): Promise<SchemeCatalogueFilters> {
    const response = await client.get('/wealth/schemes/filters/')
    return response.data
  },
  async detail(schemeCode: string): Promise<MutualFundScheme> {
    const response = await client.get(`/wealth/schemes/${encodeURIComponent(schemeCode)}/`)
    return response.data
  },
  async refresh(): Promise<SchemeCatalogueRefreshResult> {
    const response = await client.post('/wealth/schemes/refresh/')
    return response.data
  },
}
