import type { User } from '../types'

export const MODULE_CHOICES = [
  { code: 'tradedesk', path: '/dashboard', label: 'TradeDesk' },
  { code: 'wealth', path: '/wealth', label: 'WealthOnCruise' },
] as const

export function getAvailableModuleChoices(modules: readonly string[]) {
  return MODULE_CHOICES.filter(({ code }) => modules.includes(code))
}

export async function initializeIfModuleGranted(
  modules: readonly string[],
  module: string,
  initialize: () => Promise<void>,
): Promise<boolean> {
  if (!modules.includes(module)) return false
  await initialize()
  return true
}

export function getDefaultModuleRoute(user: User): string {
  const modules = user.modules ?? []
  const available = getAvailableModuleChoices(modules)
  if (available.length > 1) return '/modules'
  if (available[0]?.code === 'tradedesk') return '/dashboard'
  if (available[0]?.code === 'wealth') return '/wealth'
  return '/access'
}

export function getTradePathRedirect(pathname: string, search = '', hash = '') {
  const legacyPath = pathname.replace(/^\/trade\/?/, '')
  return {
    pathname: legacyPath ? `/${legacyPath}` : '/dashboard',
    search,
    hash,
  }
}
