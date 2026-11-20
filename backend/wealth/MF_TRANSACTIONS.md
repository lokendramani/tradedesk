# Wealth Mutual Fund Transactions

These endpoints and tables belong to the Wealth module. They reuse
`MutualFundScheme` from the shared AMFI catalogue; instruments are created only
when a scheme is resolved or used in a transaction.

## Accounting fields

The common transaction header contains no financial amounts. Its one-to-one MF
detail contains `units`, `nav`, `amount`, `charges`, and signed `cashflow`.

- For purchase, redemption, and switch legs, `amount` is the positive gross
  value and must equal units multiplied by NAV, rounded to two decimal places.
- Charges are non-negative. Purchase and switch-in cashflow is
  `-(amount + charges)`. Redemption, switch-out, and dividend cashflow is
  `amount - charges` and cannot be negative.
- SIP purchases are the exception to the purchase amount convention: `amount`
  is the net investment after charges, while `cashflow` is the scheduled total
  debit (negative), so adding `amount + charges` recovers the debit exactly.
- Bonus entries require positive units and zero cashflow and charges. Other
  entries retain their supplied signed cashflow without imposing a direction.
- SIP is a `source` value and is valid only for a `PURCHASE` transaction.

## API

All routes are under `/api/wealth/` and require authentication plus Wealth
module access.

| Method | Route | Purpose |
|---|---|---|
| GET | `fund-houses/` | List normalized fund houses |
| GET, POST | `folios/` | List the caller's folios or create one |
| PATCH | `folios/<uuid>/` | Update a caller-owned folio |
| GET, POST | `instruments/` | List resolved instruments or resolve one with `scheme_code` |
| GET | `holdings/` | Aggregate units by scheme; `?group_by=folio` returns folio rows, and `?folio=<uuid>` filters one folio |
| GET, POST | `transactions/` | List caller-owned transactions or create one with `scheme_code` and nested `mf_detail` |
| POST | `transactions/switch/` | Atomically create a `switch_out` and `switch_in` pair sharing a generated group ID |
| PATCH, DELETE | `transactions/<uuid>/` | Update or delete an owned transaction; both operations are audited |
| GET | `transactions/<uuid>/audit/` | Read audit snapshots, including after the transaction is deleted |

Folio is optional on MF transactions, so transactions without a folio remain
available in aggregate holdings. Folio ownership and any known normalized AMC
must match the transaction owner and scheme respectively.

## Fund house normalization

Migration `0006` creates one master row for each exact, nonblank legacy
`fund_house` string and links schemes to it. It does not trim, case-fold, or
otherwise merge differently spelled names. Blank or whitespace-only labels
remain unlinked, and the existing text field remains available for review.
Catalogue refresh resolves only exact AMFI fund-house strings and leaves the
existing parsing and import flow otherwise unchanged.

Apply and verify migrations only against Development Supabase. See the
repository instructions for the required environment check and approval
boundary; tests use `config.test_settings` and an isolated in-memory SQLite
database.
