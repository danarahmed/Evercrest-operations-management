# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# COMPANY ERP — FLEXIBLE PROJECT / JOB ARCHITECTURE

## 0. Repository Status, Stack and Commands

**Scope:** this repository is the **Evercrest Operations ERP** only. Every instruction given in this repository is for this ERP. Never mix in requirements, entities or code from any other project (e.g. café/bakery/POS systems).

**Decisions (confirmed by the owner):**
- Stack: Next.js 16 (TypeScript) + PostgreSQL (Supabase in production) + Drizzle ORM; deployed on Vercel.
- Accounting is **built in-house** (double-entry ledger inside the ERP; no Zoho).
- Currencies: **IQD and USD**, both first-class. Every amount stores its currency. Reports keep each currency separate; nothing is converted into a single total. Journal entries must balance **per currency**; cross-currency deals go through a currency-exchange account.
- Languages: English (`en`), Arabic (`ar`, RTL), Kurdish Sorani (`ckb`, RTL).
- Up to ~20 users.

**Commands:**
```
npm install
npm test                         # all tests (Vitest, in-process Postgres via PGlite, real migrations)
npx vitest run tests/ledger.test.ts -t "reversal"   # one file / one test
npm run typecheck
npm run build
npm run dev
npm run db:generate -- --name <change>   # new migration from schema changes (src/db/schema)
npx drizzle-kit generate --custom --name <x>   # hand-written SQL migration (triggers, seed data)
DATABASE_URL=... npm run db:migrate      # apply migrations to a real database
DATABASE_URL=... npx tsx scripts/seed-dev.ts   # development data only (never production)
DATABASE_URL=... AUTH_MODE=dev npm run dev     # run the app with the temporary development sign-in
BASE_URL=http://localhost:3000 CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e   # UI flow test (seeded dev data)
```

