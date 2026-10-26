import assert from 'node:assert/strict'
import test from 'node:test'

import { refreshSessionForGeneration } from '../src/utils/authSessionRefresh.ts'
import {
  getAuthSessionSnapshot,
  saveAuthSession,
} from '../src/utils/authSessionStorage.ts'
import { readPortfolioCapitalDraft, savePortfolioCapitalDraft } from '../src/utils/portfolioCapitalStorage.ts'

function installMemoryStorage() {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('a delayed failed refresh from an older generation cannot clear a newer login session', async () => {
  installMemoryStorage()
  const oldGeneration = await saveAuthSession('old-access', 'old-refresh', { id: 'old-user' })
  localStorage.setItem('portfolio_id', 'old-portfolio')
  savePortfolioCapitalDraft('new-user', { startingCapital: '0', worstCaseCapital: '12' })
  const response = deferred()
  let refreshStarted
  const started = new Promise((resolve) => { refreshStarted = resolve })

  const refresh = refreshSessionForGeneration(oldGeneration, (refreshToken) => {
    assert.equal(refreshToken, 'old-refresh')
    refreshStarted()
    return response.promise
  })
  await started

  await saveAuthSession('new-access', 'new-refresh', { id: 'new-user' })
  localStorage.setItem('portfolio_id', 'new-portfolio')
  response.reject(new Error('old refresh rejected'))
  const result = await refresh

  assert.deepEqual(result, { status: 'failed', error: result.error, sessionCleared: false })
  assert.equal(localStorage.getItem('access_token'), 'new-access')
  assert.equal(localStorage.getItem('refresh_token'), 'new-refresh')
  assert.equal(localStorage.getItem('portfolio_id'), 'new-portfolio')
  assert.deepEqual(JSON.parse(localStorage.getItem('user')), { id: 'new-user' })
  assert.deepEqual(readPortfolioCapitalDraft('new-user'), { startingCapital: '0', worstCaseCapital: '12' })
})

test('ordinary refresh failure clears only the active session and preserves drafts and preferences', async () => {
  installMemoryStorage()
  const generation = await saveAuthSession('expired-access', 'expired-refresh', { id: 'user-a' })
  localStorage.setItem('portfolio_id', 'portfolio-a')
  localStorage.setItem('ui_theme', 'dark')
  savePortfolioCapitalDraft('user-a', { startingCapital: '10', worstCaseCapital: '0' })

  const result = await refreshSessionForGeneration(generation, async () => {
    throw new Error('refresh rejected')
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.sessionCleared, true)
  assert.equal(localStorage.getItem('access_token'), null)
  assert.equal(localStorage.getItem('refresh_token'), null)
  assert.equal(localStorage.getItem('portfolio_id'), null)
  assert.equal(localStorage.getItem('ui_theme'), 'dark')
  assert.deepEqual(readPortfolioCapitalDraft('user-a'), { startingCapital: '10', worstCaseCapital: '0' })
})

test('successful refresh updates access token only for its still-active generation', async () => {
  installMemoryStorage()
  const generation = await saveAuthSession('old-access', 'active-refresh', { id: 'user-a' })

  const result = await refreshSessionForGeneration(generation, async (refreshToken) => {
    assert.equal(refreshToken, 'active-refresh')
    return 'new-access'
  })

  assert.deepEqual(result, { status: 'refreshed', accessToken: 'new-access' })
  assert.equal(localStorage.getItem('access_token'), 'new-access')
  assert.equal(localStorage.getItem('refresh_token'), 'active-refresh')
  assert.equal((await getAuthSessionSnapshot()).generation, generation)
})

test('a delayed successful refresh also cannot overwrite a newer login', async () => {
  installMemoryStorage()
  const oldGeneration = await saveAuthSession('old-access', 'old-refresh', { id: 'old-user' })
  const response = deferred()
  let refreshStarted
  const started = new Promise((resolve) => { refreshStarted = resolve })
  const refresh = refreshSessionForGeneration(oldGeneration, () => {
    refreshStarted()
    return response.promise
  })
  await started

  await saveAuthSession('new-access', 'new-refresh', { id: 'new-user' })
  response.resolve('late-old-access')
  assert.deepEqual(await refresh, { status: 'stale-session' })
  assert.equal(localStorage.getItem('access_token'), 'new-access')
  assert.equal(localStorage.getItem('refresh_token'), 'new-refresh')
})
