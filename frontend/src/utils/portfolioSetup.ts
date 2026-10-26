import type { Portfolio } from '../types'
import { getInitialPortfolioData, type PortfolioCapital } from './portfolioInitialization.ts'

export interface PortfolioSetupApi {
  getAll: (userId: string) => Promise<Portfolio[]>
  create: (data: NonNullable<ReturnType<typeof getInitialPortfolioData>>) => Promise<Portfolio>
}

export type PortfolioResolution =
  | { status: 'ready'; portfolio: Portfolio; created: boolean }
  | { status: 'setup-required'; error?: unknown }
  | { status: 'lookup-error'; error: unknown }

export function getPortfolioRootState(
  status: 'idle' | 'loading' | 'lookup-error' | 'needs-setup' | 'ready',
  portfolioId: string | null,
): 'loading' | 'lookup-error' | 'needs-setup' | 'ready' {
  if (status === 'lookup-error') return 'lookup-error'
  if (status === 'needs-setup') return 'needs-setup'
  if (status === 'ready' && portfolioId) return 'ready'
  return 'loading'
}

async function lookup(api: PortfolioSetupApi, userId: string): Promise<Portfolio[] | null> {
  try {
    return await api.getAll(userId)
  } catch {
    return null
  }
}

export async function resolvePortfolio(
  api: PortfolioSetupApi,
  userId: string,
  capital: PortfolioCapital | null,
  preferredPortfolioId?: string | null,
): Promise<PortfolioResolution> {
  let portfolios: Portfolio[]
  try {
    portfolios = await api.getAll(userId)
  } catch (error) {
    return { status: 'lookup-error', error }
  }

  if (portfolios.length > 0) {
    const preferred = portfolios.find(({ id }) => id === preferredPortfolioId)
    return { status: 'ready', portfolio: preferred ?? portfolios[0], created: false }
  }
  if (!capital) return { status: 'setup-required' }

  const createData = getInitialPortfolioData(capital)
  if (!createData) return { status: 'setup-required' }
  try {
    return { status: 'ready', portfolio: await api.create(createData), created: true }
  } catch (error) {
    // The POST may have committed even when its response did not reach the client.
    const confirmedPortfolios = await lookup(api, userId)
    if (confirmedPortfolios === null) return { status: 'lookup-error', error }
    if (confirmedPortfolios.length > 0) {
      const preferred = confirmedPortfolios.find(({ id }) => id === preferredPortfolioId)
      return { status: 'ready', portfolio: preferred ?? confirmedPortfolios[0], created: true }
    }
    return { status: 'setup-required', error }
  }
}