**Architecture:** see `docs/architecture.md` (layers, shared engines, phase plan). Key rules:
- Every state change is a command run through `runCommand` (`src/server/command.ts`): validation, server-side permission check, idempotency key, one DB transaction, mandatory audit event.
- Journal rows are written only by `postEntry` (`src/domain/accounting/ledger.ts`). Operational modules call it inside their own command.
- Database triggers (`src/db/migrations/0001_foundation_guards.sql`) enforce append-only audit/ledger/rates, per-currency balance, and period locks.
- Money: `numeric` columns, `decimal.js` in code (`src/domain/money.ts`); never JS floats.
- Specialized modules plug into the job engine via `registerCapabilityModule` (blockers → next action, inUse); every entry point imports `src/domain/register.ts`.
- Transport money rules (owner-confirmed) live in `src/domain/transport/`: `rates.ts` (effective-dated rules per product/customer/transporter/contract; most specific wins; overlaps refused), `settlement.ts` (actual MT = min(loaded, discharged); fine = max(loss − allowance, 0) × fine price; demurrage = days − free days; inputs snapshotted; one posted settlement per trip; settled trips frozen), `billing.ts` (customer billed on actual MT), `statements.ts` (pay statements: several drivers, or one transporter's trips, paid together; each payee gets one payment for exactly what the statement owes them; settlement balances are paid only this way). Transporter fee is price × actual MT or a fixed amount per trip. Only final amounts are rounded, to the `rounding.final_increment` setting (IQD 250); differences post to the rounding account.
- Screens read through `src/server/queries.ts` (permission-checked) and translate domain codes via `describe()` (`src/lib/format.ts`); message keys in `messages/*.json` use `_` instead of `.`.
- Forms: every form posts to `submitCommand` (`src/app/[locale]/actions.ts`) via `ActionForm`; only commands listed in `src/server/ui-commands.ts` are callable; the idempotency key is generated at render time.
- Authentication: only `AUTH_MODE=dev` exists (cookie with user id) until Supabase Auth is approved and connected. Never enable dev mode in production.

---


The company performs many different kinds of work, but most individual projects are **not** extremely complicated. The real problem is that different projects, customers and jobs require different information, resources, documents, advances and approvals: some involve transportation, products, field work, external contractors, employees, purchasing, or customer-reimbursable costs; some involve none of these.

Therefore the ERP must be:

**SIMPLE BY DEFAULT · FLEXIBLE WHEN NEEDED · CONTROLLED WHEN MONEY IS INVOLVED**

## 1. Do Not Build a Separate ERP Workflow for Every Type of Project

Do **not** create independent Transportation / Petroleum / Field / Supply / Logistics / Construction project systems. That duplicates functionality and creates unnecessary complexity. Use **one common Project / Job engine with optional capabilities**.

## 2. Simple Core Model

Customer → Contract / Agreement (optional) → Project (optional) → Job / Work Order → Activities / Tasks → Resources / Transactions → Costs + Revenue → Documents → Settlement / Billing → Profitability

Not every job needs every level:
- **Small job:** Customer → Job → Cost → Revenue → Invoice
- **Transportation job:** Customer → Job → Trip → Driver / Truck / Transporter → Advance → Documents → Settlement → Billing
- **Field-service job:** Customer → Project → Work Order → Employees / Contractor / Materials → Expenses → Completion → Billing

The same ERP supports all three without forcing the same workflow onto them.

## 3. Job Is the Central Operational Object

Every meaningful piece of work should normally have a Job ID (e.g. `JOB-2026-00125`).

A Job can contain: customer, project, contract, job type, service, product, location, start/end date, responsible person, status, budget, revenue, costs, documents, activities, resources, payments, profitability. Only relevant fields are shown.

## 4. Optional Capabilities

When creating a Job, the user activates only the capabilities that job needs:

- **Transportation:** driver, truck, transporter, trip, loading, unloading, quantity, advance, settlement, demurrage
- **Products:** product, quantity, unit, purchase, sale, inventory, delivery
- **Field Work:** site, work order, employee, contractor, equipment, material, labor, completion
- **Financial:** expense, advance, revenue, invoice, customer receivable, supplier payable
- **Documents:** contract, manifest, delivery document, invoice, receipt, approval, completion certificate
- **Approval:** expense, purchase, rate, adjustment, payment approval

A Job exposes only the capabilities actually needed.

## 5. Simple Job Creation

Minimum useful information: customer, job name, job type, start date, responsible employee, description. Everything else can be added when needed. Do **not** force users to complete 50 fields to create a simple job.

## 6. Job Type Must Not Control Everything

Job Type supplies defaults (workflow, fields, reports, documents, capabilities) but must **not** become a rigid programming structure. E.g. Job Type "Transportation" normally activates driver, truck, transporter, trip, quantity — but an authorized user can still add equipment, expense, special document, field activity, or custom cost if the job requires it.

## 7. Template System

Job Templates provide defaults, not rigid restrictions; users can modify capabilities when necessary.

- **Petroleum Transportation:** transportation, driver, truck, transporter, quantity, advance, settlement, documents
- **Product Supply:** product, quantity, supplier, purchase, delivery, customer billing
- **Field Service:** site, work order, labor, equipment, materials, expenses, completion
- **General Service:** activities, employees, expenses, documents, revenue

## 8. Custom Fields — Use Carefully

Support custom fields for customer/project/job-specific information (customer reference number, field permit number, special delivery instruction, site code, contract reference).

Custom fields are **not** a replacement for proper database entities. If a field is repeated frequently, used for reporting, calculations, relationships or filtering, or is financially important, it should become a proper structured field/entity.

## 9. Activities / Tasks

A Job can contain lightweight activities, e.g.:
- "Fuel Delivery to Field X": purchase product → arrange truck → load → transport → deliver → collect document → invoice customer
- "Field Maintenance": mobilize team → purchase materials → perform work → inspect → complete → invoice

Do not turn activities into a complicated project-management system unless the company actually needs it.

## 10. Resources

A Job can consume: employee, driver, truck, transporter, contractor, equipment, product, material, service, cash, external supplier. Keep the resource model flexible. Do not assume every job requires employees, transportation, or products.

## 11. Transaction Attachment

Costs and revenues attach to a Job: Expense → Job; Purchase → Job; Transport Trip → Job; Driver Advance → Trip → Job; Supplier Payment → Job; Customer Invoice → Job; Equipment Cost → Job; Field Expense → Job.

This enables profitability without requiring every module to understand every other module.

## 12. Cost Engine

One general cost framework. A cost can originate from: purchase, expense, employee labor, contractor, transporter, driver, equipment, material, inventory, bank payment, cash payment, other approved cost. Link it to company, department, project, job, activity, cost center where applicable.

## 13. Revenue Engine

One general revenue framework. Revenue can originate from: product sale, service, transportation, field work, contract milestone, job completion, other commercial activity. Link it to customer, contract, project, job, product/service, invoice where applicable.

## 14. General Profitability Engine

One profitability engine: `Revenue − Direct Costs − Applicable Allocated Costs = Job Profitability`, with different cost sources per job type:
- **Transportation:** Revenue − Transporter − Driver − Reward − Other direct costs
- **Field service:** Revenue − Labor − Materials − Equipment − Transportation − Other costs
- **Product supply:** Sales − Purchase cost − Transportation − Other costs

Do not create a separate accounting system per job type.

## 15. Simple Jobs Must Stay Simple

"Supply 10 generators to Customer A" must **not** force driver, truck, demurrage, manifest, MT, transporter, field work, inventory batch, or project phases unless required.

## 16. Complexity Appears Only When Needed (Progressive Disclosure)

User creates a Job → only basic fields appear. Selects "Transportation" → transportation fields appear. Selects "External Transporter" → transporter fields appear. Selects "Driver Settlement Required" → settlement functionality appears. Selects "Customer-Reimbursable Costs" → receivable tracking appears.

Never show every possible ERP field on every screen.

## 17. Configuration Over Development

Prefer: business user changes configuration → workflow changes; over: business user requests change → developer changes code.

Configurable: job types, templates, required fields, approval rules, rates, fees, statuses, documents, customer requirements, cost categories, revenue categories.

Configuration must be **controlled** — users must not be able to accidentally break financial logic.

## 18. Customer-Specific Requirements

Customers may differ in documents, pricing, approvals, billing, quantity rules, settlement rules, payment terms, reporting. Support customer-specific configuration (e.g. Customer A: manifest + delivery certificate + approval; Customer B: invoice only; Customer C: extra field-service documents). The core ERP stays the same.

## 19. Contract-Specific Rules

Conceptual override priority (lowest → highest):

System Default → Job Type Default → Customer Configuration → Contract → Job-specific approved rule

The exact hierarchy must be clearly defined in code. Do not let users unknowingly override contract terms.

## 20. Projects Are Not Required for Everything

All of these are valid: Customer → Job; Customer → Project → Job; Customer → Contract → Project → Job; Customer → Contract → Job. Do not force unnecessary hierarchy.

## 21. Contracts Are Not Required for Everything

Work may be one-time, verbal/operationally approved, small, ad hoc, or emergency. Allow legitimate work without a full contract workflow — but financially significant transactions still follow approval/control requirements.

## 22. Job Lifecycle

Generic: **Draft → Open → In Progress → Pending → Completed → Financially Closed → Cancelled**. Specialized modules may add statuses. Do not create 30 statuses for a simple job.

## 23. Status vs Data

Do not allow Completed / Financially Closed if critical information is missing. E.g. a transportation job cannot be financially closed if required documents are missing, settlement is incomplete, customer billing is incomplete, or a required approval is missing. The system identifies exactly what remains.

## 24. "Next Action" Concept

Every active Job shows a **Next Action** (e.g. waiting for truck, manifest, customer approval, material, payment, settlement, field completion; ready to invoice). This is more useful than `Status = In Progress`.

## 25. Exception Management

Focus management on exceptions: job delayed, cost exceeds budget, missing document/approval/rate, unreconciled advance, overdue customer/supplier payment, negative margin, quantity discrepancy, failed accounting synchronization. Normal work stays quiet; exceptions become visible.

## 26. Flexible Document Requirements

Document requirements are configurable by job type, customer, contract, service, activity. Do not make documents mandatory globally (transportation may require a manifest; consulting may not; field work may require a completion certificate; product supply may require a delivery note).

## 27. Flexible Financial Requirements

Not every Job needs advance, invoice, purchase, customer receivable, supplier payable, expense, or inventory. Activate these when relevant.

## 28. Do Not Create "One Giant Form"

Job form structure: **Basic Job Information + Relevant sections + Optional capabilities + Related transactions.**

## 29. Job Workspace

Each Job has one central workspace, e.g.:

```
JOB-2026-00125
Customer:    ABC Company
Service:     Transportation
Status:      In Progress
Next Action: Waiting for manifest
```

Tabs/sections (only relevant ones shown): Overview, Activities, Trips, People, Products, Expenses, Purchases, Documents, Payments, Invoices, Approvals, Profitability, History.

## 30. Workspace Is an Aggregation, Not a Copy

The Job workspace aggregates and displays underlying records; it does not duplicate them. Trip data belongs to Trip, Expense data to Expense, Invoice data to Invoice.

## 31. Modular Database Design

Strong core schema. Core entities may include: BusinessPartner, Customer, Supplier, Employee, Driver, Transporter, Truck, Product, Service, Contract, Project, Job, Activity, Document, Expense, Purchase, Sale, Invoice, Payment, Advance, Settlement, Trip. Specialized entities connect to the core. Never one enormous table containing every possible field.

## 32. General + Specialized Data Model

Core entities for common concepts; specialized entities for specific workflows:
- Job → Transportation Job → Trip
- Job → Field Service Job → Work Order
- Job → Product Supply Job → Delivery

## 33. Future-Proofing

Today petroleum transportation; tomorrow equipment rental; later construction support or industrial maintenance. Adding a new service requires a new service type (+ a new specialized workflow only if needed), not rebuilding the ERP.

## 34. Do Not Overengineer Future Requirements

Future flexibility does not mean building everything today. Do not build complex fleet management (we don't own fleets), full HR (not yet required), manufacturing (we don't manufacture), complex warehouse management (inventory is small), heavy project management (projects are simple), or advanced CRM (sales needs are basic). Build the foundation so these can be added later.

## 35. The ERP Should Feel Like One System

Customer → Job → Transportation → Expense → Invoice → Payment → Accounting → Profitability should feel like one application, not switching between unrelated ones.

## 36. Integration With Zoho / Other Systems

Possible (not mandatory) architecture — evaluate each integration on actual business needs:
- **Custom ERP:** jobs, operations, transportation, field services, custom settlements, operational documents, business-specific workflows
- **Zoho Books:** accounting, general ledger, receivables, payables, banking, reconciliation, standard financial reports
- **Zoho Inventory:** inventory, purchasing, warehousing
- **CRM:** leads, opportunities, customer relationship management

## 37. System of Record

For every piece of information, answer **"where does the truth live?"**: transportation trip, driver settlement, operational job → custom ERP; accounting journal → Zoho Books or ERP (per architecture decision); inventory → Zoho Inventory or ERP; CRM → CRM system or ERP. Never allow two systems to independently become authoritative for the same financial fact.

## 38. Build vs Integrate

Unique to our business → build. Standard and mature elsewhere → consider integrating. Partly unique → hybrid. Decide on accuracy, cost, integration, maintenance, security, user experience, scalability, local business requirements.

## 39. Most Important UX Principle

Users must not need to understand the ERP architecture. They think: "I need to create a job" → "What does this job need?" — and the system guides them.

## 40. Most Important Product Principle

The ERP adapts to the business; the business should not reorganize itself to fit the ERP. At the same time, the ERP enforces necessary controls around money, approvals, documents, accounting, security, and historical records.

## 41. Final Flexibility Principle

- **Simple by default** — a simple job is fast.
- **Modular when needed** — additional capabilities can be activated.
- **Configurable** — rules change without rewriting the system.
- **Controlled** — financially important actions require proper authorization.
- **Traceable** — everything important traces back to its source.
- **Scalable** — the same architecture supports larger, more complex work later.

## 42. Final Development Rule — Before Creating a New Module

When implementing any new project type, do **not** immediately create a new module. First ask:
1. Can the existing Job model handle it?
2. Can existing Activities handle it?
3. Can existing Cost/Revenue transactions handle it?
4. Can existing Documents handle it?
5. Can existing Approval functionality handle it?
6. Can an existing specialized capability handle it?
7. Is a genuinely new entity required?

Only create a new specialized module when the existing model cannot represent the business accurately. This prevents ERP bloat.

## 43. Final Test — Architecture Acceptance Scenarios

Before approving a new architecture or feature, test it against at least:
- **A — Simple Product Supply:** customer asks for 20 units → must stay simple.
- **B — Petroleum Transportation:** product transported by external transporter → activates transportation capabilities.
- **C — Direct Driver:** company works directly with a driver → works without a transporter.
- **D — Driver Changes Transporter:** same driver later works through another transporter → historical jobs unchanged.
- **E — Field Service:** work inside a petroleum field → no truck/driver/MT workflow required.
- **F — Product + Transportation:** company sells product and arranges transport → both capabilities connect to the same Job.
- **G — Customer-Specific Requirement:** customer requires a special document and approval → handled by configuration, not by changing the ERP.
- **H — Completely New Service:** new type of work → existing Job + Activities + Costs + Revenue + Documents handle most of it before any new specialized module.

## 44. Final Architectural Target

```
                COMPANY ERP
                     │
            ┌────────┴────────┐
            │                 │
       GENERAL CORE      SPECIALIZED
            │                 │
    ┌───────┼───────┐    ┌────┼────┐
    │       │       │    │    │    │
 Customer  Job   Finance  Transport Field Supply
    │       │       │       │      │
 Contract Activities       Trip   Work Order
    │       │               │      │
 Documents Costs           Driver Materials
    │       │               │      │
 Revenue Payments          Truck   Equipment
    │       │               │      │
    └───────┴───────────────┴──────┘
                    │
              PROFITABILITY
                    │
                REPORTING
                    │
               MANAGEMENT
```

**GENERAL AT THE CORE · SPECIALIZED AT THE EDGES · SIMPLE FOR USERS · FLEXIBLE FOR THE BUSINESS · STRICT WITH MONEY AND DATA.**

That is the architecture this project must follow.
