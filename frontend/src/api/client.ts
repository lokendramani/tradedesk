import axios, { type InternalAxiosRequestConfig } from 'axios'
import { getAuthSessionSnapshot } from '../utils/authSessionStorage'
import { refreshSessionForGeneration } from '../utils/authSessionRefresh'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

const PUBLIC_PATHS = ['/auth/login/', '/auth/register/', '/auth/token/refresh/']

type SessionAwareConfig = InternalAxiosRequestConfig & {
  authSessionGeneration?: string
  _retry?: boolean
}

client.interceptors.request.use(async (config) => {
  const isPublicEndpoint = PUBLIC_PATHS.some(p => config.url?.startsWith(p))
  if (!isPublicEndpoint) {
    const session = await getAuthSessionSnapshot()
    if (session.accessToken) {
      config.headers.Authorization = `Bearer ${session.accessToken}`
      const sessionConfig = config as SessionAwareConfig
      sessionConfig.authSessionGeneration = session.generation ?? undefined
    }
  }
  return config
})

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as SessionAwareConfig | undefined
    const isPublicEndpoint = PUBLIC_PATHS.some(p => original?.url?.startsWith(p))
    if (error.response?.status === 401 && original && !original._retry && !isPublicEndpoint) {
      original._retry = true
      const generation = original.authSessionGeneration
      if (!generation) return Promise.reject(error)
      try {
        const result = await refreshSessionForGeneration(generation, async (refreshToken) => {
          const res = await axios.post(`${API_BASE}/auth/token/refresh/`, { refresh: refreshToken })
          return res.data.data?.access ?? res.data.access
        })
        if (result.status === 'refreshed') {
          original.headers.Authorization = `Bearer ${result.accessToken}`
          return client(original)
        }
        if (result.status === 'failed' && result.sessionCleared) {
          window.location.href = '/login'
        }
      } catch {
        // A lock/storage failure must not fall back to an unguarded session clear.
      }
    }
    return Promise.reject(error)
  }
)

export default client
