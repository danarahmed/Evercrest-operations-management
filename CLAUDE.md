# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# COMPANY ERP — MASTER DEVELOPMENT CONSTITUTION

## 0. Repository Status

The repository currently contains no application code. The technology stack, build/lint/test commands, and code layout have **not yet been decided**.

- Do not assume a stack. Propose one (with reasoning against sections 37–42 and 67) and get confirmation before scaffolding.
- Once code exists, replace this section with: the stack, how to install, run, lint, test (including how to run a single test), and the actual module layout.
- Before any large build-out, make and record the BUILD / REUSE / HYBRID decision for accounting, inventory and CRM (sections 37–42, 67, 69) and the system of record for each data category.

---

## 1. Purpose of This File

This file is the permanent instruction and architectural constitution for this ERP project.

You are **not** building a generic demo ERP. You are building a real business management system for a General Private Ltd company operating primarily in petroleum-related business while also performing multiple other types of commercial, industrial, logistics, supply, and field-service activities.

The ERP must become a reliable operational and financial system for the company. Most important objectives:

1. Accurate data
2. Reliable financial calculations
3. Controlled operational workflows
4. Complete traceability
5. Strong document management
6. Clear responsibility
7. Management visibility
8. Reduced manual work
9. Reduced duplicate data entry
10. Fast and practical daily operation
11. Scalable architecture
12. Ability to support future business activities

The ERP must make the company easier to operate and manage. It must **not** become another complicated administrative burden.

## 2. Company Business Reality

The company's main area of business is petroleum-related work, but it is **not** limited to petroleum.

The company can:
- Provide petroleum products and other products
- Transport products, or arrange transportation
- Work with external transporters, or directly with drivers
- Perform services inside petroleum fields; industrial/field services
- Provide manpower or operational services where applicable
- Provide logistics services
- Perform project-based and contract-based work
- Purchase and resell products
- Perform other commercial activities as the business develops

The company does **not** necessarily:
- Own the trucks it uses
- Employ every driver it works with
- Own a refinery
- Own every product it handles
- Directly perform every physical activity itself

The ERP must represent this reality.

## 3. The ERP Must Be General-Purpose

Do **not** build a "truck transportation ERP." Do **not** build a "petroleum-only ERP." Build a **general ERP core** with specialized modules.

**General core:**
Company → Business Partners → Customers → Suppliers → Contractors → Contracts → Projects → Jobs → Work Orders → Activities → Resources → Documents → Costs → Revenue → Receivables → Payables → Payments → Accounting → Reporting → Profitability

**Specialized modules attached to the core (examples):**
- **Transportation:** trips, drivers, trucks, transporters, loading, unloading, advances, documents, demurrage, shortage, settlements
- **Product Supply:** products, purchasing, sales, inventory, delivery, supplier costs, customer pricing, margins
- **Field Services:** projects, work orders, employees, contractors, materials, equipment, field expenses, timesheets, completion records
- **Logistics:** jobs, shipments, vehicles, external carriers, delivery, documents, costs
- **General Services:** service orders, activities, resources, costs, billing, profitability

The system must allow future service types without redesigning the entire ERP.

## 4. Core Architectural Principle

- **GENERAL CORE** for concepts common to most business activities.
- **SPECIALIZED MODULES** for business-specific workflows.
- **CONFIGURABLE BUSINESS RULES** for rates, fees, approvals, calculations, and commercial arrangements.

Do not force every business activity into the same operational structure. A transportation job and a field-service job are not the same thing. They should share customer, contract, job, documents, costs, revenue, payments, accounting and reporting — but can have completely different operational data.

## 5. Business Partner Model

Do not create rigid assumptions about external parties. A business partner may act as customer, supplier, transporter, contractor, service provider, subcontractor, driver, or other external party. The same organization may have multiple roles.

Do not create duplicate organizations simply because they interact with the company in different ways. Use a flexible business-partner model.

## 6. Driver Data — Critical Real-World Rule

Do **not** assume the company has complete driver information. Often the company receives only:
- Driver name
- Truck plate number

That must be enough to begin an operational transaction. Do not block a trip because the company lacks driver phone, license, address, full identification, permanent transporter, full truck information, or other optional data. Additional information can be collected later.

## 7. Driver Is Not Permanently Linked to a Transporter

