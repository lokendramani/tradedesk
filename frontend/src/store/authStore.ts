import { create } from 'zustand'
import type { User } from '../types'
import { authApi } from '../api/auth'
import { portfolioApi } from '../api/portfolio'
import { initializeIfModuleGranted } from '../utils/moduleRouting'
import type { PortfolioCapital } from '../utils/portfolioInitialization'
import { clearPortfolioCapitalDraft, savePortfolioCapitalDraft } from '../utils/portfolioCapitalStorage'
import { resolvePortfolio } from '../utils/portfolioSetup'
import {
  getAuthSessionSnapshot,
  isAuthSessionGenerationCurrent,
  runIfAuthSessionGenerationMatches,
  type AuthSessionSnapshot,
} from '../utils/authSessionStorage'
import { loadAndInitializeUser } from '../utils/sessionUserInitialization'

export type PortfolioInitializationStatus = 'idle' | 'loading' | 'lookup-error' | 'needs-setup' | 'ready'

interface AuthStore {
  user: User | null
  isLoggedIn: boolean
  portfolioId: string | null
  adminViewingAs: string | null
  isInitializing: boolean
  portfolioInitializationStatus: PortfolioInitializationStatus
  portfolioInitializationError: string | null
  setUser: (user: User | null) => void
  setPortfolioId: (id: string) => void
  setPortfolioLookupError: (message: string) => void
  setViewAs: (portfolioId: string, userName: string) => void
  clearViewAs: () => void
  logout: () => void
  initializeUser: (user: User, initialCapital?: PortfolioCapital, sessionGeneration?: string) => Promise<boolean>
  init: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isLoggedIn: false,
  portfolioId: null,
  adminViewingAs: localStorage.getItem('admin_view_as'),
  isInitializing: true,
  portfolioInitializationStatus: 'idle',
  portfolioInitializationError: null,

  setUser: (user) => set({ user, isLoggedIn: !!user }),

  setPortfolioId: (id) => {
    localStorage.setItem('portfolio_id', id)
    set({ portfolioId: id, portfolioInitializationStatus: 'ready', portfolioInitializationError: null })
  },

  setPortfolioLookupError: (message) => set({
    portfolioInitializationStatus: 'lookup-error',
    portfolioInitializationError: message,
  }),

  setViewAs: (portfolioId, userName) => {
    if (!localStorage.getItem('admin_own_portfolio_id')) {
      const currentId = get().portfolioId
      if (currentId) localStorage.setItem('admin_own_portfolio_id', currentId)
    }
    localStorage.setItem('portfolio_id', portfolioId)
    localStorage.setItem('admin_view_as', userName)
    set({ portfolioId, adminViewingAs: userName, portfolioInitializationStatus: 'ready', portfolioInitializationError: null })
  },

  clearViewAs: () => {
    const ownId = localStorage.getItem('admin_own_portfolio_id') || get().portfolioId
    if (ownId) localStorage.setItem('portfolio_id', ownId)
    localStorage.removeItem('admin_own_portfolio_id')
    localStorage.removeItem('admin_view_as')
    set({
      portfolioId: ownId,
      adminViewingAs: null,
      portfolioInitializationStatus: ownId ? 'ready' : 'needs-setup',
      portfolioInitializationError: null,
    })
  },

