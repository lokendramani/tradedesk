export interface PortfolioCapitalDraft {
  startingCapital: string
  worstCaseCapital: string
}

const storageKey = (userId: string) => `pending_portfolio_capital_${userId}`

export function readPortfolioCapitalDraft(userId: string): PortfolioCapitalDraft | null {
  try {
    const value = localStorage.getItem(storageKey(userId))
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<Record<keyof PortfolioCapitalDraft, unknown>>
    if (
      (typeof parsed.startingCapital !== 'string' && typeof parsed.startingCapital !== 'number') ||
      (typeof parsed.worstCaseCapital !== 'string' && typeof parsed.worstCaseCapital !== 'number')
    ) return null
    return {
      startingCapital: String(parsed.startingCapital),
      worstCaseCapital: String(parsed.worstCaseCapital),
    }
  } catch {
    return null
  }
}

export function savePortfolioCapitalDraft(userId: string, draft: PortfolioCapitalDraft): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(draft))
}

export function clearPortfolioCapitalDraft(userId: string): void {
  localStorage.removeItem(storageKey(userId))
}

export function parsePortfolioCapitalDraft(draft: PortfolioCapitalDraft | null) {
  if (!draft || draft.startingCapital.trim() === '' || draft.worstCaseCapital.trim() === '') return null
  const startingCapital = Number(draft.startingCapital)
  const worstCaseCapital = Number(draft.worstCaseCapital)
  if (
    !Number.isFinite(startingCapital) || startingCapital < 0 ||
    !Number.isFinite(worstCaseCapital) || worstCaseCapital < 0
  ) return null
  return { startingCapital, worstCaseCapital }
}
