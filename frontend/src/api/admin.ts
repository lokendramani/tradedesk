import client from './client'
import { extractList } from './utils'
import type { Portfolio, Trade } from '../types'

export interface AdminUser {
  id: string
  full_name: string
  email: string
  role: string
  created_at: string
}

export const adminApi = {
  getUsers: async (): Promise<AdminUser[]> => {
    const res = await client.get('/auth/admin/users/')
    return Array.isArray(res.data.data) ? res.data.data : []
  },

  getUserPortfolios: async (userId: string): Promise<Portfolio[]> => {
    const res = await client.get(`/portfolios/?user_id=${userId}`)
    return extractList<Portfolio>(res)
  },

  getPortfolioTrades: async (portfolioId: string): Promise<Trade[]> => {
    const res = await client.get(`/portfolios/${portfolioId}/trades/`)
    return extractList<Trade>(res)
  },
}
