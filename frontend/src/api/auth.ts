import client from './client'
import type { AuthResponse } from '../types'

export const authApi = {
  register: async (email: string, password: string, full_name: string) => {
    const res = await client.post('/auth/register/', { email, password, full_name })
    return res.data
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const res = await client.post('/auth/login/', { email, password })
    const { access, refresh, user } = res.data.data
    localStorage.setItem('access_token', access)
    localStorage.setItem('refresh_token', refresh)
    localStorage.setItem('user', JSON.stringify(user))
    return res.data.data
  },

  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    localStorage.removeItem('portfolio_id')
    localStorage.removeItem('admin_own_portfolio_id')
    localStorage.removeItem('admin_view_as')
  },

  getUser: () => {
    const user = localStorage.getItem('user')
    return user ? JSON.parse(user) : null
  },

  isLoggedIn: () => !!localStorage.getItem('access_token'),
}