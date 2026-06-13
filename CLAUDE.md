# TradersDesk — Project Reference

## Overview

TradersDesk is a personal trading journal and mutual-fund tracker. It is a
full-stack web app with a Django REST API backend and a React (Vite + TypeScript)
frontend. The app is multi-user but designed primarily for a single power-user
who trades equities, commodities, and F&O, and also holds mutual funds.

---

## Project Structure

```
tradersdesk/
├── backend/               Django REST API
│   ├── config/            Project settings, root URL conf, wsgi/asgi
│   ├── users/             Custom User model (email-based auth + roles)
│   ├── portfolio/         Portfolio model (per-user)
│   ├── trades/            Trade model + analytics + CSV/JSON import
│   ├── mf/                Mutual Fund module (CAS PDF import + dashboard)
│   ├── manage.py
│   ├── requirements.txt
│   └── .env               (git-ignored) — see Environment Variables below
│
└── frontend/              React + Vite + TypeScript SPA
    ├── src/
    │   ├── api/           Axios API modules (auth, trades, portfolio, mf, admin)
    │   ├── components/    Shared components (Layout with sidebar)
    │   ├── pages/         Route pages
    │   │   ├── Auth/      Login + Register
    │   │   ├── Dashboard/ Trading stats + charts
    │   │   ├── Trades/    Trade log + add/edit/close/import
    │   │   ├── Equity/    Equity curve chart
    │   │   ├── Segments/  Per-segment breakdown
    │   │   ├── MFDashboard/ MF portfolio + CAS import
    │   │   ├── Admin/     Admin panel (ADMIN role only)
    │   │   └── SIPJournal/
    │   │       ├── SIPTrades.tsx    raw trade table + CSV import
    │   │       ├── SIPHoldings.tsx  active holdings + 2 pie charts + FIFO sell
    │   │       ├── SIPBookedPL.tsx  booked P&L (ETF summary + trade detail)
    │   │       └── SIPJournal.tsx   summary dashboard (XIRR, chart, carry-forward)
    │   ├── store/         Zustand stores (authStore)
    │   ├── types/         Shared TypeScript interfaces
    │   └── utils/         Format helpers (formatCurrency, formatDate, etc.)
    ├── vite.config.ts     Dev server on :5173, proxies /api → :8000
    └── .env               (git-ignored)
```

---

## How to Run

### Backend

```bash
cd backend
# First time only:
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
python manage.py migrate

# Every time:
venv\Scripts\activate
python manage.py runserver     # → http://localhost:8000
```

Requires a `.env` file in `backend/` (see below).

### Frontend

```bash
cd frontend
npm install       # first time only
npm run dev       # → http://localhost:5173
```

The Vite dev server proxies all `/api/*` requests to `http://localhost:8000`,
so both servers must be running for the full app to work.

---

## Environment Variables

`backend/.env` (never committed):

```
SECRET_KEY=<django secret key>
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
DATABASE_URL=postgresql://user:password@host:5432/dbname
CORS_ALLOWED_ORIGINS=http://localhost:5173
JWT_ACCESS_TOKEN_LIFETIME_HOURS=24
JWT_REFRESH_TOKEN_LIFETIME_DAYS=7
TWELVE_DATA_API_KEY=          # optional — not used yet
```

The database is **Supabase PostgreSQL** (remote). `DATABASE_URL` uses
`sslmode=require` automatically. There is no local SQLite fallback.

---

## Backend Apps

### `users`
- Custom `User` model: email as username, `full_name`, `role` (USER | ADMIN),
  UUID primary key.
- JWT auth via `djangorestframework-simplejwt`. Tokens rotate on refresh.
- Endpoints under `/api/auth/`:
  - `POST /register/` — creates user, returns tokens
  - `POST /login/` — returns tokens
  - `POST /token/refresh/` — refresh access token
  - `GET  /me/` — current user info
  - `GET  /admin/users/` — all users list (ADMIN/staff only)

### `portfolio`
- `Portfolio` model: belongs to a user, has `starting_capital`,
  `worst_case_capital`, `type` (TRADING | ETF), `currency`.
