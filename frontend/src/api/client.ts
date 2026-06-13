import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const client = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

const PUBLIC_PATHS = ['/auth/login/', '/auth/register/', '/auth/token/refresh/']

client.interceptors.request.use((config) => {
  const isPublicEndpoint = PUBLIC_PATHS.some(p => config.url?.startsWith(p))
  if (!isPublicEndpoint) {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const isPublicEndpoint = PUBLIC_PATHS.some(p => original?.url?.startsWith(p))
    if (error.response?.status === 401 && !original._retry && !isPublicEndpoint) {
      original._retry = true
      try {
        const refresh = localStorage.getItem('refresh_token')
        const res = await axios.post(
          `${API_BASE}/auth/token/refresh/`,
          { refresh }
        )
        const newToken = res.data.data?.access ?? res.data.access
        localStorage.setItem('access_token', newToken)
        original.headers.Authorization = `Bearer ${newToken}`
        return client(original)
      } catch {
        localStorage.clear()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default client