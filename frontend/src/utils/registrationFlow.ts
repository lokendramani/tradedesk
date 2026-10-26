import type { User } from '../types'
import type { PortfolioCapital } from './portfolioInitialization.ts'
import { savePortfolioCapitalDraft } from './portfolioCapitalStorage.ts'
import { type SessionBoundUser, StaleAuthSessionResponseError } from './sessionUserInitialization.ts'

interface RegistrationResponse {
  data?: {
    user?: { id?: unknown }
  }
}

export interface RegistrationFlowDependencies {
  register: (email: string, password: string, fullName: string) => Promise<RegistrationResponse>
  login: (email: string, password: string) => Promise<{ sessionGeneration: string }>
  getMe: () => Promise<SessionBoundUser>
  initializeUser: (user: User, capital: PortfolioCapital, sessionGeneration: string) => Promise<boolean>
  logoutIfSessionMatches: (sessionGeneration: string) => Promise<boolean>
}

export async function registerAndInitializeUser(
  dependencies: RegistrationFlowDependencies,
  credentials: { email: string; password: string; fullName: string },
  capital: PortfolioCapital,
): Promise<User> {
  const response = await dependencies.register(credentials.email, credentials.password, credentials.fullName)
  const registeredUserId = response.data?.user?.id
  if (typeof registeredUserId !== 'string' || !registeredUserId.trim()) {
    throw new Error('Registration response did not include a user ID.')
  }

  // Save only the capital draft, keyed by the ID returned from registration.
  savePortfolioCapitalDraft(registeredUserId, {
    startingCapital: String(capital.startingCapital),
    worstCaseCapital: String(capital.worstCaseCapital),
  })

  const session = await dependencies.login(credentials.email, credentials.password)
  const { user, sessionGeneration } = await dependencies.getMe()
  if (user.id !== registeredUserId) {
    await dependencies.logoutIfSessionMatches(session.sessionGeneration)
    throw new Error('The signed-in user did not match the newly registered account.')
  }
  if (!await dependencies.initializeUser(user, capital, sessionGeneration)) {
    throw new StaleAuthSessionResponseError()
  }
  return user
}