A driver may change transporter from time to time:

| Trip | Driver | Transporter |
|------|--------|-------------|
| 001  | Ahmed  | Company A   |
| 018  | Ahmed  | Company B   |
| 027  | Ahmed  | Direct      |

All historical relationships must remain unchanged.

**Do not design** `Driver → Permanent Transporter`.
**Instead:** `Driver + Trip Assignment + Transporter at time of transaction`.

The transporter relationship is primarily transactional/historical.

## 8. Truck Model

A truck is **not** automatically a company asset. It can belong to a transporter, a driver, a third party, or an unknown/other arrangement. Record the truck used in a transaction without assuming ownership. The most important initial identifier may simply be the **truck plate number**; more information can be added later.

## 9. Direct Driver Model

The company may work directly with a driver. `Company → Driver → Truck` must be valid without requiring `Company → Transporter → Driver`. The transporter is optional where the business relationship does not require one.

## 10. Transaction-First Data Collection

Do not force users to complete a perfect master record before they can perform real work. The workflow should allow:

Known information now → Transaction created → Work continues → Additional information added later → Verification → Finalization

## 11. Unknown Is Not Zero

Applies throughout the entire ERP. Missing information must never automatically become `0` unless the business rule explicitly says the value is zero.

- Missing demurrage date ≠ $0 demurrage
- Missing fee ≠ $0 fee
- Missing quantity ≠ 0 quantity
- Missing expense ≠ $0 expense
- Missing rate ≠ current rate
- Missing document ≠ document received

Use statuses such as **Missing, Pending, Required, Not Applicable, Awaiting Verification** when appropriate.

## 12. Source of Truth

Every important business fact must have one authoritative source:

- Customer information → Customer master
- Driver information → Driver master + historical transaction assignments
- Transporter for a trip → Trip assignment
- Trip price → applicable transaction/rate rule
- Driver advance → Advance transaction
- Final settlement → Settlement transaction
- Customer receivable → Financial transaction

Do not duplicate important values unnecessarily.

## 13. Historical Data Must Be Protected

Historical transactions must retain the values and rules that applied when the transaction occurred.

Example: June 10 price = $100/MT; June 20 price = $105/MT. If a user changes today's price to $110/MT, historical June trips must **not** recalculate to $110.

Historical transactions must preserve: applicable rate, fee, reward, rules, customer, transporter, driver, quantities, dates, financial values.

If a correction is necessary, use an authorized correction/adjustment process. Never silently rewrite history.

## 14. Trip / Job Identification

Every major operational transaction must have a unique identifier — **Trip ID** for transportation; **Job ID / Work Order ID / Project ID** for general business.

The identifier must connect all relevant information, e.g.:
Trip ID → Customer → Job → Driver → Truck → Transporter → Loading → Quantity → Price → Advance → Documents → Unloading → Demurrage → Shortage → Settlement → Customer receivable → Profitability

## 15. General Job Model

Customer → Contract → Project → Job → Work Order → Activities → Resources → Costs → Revenue → Documents → Settlement → Accounting

Not every job needs every layer. Use only what is appropriate.

## 16. Contracts

Contracts are independent from individual transactions. A contract may define: customer, supplier, service, product, pricing, rates, validity dates, payment terms, responsibilities, allowances, penalties, required documents, commercial conditions.

Transactions reference the applicable contract where appropriate. Do not copy the entire contract into every transaction.

## 17. Configurable Rate Engine

Commercial rules change. Support **effective-dated rates**.

Rate types include: product price, transportation price, transporter fee, driver reward, service rate, demurrage rate, customer price, supplier price, commission, penalty, allowance.

Rates are associated with dimensions such as customer, supplier, product, service, location, date range, contract, job type.

Do not hard-code changing business rates.

## 18. Petroleum Transportation Model

Order/Job → Trip → Driver/Transporter → Truck → Loading → Advance → Transportation → Arrival → Unloading → Documents → Demurrage → Quantity reconciliation → Shortage/forgiveness → Final settlement → Customer billing/receivable → Profitability

## 19. Loading Data

At loading the system may know: driver name, truck plate, transporter, loading location, loading date, product, loaded quantity, MT, applicable price, reward, initial advance.

Automatically derive whatever can be derived safely. Do not ask users to calculate values manually if the ERP can calculate them reliably.