- `GET/POST /api/portfolios/` — list/create
- `GET/PUT/DELETE /api/portfolios/<id>/` — detail
- `GET /api/portfolios/?user_id=<uuid>` — admin only: list a specific user's portfolios.
- Without `?user_id`, always scoped to the requesting user (even for admin).
- On first login the frontend auto-creates a default portfolio if none exists.

### `trades`
- `Trade` model: belongs to a `Portfolio`. Fields: `scrip_name`, `segment`
  (EQUITY | COMMODITY | F_AND_O), `direction` (LONG | SHORT), `entry_date`,
  `entry_price`, `quantity`, `stop_loss`, `target`, `close_date`,
  `close_price`, `gross_pl`, `charges`, `net_income`, `risk_reward`, `notes`.
- All calculated fields (`target`, `initial_risk`, `gross_pl`, `charges`,
  `net_income`, `risk_reward`) are computed automatically on `save()` via
  `recalculate()`. Charge rates: Equity 0.11%, Commodity 0.02%, F&O ₹130/leg.
- Endpoints under `/api/portfolios/<portfolio_id>/`:
  - `GET/POST  /trades/` — list (filterable) / create
  - `GET/PUT/DELETE /trades/<id>/` — detail
  - `PATCH /trades/<id>/close/` — close a trade (supply `close_date`, `close_price`)
  - `POST  /trades/import/` — CSV import with column mapping
  - `POST  /trades/bulk/` — JSON bulk import (pre-parsed trades array)
  - `POST  /trades/clear/` — delete all trades in portfolio
  - `GET   /stats/` — aggregated stats (filterable by segment, year, month)
  - `GET   /stats/equity-curve/` — equity curve points
  - `GET   /stats/monthly-pnl/` — monthly net P&L array
  - `GET   /stats/closed-months/` — list of months that have closed trades

**Import modes** (`mode` param on `/trades/import/` and `/trades/bulk/`):
- `smart` (default) — deduplicate against existing trades via O(1) set lookup
- `append_from_date` — skip rows with `entry_date` before `from_date`
- `replace` — wipe all portfolio trades first, then import

### `mf` (Mutual Fund)
- Three models: `MFFolio` (folio/fund house), `MFScheme` (fund with NAV,
  cost/market value), `MFTransaction` (individual transactions).
- CAS PDF parser (`parser.py`) handles both CAMS and KFintech formats using
  structural detection (date + 4 numeric tokens). Requires `pdfplumber`.
- Endpoints under `/api/mf/`:
  - `POST /import/` — upload a CAS PDF (multipart), returns import counts
  - `GET  /dashboard/` — summary totals + fund-house breakdown
  - `GET  /schemes/` — all schemes with gain/loss (filter by `?fund_house=`)
  - `GET  /transactions/` — all transactions (filter by `scheme_id`, `fund_house`, `txn_type`)
  - `DELETE /delete/` — wipe all MF data for the current user

---

## Frontend Pages

| Route | Component | Description |
|---|---|---|
| `/login` | Auth/Login | JWT login, stores tokens in localStorage |
| `/register` | Auth/Register | New user registration |
| `/dashboard` | Dashboard/Dashboard | Stats grid + equity curve + charts |
| `/trades` | Trades/Trades | Trade log table, add/edit/close modals, CSV import wizard |
| `/equity` | Equity/Equity | Full-screen equity curve with segment/period filters |
| `/segments` | Segments/Segments | Per-segment stats cards |
| `/mf` | MFDashboard/MFDashboard | MF summary + CAS PDF upload + schemes/txns tables |
| `/admin` | Admin/AdminPanel | Two tabs: Users (user list → portfolio picker → trade log) and Configuration (ETF master CRUD). ADMIN only. |
| `/sip/trades` | SIPJournal/SIPTrades | Raw SIP trade table + CSV import + add trade |
| `/sip/holdings` | SIPJournal/SIPHoldings | Active holdings table + 2 pie charts + FIFO sell modal |
| `/sip/booked-pl` | SIPJournal/SIPBookedPL | Booked P&L: ETF summary table + trade-wise detail table |
| `/sip/summary` | SIPJournal/SIPJournal | Full dashboard: XIRR, carry-forward, portfolio chart |

