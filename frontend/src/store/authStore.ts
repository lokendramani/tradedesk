import { create } from 'zustand'
import type { User } from '../types'
import { authApi } from '../api/auth'
import { portfolioApi } from '../api/portfolio'
import { initializeIfModuleGranted } from '../utils/moduleRouting'

interface AuthStore {
  user: User | null
  isLoggedIn: boolean
  portfolioId: string | null
  adminViewingAs: string | null
  isInitializing: boolean
  setUser: (user: User | null) => void
  setPortfolioId: (id: string) => void
  setViewAs: (portfolioId: string, userName: string) => void
  clearViewAs: () => void
  logout: () => void
  initializeUser: (user: User) => Promise<void>
  init: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isLoggedIn: false,
  portfolioId: null,
  adminViewingAs: localStorage.getItem('admin_view_as'),
  isInitializing: true,

  setUser: (user) => set({ user, isLoggedIn: !!user }),

  setPortfolioId: (id) => {
    localStorage.setItem('portfolio_id', id)
    set({ portfolioId: id })
  },

  setViewAs: (portfolioId, userName) => {
    if (!localStorage.getItem('admin_own_portfolio_id')) {
      const currentId = get().portfolioId
      if (currentId) localStorage.setItem('admin_own_portfolio_id', currentId)
    }
    localStorage.setItem('portfolio_id', portfolioId)
    localStorage.setItem('admin_view_as', userName)
    set({ portfolioId, adminViewingAs: userName })
  },

  clearViewAs: () => {
    const ownId = localStorage.getItem('admin_own_portfolio_id') || get().portfolioId
    if (ownId) localStorage.setItem('portfolio_id', ownId)
    localStorage.removeItem('admin_own_portfolio_id')
    localStorage.removeItem('admin_view_as')
    set({ portfolioId: ownId, adminViewingAs: null })
  },

  logout: () => {
    authApi.logout()
    set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null })
  },

  initializeUser: async (user) => {
    set({ user, isLoggedIn: true })

    const hasTradeDeskAccess = await initializeIfModuleGranted(
      user.modules ?? [],
      'tradedesk',
      async () => {
        const viewingAs = localStorage.getItem('admin_view_as')
        set({ adminViewingAs: viewingAs })
        if (viewingAs) {
          set({ portfolioId: localStorage.getItem('portfolio_id') })
          return
        }

        try {
          const portfolios = await portfolioApi.getAll(user.id)
          const storedId = localStorage.getItem('portfolio_id')

          if (portfolios.length === 0) {
            const portfolio = await portfolioApi.create({
              name: 'My Trading Journal',
              type: 'TRADING',
              starting_capital: 0,
              worst_case_capital: 0,
            })
            localStorage.setItem('portfolio_id', portfolio.id)
            set({ portfolioId: portfolio.id })
          } else {
            const storedPortfolio = storedId && portfolios.find((p) => p.id === storedId)
            const portfolioId = storedPortfolio ? storedPortfolio.id : portfolios[0].id
            localStorage.setItem('portfolio_id', portfolioId)
            set({ portfolioId })
          }
        } catch {
          set({ portfolioId: localStorage.getItem('portfolio_id') })
        }
      },
    )

    if (!hasTradeDeskAccess) {
      localStorage.removeItem('portfolio_id')
      localStorage.removeItem('admin_own_portfolio_id')
      localStorage.removeItem('admin_view_as')
      set({ portfolioId: null, adminViewingAs: null })
    }
  },

  init: async () => {
    set({ isInitializing: true })
    if (!authApi.isLoggedIn()) {
      set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null, isInitializing: false })
      return
    }

    try {
      const user = await authApi.getMe()
      await get().initializeUser(user)
    } catch {
      authApi.logout()
      set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null })
    } finally {
      set({ isInitializing: false })
    }
  },
}))
