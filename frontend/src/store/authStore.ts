import { create } from 'zustand'
import type { User } from '../types'
import { authApi } from '../api/auth'
import { portfolioApi } from '../api/portfolio'

interface AuthStore {
  user: User | null
  isLoggedIn: boolean
  portfolioId: string | null
  isInitializing: boolean
  setUser: (user: User | null) => void
  setPortfolioId: (id: string) => void
  logout: () => void
  init: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isLoggedIn: false,
  portfolioId: null,
  isInitializing: true,

  setUser: (user) => set({ user, isLoggedIn: !!user }),

  setPortfolioId: (id) => {
    localStorage.setItem('portfolio_id', id)
    set({ portfolioId: id })
  },

  logout: () => {
    authApi.logout()
    set({ user: null, isLoggedIn: false, portfolioId: null })
  },

  init: async () => {
    set({ isInitializing: true })
    const user = authApi.getUser()

    if (!user) {
      set({ user: null, isLoggedIn: false, portfolioId: null, isInitializing: false })
      return
    }

    set({ user, isLoggedIn: true })

    try {
      const portfolios = await portfolioApi.getAll()
      const storedId   = localStorage.getItem('portfolio_id')

      if (portfolios.length === 0) {
        // No portfolio in DB — create a default one
        const p = await portfolioApi.create({
          name: 'My Trading Journal',
          type: 'TRADING',
          starting_capital: 0,
          worst_case_capital: 0,
        })
        localStorage.setItem('portfolio_id', p.id)
        set({ portfolioId: p.id })
      } else {
        // Use stored ID only if it matches a real portfolio, otherwise fall back to first
        const valid = storedId && portfolios.find((p) => p.id === storedId)
        const id = valid ? storedId! : portfolios[0].id
        localStorage.setItem('portfolio_id', id)
        set({ portfolioId: id })
      }
    } catch {
      // API unreachable — use whatever is stored and let pages show the error
      const portfolioId = localStorage.getItem('portfolio_id')
      set({ portfolioId })
    } finally {
      set({ isInitializing: false })
    }
  },
}))
