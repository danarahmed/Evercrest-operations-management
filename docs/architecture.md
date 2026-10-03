# Evercrest ERP — Architecture

Companion to `CLAUDE.md` (the product specification). This file records *how* the
specification is implemented. Keep it short and current.

## Decisions

| Topic | Decision |
|---|---|
| Stack | Next.js (TypeScript) + PostgreSQL (Supabase in production) + Drizzle ORM, deployed on Vercel |
| Accounting | Built in-house: double-entry general ledger inside the ERP (no Zoho) |
| Currencies | IQD and USD are both first-class. Every amount stores its currency. Reports show each currency separately; nothing is silently converted |
| Languages | English (`en`), Arabic (`ar`, RTL), Kurdish Sorani (`ckb`, RTL) |
| Users | Up to ~20; roles and approvals from day one |

## Layers

```
src/app/            UI (Next.js). No business logic. Calls server commands.
src/server/         Cross-cutting engines: commands, authz, audit, idempotency, settings, errors
src/domain/         Business engines and modules (money, accounting, partners, jobs, transport, ...)
src/db/             Drizzle schema + migrations (one schema file per module)
tests/              Vitest; runs against in-process Postgres (PGlite) with real migrations
```

Rule: every state-changing operation is a **command** executed through
`runCommand` (`src/server/command.ts`), which gives it, in one database transaction:
permission check → idempotency claim → business logic → audit event → stored result.
Modules never open their own transactions or write audit rows ad hoc.

## Shared engines (one of each)

| Engine | Owns | Notes |
|---|---|---|
| Money (`domain/money.ts`) | Decimal arithmetic, currency rounding, conversion | `numeric` in DB, `decimal.js` in code; never JS floats |
| Exchange rates | Dated, immutable rate history | Transactions store the rate they used; new rates never rewrite history |
| Ledger (`domain/accounting`) | Journal entries, periods, balances | Each entry must balance **per currency**. Cross-currency deals go through a currency-exchange account. Posted entries are immutable; corrections are reversals. Locked periods reject postings |
| Audit (`server/audit.ts`) | Append-only `audit_events` | DB trigger blocks update/delete |
| Idempotency (`server/idempotency`) | `idempotency_keys` | Same key + same request → stored result; same key + different request → conflict |
| Authorization (`server/authz.ts`) | Permission catalog, role → permissions, branch-scoped roles | Enforced server-side in `runCommand` |
| Settings (`server/settings.ts`) | Configurable business rules (key → JSON) | Every change audited |

Operational modules (jobs, trips, advances, settlements, invoices, expenses) produce
journal entries only by calling the ledger engine — never by writing ledger rows.

## Domain model (minimum, by phase)

- **Phase 0 — Foundation:** company, branch, user, role, permission, settings, audit, idempotency, currency, exchange rate, account, fiscal period, journal entry/line.
- **Phase 1 — Master data:** business partner (one record, many roles: customer, supplier, transporter, driver, contractor), contract, project, job types/templates, service, product, location.
- **Phase 2 — Job engine:** job (central object, optional capabilities), activities, documents + requirements, cost and revenue lines attached to jobs, approvals, next action.
- **Phase 3 — Transportation vertical slice:** trip (driver/truck/transporter captured at trip time), loading/unloading quantities with units, advances, settlement, customer billing → receivable → ledger → job profitability.
- **Phase 4 — Finance:** invoices, receivables/payables per currency, payments, cash/bank accounts, currency exchange, period close, financial statements.
- **Phase 5 — Other capabilities:** field service (work orders, labour, materials), product supply, expenses engine extensions.
- **Phase 6 — Management:** dashboards, exceptions, data-quality checks, reports, PDF export.

Each phase is built as vertical slices and tested before the next dependency.

## Module map (what is built)

| Area | Code | Screens |
|---|---|---|
| Job engine | `domain/jobs` — jobs, capabilities registry, steps (`activities.ts`), custom fields + budget (`custom-fields.ts`), contracts, projects, job types with default capabilities and steps | Dashboard, Jobs (workspace), New job, Setup |
| Transport | `domain/transport` — trips, rates, settlement, billing, pay statements, statement debts | Job workspace, Pay statements |
| Field service | `domain/field/work-orders.ts` — work orders gate job completion | Job workspace |
| Product supply | `domain/supply/deliveries.ts` — deliveries invoiced at the product price rule | Job workspace |
| Documents | `domain/documents` — types and rules by job type, customer or contract | Job workspace, Documents, Setup |
| Finance | `domain/finance` — invoices/bills, payments (one engine: advance, settlement, receipt, bill payment, expense, other), transfers, currency exchange | Finance (5 tabs) |
| Accounting | `domain/accounting` — ledger, posting map, statements, views (journal, trial balance, partner ledger, cash balances, month locks) | Finance → Cash, bank & books / Journal / Partner accounts |
| Approvals | `domain/approvals` — four-eyes, payout limits, write-offs always | Approvals |
| Management | `domain/management` — exceptions, reports (job profit, monthly), history/audit | Dashboard, Reports, Admin → Audit log |
| Organisation | `domain/org` — users, roles, permissions (no self-escalation) | Admin |

Capability modules plug into the job engine with `registerCapabilityModule`
(blockers → next action, `inUse` protects switching a capability off). General
controls that are not switchable (required steps, required custom fields) use
the `"core"` capability with `alwaysCheck`.

## Acceptance scenarios (CLAUDE.md §43) — where they are tested

| Scenario | Test |
|---|---|
| A Simple product supply | `tests/operations.test.ts` (deliveries, no trips) |
| B Petroleum transport via transporter | `tests/settlement.test.ts`, `tests/statements.test.ts` |
| C Direct driver | `tests/settlement.test.ts` (trips without transporter) |
| D Driver changes transporter | `tests/transport.test.ts` (transporter captured per trip) |
| E Field service | `tests/operations.test.ts` (work orders, contractor bill) |
| F Product + transportation | capabilities combine on one job (`jobs.set_capabilities`) |
| G Customer-specific requirement | `tests/custom-fields.test.ts` (customer document + required field by configuration) |
| H New service | job type + steps + expenses + invoices, no new module (`tests/activities.test.ts`, `tests/reports.test.ts`) |

## Not built yet

- Supabase Auth (only `AUTH_MODE=dev` sign-in exists) and production hosting.
- PDF files (pages print cleanly from the browser instead).
- Inventory stock levels, fleet, HR, CRM — deliberately out of scope (CLAUDE.md §34).