## 20. Advances

An advance is a **cash movement**, not automatically the final expense. A trip can have multiple advances.

Each advance contains: Trip ID, driver/payee, amount, currency, date, purpose, payment method, paid by, approval, supporting document, reconciliation status.

The system must maintain: **Total Advances vs Final Entitlement vs Remaining Settlement**.

## 21. Cash vs Cost vs Receivable

Never confuse:
- **Cash movement** — money physically paid or received.
- **Business cost** — economic cost belonging to the company.
- **Customer-reimbursable cost** — paid by the company but recoverable from the customer.
- **Receivable** — amount the customer owes the company.
- **Profitability** — revenue minus applicable economic costs.

## 22. Customer-Reimbursable Costs

For customers such as Dazzle, certain costs may be the customer's responsibility (e.g. visa, insurance, demurrage, MT forgiveness/allowance, other contractually reimbursable costs). Track these separately from company-owned costs.

Example — company pays $500 demurrage:
- Cash movement: company paid $500
- Customer responsibility: customer owes $500
- Receivable: $500
- Company P&L: do not treat it as an ordinary company expense if fully recoverable under the contract.

Exact accounting treatment must follow the company's accounting policy and contract.

## 23. MT and Quantity Control

Clearly distinguish: liters, KG, MT, loaded quantity, discharged quantity, difference, allowance, forgiveness, approved adjustment, chargeable shortage.

Never mix units. Every quantity must have a defined unit.

## 24. Shortage / Forgiveness

Example: difference 250 KG, approved forgiveness 200 KG → chargeable shortage 50 KG.

```
Chargeable Shortage = MAX(Difference − Forgiveness − Approved Adjustment, 0)
```

Never overwrite the original difference. Store separately: original difference, forgiveness, approved adjustment, final chargeable shortage, monetary value, approval, reason.

## 25. Demurrage

Demurrage rules must be configurable and effective-dated. Rules may differ in start date, end date, free days, and rate per day.

Historical examples (must **not** become hard-coded assumptions):
- Loading date 17 Jun–17 Jul: start = storage/parking arrival; end = discharge; free days = 5; rate = $50/day
- Loading date 18 Jul–31 Jul: start = loading date; end = discharge; free days = 7; rate = $50/day

## 26. Demurrage Missing Information

If required information is missing, do **not** calculate zero. Example: arrival date required but unavailable → status `MANIFEST / ARRIVAL DATE REQUIRED`.

Distinguish: **Not incurred** vs **Not yet calculated** vs **Data missing** vs **Pending approval**.

## 27. Driver Settlement

Conceptual settlement:

```
Gross entitlement
− Advances
− Shortage fine
− Deduction fee
− Other valid deductions
= Remaining amount
```

The actual formula must be configurable where commercial agreements differ. Paid Fee must not automatically be treated as a driver deduction when it is a separate transporter payment.

## 28. Deduction Fee / Paid Fee

- **Deduction Fee** = amount deducted from driver
- **Paid Fee** = amount later paid to transporter
- **Fee Difference** = Deduction Fee − Paid Fee; expected `>= 0`

If Paid Fee > Deduction Fee → show `LOSS / MANAGEMENT REVIEW REQUIRED`.

If the transporter returns the required document and the business rule says no fee applies: Deduction Fee = 0, Paid Fee = 0.

## 29. Document Management

Documents are part of the transaction: manifest, delivery document, loading document, insurance, visa, demurrage evidence, invoice, receipt, approval, contract, completion certificate.

Link documents to job, trip, settlement, expense, invoice, purchase, payment as appropriate.

## 30. Document Status

Controlled statuses: **Required, Pending, Received, Verified, Rejected, Missing, Expired**.

A transaction is not financially complete merely because money was paid.

## 31. General Expense Engine

Expenses can be associated with: company, department, project, job, customer, contract, trip, location, cost center.

An expense can be: company expense, customer-reimbursable, project cost, trip cost, supplier cost, or other defined category. Do not use a single generic "expense" bucket for everything.

## 32. Procurement

Support where needed: Purchase Request → Purchase Order → Receipt → Supplier Bill → Payment. Do not duplicate mature procurement/accounting functionality if an integrated external system already provides it.

## 33. Inventory

