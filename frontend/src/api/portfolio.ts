import client from './client'
import { extractData, extractList } from './utils'
import type { Portfolio } from '../types'

const DEFAULT_PORTFOLIO = {
  name: 'My Trading Journal',
  type: 'TRADING',
  starting_capital: 0,
  worst_case_capital: 0,
} as const

export const portfolioApi = {
  getAll: async (): Promise<Portfolio[]> => {
    const res = await client.get('/portfolios/')
    return extractList<Portfolio>(res)
  },

  create: async (data: {
    name: string
    type: string
    starting_capital: number
    worst_case_capital: number
  }): Promise<Portfolio> => {
    const res = await client.post('/portfolios/', data)
    return extractData<Portfolio>(res)
  },

  update: async (id: string, data: Partial<Portfolio>): Promise<Portfolio> => {
    const res = await client.put(`/portfolios/${id}/`, data)
    return extractData<Portfolio>(res)
  },

  /** Use first portfolio or create a default one after login/register */
  ensureDefault: async (): Promise<string> => {
    const portfolios = await portfolioApi.getAll()
    if (portfolios.length > 0) return portfolios[0].id
    const created = await portfolioApi.create({ ...DEFAULT_PORTFOLIO })
    return created.id
  },
}