### Routing
- `ProtectedRoute` — redirects to `/login` if not authenticated
- `AdminRoute` — redirects to `/dashboard` if not ADMIN role
- Auth state lives in Zustand `useAuthStore` (persisted via localStorage for
  tokens; portfolio ID also stored in localStorage)

### Admin "View As" Feature
Admin users can impersonate any user's portfolio context from the Admin Panel:
1. Admin Panel → Users tab → select user → select portfolio → **Open Dashboard** button appears in the Full Trade Log header.
2. Clicking it calls `setViewAs(portfolioId, userName)` in `authStore`, switches `localStorage.portfolio_id` to the selected portfolio, and navigates to `/dashboard`.
3. A blue banner "Viewing **[name]**'s portfolio" appears at the top of every page while in view-as mode.
4. **Return to my portfolio** button in the banner calls `clearViewAs()`, which restores the admin's own portfolio from `localStorage.admin_own_portfolio_id`.

**localStorage keys used by view-as:**
- `admin_own_portfolio_id` — admin's real portfolio ID, saved on first `setViewAs()` call
- `admin_view_as` — the name being viewed as (cleared on `clearViewAs()` and `logout()`)

**authStore methods:**
- `setViewAs(portfolioId, userName)` — enter view-as mode
- `clearViewAs()` — exit view-as mode, restore own portfolio
- `adminViewingAs: string | null` — reactive state for the banner

### API Layer (`frontend/src/api/`)
| File | Purpose |
|---|---|
| `client.ts` | Axios instance, base URL `/api`, JWT Bearer header injection, 401 auto-logout. JWT is skipped only for the three public auth endpoints (`/auth/login/`, `/auth/register/`, `/auth/token/refresh/`) — all other `/auth/*` routes (e.g. `/auth/admin/users/`) DO send the token. |
| `auth.ts` | login, register, logout, getUser, refreshToken |
| `portfolio.ts` | CRUD for portfolios. `getAll(forUserId?)` accepts optional user ID — pass current user's ID so admin always fetches their own portfolios during init (backend scopes to that user). |
| `trades.ts` | trades CRUD + import + stats + equity/monthly/closedMonths |
| `mf.ts` | CAS import + dashboard + schemes + transactions |
| `admin.ts` | Admin: list users, user portfolios, portfolio trades |
| `sip.ts` | SIP: listTrades, uploadCsv, addTrade, sell, getHoldings, getBookedPL, getDashboard, refreshPrices, clearData |
| `utils.ts` | `extractList` helper for paginated/unpaginated responses |

---

## Key Architectural Decisions

1. **Email-only auth** — no username field; `email` is the `USERNAME_FIELD`.
2. **UUID primary keys** everywhere (User, Portfolio, Trade) to avoid
   enumerable IDs in URLs.
3. **Calculated fields stored on the model** — `gross_pl`, `charges`,
   `net_income`, `risk_reward`, `target`, `initial_risk` are computed and
   persisted on save so stats queries are pure aggregations.
4. **Bulk import uses `bulk_create`** — `save()` is not called, so
   `recalculate()` is called explicitly before appending to the batch.
5. **Timezone** set to `Asia/Kolkata` (IST).
6. **No DRF browsable API** — `DEFAULT_RENDERER_CLASSES` is JSON-only.
7. **Vite proxy** — `/api` in dev goes to `:8000`; in prod the Django app
   is served behind gunicorn and the proxy is handled by the hosting layer.
8. **CAS parser is format-agnostic** — transactions are detected by structure
   (date token + four numeric tokens), not by hardcoded fund names. This
   makes it resilient to new fund houses without code changes.