Inventory applies only where the company owns or controls inventory. Do not assume every petroleum product handled is company-owned inventory.

```
Opening + Purchases + Receipts − Sales − Issues ± Adjustments = Closing
```

Track: product, unit, quantity, location, ownership, batch (if required), cost, movement.

## 34. Field Services

Support work inside petroleum fields and other industrial locations. Field jobs may involve customer, contract, site, work order, personnel, contractor, equipment, materials, consumables, transportation, expenses, time, completion, documents, billing, profitability.

Do not force field-service work into a truck-trip structure.

## 35. General Service Engine

Support configurable: Service Type → Job → Activities → Resources → Costs → Revenue → Documents → Billing → Profitability. A new service must not require rebuilding the ERP core.

## 36. Accounting Architecture

Accounting must be connected to operations. It must be possible to trace:
- Accounting Entry → Financial Transaction → Job/Trip → Operational Event → Supporting Document
- Job/Trip → Revenue → Cost → Receivable/Payable → Accounting Entry

## 37. Do Not Reinvent Mature Accounting Software

Before implementing accounting functionality from scratch, evaluate whether a mature platform (e.g. Zoho Books, other established accounting systems, existing company accounting software) can perform it reliably.

Zoho Books provides: accounts, general ledger, journals, receivables, payables, expenses, bank reconciliation, inventory, projects, approvals, transaction locking, custom reports, workflow automation, APIs, multi-currency, budgeting. Source: https://www.zoho.com/books/

Do not rebuild these merely for the sake of having everything inside the custom application. Evaluate first.

## 38. Zoho Books Integration Strategy

- **Option A — Accounting backend:** custom ERP handles operations; Zoho Books handles accounting; ERP sends approved financial transactions to Zoho Books.
- **Option B — Accounting reference/integration:** ERP maintains operational and management data while accounting remains in Zoho Books.
- **Option C — Internal accounting:** only with a strong business reason to build and maintain it internally.

Do not assume Option C. Before building accounting modules, evaluate: existing Zoho functionality, integration/API capability, data synchronization, accounting requirements, local compliance requirements, cost, user requirements, reliability, long-term maintenance. Decide on business and technical evidence, not preference.

## 39. Zoho Inventory

For serious inventory needs, evaluate Zoho Inventory (stock management, purchase orders, purchase receives, warehouses, stock transfers, sales orders, invoicing, adjustments, batch/serial tracking, price lists, reordering, integrations) before building from scratch. Source: https://www.zoho.com/inventory/

Principle: **reuse mature functionality where it is better than our custom implementation.**

## 40. CRM / Customer Management

Evaluate mature CRM systems such as Zoho CRM before building a complete CRM internally. The custom ERP owns the operational information unique to this company. If CRM integration is used, CRM ↔ ERP ↔ Accounting must have clearly defined ownership of each data type.

## 41. General "Buy vs Build" Rule

Classify each major module before implementing it:

- **BUILD** — unique to our workflow: driver settlement, transporter settlement, petroleum transportation calculations, customer-specific operational rules, trip lifecycle, custom field-service workflow, company-specific approval logic.
- **REUSE / INTEGRATE** — solved well by mature software: general accounting, bank reconciliation, standard invoicing, standard inventory, standard CRM, standard payroll (where appropriate), generic document functions.
- **HYBRID** — unique workflow plus mature underlying functionality, e.g. custom Transportation ERP + Zoho Books accounting.

Make this decision before large implementation work.

## 42. Do Not Duplicate Systems Without a Reason

Avoid ERP accounting + Zoho accounting where both are authoritative. One source of truth per financial concept. If two systems are connected, define: system of record, data owner, synchronization direction, synchronization frequency, conflict handling, error handling, audit trail.

## 43. Integration-First Architecture

Design so external systems can be connected later. Use stable internal IDs (Customer, Supplier, Job, Trip, Invoice, Payment IDs).

Where integrations exist, store: internal ID, external system ID, sync status, last synchronized time, error status, sync history. Never use external IDs as the only internal identifier.

## 44. Accounting Synchronization

Operational transaction → Validation → Approval → Financial transaction → Accounting sync → External accounting record

Never send incomplete or unapproved financial data automatically. Failed synchronization must be visible. Never silently lose accounting transactions.

## 45. Profitability

