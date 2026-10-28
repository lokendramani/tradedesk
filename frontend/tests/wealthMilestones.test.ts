import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateFireEstimates,
  calculateMilestoneProjection,
  compareMonthlySurplus,
  createFireMilestoneDraft,
  type MilestoneDraft,
} from '../src/utils/wealthMilestones.ts'

const draft: MilestoneDraft = {
  name: 'Home purchase',
  presentAmount: '100000.00',
  targetYear: '2031',
  inflationRate: '7.00',
  expectedReturnRate: '12.00',
}

test('inflation projection and years remaining use the current application year', () => {
  const projection = calculateMilestoneProjection(draft, 2026)

  assert.equal(projection.yearsRemaining, 5)
  assert.equal(projection.futureAmount, 140255.17)
  assert.equal(calculateMilestoneProjection(draft, 2027).yearsRemaining, 4)
})

test('SIP projection follows the beginning-of-month formula at 12% and changed returns', () => {
  assert.equal(calculateMilestoneProjection(draft, 2026).requiredMonthlySip, 1700.34)
  assert.equal(
    calculateMilestoneProjection({ ...draft, expectedReturnRate: '8.00' }, 2026).requiredMonthlySip,
    1896.19,
  )
})

test('zero return divides the future amount evenly over the remaining months', () => {
  assert.equal(
    calculateMilestoneProjection({ ...draft, expectedReturnRate: '0.00' }, 2026).requiredMonthlySip,
    2337.59,
  )
})

test('FIRE estimates use annual expense and 25x/30x corpus multiples', () => {
  assert.deepEqual(calculateFireEstimates(100000), {
    annualExpense: 1200000,
    leanCorpus: 30000000,
    fatCorpus: 36000000,
  })
})

test('FIRE estimate prefill opens a regular goal draft and leaves target year for the user', () => {
  assert.deepEqual(createFireMilestoneDraft('Lean FIRE', 30000000), {
    name: 'Lean FIRE',
    presentAmount: '30000000.00',
    targetYear: '',
    inflationRate: '7.00',
    expectedReturnRate: '12.00',
  })
})

test('monthly surplus comparison reports uncovered SIP gap or remaining surplus', () => {
  assert.deepEqual(compareMonthlySurplus(20000, 15000), {
    surplus: 15000,
    difference: 5000,
    covered: false,
  })
  assert.deepEqual(compareMonthlySurplus(20000, 30000), {
    surplus: 30000,
    difference: -10000,
    covered: true,
  })
})
