import client from './client'

export type CashFlowSection = 'INCOME' | 'SAVINGS' | 'EXPENSES'

export interface CashFlowCategory {
  id: number
  section: CashFlowSection
  name: string
  is_archived: boolean
}

export interface CashFlowEntry {
  id: number
  name: string
  category: number
  category_name: string
  section: CashFlowSection
  amount: string
}

export interface CashFlowTotals {
  income: string
  savings: string
  expenses: string
  surplus: string
  savings_rate: string
}

export interface CashFlowProfile {
  profile_id: number
  categories: CashFlowCategory[]
  entries: CashFlowEntry[]
  totals: CashFlowTotals
  expense_breakdown: { category_id: number; category_name: string; amount: string }[]
}

export interface CashFlowEntryInput {
  name: string
  category: number
  amount: string
}

export const cashFlowApi = {
  async getCurrent(): Promise<CashFlowProfile> {
    const response = await client.get('/wealth/cash-flow/')
    return response.data.data ?? response.data
  },

  async createCategory(data: { section: CashFlowSection; name: string }): Promise<CashFlowCategory> {
    const response = await client.post('/wealth/cash-flow/categories/', data)
    return response.data.data ?? response.data
  },

  async updateCategory(id: number, data: Partial<Pick<CashFlowCategory, 'name' | 'is_archived'>>): Promise<CashFlowCategory> {
    const response = await client.patch(`/wealth/cash-flow/categories/${id}/`, data)
    return response.data.data ?? response.data
  },

  async createEntry(data: CashFlowEntryInput): Promise<CashFlowEntry> {
    const response = await client.post('/wealth/cash-flow/entries/', data)
    return response.data.data ?? response.data
  },

  async updateEntry(id: number, data: Partial<CashFlowEntryInput>): Promise<CashFlowEntry> {
    const response = await client.patch(`/wealth/cash-flow/entries/${id}/`, data)
    return response.data.data ?? response.data
  },

  async deleteEntry(id: number): Promise<void> {
    await client.delete(`/wealth/cash-flow/entries/${id}/`)
  },
}