Generic model: `Revenue − Direct Costs − Applicable Allocated Costs = Profit`, but cost structures differ by job type:
- **Transportation:** driver costs, transporter fees, rewards, shortage, other direct costs
- **Field services:** labor, materials, equipment, transportation, site expenses
- **Product supply:** purchase cost, transportation, storage, other costs

Do not force one profitability formula onto all business types.

## 46. Management Dashboard

The dashboard answers **"What requires attention?"**, not "How much data exists?"

- **Critical:** missing documents, financial discrepancies, negative margins, unapproved adjustments, failed integrations, overdue receivables
- **Operations:** active jobs, delayed trips, pending settlements, incomplete jobs
- **Finance:** receivables, payables, advances, cash exposure, bank reconciliation, outstanding settlements
- **Profitability:** revenue, cost, margin, customer/project/service profitability

## 47. Data Quality Dashboard

Actively detect bad or incomplete data, e.g.: missing driver, missing truck plate, missing transporter where required, missing price, missing quantity, missing documents, unreconciled advance, duplicate manifest, negative settlement, paid fee > deduction fee, missing demurrage dates, unapproved adjustment, failed accounting synchronization.

Tell management: **what is wrong + why it matters + what action is required.**

## 48. Audit Trail

Important transactions record: created by/date, modified by/date, approved by/date, previous value, new value, reason.

Do not permanently delete financially important records. Prefer the lifecycle: **Draft → Submitted → Approved → Posted → Cancelled → Reversed** where appropriate.

## 49. Role-Based Access

Possible roles: Management, Operations, Finance, Accounting, Field Staff, Procurement, Project Management, Auditor/Controller, Administrator. Users see/change only what they need. Separate financial approval from ordinary data entry where practical.

## 50. Field User Experience

Field users may have mobile phones, limited internet, limited time, incomplete information, paper documents, operational pressure. Field interfaces must be fast, simple, mobile-friendly, saveable, validated, recoverable, and duplicate-resistant. Do not force field users to understand accounting.

## 51. Document / OCR Automation

Use OCR/AI where useful for manifests, delivery documents, invoices, receipts, supporting documents — but always:

OCR → Extract → Validate → Human confirmation → Official record

AI/OCR must not silently change financial data.

## 52. AI Rules

AI can assist with data extraction, anomaly detection, missing-data detection, report summaries, document classification, search, operational alerts, management insights.

AI must **not** silently change prices, settlements, or accounting entries; approve payments; delete records; or change historical transactions without an explicitly authorized workflow.

## 53. No Magic Numbers

Never hard-code unexplained business values (`50`, `7`, `5`, `100`, `200`). Use named, configurable rules (`DEMURRAGE_RATE`, `FREE_DAYS`, `TRANSPORT_RATE`, `FORGIVENESS_RULE`).

## 54. Validation

Prevent obvious errors before bad data reaches financial reports: invalid dates, discharge before loading, duplicate manifest, negative quantity, missing rate, missing required approval, payment greater than balance, paid fee greater than deduction fee, missing required document, duplicate transaction.

## 55. Reporting

Reports must be actionable.
- **Operations:** active jobs, active trips, delayed work, pending documents, pending settlements
- **Finance:** receivables, payables, advances, cash, bank, expenses, customer balances
- **Management:** revenue, costs, profitability, customer/project/service performance
- **Control:** data-quality exceptions, approval exceptions, financial discrepancies, integration failures

## 56. Drill-Down

Every important report number must be traceable: Profit report → Customer → Project → Job → Trip → Cost → Transaction → Document. If management asks "Why is this $5,000?", the system provides the underlying transactions.

## 57. Month-End

1. Complete operational records
2. Verify documents
3. Reconcile advances
4. Finalize settlements
5. Verify receivables
6. Verify payables
7. Verify reimbursable costs
8. Verify accounting synchronization
9. Reconcile bank/cash
10. Review profitability
11. Lock/close period

After closing, historical changes require controlled authorization.

## 58. Security

Protect financial, customer, employee, supplier, document, and payment information. Use authentication, authorization, role-based permissions, audit logs, secure APIs, input validation, encryption where appropriate, backups, and recovery procedures.

## 59. Development Process

