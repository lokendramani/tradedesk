import assert from 'node:assert/strict'
import test from 'node:test'

import { getInitialPortfolioData } from '../src/utils/portfolioInitialization.ts'
import {
  clearPortfolioCapitalDraft,
  parsePortfolioCapitalDraft,
  readPortfolioCapitalDraft,
  savePortfolioCapitalDraft,
} from '../src/utils/portfolioCapitalStorage.ts'
import { getPortfolioRootState, resolvePortfolio } from '../src/utils/portfolioSetup.ts'

const portfolio = (id) => ({
  id,
  name: 'My Trading Journal',
  type: 'TRADING',
  starting_capital: 800000,
  worst_case_capital: 560000,
  currency: 'INR',
  created_at: '2026-01-01T00:00:00Z',
})

const installMemoryStorage = () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

test('portfolio setup does not invent zero capital when no values were supplied', () => {
  assert.equal(getInitialPortfolioData(null), null)
})

test('portfolio setup preserves the registration capital values', () => {
  assert.deepEqual(getInitialPortfolioData({ startingCapital: 800000, worstCaseCapital: 560000 }), {
    name: 'My Trading Journal',
    type: 'TRADING',
    starting_capital: 800000,
    worst_case_capital: 560000,
  })
})

test('an explicitly entered zero remains a valid capital value', () => {
  assert.deepEqual(getInitialPortfolioData({ startingCapital: 0, worstCaseCapital: 0 }), {
    name: 'My Trading Journal',
    type: 'TRADING',
    starting_capital: 0,
    worst_case_capital: 0,
  })
})

test('pending capital drafts restore after setup remount and stay isolated per user', () => {
  installMemoryStorage()
  savePortfolioCapitalDraft('user-a', { startingCapital: '123.45', worstCaseCapital: '0' })
  savePortfolioCapitalDraft('user-b', { startingCapital: '900', worstCaseCapital: '500' })

  // A second read models a fresh component instance after reload/relogin.
  assert.deepEqual(readPortfolioCapitalDraft('user-a'), { startingCapital: '123.45', worstCaseCapital: '0' })
  assert.deepEqual(readPortfolioCapitalDraft('user-b'), { startingCapital: '900', worstCaseCapital: '500' })
  clearPortfolioCapitalDraft('user-a')
  assert.equal(readPortfolioCapitalDraft('user-a'), null)
  assert.deepEqual(readPortfolioCapitalDraft('user-b'), { startingCapital: '900', worstCaseCapital: '500' })
})

test('portfolio lookup failure does not permit setup or a create request', async () => {
  let creates = 0
  const result = await resolvePortfolio({
    getAll: async () => { throw new Error('offline') },
    create: async () => { creates += 1; return portfolio('created') },
  }, 'user-a', { startingCapital: 10, worstCaseCapital: 5 })

  assert.equal(result.status, 'lookup-error')
  assert.equal(creates, 0)
  assert.equal(getPortfolioRootState('lookup-error', 'existing-id'), 'lookup-error')
  assert.notEqual(getPortfolioRootState('lookup-error', 'existing-id'), 'needs-setup')
})

test('a successful empty lookup permits setup, and existing portfolios are reused', async () => {
  let portfolios = []
  let creates = 0
  const api = {
    getAll: async () => portfolios,
    create: async (data) => {
      creates += 1
      const created = {
        ...portfolio(`created-${creates}`),
        starting_capital: data.starting_capital,
        worst_case_capital: data.worst_case_capital,
      }
      portfolios = [created]
      return created
    },
  }

  const empty = await resolvePortfolio(api, 'user-a', null)
  assert.equal(empty.status, 'setup-required')
  assert.equal(getPortfolioRootState('needs-setup', null), 'needs-setup')
  const created = await resolvePortfolio(api, 'user-a', { startingCapital: 25, worstCaseCapital: 10 })
  assert.equal(created.status, 'ready')
  assert.equal(creates, 1)
  const reused = await resolvePortfolio(api, 'user-a', { startingCapital: 999, worstCaseCapital: 1 })
  assert.equal(reused.status, 'ready')
  assert.equal(reused.created, false)
  assert.equal(reused.portfolio.id, created.portfolio.id)
  assert.equal(creates, 1)
})

test('an ambiguous create failure is reconciled before a retry can create again', async () => {
  let portfolios = []
  let creates = 0
  const api = {
    getAll: async () => portfolios,
    create: async (data) => {
      creates += 1
      portfolios = [{
        ...portfolio('created-once'),
        starting_capital: data.starting_capital,
        worst_case_capital: data.worst_case_capital,
      }]
      throw new Error('response lost after commit')
    },
  }

  const firstAttempt = await resolvePortfolio(api, 'user-a', { startingCapital: 800000, worstCaseCapital: 0 })
  assert.equal(firstAttempt.status, 'ready')
  assert.equal(firstAttempt.created, true)
  const retry = await resolvePortfolio(api, 'user-a', { startingCapital: 1, worstCaseCapital: 1 })
  assert.equal(retry.status, 'ready')
  assert.equal(retry.created, false)
  assert.equal(retry.portfolio.id, 'created-once')
  assert.equal(creates, 1)
})

test('pending draft parsing keeps explicit zero values valid', () => {
  assert.deepEqual(parsePortfolioCapitalDraft({ startingCapital: '0', worstCaseCapital: '0' }), {
    startingCapital: 0,
    worstCaseCapital: 0,
  })
})
