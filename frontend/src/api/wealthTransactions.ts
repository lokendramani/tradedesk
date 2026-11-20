import client from './client'

export type WealthTransactionType =
  | 'PURCHASE' | 'REDEMPTION' | 'SWITCH_OUT' | 'SWITCH_IN'
  | 'DIVIDEND' | 'BONUS' | 'OTHER'
export type WealthTransactionSource = 'MANUAL' | 'SIP' | 'IMPORT' | 'OTHER'

export interface WealthMFTransactionDetail {
  units: string
  nav: string
  amount: string
  charges: string
  cashflow: string
  charges_source?: 'AUTOMATIC' | 'MANUAL' | 'MIXED'
  charges_breakdown?: Record<string, string | number | boolean>
}
export interface WealthTransaction {
  id: string
  transaction_type: WealthTransactionType
  transaction_date: string
  source: WealthTransactionSource
  source_reference: string
  scheme_code?: string
  scheme: {
    scheme_code: string
    scheme_name: string
    fund_house: string
    category_name: string
    fund_house_master_id?: string | null
    asset_class: string
    plan_type: string
    option_type: string
    isin_growth: string | null
    isin_div_payout: string | null
    isin_div_reinvestment: string | null
  }
  instrument: {
    id: string
    instrument_type: 'MUTUAL_FUND' | 'OTHER'
    scheme_code: string
    scheme_name: string
    fund_house: string
  }
  folio: string | null
  switch_group_id: string | null
  mf_detail: WealthMFTransactionDetail
  notes: string
  created_at: string
  updated_at: string
}

export interface WealthTransactionInput {
  transaction_type: WealthTransactionType
  transaction_date: string
  source?: WealthTransactionSource
  source_reference?: string
  scheme_code: string
  folio?: string | null
  mf_detail: WealthMFTransactionDetail
  notes?: string
}

export interface WealthFolio {
  id: string
  folio_number: string
  name: string
  fund_house: string | null
  fund_house_name: string | null
  created_at: string
  updated_at: string
  can_delete?: boolean
  delete_block_reason?: string | null
}

export type WealthFolioInput = Pick<WealthFolio, 'folio_number'> & {
  name?: string
  fund_house?: string | null
}

export interface WealthFundHouse {
  id: string
  name: string
}

export interface WealthInstrument {
  id: string
  instrument_type: 'MUTUAL_FUND' | 'OTHER'
  scheme_code: string
  scheme_name: string
  fund_house: string
}

