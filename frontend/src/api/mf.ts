import client from './client'

export interface MFDashboard {
  total_cost_value:   string
  total_market_value: string
  total_gain_loss:    string
  gain_loss_pct:      number
  total_folios:       number
  total_schemes:      number
  fund_houses: {
    fund_house:   string
    cost_value:   string
    market_value: string
    gain_loss:    string
    schemes:      number
  }[]
}

export interface MFScheme {
  id:               number
  folio_number:     string
  fund_house:       string
  scheme_name:      string
  scheme_code:      string
  isin:             string
  plan:             string
  option:           string
  registrar:        string
  closing_units:    string
  closing_nav:      string
  closing_nav_date: string
  cost_value:       string
  market_value:     string
  gain_loss:        string
  gain_loss_pct:    number
}

export interface MFTransaction {
  id:               number
  scheme_id:        number
  scheme_name:      string
  fund_house:       string
  folio_number:     string
  transaction_date: string
  transaction_type: string
  description:      string
  amount:           string
  units:            string
  nav:              string
  unit_balance:     string
}

export interface ImportResult {
  folios:   number
  schemes:  number
  imported: number
  skipped:  number
  investor: { name?: string; pan?: string; email?: string }
}

export const mfApi = {
  importCAS: async (file: File): Promise<ImportResult> => {
    const form = new FormData()
    form.append('file', file)
    const res = await client.post('/mf/import/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.data
  },

  getDashboard: async (): Promise<MFDashboard> => {
    const res = await client.get('/mf/dashboard/')
    return res.data.data
  },

  getSchemes: async (fundHouse?: string): Promise<MFScheme[]> => {
    const res = await client.get('/mf/schemes/', {
      params: fundHouse ? { fund_house: fundHouse } : {},
    })
    return res.data.data ?? []
  },

  getTransactions: async (params?: {
    scheme_id?: number
    fund_house?: string
    txn_type?:  string
  }): Promise<MFTransaction[]> => {
    const res = await client.get('/mf/transactions/', { params })
    return res.data.data ?? []
  },

  deleteAll: async (): Promise<void> => {
    await client.delete('/mf/delete/')
  },
}