Before changing code:
1. Understand the business problem.
2. Inspect the existing system.
3. Inspect the database.
4. Inspect related modules.
5. Identify dependencies.
6. Identify existing calculations.
7. Identify integrations.
8. Identify financial consequences.
9. Identify edge cases.
10. Then implement.

Never rewrite large sections simply because another implementation seems cleaner.

## 60. Do Not Destroy Working Features

If a feature works, keep it unless there is a strong reason to change it. Before modifying, determine: what it does, who uses it, what data/reports/integrations depend on it, whether the calculation is correct, whether it creates data-quality problems. Use the smallest safe change.

## 61. Testing

Every major module requires unit, integration, business-rule, permission, edge-case, and regression tests. Financial calculations require explicit test cases.

## 62. Required Transportation Tests

1. Normal trip
2. Multiple advances
3. Price change during same month
4. Different transporter for different trips
5. Direct driver
6. Missing transporter
7. Missing driver information
8. Missing manifest
9. Missing arrival date
10. Demurrage
11. Shortage
12. Forgiveness
13. Approved shortage adjustment
14. Driver settlement
15. Fee deduction
16. Paid fee
17. Paid fee greater than deduction fee
18. Customer-reimbursable cost
19. Historical rate protection
20. Cancelled transaction

## 63. General ERP Tests

Customer creation, supplier creation, contract, project, job, work order, purchase, sale, expense, payment, receivable, payable, inventory, document, approval, accounting integration, period closing, user permissions.

## 64. Performance

Design for large transaction volumes: efficient queries, indexing, pagination, search, background processing, caching where appropriate, efficient reports. Do not load thousands of records unnecessarily.

## 65. User Experience

Users are business employees, not software engineers: simple language, minimal clicks, minimal repeated typing, pre-filled known information, clear statuses, understandable errors, visible required actions, no unnecessary accounting terminology, focused screens.

## 66. Accounting vs Operations

- Operations records **what happened**.
- Finance understands **what it means financially**.
- Management understands **what requires action**.

Do not force every employee to operate like an accountant.

## 67. Buy vs Build Decision

For every major feature:
- Unique to our company? → **BUILD**.
- Standard capability reliably solved by mature software? → **EVALUATE REUSE/INTEGRATION**.
- Partly unique, partly standard? → **HYBRID**.

Before implementing major standard capabilities, evaluate Zoho Books, Zoho Inventory, Zoho CRM, other mature ERP/accounting systems, existing company systems, and open-source alternatives. Do not assume Zoho is always the answer, nor that custom development is. Choose on functionality, accuracy, integration, cost, security, local requirements, maintainability, user experience, scalability.

## 68. External Software Is Not a Failure

Using Zoho Books or another mature platform does not mean the custom ERP failed. The goal is the best overall business system. The custom ERP focuses on the company's unique operational complexity.

## 69. System of Record

Explicitly define the system of record for each major data category, e.g.:
- Customer: ERP or CRM
- Accounting: Zoho Books or ERP
- Inventory: ERP or Zoho Inventory
- Transportation: custom ERP
- Driver settlement: custom ERP
- Field operations: custom ERP
- Documents: ERP/document system

Do not create competing sources of truth.

## 70. Integration Contract

Every integration defines: source system, destination system, data owner, direction, trigger, frequency, external ID, internal ID, error handling, retry behavior, conflict handling, audit log. Integration failures must be visible to users.

## 71. Data Migration

When importing old Excel files or existing records, never blindly import:

Existing data → Clean → Validate → Map → Detect duplicates → Preview → Approve → Import → Reconcile

Preserve original references where possible.

## 72. General Ledger Traceability

General Ledger → Journal → Financial transaction → Job → Operational transaction → Supporting document. Never create unexplained financial numbers.

## 73. Profitability Rule

Do not calculate profitability as cash received − cash paid unless that is specifically the intended cash-flow metric. Profitability uses economic revenue and costs per the company's accounting/business rules. Cash flow is a separate report.

## 74. Data Quality Over Automation

Priority: **Accurate data → Reliable rules → Controlled workflow → Automation.** A perfectly automated wrong calculation is a serious business failure.

## 75. No Guessing

Never invent business rules concerning money, prices, rates, settlements, accounting, customer/driver/transporter responsibility, inventory ownership, profitability, or legal responsibility. If unclear:
1. Ask for clarification, OR
2. Make it configurable, OR
3. Clearly identify the assumption before implementation.

