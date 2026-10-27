import { Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import type { ModuleCode } from '../../types'
import { getAvailableModuleChoices, getDefaultModuleRoute } from '../../utils/moduleRouting'

const cardClass = 'rounded-xl border border-surface-border bg-white p-6 text-left shadow-sm transition hover:border-brand hover:shadow-md'

export function HomeRedirect() {
  const user = useAuthStore((state) => state.user)
  return user ? <Navigate to={getDefaultModuleRoute(user)} replace /> : <Navigate to="/login" replace />
}

export function ModuleSwitcher() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  if (!user) return <Navigate to="/login" replace />
  const modules = user.modules ?? []
  const choices = getAvailableModuleChoices(modules)
  if (choices.length < 2) return <Navigate to={getDefaultModuleRoute(user)} replace />

  return (
    <main className="min-h-screen bg-surface-page px-6 py-16">
      <section className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-muted">Your applications</p>
        <h1 className="mt-2 font-display text-3xl font-bold text-neutral-primary">Choose a workspace</h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {choices.map((choice) => (
            <button key={choice.code} className={cardClass} onClick={() => navigate(choice.path)}>
              <span className="font-display text-xl font-bold text-neutral-primary">{choice.label}</span>
              <span className="mt-2 block text-sm text-neutral-muted">
                {choice.code === 'tradedesk'
                  ? 'Trading journal, SIP and mutual fund tools'
                  : 'Personal wealth workspace'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </main>
  )
}

export function AccessRequired() {
  const user = useAuthStore((state) => state.user)
  if (!user) return <Navigate to="/login" replace />

  return (
    <main className="min-h-screen bg-surface-page px-6 py-16">
      <section className="mx-auto max-w-xl rounded-xl border border-surface-border bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-bold text-neutral-primary">Access required</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-muted">
          Your account does not currently have access to an application. Ask an administrator to grant access.
        </p>
      </section>
    </main>
  )
}

export function ModuleAccessDenied({ module }: { module: ModuleCode }) {
  const user = useAuthStore((state) => state.user)
  const moduleName = module === 'wealth' ? 'WealthOnCruise' : 'TradeDesk'
  if (!user) return <Navigate to="/login" replace />
  if (user.modules.length === 0) return <Navigate to="/access" replace />

  return (
    <main className="min-h-screen bg-surface-page px-6 py-16">
      <section className="mx-auto max-w-xl rounded-xl border border-surface-border bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl font-bold text-neutral-primary">You don’t have access</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-muted">
          This account has not been granted access to {moduleName}. Contact an administrator if you need it.
        </p>
      </section>
    </main>
  )
}
