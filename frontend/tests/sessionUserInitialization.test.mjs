import assert from 'node:assert/strict'
import test from 'node:test'

import { clearAuthSessionStorage, saveAuthSession } from '../src/utils/authSessionStorage.ts'
import {
  fetchUserForActiveSession,
  loadAndInitializeUser,
  StaleAuthSessionResponseError,
} from '../src/utils/sessionUserInitialization.ts'

function installMemoryStorage() {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

const userA = { id: 'user-a', email: 'a@example.test', full_name: 'User A', role: 'USER', modules: ['tradedesk'] }
const userB = { id: 'user-b', email: 'b@example.test', full_name: 'User B', role: 'USER', modules: ['tradedesk'] }

test('a delayed /me response cannot persist or initialize a user after the session switches', async () => {
  installMemoryStorage()
  await clearAuthSessionStorage()
  await saveAuthSession('a-access', 'a-refresh', userA)

  let finishRequest
  const responsePending = new Promise((resolve) => { finishRequest = resolve })
  const initializationCalls = []
  const loading = loadAndInitializeUser(
    () => fetchUserForActiveSession(() => responsePending),
    async (user, generation) => {
      initializationCalls.push({ user, generation })
      return true
    },
  )

  await new Promise((resolve) => setTimeout(resolve, 0))
  await saveAuthSession('b-access', 'b-refresh', userB)
  localStorage.setItem('portfolio_id', 'portfolio-b')
  finishRequest(userA)

  await assert.rejects(loading, StaleAuthSessionResponseError)
  assert.deepEqual(JSON.parse(localStorage.getItem('user')), userB)
  assert.equal(localStorage.getItem('portfolio_id'), 'portfolio-b')
  assert.deepEqual(initializationCalls, [])
})

test('a same-generation /me response persists the user and reaches initialization', async () => {
  installMemoryStorage()
  await clearAuthSessionStorage()
  const generation = await saveAuthSession('a-access', 'a-refresh', { id: userA.id })
  const initialized = []

  const result = await loadAndInitializeUser(
    () => fetchUserForActiveSession(async () => userA),
    async (user, sessionGeneration) => {
      initialized.push({ user, sessionGeneration })
      return true
    },
  )

  assert.equal(result, true)
  assert.deepEqual(JSON.parse(localStorage.getItem('user')), userA)
  assert.deepEqual(initialized, [{ user: userA, sessionGeneration: generation }])
})
