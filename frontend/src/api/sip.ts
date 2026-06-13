import apiClient from './client'
import type { SIPTrade, SIPDashboard, SIPUploadResult, SIPHoldingsResponse, SIPBookedPLResponse } from '../types'

export const sipApi = {
  async listTrades(): Promise<SIPTrade[]> {
    const res = await apiClient.get('/sip/trades/')
    return res.data
  },

  async uploadCsv(file: File): Promise<SIPUploadResult> {
    const form = new FormData()
    form.append('file', file)
    const res = await apiClient.post('/sip/upload/', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  async addTrade(data: Partial<SIPTrade>): Promise<SIPTrade> {
    const res = await apiClient.post('/sip/trades/', data)
    return res.data
  },

  async closeTrade(id: string, exitDate: string, exitPrice: number): Promise<SIPTrade> {
    const res = await apiClient.patch(`/sip/trades/${id}/close/`, {
      exit_date: exitDate,
      exit_price: exitPrice,
    })
    return res.data
  },

  async getBookedPL(): Promise<SIPBookedPLResponse> {
    const res = await apiClient.get('/sip/booked-pl/')
    return res.data
  },

  async sell(ticker: string, qty: number, exitDate: string, exitPrice: number): Promise<{ message: string; trades_closed: number; splits_created: number }> {
    const res = await apiClient.post('/sip/sell/', { ticker, qty, exit_date: exitDate, exit_price: exitPrice })
    return res.data
  },

  async getHoldings(): Promise<SIPHoldingsResponse> {
    const res = await apiClient.get('/sip/holdings/')
    return res.data
  },

  async getDashboard(): Promise<SIPDashboard> {
    const res = await apiClient.get('/sip/dashboard/')
    return res.data
  },

  async refreshPrices(): Promise<{ refreshed_at: string; updated_tickers: string[] }> {
    const res = await apiClient.post('/sip/refresh-prices/')
    return res.data
  },

  async clearData(): Promise<{ deleted_trades: number }> {
    const res = await apiClient.delete('/sip/clear/')
    return res.data
  },
}