9. **Admin portfolio scoping** — `portfolioApi.getAll()` in `authStore.init()` always passes the current user's ID as `?user_id=`. Without this, the backend returns all users' portfolios for admin accounts (sorted by `-created_at`), which would cause admin to initialise with a wrong portfolio. With `?user_id=`, admin always boots into their own portfolio.
10. **JWT not sent only for public auth endpoints** — `client.ts` skips the `Authorization` header for exactly three paths: `/auth/login/`, `/auth/register/`, `/auth/token/refresh/`. All other routes under `/auth/` (e.g. `/auth/admin/users/`) still receive the token.

---

## Data Model Summary

```
User (users)
 └── Portfolio (portfolios)
      └── Trade (trades)

User (users)
 └── MFFolio (mf_folios)       ← folio/fund-house
      └── MFScheme (mf_schemes) ← one fund
           └── MFTransaction (mf_transactions)

User (users)
 └── SIPTrade (sip_trades)          ← one buy/sell row (split on partial FIFO sell)
 └── SIPWeeklySnapshot (sip_weekly) ← carry-forward per week (upserted, not per-user-trade)

Shared (no user FK):
 └── SIPPriceCache (ticker, price_date) ← yfinance cache + CSV CMP values
 └── SIPBenchmarkPrice (week_date)      ← Nifty50 + Nifty500 weekly prices
```

---

## Dependencies

### Backend (`requirements.txt`)
```
django==4.2.13
djangorestframework==3.15.1
djangorestframework-simplejwt==5.3.1
django-cors-headers==4.3.1
psycopg2-binary==2.9.12
python-decouple==3.8
Pillow==10.3.0
yfinance==0.2.38          # not wired to any live endpoint yet
pandas==2.2.2
django-filter==24.2
gunicorn==21.2.0          # production server
pdfplumber==0.11.4        # CAS PDF parsing
```

### Frontend (key packages)
- React 18 + React Router v6
- TypeScript
- Vite 5
- Zustand (state management)
- Axios (HTTP)
- Recharts (charts — LineChart, BarChart, PieChart)
- Tailwind CSS

---

## Git History

| Commit | Description |
|---|---|
| `e1f2133` | Initial commit: Django backend + React frontend scaffold |
| `eb880b8` | Remote: added gunicorn, psycopg2-binary version bump |
| `200e62c` | MF journal, admin panel, trading analytics, direction field, bulk import |

---

## Known Gaps / Future Work

- `TWELVE_DATA_API_KEY` is in `.env` but no live price feed is wired up for the Trade Journal.
- `/settings` route is in the sidebar but has no page component yet.
- No automated tests exist (placeholder `tests.py` files only).
- Pagination is set to 50 items per page but the frontend does not render
  paginator controls — it reads `res.data.data || res.data.results || res.data`.
- `Pillow` is installed but not used anywhere visible.
- SIP yfinance price refresh can be slow on first run (bulk-fetching NSE history). Subsequent calls use DB cache.
- SIP Summary (`/sip/summary`) XIRR and benchmark comparison require at least one price refresh to show meaningful values.

---

## AI CHAT FEATURE

**Status:** Implemented

**Overview:** A floating chat assistant that lets users ask natural language questions about their own trade data. The backend fetches live trade data from the DB, builds a context dict, and sends it along with the user's question to the Gemini API. The frontend renders a fixed bottom-right chat widget.

### New files added
- `frontend/src/components/TradeChatBot.tsx` — floating chat widget component

### Modified files
- `backend/requirements.txt` — added `google-genai>=1.0.0`
- `backend/trades/views.py` — added `build_trade_context()` helper and `trade_chat` view at the bottom
- `backend/trades/urls.py` — added `path('chat/', trade_chat, name='trade-chat')`
- `frontend/src/components/Layout.tsx` — imports and renders `TradeChatBot`

### Environment variables required
- `GEMINI_API_KEY` — get from aistudio.google.com, add to `backend/.env`

### API endpoint
- `POST /api/portfolios/<portfolio_id>/trades/chat/`
- Request body: `{ "message": "user question here", "history": [{ "role": "user"|"model", "text": "..." }, ...] }`
- Response: `{ "reply": "...", "tokens_used": { "input": N, "output": N }, "model_used": "..." }`
- Auth: JWT required (same as all other endpoints)

