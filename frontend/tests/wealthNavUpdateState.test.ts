import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canTriggerWealthNAVUpdate,
  getWealthNAVUIStatus,
  type WealthNAVRunState,
} from '../src/utils/wealthNavUpdateState.ts'

const staleAfterSeconds = 1800

test('fresh RUNNING update remains active and cannot be retriggered', () => {
  const run: WealthNAVRunState = { status: 'RUNNING', run_age_seconds: 120 }
  const status = getWealthNAVUIStatus(run, staleAfterSeconds)

  assert.equal(status, 'RUNNING')
  assert.equal(canTriggerWealthNAVUpdate(true, false, status), false)
})

test('stale RUNNING update displays expired and allows an Admin retry', () => {
  const run: WealthNAVRunState = { status: 'RUNNING', run_age_seconds: 1800 }
  const status = getWealthNAVUIStatus(run, staleAfterSeconds, 0.01)

  assert.equal(status, 'STALE')
  assert.equal(canTriggerWealthNAVUpdate(true, false, status), true)
  assert.equal(canTriggerWealthNAVUpdate(true, true, status), false)
  assert.equal(canTriggerWealthNAVUpdate(false, false, status), false)
})

test('stale status transitions to retryable after the remaining lease time elapses', () => {
  const run: WealthNAVRunState = { status: 'RUNNING', run_age_seconds: 1799 }
  assert.equal(getWealthNAVUIStatus(run, staleAfterSeconds, 0), 'RUNNING')
  const expired = getWealthNAVUIStatus(run, staleAfterSeconds, 2)
  assert.equal(expired, 'STALE')
  assert.equal(canTriggerWealthNAVUpdate(true, false, expired), true)
})

test('completed update states are displayed and allow a later trigger', () => {
  for (const status of ['SUCCESS', 'PARTIAL', 'FAILED'] as const) {
    const uiStatus = getWealthNAVUIStatus({ status, run_age_seconds: 2000 }, staleAfterSeconds)
    assert.equal(uiStatus, status)
    assert.equal(canTriggerWealthNAVUpdate(true, false, uiStatus), true)
  }
})
