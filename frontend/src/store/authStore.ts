import { create } from 'zustand'
import type { User } from '../types'
import { authApi } from '../api/auth'
import { portfolioApi } from '../api/portfolio'

interface AuthStore {
  user: User | null
  isLoggedIn: boolean
  portfolioId: string | null
  adminViewingAs: string | null  // non-null when admin is viewing another user's portfolio
  isInitializing: boolean
  setUser: (user: User | null) => void
  setPortfolioId: (id: string) => void
  setViewAs: (portfolioId: string, userName: string) => void
  clearViewAs: () => void
  logout: () => void
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
    // Save own portfolio ID only on first "view as" (don't overwrite if already viewing as someone)
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

  init: async () => {
    set({ isInitializing: true })
    const user = authApi.getUser()

    if (!user) {
      set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null, isInitializing: false })
      return
    }

    const viewingAs = localStorage.getItem('admin_view_as')
    set({ user, isLoggedIn: true, adminViewingAs: viewingAs })

    try {
      if (viewingAs) {
        // Preserve view-as state — don't reset portfolio_id to own
        set({ portfolioId: localStorage.getItem('portfolio_id') })
      } else {
        // Always fetch ONLY the current user's portfolios (pass user.id)
        // For admin: returns their own portfolios only (backend filters by user_id)
        // For regular user: backend ignores user_id for non-admin, returns their own
        const portfolios = await portfolioApi.getAll(user.id)
        const storedId   = localStorage.getItem('portfolio_id')

        if (portfolios.length === 0) {
          const p = await portfolioApi.create({
            name: 'My Trading Journal',
            type: 'TRADING',
            starting_capital: 0,
            worst_case_capital: 0,
          })
          localStorage.setItem('portfolio_id', p.id)
          set({ portfolioId: p.id })
        } else {
          // Use stored ID only if it's one of the user's OWN portfolios
          const valid = storedId && portfolios.find((p) => p.id === storedId)
          const id = valid ? storedId! : portfolios[0].id
          localStorage.setItem('portfolio_id', id)
          set({ portfolioId: id })
        }
      }
    } catch {
      set({ portfolioId: localStorage.getItem('portfolio_id') })
    } finally {
      set({ isInitializing: false })
    }
  },
}))