### SDK used
`google-genai` (new unified SDK, `from google import genai`). Do not use the legacy `google-generativeai` package — it reached end-of-life November 2025.

### Model used
`gemini-2.5-flash-lite` with fallback to `gemini-2.5-flash` and `gemini-3.5-flash` on 503/UNAVAILABLE errors.
`model_used` field in response tells you which model actually answered.

### Session memory (multi-turn)
The frontend maintains a `messages` array and sends all previous turns as `history` on every request. The backend builds a Gemini multi-turn `contents` list (plain dicts `{"role", "parts"}` — do NOT use `types.Content`/`types.Part` constructors, they behave inconsistently). The portfolio context is always re-fetched from DB for freshness and prepended to the first user turn in the conversation.

### Context sent to Gemini per request
- `today` — current date (ISO format) so the model can resolve "this month", "this week", etc.
- Portfolio name, currency, starting capital
- Summary stats: total trades, win rate, net P&L, charges
- Best and worst trade by net_income
- Segment breakdown for EQUITY, COMMODITY, F_AND_O
- `monthly_pnl` — net P&L, trade count, win rate keyed by `YYYY-MM` for every month
- `all_closed_trades` — every closed trade (full detail), sorted newest first
- `all_open_trades` — every open trade (entry detail + stop_loss + notes)

### Chat widget UX
- Toggle button (bottom-right) is hidden while the panel is open — panel has its own × close button.

### CSV import fix
- Row filter changed to accept any non-empty row (was incorrectly requiring first column to be a pure integer, which broke the sample CSV and most real-world CSVs).

### Future migration plan (n8n)
When migrating to n8n for multi-tool orchestration, only 3 lines change in `trade_chat` view — replace the Gemini client call with `requests.post(N8N_WEBHOOK_URL, json=payload)`. The `build_trade_context()` function, all URL routing, and the entire React component stay identical. React never knows whether Gemini is called directly or through n8n.

--- END AI CHAT FEATURE ---

---

## UI Design System