  logout: () => {
    authApi.logout()
    set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null, portfolioInitializationStatus: 'idle', portfolioInitializationError: null })
  },

  initializeUser: async (user, initialCapital, sessionGeneration) => {
    const apply = async (callback: () => void) => {
      if (!sessionGeneration) {
        callback()
        return true
      }
      return runIfAuthSessionGenerationMatches(sessionGeneration, callback)
    }
    const hasTradeDeskAccess = (user.modules ?? []).includes('tradedesk')
    if (!await apply(() => set({
      user,
      isLoggedIn: true,
      portfolioInitializationStatus: hasTradeDeskAccess ? 'loading' : 'idle',
      portfolioInitializationError: null,
    }))) return false

    if (initialCapital) {
      savePortfolioCapitalDraft(user.id, {
        startingCapital: String(initialCapital.startingCapital),
        worstCaseCapital: String(initialCapital.worstCaseCapital),
      })
    }

    let staleSession = false
    const initialized = await initializeIfModuleGranted(
      user.modules ?? [],
      'tradedesk',
      async () => {
        const viewingAs = localStorage.getItem('admin_view_as')
        if (viewingAs) {
          const portfolioId = localStorage.getItem('portfolio_id')
          if (!await apply(() => set({
            adminViewingAs: viewingAs,
            portfolioId,
            portfolioInitializationStatus: portfolioId ? 'ready' : 'lookup-error',
            portfolioInitializationError: portfolioId ? null : 'The viewed portfolio could not be identified.',
          }))) staleSession = true
          return
        }
        if (!await apply(() => set({ adminViewingAs: null }))) {
          staleSession = true
          return
        }

        if (sessionGeneration && !await isAuthSessionGenerationCurrent(sessionGeneration)) {
          staleSession = true
          return
        }

        const result = await resolvePortfolio(
          portfolioApi,
          user.id,
          initialCapital ?? null,
          localStorage.getItem('portfolio_id'),
        )
        if (sessionGeneration && !await isAuthSessionGenerationCurrent(sessionGeneration)) {
          staleSession = true
          return
        }
        if (result.status === 'ready') {
          const portfolioId = result.portfolio.id
          if (!await apply(() => {
            if (result.created) clearPortfolioCapitalDraft(user.id)
            localStorage.setItem('portfolio_id', portfolioId)
            set({ portfolioId, portfolioInitializationStatus: 'ready', portfolioInitializationError: null })
          })) staleSession = true
        } else if (result.status === 'setup-required') {
          const message = result.error instanceof Error ? result.error.message : null
          if (!await apply(() => {
            localStorage.removeItem('portfolio_id')
            set({ portfolioId: null, portfolioInitializationStatus: 'needs-setup', portfolioInitializationError: message })
          })) staleSession = true
        } else {
          const message = result.error instanceof Error ? result.error.message : 'Could not check your portfolios. Try again.'
          if (!await apply(() => set({ portfolioInitializationStatus: 'lookup-error', portfolioInitializationError: message }))) staleSession = true
        }
      },
    )

    if (!initialized) {
      if (!await apply(() => {
        localStorage.removeItem('portfolio_id')
        localStorage.removeItem('admin_own_portfolio_id')
        localStorage.removeItem('admin_view_as')
        set({ portfolioId: null, adminViewingAs: null, portfolioInitializationStatus: 'idle', portfolioInitializationError: null })
      })) staleSession = true
    }
    return !staleSession
  },

  init: async () => {
    set({ isInitializing: true })
    if (!authApi.isLoggedIn()) {
      set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null, portfolioInitializationStatus: 'idle', portfolioInitializationError: null, isInitializing: false })
      return
    }

    let session: AuthSessionSnapshot | null = null
    try {
      session = await getAuthSessionSnapshot()
      await loadAndInitializeUser(
        () => authApi.getMe(),
        (user, generation) => get().initializeUser(user, undefined, generation),
      )
    } catch {
      const currentSession = await getAuthSessionSnapshot().catch(() => null)
      const sameSession = !!session?.generation && currentSession?.generation === session.generation
      let cleared = false
      if (sameSession && session?.generation) {
        cleared = await authApi.logoutIfSessionMatches(session.generation).catch(() => false)
      }
      if (cleared || !authApi.isLoggedIn()) {
        set({ user: null, isLoggedIn: false, portfolioId: null, adminViewingAs: null, portfolioInitializationStatus: 'idle', portfolioInitializationError: null })
      }
    } finally {
      set({ isInitializing: false })
    }
  },
}))
