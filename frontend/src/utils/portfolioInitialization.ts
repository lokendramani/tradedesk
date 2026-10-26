export interface PortfolioCapital {
  startingCapital: number
  worstCaseCapital: number
}

export function getInitialPortfolioData(capital: PortfolioCapital | null) {
  if (!capital) return null
  return {
    name: 'My Trading Journal',
    type: 'TRADING',
    starting_capital: capital.startingCapital,
    worst_case_capital: capital.worstCaseCapital,
  }
}
