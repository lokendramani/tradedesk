import type { User } from '../types'
import {
  getAuthSessionSnapshot,
  isAuthSessionGenerationCurrent,
  persistAuthUserIfGenerationMatches,
} from './authSessionStorage.ts'

export interface SessionBoundUser {
  user: User
  sessionGeneration: string
}

export class StaleAuthSessionResponseError extends Error {
  constructor() {
    super('The authentication session changed before the current-user response was applied.')
    this.name = 'StaleAuthSessionResponseError'
  }
}

export async function fetchUserForActiveSession(request: () => Promise<User>): Promise<SessionBoundUser> {
  const session = await getAuthSessionSnapshot()
  if (!session.generation) throw new StaleAuthSessionResponseError()

  const user = await request()
  const persisted = await persistAuthUserIfGenerationMatches(session.generation, user)
  if (!persisted) throw new StaleAuthSessionResponseError()
  return { user, sessionGeneration: session.generation }
}

export async function loadAndInitializeUser(
  getCurrentUser: () => Promise<SessionBoundUser>,
  initializeUser: (user: User, sessionGeneration: string) => Promise<boolean>,
): Promise<boolean> {
  const { user, sessionGeneration } = await getCurrentUser()
  if (!await isAuthSessionGenerationCurrent(sessionGeneration)) return false
  return initializeUser(user, sessionGeneration)
}
