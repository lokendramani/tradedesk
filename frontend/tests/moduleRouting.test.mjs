import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAvailableModuleChoices,
  getDefaultModuleRoute,
  getTradePathRedirect,
  initializeIfModuleGranted,
} from '../src/utils/moduleRouting.ts'

const user = (modules) => ({ modules })

test('routes each supported module grant state to the expected destination', () => {
  assert.equal(getDefaultModuleRoute(user(['tradedesk'])), '/dashboard')
  assert.equal(getDefaultModuleRoute(user(['wealth'])), '/wealth')
  assert.equal(getDefaultModuleRoute(user(['tradedesk', 'wealth'])), '/modules')
  assert.equal(getDefaultModuleRoute(user([])), '/access')
  assert.deepEqual(getAvailableModuleChoices(['tradedesk']).map(({ code }) => code), ['tradedesk'])
  assert.deepEqual(getAvailableModuleChoices(['wealth']).map(({ code }) => code), ['wealth'])
  assert.deepEqual(
    getAvailableModuleChoices(['tradedesk', 'wealth']).map(({ code }) => code),
    ['tradedesk', 'wealth'],
  )
  assert.deepEqual(getAvailableModuleChoices([]), [])
})

test('switcher choices require an exact known module grant', () => {
  const choices = getAvailableModuleChoices(['tradedesk', 'research'])
  assert.deepEqual(choices.map(({ code }) => code), ['tradedesk'])
  assert.equal(choices.some(({ code }) => code === 'wealth'), false)
})

test('legacy TradeDesk aliases preserve deep paths, query, and hash', () => {
  assert.deepEqual(getTradePathRedirect('/trade'), {
    pathname: '/dashboard', search: '', hash: '',
  })
  assert.deepEqual(getTradePathRedirect('/trade/sip/holdings', '?sort=desc', '#table'), {
    pathname: '/sip/holdings', search: '?sort=desc', hash: '#table',
  })
})

test('no-module initialization skips TradeDesk portfolio API work', async () => {
  let portfolioRequests = 0
  const initialized = await initializeIfModuleGranted([], 'tradedesk', async () => {
    portfolioRequests += 1 // Represents the list/create work kept inside authStore's guarded callback.
  })

  assert.equal(initialized, false)
  assert.equal(portfolioRequests, 0)
})
