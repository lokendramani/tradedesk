import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { portfolioApi } from '../../api/portfolio'
import { useAuthStore } from '../../store/authStore'
import { extractErrorMessage } from '../../utils/format'
import { clearPortfolioCapitalDraft, parsePortfolioCapitalDraft, readPortfolioCapitalDraft, savePortfolioCapitalDraft } from '../../utils/portfolioCapitalStorage'
import { resolvePortfolio } from '../../utils/portfolioSetup'

export default function PortfolioSetup() {
  const user = useAuthStore((state) => state.user)
  const setPortfolioId = useAuthStore((state) => state.setPortfolioId)
  const setPortfolioLookupError = useAuthStore((state) => state.setPortfolioLookupError)
  const initializationError = useAuthStore((state) => state.portfolioInitializationError)
  const navigate = useNavigate()
  const [startingCapital, setStartingCapital] = useState(() => user ? readPortfolioCapitalDraft(user.id)?.startingCapital ?? '' : '')
  const [worstCaseCapital, setWorstCaseCapital] = useState(() => user ? readPortfolioCapitalDraft(user.id)?.worstCaseCapital ?? '' : '')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submitting = useRef(false)

  const persistDraft = (starting: string, worstCase: string) => {
    if (user) savePortfolioCapitalDraft(user.id, { startingCapital: starting, worstCaseCapital: worstCase })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    setError('')
    const capital = parsePortfolioCapitalDraft({ startingCapital, worstCaseCapital })
    if (!capital) {
      const starting = Number(startingCapital)
      const worstCase = Number(worstCaseCapital)
      if (!startingCapital || !Number.isFinite(starting) || starting < 0) {
        setError('Enter a valid starting capital of zero or more.')
        return
      }
      if (!worstCaseCapital || !Number.isFinite(worstCase) || worstCase < 0) {
        setError('Enter a valid worst-case capital of zero or more.')
        return
      }
      setError('Enter valid capital values.')
      return
    }
    if (!user) return

    persistDraft(startingCapital, worstCaseCapital)
    submitting.current = true
    setLoading(true)
    try {
      const result = await resolvePortfolio(portfolioApi, user.id, capital)
      if (result.status === 'ready') {
        if (result.created) clearPortfolioCapitalDraft(user.id)
        setPortfolioId(result.portfolio.id)
        navigate('/dashboard', { replace: true })
      } else if (result.status === 'lookup-error') {
        setPortfolioLookupError('Could not verify your portfolio. Your capital values are saved; retry the lookup before creating one.')
      } else {
        setError(extractErrorMessage(result.error) || 'Could not create your portfolio. Your capital values are saved; please retry.')
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: unknown } }
      setError(extractErrorMessage(ax.response?.data) || 'Could not create your portfolio. Your capital values are saved; please retry.')
    } finally {
      submitting.current = false
      setLoading(false)
    }
  }

  const inputClass = 'w-full rounded-lg border border-surface-border bg-white px-4 py-3 font-mono text-sm text-neutral-primary focus:border-brand focus:outline-none'

  return (
    <main className="min-h-screen bg-surface-page px-6 py-16">
      <section className="mx-auto max-w-xl rounded-xl border border-surface-border bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-muted">TradeDesk setup</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-neutral-primary">Set your portfolio capital</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-muted">
          Enter these values to create your trading portfolio. They are used in your capital and risk metrics.
        </p>
        {(error || initializationError) && <div role="alert" className="mt-5 rounded-lg border border-loss-border bg-loss-bg px-4 py-3 text-sm text-loss-text">{error || initializationError}</div>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="starting-capital" className="mb-1 block text-xs uppercase tracking-wider text-neutral-muted">Starting Capital ₹</label>
            <input id="starting-capital" type="number" min="0" step="0.01" required value={startingCapital}
              onChange={(event) => { setStartingCapital(event.target.value); persistDraft(event.target.value, worstCaseCapital) }} className={inputClass} />
          </div>
          <div>
            <label htmlFor="worst-case-capital" className="mb-1 block text-xs uppercase tracking-wider text-neutral-muted">Worst Case ₹</label>
            <input id="worst-case-capital" type="number" min="0" step="0.01" required value={worstCaseCapital}
              onChange={(event) => { setWorstCaseCapital(event.target.value); persistDraft(startingCapital, event.target.value) }} className={inputClass} />
          </div>
          <button type="submit" disabled={loading}
            className="w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand/90 disabled:opacity-50">
            {loading ? 'Saving portfolio...' : 'Continue to TradeDesk'}
          </button>
        </form>
      </section>
    </main>
  )
}