**Status:** Implemented (Issue #5 — light theme refresh)

### Color Tokens (`tailwind.config.js`)

| Token | Value | Usage |
|---|---|---|
| `brand` / `brand-DEFAULT` | `#4C6FFF` | Primary accent — buttons, links, active states, chart lines |
| `surface-page` | `#F4F6F9` | Page background |
| `surface-card` | `#FFFFFF` | Card / modal backgrounds |
| `surface-border` | `#E5E9F0` | All borders (cards, inputs, tables, dividers) |
| `neutral-primary` | `#1A1F2B` | Primary text |
| `neutral-muted` | `#8A93A6` | Secondary text, labels, placeholders |
| `profit-bg` | `#ECFBF4` | Profit card background |
| `profit-border` | `#CFF3E3` | Profit card border |
| `profit-text` | `#0E7A53` | Profit value text |
| `profit-label` | `#189A6B` | Profit card label text |
| `profit-chart` | `#2ECC91` | Profit bars / positive chart elements |
| `loss-bg` | `#FFF3F3` | Loss card background |
| `loss-border` | `#FAD8D8` | Loss card border |
| `loss-text` | `#C24545` | Loss value text |
| `loss-chart` | `#FF6B6B` | Loss bars / negative chart elements |

### Font Families

| Tailwind class | Family | Use |
|---|---|---|
| `font-display` | Space Grotesk | Page titles (`<h1>`), section headers, modal titles, logo wordmark |
| `font-mono` | JetBrains Mono | All numeric values — prices, P&L, quantities, percentages, R:R, stat card values |

Google Fonts loaded in `index.html`. Both families fall back gracefully if unavailable.

### StatCard Variants

StatCard accepts `variant?: 'default' | 'profit' | 'loss'`:
- **default** — white bg, `surface-border`, `neutral-primary` value
- **profit** — `profit-bg`, `profit-border`, `profit-text` value, `profit-label` label
- **loss** — `loss-bg`, `loss-border`, `loss-text` value

Apply `profit` to: Avg Profit, Win Rate ≥50%, Net Income > 0, Current Capital (when profitable), Peak Capital.
Apply `loss` to: Avg Loss, Win Rate <50%, Net Income < 0, Trough Capital, Worst Case Buffer (when negative).

### Sidebar

- **Collapsed**: 60px wide, icons only (lucide-react), centered.
- **Expanded**: 220px wide, icons + labels side by side.
- **Toggle**: ChevronLeft/ChevronRight button at top of sidebar.
- **State persistence**: `localStorage.getItem/setItem('sidebar_collapsed')`.
- **Active item**: `bg-brand/5 text-brand border-l-2 border-brand rounded-l-none`.
- **Inactive item**: `text-neutral-muted hover:bg-surface-page`.
- **Transition**: `transition-all duration-200` on the `<aside>` width.
- **Bottom**: user initials avatar (bg-brand/10) + LogOut icon. Full name/email/text shown only when expanded.
- **Grouped nav** (`NAV_GROUPS` in Layout.tsx): "Trade Journal" (Dashboard, Trade Log, Equity Curve, Segments) and "SIP Journal" (Trades, Holdings, Booked P&L, Summary). Group labels show when expanded; a thin divider replaces labels when collapsed. MF Dashboard sits standalone below a divider.

### Chart Colors (Recharts)

| Element | Color |
|---|---|
| Line / area stroke | `#4C6FFF` |
| Area fill opacity | 0.06 |
| Profit bars | `#2ECC91` |
| Loss bars | `#FF6B6B` |
| Neutral / break-even | `#8A93A6` |
| CartesianGrid stroke | `#EEF1F6` |
| Axis tick fill | `#8A93A6` |
| Tooltip bg | `#FFFFFF`, border `#E5E9F0` |

--- END UI DESIGN SYSTEM ---

---

## SIP JOURNAL FEATURE

**Status:** Implemented

**Overview:** Tracks weekly ETF SIP investments with carry-forward cash recycling, XIRR calculation, and benchmark comparison vs Nifty 50 / Nifty 500. CSV upload for historical data; new trades and FIFO sells added through the app.

### Backend App: `backend/sip/`

| File | Purpose |
|---|---|
| `models.py` | 4 models: SIPTrade, SIPWeeklySnapshot, SIPBenchmarkPrice, SIPPriceCache |
| `parser.py` | CSV parser. Required: Date, ETF, AssetClass, Ticker, Qty, Price. Optional (ignored or stored): TradePrice, CMP, Exit Date, Exit Price, Profit/Loss. CMP stored to SIPPriceCache (is_stale=True) via single bulk_create. |
| `price_service.py` | yfinance fetch + per-day cache (SIPPriceCache). NSE equities append `.NS`; benchmarks use `^NSEI` (Nifty 50) and `^CRSLDX` (Nifty 500) |
| `calculations.py` | Full pipeline: `recalculate_for_user(user, fetch_prices=False)` — fresh-cash, holdings, booked P&L, weekly values, XIRR, benchmark XIRR. All snapshot writes use bulk_create(update_conflicts=True) + bulk_update — O(1) DB round-trips. |
| `views.py` | 8 function-based views (see endpoints below) |
| `urls.py` | Registered at `api/sip/` |

### API Endpoints

| Method | URL | Purpose |
|---|---|---|
| `POST` | `/api/sip/upload/` | CSV import (multipart) — bulk_create only, no recalculate |
| `GET/POST` | `/api/sip/trades/` | List all trades / add single trade |
| `PATCH` | `/api/sip/trades/<id>/close/` | Close individual trade by ID (direct, no FIFO) |
| `POST` | `/api/sip/sell/` | **FIFO sell** across open positions for a ticker |
| `GET` | `/api/sip/holdings/` | Aggregated active holdings with CMP from price cache |
| `GET` | `/api/sip/booked-pl/` | Closed trades: ETF-level summary + individual trade detail |
| `GET` | `/api/sip/dashboard/` | Full summary: XIRR, carry-forward, chart data |
| `POST` | `/api/sip/refresh-prices/` | Force-fetch live prices from yfinance + recalculate |
| `DELETE` | `/api/sip/clear/` | Wipe all SIPTrade + SIPWeeklySnapshot for user |

### FIFO Sell Logic (`POST /api/sip/sell/`)

Body: `{ ticker, qty, exit_date, exit_price }`

1. Fetch all open trades for ticker ordered by `trade_date ASC, created_at ASC` (oldest first).
2. Validate: total available qty ≥ requested sell qty.
3. Walk trades in order, fully closing each until qty is consumed.
4. If a trade is only **partially** consumed → **split**: original row gets the sold qty (closed), a new row is created for the remaining qty (still open, same trade_date/price).
5. All writes wrapped in `transaction.atomic()`.

Example: 25+25=50 qty available, sell 30:
- Trade 1 (25 qty) → fully closed
- Trade 2 (25 qty) → split into: 5 qty closed + 20 qty new open row

### Carry-Forward Logic

For each buy-week in chronological order:
- `exits_settled` = exit proceeds whose `exit_date` falls **on** that week
- `carry` = exit proceeds whose `exit_date` falls **between** prev_week and this_week
- `recycled = min(carry + exits_settled, weekly_buy)`
- `fresh = weekly_buy - recycled`
- Remaining carry rolls to next week

### XIRR

Pure-Python Newton's method (no scipy). Cashflows: `(-weekly_buy, week_date)` for each week + `(+exit_value, exit_date)` for exits + `(+portfolio_value, today)`.

### Benchmark comparison

Same fresh-cash amounts invested into `^NSEI` (Nifty 50) and `^CRSLDX` (Nifty 500) each week at Friday close. Alpha = your XIRR minus benchmark XIRR (in percentage points).

### Performance notes

- `recalculate_for_user(fetch_prices=False)` — DB/cache only, used by dashboard GET. No yfinance HTTP calls.
- `recalculate_for_user(fetch_prices=True)` — fetches yfinance first; only triggered by refresh-prices POST.
- Upload, add-trade, close-trade, and sell endpoints do NOT call recalculate — they only write trade rows. Dashboard recalculates on next visit.
- `compute_benchmark_xirr` uses `bulk_create(update_conflicts=True)` to persist benchmark prices in one round-trip.

### Frontend Pages

| Page | Route | Key features |
|---|---|---|
| `SIPTrades.tsx` | `/sip/trades` | Flat table sorted by date (toggle ↑↓), CSV import modal, add trade modal. No sell button here. |
| `SIPHoldings.tsx` | `/sip/holdings` | Holdings aggregated by ticker. 4 summary cards. Two Recharts PieCharts (invested vs current allocation). Per-row "Sell" button opens FIFO sell modal showing available qty + partial sell preview. |
| `SIPBookedPL.tsx` | `/sip/booked-pl` | 4 summary cards. Table 1: ETF-wise summary (ticker, trades count, total qty, invested, exit value, booked P&L, return%). Table 2: collapsible trade-wise detail (+ hold days column). |
| `SIPJournal.tsx` | `/sip/summary` | XIRR, alpha vs benchmarks, carry-forward chart, active holdings, booked P&L breakdown. |

### CSV format accepted

```
Date, ETF, AssetClass, Ticker, Qty, Price[, TradePrice, CMP, Exit Date, Exit Price, Profit/Loss]
24-Oct-2025, Gold BEES, Debt, GOLDBEES, 15, 100.76, 1511.4, 1828.5, , , 317.1
```

- Date formats: `DD-Mon-YYYY` or `DD-Mon-YY` (e.g. `24-Oct-2025` or `24-Oct-25`)
- Extra columns (TradePrice, CMP, Profit/Loss) are accepted and ignored **except** CMP — if present and > 0, stored to SIPPriceCache (is_stale=True) via bulk_create so Holdings page shows data immediately without a yfinance refresh.
- Duplicate rows (same user+date+ticker+qty+price) are silently skipped.

--- END SIP JOURNAL FEATURE ---
