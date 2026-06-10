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
    │   │   └── Admin/     Admin panel (ADMIN role only)
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
- Admin can pass `?user_id=<uuid>` to list any user's portfolios.
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
| `/admin` | Admin/AdminPanel | User list → portfolio picker → trade viewer (ADMIN only) |

### Routing
- `ProtectedRoute` — redirects to `/login` if not authenticated
- `AdminRoute` — redirects to `/dashboard` if not ADMIN role
- Auth state lives in Zustand `useAuthStore` (persisted via localStorage for
  tokens; portfolio ID also stored in localStorage)

### API Layer (`frontend/src/api/`)
| File | Purpose |
|---|---|
| `client.ts` | Axios instance, base URL `/api`, JWT Bearer header injection, 401 auto-logout |
| `auth.ts` | login, register, logout, getUser, refreshToken |
| `portfolio.ts` | CRUD for portfolios |
| `trades.ts` | trades CRUD + import + stats + equity/monthly/closedMonths |
| `mf.ts` | CAS import + dashboard + schemes + transactions |
| `admin.ts` | Admin: list users, user portfolios, portfolio trades |
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

- `yfinance` and `TWELVE_DATA_API_KEY` are in the codebase but no live price
  feed is wired up yet; live P&L on open trades is not implemented.
- `/settings` route is in the sidebar but has no page component yet.
- No automated tests exist (placeholder `tests.py` files only).
- Pagination is set to 50 items per page but the frontend does not render
  paginator controls — it reads `res.data.data || res.data.results || res.data`.
- `Pillow` is installed but not used anywhere visible.

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