Never silently guess.

## 76. Definition of Done

A feature is complete only when: UI works; database works; validation works; permissions work; calculations work; audit trail works where required; reports work; integration works where applicable; tests pass; edge cases are handled; existing functionality is not broken; data can be traced.

## 77. Development Priority

1. Data architecture
2. Core business workflow
3. Financial accuracy
4. Security
5. Document control
6. Reconciliation
7. Reporting
8. Exception management
9. Automation
10. Advanced analytics
11. Visual enhancements

Do not prioritize attractive screens over correct business logic.

## 78. Roadmap Layers

- **Foundation:** authentication, users, roles, permissions, business partners, customers, suppliers, products, services, locations, contracts, projects, documents
- **Core operations:** jobs, work orders, activities, expenses, purchases, sales, payments
- **Specialized operations:** transportation, petroleum, field services, logistics, product supply
- **Finance:** receivables, payables, cash, bank, accounting integration, reconciliation
- **Management:** dashboards, reports, profitability, alerts, data quality
- **Automation:** workflows, notifications, OCR, AI, anomaly detection, integrations

Do not attempt to build everything simultaneously.

## 79. Implementation Strategy

Build vertically, not horizontally. Instead of 20 empty modules, build one complete, reliable workflow first:

Customer → Job → Transportation Trip → Advance → Documents → Settlement → Customer Receivable → Accounting → Profitability → Dashboard

Then expand.

## 80. Management-First Design

Management should not need to understand the database to understand the company. The system answers: What happened? What is happening? What is delayed? What is missing? What do we owe? Who owes us? Where are we losing money? Which jobs/customers are profitable? What requires approval? What requires immediate action?

## 81. The ERP's Most Important Purpose

Transform scattered information + WhatsApp + paper + Excel files + employee memory + manual calculations + separate accounting into **one controlled business system**.

## 82. Final Golden Rules

1. Accuracy before automation.
2. Unknown is not zero.
3. Cash movement is not automatically expense.
4. Current master data must not rewrite historical transactions.
5. Driver does not permanently belong to one transporter.
6. Truck does not automatically belong to the company.
7. Transporter can be optional.
8. Petroleum is a major business area, not the only business the ERP supports.
9. Transportation is a specialized module, not the entire ERP.
10. Build unique company workflows; integrate mature standard functionality.
11. Never create two competing sources of truth.
12. Every important number must be traceable.
13. Every important adjustment must be auditable.
14. Never guess financially important business rules.
15. Do not rebuild a mature capability merely because we can.
16. Do not change working functionality unnecessarily.
17. Simple user experience does not mean simple business logic.
18. The system should reduce employee dependency and preserve institutional knowledge.
19. Management must see exceptions and actions, not just totals.
20. Build for the company we operate today while creating a foundation for the company we may become tomorrow.

## 83. Final Instruction to Claude

Act as Senior ERP Architect, Product Manager, Backend Engineer, Frontend Engineer, Database Architect, Financial Systems Architect, Operations Analyst, QA Engineer, Integration Architect, and Business Process Analyst.

Do not behave as a code generator that blindly follows individual requests.
- Understand the business before changing the system.
- Inspect existing code before modifying it.
- Protect existing working functionality, historical data, and financial accuracy.
- Use mature external software where it provides better standard functionality; build custom functionality where the business is genuinely unique.
- When integrating external systems (Zoho Books, Zoho Inventory, CRM, banking, document systems, others), clearly define the system of record and integration boundaries.
- When a business requirement is unclear, do not invent a financially meaningful rule.
- When a feature is technically possible but provides little business value, question whether it should be built.
- When a feature can be implemented safely using existing infrastructure, prefer the simpler reliable approach.

Always ask, in order:
1. What is the real business problem?
2. What is the simplest reliable architecture that solves it?
3. What existing capability can we reuse instead of rebuilding?
4. How do we ensure the data remains accurate and traceable?

The ultimate objective is **one reliable business system** where operations, documents, customers, suppliers, projects, transportation, field services, products, inventory, finance, accounting and reporting are connected without unnecessarily duplicating functionality. The ERP should become the company's institutional memory and operational control system, making complex work easier rather than making the company more dependent on software specialists.
