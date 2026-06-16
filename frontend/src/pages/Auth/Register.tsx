import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi } from '../../api/auth'
import { useAuthStore } from '../../store/authStore'
import { portfolioApi } from '../../api/portfolio'
import { extractErrorMessage } from '../../utils/format'

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a9.97 9.97 0 012.71-4.258M6.16 6.16A9.97 9.97 0 0112 5c4.477 0 8.268 2.943 9.542 7a9.97 9.97 0 01-1.357 2.686M6.16 6.16L3 3m3.16 3.16l11.68 11.68M15 12a3 3 0 00-3-3m0 0a3 3 0 00-2.83 2M12 9l3 3" />
    </svg>
  )
}

export default function Register() {
  const navigate = useNavigate()
  const { setUser, setPortfolioId } = useAuthStore()

  const [fullName,        setFullName]        = useState('')
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [capital,         setCapital]         = useState('')
  const [worstCase,       setWorstCase]       = useState('')
  const [error,           setError]           = useState('')
  const [loading,         setLoading]         = useState(false)
  const [showPassword,    setShowPassword]    = useState(false)
  const [showConfirm,     setShowConfirm]     = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const data = await authApi.register(email, password, fullName)
      setUser(data.data.user)

      await authApi.login(email, password)

      const p = await portfolioApi.create({
        name: 'My Trading Journal',
        type: 'TRADING',
        starting_capital:   parseFloat(capital)   || 0,
        worst_case_capital: parseFloat(worstCase) || 0,
      })
      setPortfolioId(p.id)
      navigate('/dashboard')
    } catch (err: unknown) {
      const ax = err as { response?: { data?: unknown } }
      setError(extractErrorMessage(ax.response?.data) || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = `w-full bg-white border border-surface-border rounded-lg px-4 py-3 text-sm text-neutral-primary
    placeholder-neutral-muted focus:outline-none focus:border-brand transition-colors`

  return (
    <div className="min-h-screen bg-surface-page flex items-center justify-center py-10">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-neutral-primary">
            Trade<span className="text-brand">Desk</span>
          </h1>
          <p className="text-neutral-muted text-sm mt-2">Create your account</p>
        </div>

        <div className="bg-white border border-surface-border rounded-xl p-8 shadow-sm">
          <h2 className="text-lg font-display font-semibold text-neutral-primary mb-6">Register</h2>

          {error && (
            <div className="bg-loss-bg border border-loss-border text-loss-text text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Full Name</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
                required className={inputClass} placeholder="Your full name" />
            </div>

            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                required className={inputClass} placeholder="you@email.com" />
            </div>

            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required className={`${inputClass} pr-11`} placeholder="••••••" />
                <button type="button" onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-muted hover:text-neutral-primary transition-colors"
                  tabIndex={-1}>
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Confirm Password</label>
              <div className="relative">
                <input type={showConfirm ? 'text' : 'password'} value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required className={`${inputClass} pr-11`} placeholder="••••••" />
                <button type="button" onClick={() => setShowConfirm((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-muted hover:text-neutral-primary transition-colors"
                  tabIndex={-1}>
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Starting Capital ₹</label>
              <input type="number" value={capital} onChange={(e) => setCapital(e.target.value)}
                className={`${inputClass} font-mono`} placeholder="800000" />
            </div>

            <div>
              <label className="block text-xs text-neutral-muted uppercase tracking-wider mb-1">Worst Case ₹</label>
              <input type="number" value={worstCase} onChange={(e) => setWorstCase(e.target.value)}
                className={`${inputClass} font-mono`} placeholder="560000" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-brand/90 text-white font-semibold rounded-lg py-3 text-sm transition-colors disabled:opacity-50 mt-2">
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-neutral-muted mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-brand hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
