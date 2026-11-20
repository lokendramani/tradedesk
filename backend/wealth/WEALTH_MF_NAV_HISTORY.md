# Wealth Mutual Fund NAV History

## Catalogue and NAV data are separate

The existing scheme catalogue initialization and manual refresh continue to download AMFI NAVAll for catalogue metadata. Its parser still ignores NAV and NAV date, and its triggers, lock, transaction boundaries, and import log are unchanged.

The NAV updater is an independent service. It downloads NAVAll once per manual run, parses NAV and date, and upserts only the latest record for schemes with positive remaining Wealth units. It has its own run log and lock. It does not refresh catalogue metadata or delete older NAV history. NAV eligibility is evaluated per user, scheme, and folio (including unassigned folios); a positive folio position qualifies even if another folio has an offsetting negative balance. Negative folio positions remain negative and are exposed as `NEGATIVE_NET_UNITS` anomalies in folio holdings; they are counted in updater diagnostics and do not qualify on their own.

## Shared NAV history and source precedence

`WealthMFNAVHistory` stores shared scheme-level rows with a unique `(scheme, nav_date)` key, a four-decimal NAV, and source provenance (`MFAPI` or `AMFI`). AMFI updates an existing row for the same scheme/date and takes precedence over an MFAPI value for that date. History is not owned by a user. NAVs must be positive, and future-dated values are rejected by model validation.

## Historical MFAPI loading

The first GET of a scheme's NAV history fetches only that scheme from MFAPI. The response is validated, parsed, and inserted atomically. A per-scheme load row records the successful completion time. Failed requests leave the scheme retryable; successful subsequent requests use stored history and do not download the full series again. No catalogue-wide MFAPI download is performed.

## Manual AMFI update

An authorized Wealth administrator can open Wealth Portfolio and select **Update NAV Now**. The action requests one AMFI NAVAll download, identifies positive holdings using the Wealth transaction signs (purchase, switch-in, and bonus add units; redemption and switch-out subtract units), and includes unassigned-folio positions. Positions are evaluated per user, scheme, and folio, then deduplicated to schemes. Missing or invalid held-scheme rows appear in the run summary; existing history is retained. The status API returns the authoritative stale-lock duration and the latest run age; after that lease expires, the UI labels a still-`RUNNING` run as expired and permits retry. The database lock remains authoritative and rejects concurrent requests.

The separate management command is also available for a manual operator run:

```powershell
cd backend
python manage.py update_wealth_mf_navs
```

The command invokes the same updater service as the Admin action. It does not add or require a scheduler. No APScheduler, Celery, Redis, or Render Cron Job dependency is introduced. Future scheduling can call this service or command without duplicating NAV update logic.

### Synchronous execution characteristics

- Each source download reads at most 20 MiB; an oversized response is rejected.
- HTTP downloads use a 30-second timeout. The updater downloads NAVAll once, parses the file in memory, computes one per-folio holdings summary, selects held catalogue schemes, creates load-state rows, and bulk-upserts only the selected schemes' latest NAV rows.
- The database transaction that serializes scheme history writes begins after download and parsing; it locks the relevant per-scheme load-state rows and performs the upsert and run-summary update. The singleton updater-lock transaction is short and separate. The MFAPI lazy load has its own per-scheme transaction and does hold that row lock while fetching its one scheme's history.
- The updater logs elapsed seconds and row counts without logging credentials or response contents. The Admin endpoint and management command call the same service.
- No configured web request timeout was found in this repository. The Admin endpoint is synchronous, so its deployment compatibility must be measured and verified in the target hosting environment; no Render timeout compatibility is claimed here.

## APIs

- `GET /api/wealth/holdings/?group_by=aggregate` — scheme aggregate holdings.
- `GET /api/wealth/holdings/?group_by=folio` — folio-grouped holdings.
- Both holdings responses retain their existing fields and add `latest_nav`, `nav_date`, and `market_value`. NAV comes from the latest stored date, including across weekends and market holidays. Market value is calculated with Decimal arithmetic and rounded to two currency decimals. Unavailable NAV produces null valuation fields.
- `GET /api/wealth/schemes/{scheme_code}/nav-history/?from=YYYY-MM-DD&to=YYYY-MM-DD` — chronological stored history; the first request lazily loads that scheme from MFAPI.
- `GET /api/wealth/nav-updates/` — latest update summary for Wealth administrators.
- `POST /api/wealth/nav-updates/` — synchronous manual AMFI update for Wealth administrators.

All endpoints require authentication and Wealth module access. NAV history is read-only to normal users. Only a user with `role=ADMIN` or `is_staff=True` can inspect operational update details or trigger the AMFI updater; the backend enforces this check.

## Local verification

Run isolated Wealth tests without connecting to Supabase:

```powershell
cd backend
python manage.py test wealth --settings=config.test_settings
```

Migration `0009_wealth_mf_nav_history` creates the NAV history, per-scheme load state, manual update run, and separate updater lock tables, plus the NAV uniqueness/check constraints and latest-date index. It does not transform existing records. Do not apply it until the migration has been reviewed and the Development Supabase target has been verified in the user's separate PowerShell environment.

Current limitation: there is no automatic daily scheduler. The AMFI update is manually triggered through Wealth Admin (or the same management command). Before Development PostgreSQL verification, confirm the migration target and exercise the row locks, upserts, AMFI/MFAPI precedence, and stale-lock recovery on the actual PostgreSQL/Supabase test environment. Separately measure the synchronous Admin request duration and response behavior in deployment; this repository does not define its request timeout. Existing catalogue initialization and manual refresh remain unchanged.
