import client from './client'
import type { Trade, Stats, EquityPoint, MonthlyPnl, TradeFilter } from '../types'

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const tradesApi = {
  getAll: async (portfolioId: string, filters?: TradeFilter): Promise<Trade[]> => {
    const res = await client.get(`/portfolios/${portfolioId}/trades/`, {
      params: filters,
    })
    return res.data.data || res.data.results || res.data
  },

  create: async (portfolioId: string, data: Partial<Trade>): Promise<Trade> => {
    const res = await client.post(`/portfolios/${portfolioId}/trades/`, data)
    return res.data.data
  },

  update: async (portfolioId: string, tradeId: string, data: Partial<Trade>): Promise<Trade> => {
    const res = await client.put(`/portfolios/${portfolioId}/trades/${tradeId}/`, data)
    return res.data.data
  },

  close: async (portfolioId: string, tradeId: string, closeDate: string, closePrice: number): Promise<Trade> => {
    const res = await client.patch(`/portfolios/${portfolioId}/trades/${tradeId}/close/`, {
      close_date: closeDate,
      close_price: closePrice,
    })
    return res.data.data
  },

  delete: async (portfolioId: string, tradeId: string): Promise<void> => {
    await client.delete(`/portfolios/${portfolioId}/trades/${tradeId}/`)
  },

  deleteAll: async (portfolioId: string): Promise<void> => {
    await client.post(`/portfolios/${portfolioId}/trades/clear/`)
  },

  bulkImport: async (
    portfolioId: string,
    trades: Partial<Trade>[],
    mode: string,
    fromDate?: string,
  ): Promise<{ imported: number; skipped: number; duplicates: number; errors: string[] }> => {
    const res = await client.post(`/portfolios/${portfolioId}/trades/bulk/`, {
      trades,
      mode,
      from_date: fromDate ?? '',
    })
    return res.data.data
  },

  importCsv: async (portfolioId: string, file: File, mapping: Record<string, string>) => {
    const formData = new FormData()
    formData.append('file', file)
    Object.entries(mapping).forEach(([key, value]) => {
      formData.append(key, value)
    })
    const res = await client.post(`/portfolios/${portfolioId}/trades/import/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.data
  },

  getStats: async (portfolioId: string, segment?: string, year?: number, month?: number): Promise<Stats> => {
    const res = await client.get(`/portfolios/${portfolioId}/stats/`, {
      params: { segment, year, month },
    })
    return res.data.data
  },

  getEquityCurve: async (portfolioId: string, segment?: string, basis?: string, year?: number, month?: number): Promise<EquityPoint[]> => {
    const res = await client.get(`/portfolios/${portfolioId}/stats/equity-curve/`, {
      params: { segment, basis, year, month },
    })
    return res.data.data
  },

  getMonthlyPnl: async (portfolioId: string, segment?: string): Promise<MonthlyPnl[]> => {
    const res = await client.get(`/portfolios/${portfolioId}/stats/monthly-pnl/`, {
      params: { segment },
    })
    return res.data.data
  },

  getClosedMonths: async (portfolioId: string): Promise<string[]> => {
    const res = await client.get(`/portfolios/${portfolioId}/stats/closed-months/`)
    return res.data.data
  },

  downloadSampleCsv: async (portfolioId: string): Promise<void> => {
    const res = await client.get(`/portfolios/${portfolioId}/trades/sample-csv/`, { responseType: 'blob' })
    triggerDownload(res.data, 'tradedesk_sample.csv')
  },

  exportCsv: async (portfolioId: string): Promise<void> => {
    const res = await client.get(`/portfolios/${portfolioId}/trades/export/`, { responseType: 'blob' })
    const today = new Date().toISOString().slice(0, 10)
    triggerDownload(res.data, `trades_export_${today}.csv`)
  },
}