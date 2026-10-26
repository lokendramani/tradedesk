# WealthOnCruise module access: Supabase RLS verification gap

The module-access foundation enforces application access in Django REST Framework. Each protected TradeDesk API request checks the user's active module grant against the database. JWT module claims are informational and are not the authorization source.

This change does not add or alter Supabase Row Level Security policies. The repository configures Django with a PostgreSQL connection from `DATABASE_URL`, but source inspection does not establish whether RLS is enabled on deployed tables or whether the configured database role bypasses RLS. Do not treat module permissions as row-level isolation, and do not assume Supabase RLS is protecting Django queries.

Before adding WealthOnCruise user data or relying on database-side isolation, verify the deployed Supabase schema and the exact role used by Django. Confirm that policies cover every user-owned table and that the application role cannot bypass them. Also test with two independent users that reads and writes cannot cross user boundaries. Shared reference data should have a separate policy that permits user reads and limits writes to the sync process.

No production database configuration or RLS policy is changed by this feature.

## Access audit retention and rollback

`UserModuleAccess` keeps a nullable user reference and required subject snapshots
(user UUID, email, and name). Grantor and revoker references are nullable and
their snapshots are recorded only when an actor is available. Deleting a user
therefore leaves the access history and the known identities behind. This
retains personal identifiers after account deletion; operators must include
these audit snapshots in their retention and deletion policy.

The module-access migration is intentionally irreversible. Do not reverse it
to roll back an application deployment: roll back application code while
leaving the additive module tables in place, then deploy a forward migration if
schema correction is needed. If the feature is ever retired, export and review
the grant and revocation history before a separately approved archival/removal
procedure. The migration must be applied before deploying code that queries
module-access tables.

## Authentication throttling

DRF scoped throttles are attached only to registration, login, and token
refresh. Defaults are 5 registration attempts per hour, 5 login attempts per
minute, and 60 refresh attempts per minute. Configure them with
`AUTH_REGISTER_THROTTLE_RATE`, `AUTH_LOGIN_THROTTLE_RATE`, and
`AUTH_REFRESH_THROTTLE_RATE` in the backend environment. Values must use a
positive DRF rate such as `5/minute`; malformed, blank, zero, negative, or
unsupported values fail Django settings initialization with a descriptive
configuration error.

The project does not configure Django's `CACHES` setting, so Django uses its
default local-memory cache unless the deployment overrides it. Local-memory
throttle counters are process-local and are not shared across application
workers or processes. Therefore, these DRF rates are not reliable global
limits in a multi-worker production deployment. Before relying on them in
production, configure a shared cache backend for throttle counters or enforce
suitable limits at the edge or reverse proxy. Edge enforcement is an
alternative; this project does not configure it. Application throttles remain
best-effort controls and do not replace that production configuration.
