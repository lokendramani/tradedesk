import client from './client'
import type { AuthResponse, User } from '../types'
import { clearAuthSessionIfGenerationMatches, clearAuthSessionStorage, saveAuthSession } from '../utils/authSessionStorage'
import { fetchUserForActiveSession, type SessionBoundUser } from '../utils/sessionUserInitialization'

export const authApi = {
  register: async (email: string, password: string, full_name: string) => {
    const res = await client.post('/auth/register/', { email, password, full_name })
    return res.data
  },

  login: async (email: string, password: string): Promise<AuthResponse & { sessionGeneration: string }> => {
    const res = await client.post('/auth/login/', { email, password })
    const { access, refresh, user } = res.data.data
    const sessionGeneration = await saveAuthSession(access, refresh, user)
    return { ...res.data.data, sessionGeneration }
  },

  getMe: async (): Promise<SessionBoundUser> => {
    return fetchUserForActiveSession(async () => {
      const res = await client.get('/auth/me/')
      return res.data.data as User
    })
  },

  logout: async (): Promise<void> => {
    await clearAuthSessionStorage()
  },

  logoutIfSessionMatches: (expectedGeneration: string): Promise<boolean> => {
    return clearAuthSessionIfGenerationMatches(expectedGeneration)
  },

  getUser: () => {
    const user = localStorage.getItem('user')
    return user ? JSON.parse(user) : null
  },

  isLoggedIn: () => !!localStorage.getItem('access_token'),
}
