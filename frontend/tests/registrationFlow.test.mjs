import assert from 'node:assert/strict'
import test from 'node:test'

import { readPortfolioCapitalDraft, savePortfolioCapitalDraft } from '../src/utils/portfolioCapitalStorage.ts'
import { registerAndInitializeUser } from '../src/utils/registrationFlow.ts'
import { clearAuthSessionIfGenerationMatches, clearAuthSessionStorage, saveAuthSession } from '../src/utils/authSessionStorage.ts'

const user = { id: 'registered-user', email: 'new@example.test', full_name: 'New User', role: 'USER', modules: [] }
const capital = { startingCapital: 800000, worstCaseCapital: 560000 }

function installMemoryStorage() {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  }
}

function dependencies(overrides = {}) {
  let sessionGeneration = 'test-session-generation'
  return {
    register: async () => ({ data: { access: 'register-access-secret', refresh: 'register-refresh-secret', user } }),
    login: async () => {
      sessionGeneration = await saveAuthSession('login-access-secret', 'login-refresh-secret', user)
      return { access: 'login-access-secret', refresh: 'login-refresh-secret', sessionGeneration }
    },
    getMe: async () => ({ user, sessionGeneration }),
    initializeUser: async () => true,
    logoutIfSessionMatches: clearAuthSessionIfGenerationMatches,
    ...overrides,
  }
}

test('registration capital is saved before a failed login and scoped to the registered user', async () => {
  installMemoryStorage()
  const deps = dependencies({
    login: async () => {
      assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
      throw new Error('login unavailable')
    },
  })

  await assert.rejects(registerAndInitializeUser(deps, { email: user.email, password: 'secret', fullName: user.full_name }, capital))
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
  assert.deepEqual(localStorage.keys(), [`pending_portfolio_capital_${user.id}`])
  assert.equal(readPortfolioCapitalDraft('some-other-user'), null)
})

test('registration capital remains saved when the current-user request fails', async () => {
  installMemoryStorage()
  const deps = dependencies({
    getMe: async () => {
      assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
      throw new Error('profile unavailable')
    },
  })

  await assert.rejects(registerAndInitializeUser(deps, { email: user.email, password: 'secret', fullName: user.full_name }, capital))
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
})

test('successful registration initializes the matching user after saving the draft', async () => {
  installMemoryStorage()
  const calls = []
  let sessionGeneration
  const deps = dependencies({
    register: async () => { calls.push('register'); return { data: { user } } },
    login: async () => {
      calls.push('login')
      sessionGeneration = await saveAuthSession('login-access-secret', 'login-refresh-secret', user)
      return { sessionGeneration }
    },
    getMe: async () => { calls.push('me'); return { user, sessionGeneration } },
    initializeUser: async (initializedUser, initializedCapital, generation) => {
      calls.push('initialize')
      assert.equal(initializedUser.id, user.id)
      assert.deepEqual(initializedCapital, capital)
      assert.equal(generation, sessionGeneration)
      assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
      return true
    },
  })

  const result = await registerAndInitializeUser(deps, { email: user.email, password: 'secret', fullName: user.full_name }, capital)
  assert.equal(result.id, user.id)
  assert.deepEqual(calls, ['register', 'login', 'me', 'initialize'])
})

test('explicit zero capital values are persisted and initialized', async () => {
  installMemoryStorage()
  const zeroCapital = { startingCapital: 0, worstCaseCapital: 0 }
  let initialized = false
  const deps = dependencies({
    initializeUser: async (_initializedUser, initializedCapital) => {
      initialized = true
      assert.deepEqual(initializedCapital, zeroCapital)
      return true
    },
  })

  await registerAndInitializeUser(deps, { email: user.email, password: 'secret', fullName: user.full_name }, zeroCapital)
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '0', worstCaseCapital: '0' })
  assert.equal(initialized, true)
})

test('a failed or mismatched registration never stores capital under another user ID', async () => {
  installMemoryStorage()
  await assert.rejects(registerAndInitializeUser(
    dependencies({ register: async () => { throw new Error('registration rejected') } }),
    { email: user.email, password: 'secret', fullName: user.full_name },
    capital,
  ))
  assert.deepEqual(localStorage.keys(), [])

  await assert.rejects(registerAndInitializeUser(
    dependencies({ getMe: async () => ({ user: { ...user, id: 'different-user' }, sessionGeneration: 'test-session-generation' }) }),
    { email: user.email, password: 'secret', fullName: user.full_name },
    capital,
  ), /did not match/)
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
  assert.equal(readPortfolioCapitalDraft('different-user'), null)
})

test('/me/ mismatch clears the current mismatched session, keeps the signup draft, and skips initialization', async () => {
  installMemoryStorage()
  let initialized = false
  const deps = dependencies({
    login: async () => {
      const sessionGeneration = await saveAuthSession('wrong-user-access', 'wrong-user-refresh', { id: 'wrong-user' })
      return { access: 'wrong-user-access', refresh: 'wrong-user-refresh', sessionGeneration }
    },
    getMe: async () => ({ user: { ...user, id: 'wrong-user' }, sessionGeneration: 'wrong-user-session' }),
    initializeUser: async () => { initialized = true },
  })

  await assert.rejects(
    registerAndInitializeUser(deps, { email: user.email, password: 'secret', fullName: user.full_name }, capital),
    /did not match/,
  )
  assert.equal(localStorage.getItem('access_token'), null)
  assert.equal(localStorage.getItem('refresh_token'), null)
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
  assert.equal(initialized, false)
})

test('/me/ mismatch leaves a newer shared session untouched', async () => {
  installMemoryStorage()
  const deps = dependencies({
    getMe: async () => {
      await saveAuthSession('new-session-access', 'new-session-refresh', { id: 'new-session' })
      return { user: { ...user, id: 'wrong-user' }, sessionGeneration: 'old-session-generation' }
    },
  })

  await assert.rejects(
    registerAndInitializeUser(deps, { email: user.email, password: 'secret', fullName: user.full_name }, capital),
    /did not match/,
  )
  assert.equal(localStorage.getItem('access_token'), 'new-session-access')
  assert.equal(localStorage.getItem('refresh_token'), 'new-session-refresh')
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
})

test('session cleanup after an authentication failure preserves the capital draft', async () => {
  installMemoryStorage()
  localStorage.setItem('access_token', 'expired-access')
  localStorage.setItem('refresh_token', 'expired-refresh')
  localStorage.setItem('user', JSON.stringify(user))
  localStorage.setItem('unrelated_preference', 'dark')
  // Mirrors the existing API client's failed-refresh cleanup path.
  savePortfolioCapitalDraft(user.id, { startingCapital: '800000', worstCaseCapital: '560000' })
  await clearAuthSessionStorage()

  assert.equal(localStorage.getItem('access_token'), null)
  assert.equal(localStorage.getItem('refresh_token'), null)
  assert.equal(localStorage.getItem('unrelated_preference'), 'dark')
  assert.deepEqual(readPortfolioCapitalDraft(user.id), { startingCapital: '800000', worstCaseCapital: '560000' })
})
