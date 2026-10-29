export type FireGoalKind = 'Lean FIRE' | 'Fat FIRE'

export interface MilestoneDraft {
  name: string
  presentAmount: string
  targetYear: string
  inflationRate: string
  expectedReturnRate: string
}

export interface MilestoneProjection {
  yearsRemaining: number | null
  futureAmount: number | null
  requiredMonthlySip: number | null
}

export function roundRupees(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateMilestoneProjection(
  draft: MilestoneDraft,
  currentYear: number,
): MilestoneProjection {
  const presentAmount = Number(draft.presentAmount)
  const targetYear = Number(draft.targetYear)
  const inflationRate = Number(draft.inflationRate)
  const expectedReturnRate = Number(draft.expectedReturnRate)
  const hasInputs = [presentAmount, targetYear, inflationRate, expectedReturnRate].every(Number.isFinite)

  if (!hasInputs || !draft.targetYear) {
    return { yearsRemaining: null, futureAmount: null, requiredMonthlySip: null }
  }

  const yearsRemaining = targetYear - currentYear
  if (yearsRemaining <= 0 || presentAmount <= 0 || inflationRate < 0 || inflationRate > 100 || expectedReturnRate < 0 || expectedReturnRate > 100) {
    return { yearsRemaining, futureAmount: null, requiredMonthlySip: null }
  }

  const exactFutureAmount = presentAmount * (1 + inflationRate / 100) ** yearsRemaining
  const futureAmount = roundRupees(exactFutureAmount)
  const months = yearsRemaining * 12
  const monthlyRate = expectedReturnRate / 100 / 12
  const futureValueFactor = monthlyRate === 0
    ? months
    : (((1 + monthlyRate) ** months - 1) / monthlyRate) * (1 + monthlyRate)

  return {
    yearsRemaining,
    futureAmount,
    requiredMonthlySip: roundRupees(exactFutureAmount / futureValueFactor),
  }
}

export function calculateFireEstimates(monthlyExpenses: number | string) {
  const monthly = Number(monthlyExpenses)
  if (!Number.isFinite(monthly) || monthly <= 0) {
    return { annualExpense: 0, leanCorpus: 0, fatCorpus: 0 }
  }

  const annualExpense = roundRupees(monthly * 12)
  return {
    annualExpense,
    leanCorpus: roundRupees(annualExpense * 25),
    fatCorpus: roundRupees(annualExpense * 30),
  }
}

export function createFireMilestoneDraft(kind: FireGoalKind, corpus: number): MilestoneDraft {
  return {
    name: kind,
    presentAmount: roundRupees(corpus).toFixed(2),
    targetYear: '',
    inflationRate: '7.00',
    expectedReturnRate: '12.00',
  }
}

export function compareMonthlySurplus(requiredSip: number, surplus: number) {
  const difference = roundRupees(requiredSip - surplus)
  return {
    surplus: roundRupees(surplus),
    difference,
    covered: difference <= 0,
  }
}
