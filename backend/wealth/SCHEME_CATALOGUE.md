# Mutual Fund Scheme Catalogue

The shared AMFI scheme catalogue is separate from the user-owned CAS import
models in `mf`. It stores scheme metadata and ISINs only; it does not store NAVs,
holdings, or transactions.

## Local development and integration

Local development and database-backed integration checks use the established
Development Supabase database. Before any migration, catalogue initialization,
refresh, import, or other database write, inspect Django's effective settings
and verify that the resolved target is Development Supabase; report the planned
operation and obtain approval first. Never use Production for this feature.

The `config.test_settings` SQLite database is for isolated automated tests only.
Do not use SQLite for local integration testing or as a substitute for
Development Supabase. Do not run database-backed commands until the target and
approval requirements above are satisfied.

## Automatic initialization

The first authenticated Wealth request to the catalogue list, filters, or
detail API initializes the shared catalogue automatically when it is empty.
Concurrent first requests are serialized by the catalogue run lock. If AMFI
download or validation fails, the API returns a retryable service-unavailable
response and records the failure; a later catalogue request tries again.
Requests against a populated catalogue do not download AMFI or modify scheme
records. Users do not need to run a management command.

AMFI downloads use HTTPS with certificate and hostname verification. The
downloader explicitly loads the maintained `certifi` CA bundle installed from
`requirements.txt`, so Windows development and the deployed Python runtime do
not depend on a machine-specific CA path or urllib's platform default bundle.

Failures are logged server-side with the operation, stage, run identifier, and
original traceback. The API response and persisted failure summary contain only
generic, sanitized messages; the original exception is not returned to clients.

The list API filters and searches the complete catalogue before paginating. It
returns 100 schemes per page by default and caps requested page sizes at 200.
The frontend requests only the selected page; changing search or filters returns
the user to page 1.

## Optional operator commands

The initialization management command remains available for operators who
need an explicit one-time load. It downloads AMFI only when the catalogue table
is empty. Run it only after verifying the effective database target and
obtaining approval for the write:

```powershell
python manage.py initialize_scheme_catalogue --settings=config.settings
```

If the table already contains a scheme, initialization returns `SKIPPED`
without downloading AMFI. It records the skip in the import log.

Incremental refresh always downloads AMFI and validates the source before
catalogue writes. It applies inserts and metadata updates without deleting
schemes absent from the source. Run it only after the target and approval checks:

```powershell
python manage.py refresh_scheme_catalogue --settings=config.settings
```

Refresh from the catalogue page requires both an active Wealth module grant and
a backend administrator (`role=ADMIN` or `is_staff=True`). The refresh API never
accepts a caller-provided source URL.

## Automated checks

Backend tests use an isolated in-memory SQLite database and mocked AMFI data:

```powershell
python manage.py test wealth --settings=config.test_settings
python manage.py makemigrations --check --dry-run --settings=config.test_settings
```

Frontend checks from `frontend/`:

```powershell
npm test
npm run build
```

For a manual API check, run the backend and frontend, sign in with a user that
has Wealth access, open `/wealth/funds`, search/filter, page through results,
and open a row for scheme details. Sign in as an admin with Wealth access to
exercise **Refresh Catalogue**; an admin without the Wealth grant and a regular
Wealth user must receive HTTP 403 from `POST /api/wealth/schemes/refresh/`.

The automated backend tests cover parser structure/classification, initialization
skip semantics and retry, safe traceback logging, refresh deltas and rollback,
API permissions, filtering, pagination limits and metadata, details, and source
override rejection. Test fixtures do not call AMFI.
