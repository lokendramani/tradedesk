export interface User {
  id: string
  email: string
  full_name: string
  role: string
}

export interface AuthResponse {
  access: string
  refresh: string
  user: User
}

export interface Portfolio {
  id: string
  name: string
  type: string
  starting_capital: number
  worst_case_capital: number
  currency: string
  created_at: string
}

export interface Trade {
  id: string
  scrip_name: string
  segment: string
  direction: string
  legs: number | null
  entry_date: string
  entry_price: number
  quantity: number
  stop_loss: number | null
  target: number | null
  initial_risk: number | null
  close_date: string | null
  close_price: number | null
  gross_pl: number | null
  charges: number | null
  net_income: number | null
  risk_reward: number | null
  notes: string
  is_closed: boolean
  created_at: string
}

export interface Stats {
  total_trades: number
  closed_trades: number
  open_trades: number
  trade_in_profit: number
  trade_in_loss: number
  total_net_income: string
  total_gross_pl: string
  avg_profit: string
  avg_loss: string
  avg_per_trade: string
  win_rate: string
  actual_rr: string
  breakeven_accuracy: string
  current_capital: string | null
  starting_capital: string
  worst_case_capital: string
}

export interface EquityPoint {
  date: string
  capital: string
}

export interface MonthlyPnl {
  month: string
  net_income: string
}

export interface TradeFilter {
  segment?: string
  direction?: string
  only_open?: boolean
  only_closed?: boolean
  only_profit?: boolean
  only_loss?: boolean
  search?: string
}