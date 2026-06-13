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

// ── SIP Journal types ────────────────────────────────────────────────────────

export interface SIPTrade {
  id: string
  trade_date: string
  etf_name: string
  asset_class: string
  ticker: string
  qty: number
  price: number
  trade_value: number
  exit_date?: string | null
  exit_price?: number | null
  exit_value?: number | null
  pl?: number | null
  notes?: string
}

export interface SIPHolding {
  ticker: string
  etf_name: string
  asset_class: string
  qty: number
  avg_price: number
  invested: number
  cmp: number | null
  current_value: number | null
  pl: number | null
  pl_pct: number | null
  price_stale: boolean
}

export interface SIPHoldingsResponse {
  holdings: SIPHolding[]
  total_invested: number
  total_current: number | null
  has_stale_prices: boolean
}

export interface SIPBookedTicker {
  ticker: string
  etf_name: string
  booked_pl: number
  trade_count: number
}

export interface SIPWeekPoint {
  week: string
  cumulative_fresh: number
  portfolio_value: number | null
}

export interface SIPSummary {
  fresh_invested: number
  portfolio_value: number
  unrealised_pl: number
  booked_pl: number
  your_xirr: number | null
  n50_xirr: number | null
  n500_xirr: number | null
  alpha_n50: number | null
  alpha_n500: number | null
  has_stale_prices: boolean
  benchmark_missing_weeks: number
}

export interface SIPDashboard {
  summary: SIPSummary
  active_holdings: SIPHolding[]
  booked_pl_by_ticker: SIPBookedTicker[]
  weekly_chart_data: SIPWeekPoint[]
}

export interface SIPBookedSummary {
  ticker: string
  etf_name: string
  asset_class: string
  trade_count: number
  total_qty: number
  total_invested: number
  total_exit_value: number
  booked_pl: number
  return_pct: number
}

export interface SIPBookedTrade {
  id: string
  ticker: string
  etf_name: string
  asset_class: string
  trade_date: string
  exit_date: string
  hold_days: number | null
  qty: number
  buy_price: number
  trade_value: number
  exit_price: number | null
  exit_value: number | null
  pl: number | null
  return_pct: number | null
}

export interface SIPBookedPLResponse {
  summary: SIPBookedSummary[]
  trades: SIPBookedTrade[]
  total_invested: number
  total_exit_value: number
  total_pl: number
  total_return_pct: number
}

export interface SIPUploadResult {
  imported: number
  duplicates_skipped: number
  errors: string[]
}

export interface SIPETFMaster {
  ticker: string
  etf_name: string
  asset_class: string
}