# How Evercrest works — owner's explanation

The owner's own answers to the business questionnaire, saved word for word, part by part.
These are the source of truth for the business rules; the system is rebuilt around them once all parts are in.
Each part has the owner's answer, then open questions noted while reading (not yet asked or answered).

| Part | Topic | File |
|---|---|---|
| 1 | Company overview and the work we do | [part-1-company.md](part-1-company.md) |
| 2 | One real job from start to finish | [part-2-job-flow.md](part-2-job-flow.md) |
| ex | Real job: diesel to Syria (master sheet + transporter settlement form) | [example-diesel-syria.md](example-diesel-syria.md) |
| 3 | Customers | [part-3-customers.md](part-3-customers.md) |
| 4 | Transport | [part-4-transport.md](part-4-transport.md) |
| 5 | Field work and staff | [part-5-field-staff.md](part-5-field-staff.md) |
| 6 | Product supply | [part-6-product-supply.md](part-6-product-supply.md) |
| 7 | Suppliers, subcontractors and other costs | [part-7-suppliers-costs.md](part-7-suppliers-costs.md) |
| 8 | Money handling | [part-8-money.md](part-8-money.md) |
| 9 | Approvals and control | [part-9-approvals-control.md](part-9-approvals-control.md) |
| 10 | Documents | [part-10-documents.md](part-10-documents.md) |
| 11 | Your team | [part-11-team.md](part-11-team.md) |
| 12 | Problems today | [part-12-problems.md](part-12-problems.md) |

## After all parts

- [design-proposal.md](design-proposal.md) — the proposed design (v1), for the owner's approval
- [open-questions.md](open-questions.md) — the 43 questions still open, consolidated

## Build log

- **Step 1 (rule card, trips, import)** — built 2026-10-27: `job_terms` / `job_routes` / `fee_types` / `job_fees` / `trip_fees` / `trip_imports`, live trip grid, Excel import with preview. Verified against the real DIESEL sheet: 197 rows imported, all 112 discharged trips equal the Excel formulas (with the two agreed corrections).
- **Guide, chapter 1** — written 2026-11-18 (`docs/guide/`, published as a page). Writing it found and fixed: a trip paid by the old per-trip settlement could also be claimed; a fine waiver waiting for approval did not hold the trip back from claims; advances above the rule card's limit went through without approval when below the payment limit; the storage's three-column discharge list was refused by the importer; the entry line paid advances from the IQD safe on a USD job; no screen could reverse a payment.
- **Step 2 (claims and carrier accounts)** — built 2026-11-18: claims by whoever brings the papers (manifest check, papers brought with the claim, duplicate blocking at the database, posting to the claimant's running account, part payments, cancellation with reversal), fine waivers through approval, site settlements imported and compared line by line with approval that claims and pays per driver. Tests: `tests/claims.test.ts`, `tests/remote.test.ts`, `e2e/claims-flow.mjs`. Open for step 3: the site's over/under-payments land on that cash box's count.
- **Step 1f (one-screen trip, grid, filters)** — built 2026-10-27: trip dialog with full form and change history, spreadsheet-style entry grid, column filters/sort/search/date ranges/chips, company-wide Trips page. Owner decided: dialog + grid (no separate page); staff may edit saved trips, with who/what/from/to recorded; saved filter groups to be decided at the end.
