import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../store/authStore'
import { portfolioApi } from '../../api/portfolio'

export default function Login() {
  const navigate  = useNavigate()
  const { setUser, setPortfolioId } = useAuthStore()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await authApi.login(email, password)
      setUser(data.user)

      const portfolios = await portfolioApi.getAll()
      if (portfolios.length > 0) {
        setPortfolioId(portfolios[0].id)
      } else {
        const p = await portfolioApi.create({
          name: 'My Trading Journal',
          type: 'TRADING',
          starting_capital: 0,
          worst_case_capital: 0,
        })
        setPortfolioId(p.id)
      }
      navigate('/dashboard')
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } }; message?: string }
      const msg = ax.response?.data?.message
      setError(
        msg ||
          (ax.message?.includes('Network Error')
            ? 'Cannot reach API — check backend is running and CORS/proxy settings'
            : 'Invalid email or password')
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-neutral-primary">
            Trade<span className="text-brand">Desk</span>
          </h1>
          <p className="text-neutral-muted text-sm mt-2">Trading Journal</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-surface-border rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-display font-semibold text-neutral-primary mb-6">Sign In</h2>

          {error && (
            <div className="bg-loss-bg border border-loss-border text-loss-text text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-white border border-surface-border rounded-lg px-4 py-3 text-sm text-neutral-primary
                           placeholder-neutral-muted focus:outline-none focus:border-brand transition-colors"
                placeholder="you@email.com"
              />
            </div>

            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-white border border-surface-border rounded-lg px-4 py-3 text-sm text-neutral-primary
                           placeholder-neutral-muted focus:outline-none focus:border-brand transition-colors"
                placeholder="••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-50 mt-2"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="text-center text-sm text-neutral-muted mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-brand hover:underline">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