export interface WealthHolding {
  instrument_id: string
  scheme_code: string
  scheme_name: string
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

export interface WealthTransactionAudit {
  id: string
  transaction_id_snapshot: string
  action: 'CREATED' | 'UPDATED' | 'DELETED'
  before: Record<string, unknown>
  after: Record<string, unknown>
  actor_id: string | null
  created_at: string
}

export interface WealthSIPMandate {
  id: string; scheme_code: string; scheme_name: string; fund_house: string
  plan_type?: string | null; option_type?: string | null
  folio: string | null; monthly_amount: string; frequency: 'MONTHLY'; sip_day: number
  start_date: string; generate_from_date: string; end_date: string | null
  generated_through: string | null; status: 'ACTIVE' | 'PAUSED' | 'COMPLETED'
  can_delete?: boolean; delete_block_reason?: string | null
}
export interface WealthSIPInstallment {
  id: string; mandate_id: string; scheme_code: string; scheme_name: string; folio_id: string | null
  plan_type?: string | null; option_type?: string | null
  sip_day: number; monthly_amount: string; scheduled_date: string; amount: string
  status: 'PENDING' | 'CONFIRMED'; transaction_id_snapshot: string | null
}
export interface WealthSIPConfirmation {
  actual_date: string
  actual_nav: string
  actual_charges?: string
  charges_source?: 'AUTOMATIC' | 'MANUAL' | 'MIXED'
  notes?: string
}

export interface WealthSwitchRequest {
  switch_out: WealthTransactionInput
  switch_in: WealthTransactionInput
}

export interface WealthSwitchResponse {
  switch_group_id: string
  switch_out: WealthTransaction
  switch_in: WealthTransaction
}

export const wealthTransactionsApi = {
  async list(): Promise<WealthTransaction[]> {
    const { data } = await client.get('/wealth/transactions/')
    return data
  },
  async create(input: WealthTransactionInput): Promise<WealthTransaction> {
    const { data } = await client.post('/wealth/transactions/', input)
    return data
  },
  async update(id: string, input: Partial<WealthTransactionInput>): Promise<WealthTransaction> {
    const { data } = await client.patch(`/wealth/transactions/${encodeURIComponent(id)}/`, input)
    return data
  },
  async delete(id: string): Promise<void> {
    await client.delete(`/wealth/transactions/${encodeURIComponent(id)}/`)
  },
  async switchPair(input: WealthSwitchRequest): Promise<WealthSwitchResponse> {
    const { data } = await client.post('/wealth/transactions/switch/', input)
    return data
  },
  async updateSwitchPair(groupId: string, input: WealthSwitchRequest): Promise<WealthSwitchResponse> {
    const { data } = await client.patch(`/wealth/transactions/switch/${encodeURIComponent(groupId)}/`, input)
    return data
  },
  async deleteSwitchPair(groupId: string): Promise<void> {
    await client.delete(`/wealth/transactions/switch/${encodeURIComponent(groupId)}/`)
  },
  async auditLog(): Promise<WealthTransactionAudit[]> {
    const { data } = await client.get('/wealth/transactions/audit/')
    return data
  },
  async sipMandates(): Promise<WealthSIPMandate[]> {
    const { data } = await client.get('/wealth/sip-mandates/')
    return data
  },
  async createSIPMandate(input: Omit<WealthSIPMandate, 'id' | 'scheme_name' | 'fund_house' | 'frequency' | 'generated_through' | 'status'> & { status?: 'ACTIVE' | 'PAUSED' }): Promise<WealthSIPMandate> {
    const { data } = await client.post('/wealth/sip-mandates/', input)
    return data
  },
  async updateSIPMandate(id: string, input: Partial<Pick<WealthSIPMandate, 'status' | 'monthly_amount' | 'sip_day' | 'end_date'>>): Promise<WealthSIPMandate> {
    const { data } = await client.patch(`/wealth/sip-mandates/${encodeURIComponent(id)}/`, input)
    return data
  },
  async deleteSIPMandate(id: string): Promise<void> {
    await client.delete(`/wealth/sip-mandates/${encodeURIComponent(id)}/`)
  },
  async sipInstallments(status?: string): Promise<WealthSIPInstallment[]> {
    const { data } = await client.get('/wealth/sip-installments/', { params: status ? { status } : {} })
    return data
  },
  async updateSIPInstallment(id: string, input: { scheduled_date?: string; amount?: string }): Promise<WealthSIPInstallment> {
    const { data } = await client.patch(`/wealth/sip-installments/${encodeURIComponent(id)}/`, input)
    return data
  },
  async confirmSIPInstallment(id: string, input: WealthSIPConfirmation): Promise<{ installment: WealthSIPInstallment; transaction: WealthTransaction }> {
    const { data } = await client.post(`/wealth/sip-installments/${encodeURIComponent(id)}/confirm/`, input)
    return data
  },
  async audit(id: string): Promise<WealthTransactionAudit[]> {
    const { data } = await client.get(`/wealth/transactions/${encodeURIComponent(id)}/audit/`)
    return data
  },
  async folios(): Promise<WealthFolio[]> {
    const { data } = await client.get('/wealth/folios/')
    return data
  },
  async createFolio(input: WealthFolioInput): Promise<WealthFolio> {
    const { data } = await client.post('/wealth/folios/', input)
    return data
  },
  async updateFolio(id: string, input: Partial<WealthFolioInput>): Promise<WealthFolio> {
    const { data } = await client.patch(`/wealth/folios/${encodeURIComponent(id)}/`, input)
    return data
  },
  async deleteFolio(id: string): Promise<void> {
    await client.delete(`/wealth/folios/${encodeURIComponent(id)}/`)
  },
  async fundHouses(): Promise<WealthFundHouse[]> {
    const { data } = await client.get('/wealth/fund-houses/')
    return data
  },
  async instruments(): Promise<WealthInstrument[]> {
    const { data } = await client.get('/wealth/instruments/')
    return data
  },
  async resolveInstrument(schemeCode: string): Promise<WealthInstrument> {
    const { data } = await client.post('/wealth/instruments/', { scheme_code: schemeCode })
    return data
  },
  async holdings(groupBy: 'aggregate' | 'folio' = 'folio'): Promise<WealthHoldingsResponse> {
    const { data } = await client.get('/wealth/holdings/', { params: { group_by: groupBy } })
    return data
  },
}

\n