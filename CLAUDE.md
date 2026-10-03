# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MASTER CLAUDE.md — BUSINESS OPERATING SYSTEM

You are working on an already substantially built business operations, POS, inventory, production, supplier, cash-management, accounting, reporting, and control system for a café/bakery/food-service business.

This document is the single source of truth for the product direction and implementation requirements. Treat it as the overall product and architecture specification, not as a feature request list.

The system already contains substantial functionality. Do not rebuild working functionality unnecessarily. First inspect what already exists, preserve correct functionality, and extend it where required.

The goal is not many disconnected features. The goal is one coherent business operating system where operations, inventory, money, accounting, people, customers, reporting, controls, and management information are connected automatically.

## 1. Product Goal

Build a professional business operating system that makes running a café/bakery/food-service business simple, fast, accurate, controlled, automated, transparent, easy to learn, comfortable to use, and powerful for management.

Employees perform normal daily work without needing to understand the complexity behind the system.

**Core philosophy: complexity belongs inside the system, not inside the user's workflow.**

- Employee: simple input → automatic processing → clear result → actionable exception when something is wrong.
- Management: real operational data → reliable analysis → clear problems → actionable decisions.

## 2. The Most Important Principle

**ONE OPERATION → ONE SOURCE OF TRUTH → AUTOMATIC CONSEQUENCES**

The user records an operation once; the system propagates its consequences to every relevant area.

A sale automatically affects, where applicable: revenue, payment, cash/card/platform balance, inventory, recipe consumption, COGS, customer history, production consumption, accounting, reports, audit trail, alerts.

The user must not manually record the same event in several modules. The same applies to: purchases, deliveries, supplier returns, credit notes, waste, production, refunds, cash movements, staff meals, free items, samples, expenses, branch transfers, payroll.

## 3. Non-Negotiable Priorities

1. Data accuracy
2. Financial integrity
3. Inventory integrity
4. Transaction reliability
5. Security and controls
6. Operational simplicity
7. Automation
8. Management visibility
9. Speed
10. Visual polish

Do not sacrifice accuracy or control merely to reduce clicks. Do not sacrifice usability merely to expose unnecessary complexity. The objective is **reliable simplicity**.

## 4. Existing System — Preserve What Already Works

The system currently manages:

- **Selling:** quick sales, tables, open bills, split bills, moving bills, cancelled bills, discounts, cash, card, delivery-platform payments, receipts, barista tickets, customer numbers
- **Stock:** ingredients, packaging, recipe-based inventory deduction, deliveries, blind stock counts by two people, waste, low-stock alerts
- **Costs and prices:** recipe-based product costing, product margin, scheduled price changes, price history
- **Production:** gelato batches, base production, exact batch costing
- **Suppliers:** delivery receiving, delivery price checking, supplier bills, supplier payments, supplier balances, supplier aging
- **Cash:** drawer counts, over/short, cash transfers to safe, cash transfers to bank, card-to-bank reconciliation, delivery-platform statement reconciliation
- **Accounting:** automatic accounting, Profit & Loss, Trial Balance, month locks
- **Controls:** 9 staff roles, void/refund/cancellation reasons, manager PIN for large discounts, action reports by employee, audit trail, dashboard alerts

All of this must remain functional. If something already works correctly, do not replace it simply because you would personally design it differently.

## 5. Do Not Build Features in Isolation

Evaluate every new feature across:

- **Operations** — what does the employee do?
- **Inventory** — what stock changes?
- **Money** — what money changes?
- **Accounting** — what journal entries are required?
- **Reporting** — which reports change?
- **Permissions** — who can perform or approve it?
- **Audit** — what must be recorded?
- **Alerts** — should management be notified?
- **Reconciliation** — what should this transaction later reconcile against?

A feature that works on its own screen but does not correctly propagate through the rest of the system is incomplete.

## 6. Product Sizes

Products support multiple sizes (e.g. Latte: Small / Medium / Large). Each size may have a different selling price, recipe, ingredient quantities, packaging, cost, margin, and availability. Do not force users to create unrelated products for every size.

Reports support product totals and sales, quantity, revenue, cost, and margin **by size**.

## 7. Add-ons / Modifiers

Support proper modifiers (extra scoop, oat milk, extra shot, syrup, topping, sauce, extra ingredient). Each modifier supports: name, selling price, cost, inventory consumption, quantity consumed, availability, category, product compatibility, optional/required status, price history where appropriate.

Example: Extra espresso shot — selling price $1, consumes X grams of espresso beans. The system automatically updates sale value, inventory, COGS, margin, accounting, and reporting.

Do not create a separate product called "Latte + Extra Shot."

## 8. Payments

Support cash, card, delivery platform, other configured methods, and split payments. A single sale may be paid by multiple methods (e.g. $20 = $12 cash + $8 card). This remains **one sale with multiple payment allocations** — never two sales.

## 9. Multi-Currency — IQD and USD

**Core architectural requirement.** The business actively uses both **IQD (Iraqi Dinar)** and **USD**. Both are first-class currencies. Do not treat USD as an occasional foreign-currency payment. The entire system must be professionally multi-currency.

## 10. Currency Architecture

Every monetary value must have a clearly defined currency. Never store an unexplained monetary amount.

Support: original amount, original currency, exchange rate where applicable, exchange-rate date/time, reporting/base-currency equivalent, historical exchange rate.

Adding a `currency` field to a few tables is not multi-currency. Review **every** monetary entity in the database.

## 11. Base / Reporting Currency

Support a configurable reporting/base currency. If IQD is the reporting currency, USD transactions remain recorded in USD and may additionally show their IQD equivalent. Never replace the original USD amount.

Example: original $100 USD; rate 1 USD = 1,500 IQD; reporting equivalent 150,000 IQD. Retain all three.

## 12. Historical Exchange Rates

Historical transactions retain the rate used when they occurred.

- Sept 1: $100 × 1,500 = 150,000 IQD
- Sept 10: $100 × 1,520 = 152,000 IQD

The Sept 1 transaction stays at its historical rate. Changing today's rate must not rewrite yesterday's transaction.

## 13. Exchange-Rate Management

Exchange rates are controlled business data. Store: rate, effective date/time, source/type, user who entered it, previous rate, new rate, audit trail.

Where the business requires different rates for different purposes, support that without complicating normal employee workflows.

## 14. Sales in IQD and USD

Products support IQD prices, USD prices, configurable pricing behavior, and optional conversion. Do not assume USD prices are always calculated from IQD — businesses may intentionally maintain separate IQD and USD prices.

## 15. Mixed-Currency Payments

A single bill may be paid in multiple currencies (e.g. bill $20; customer pays $10 USD + 15,000 IQD). The system calculates the combined payment value using the applicable exchange rate. It remains one sale.

Each payment allocation retains: amount, currency, payment method, exchange rate where applicable, reporting equivalent.

## 16. Payment Currency vs Sale Currency

These are different concepts. A bill may be denominated in USD and paid partly or fully in IQD, or vice versa. Handle both correctly. Employees must not manually calculate conversions.

## 17. Cash Drawers and Currencies

Cash is tracked separately by currency (e.g. drawer: IQD 500,000; USD $200). Never combine them into a single meaningless cash number. Safe and bank balances are also currency-specific.

## 18. Blind Cash Count

The stock-count blindness principle also applies to cash. The cashier must not see expected cash before entering the actual count.

1. Select session.
2. Count IQD.
3. Count USD.
4. Submit.
5. System calculates expected amounts.
6. System reveals expected vs actual.
7. System calculates over/short.

Example: expected IQD 300,000 / USD $100; actual IQD 295,000 / USD $95. Report each currency's difference separately.

## 19. Cash Denominations

Support denomination counting where practical, with a **configurable** denomination list.
- IQD (e.g.): 250, 500, 1,000, 5,000, 10,000, 25,000, 50,000
- USD (e.g.): $1, $5, $10, $20, $50, $100

## 20. Cashier Sessions

Each session tracks: cashier, drawer, opening/closing time, opening cash, cash sales, cash refunds, cash in/out, safe transfers, expected cash, actual cash, over/short, manager overrides.

If a physical drawer is shared, responsibility must remain traceable through explicit session ownership or controlled session transfers.

## 21. Cash Movements

Every cash movement specifies: amount, currency, source, destination, reason, user, date/time, approval where required (e.g. "100,000 IQD to safe", "$500 USD to bank"). Never record "100,000 cash" without currency.

## 22. Partial Refunds

Support partial refunds (e.g. sale of coffee $4 + cake $6 + juice $5; refund only the cake $6). The original sale remains intact; create a **linked refund transaction**.

Automatically reverse the appropriate revenue, payment, inventory, COGS, tax, customer history, accounting, and reports. Refunds require appropriate permission and reason.

## 23. Refunds and Multi-Currency

Refunds preserve currency logic. For mixed payments, clearly identify which payment allocation is being refunded. Never change the original historical exchange rate because a refund occurs later.

## 24. Supplier Returns

Link returns to the original purchase/delivery whenever possible. Automatically update inventory, supplier balance, purchase records, accounting, reports, audit trail.

## 25. Supplier Credit Notes

Support credit notes with: supplier, original transaction, amount, currency, reason, date, accounting treatment, approval if required. Supplier balances update automatically.

## 26. Delivery Corrections

Provide controlled correction workflows for quantity errors, price errors, wrong item, wrong supplier, wrong date. Do not allow unrestricted editing of historical financial transactions. Preserve original value, new value, user, date/time, reason, audit history.

## 27. Purchase Orders

Lifecycle: **Draft → Approved → Sent → Partially Received → Fully Received → Closed/Cancelled**.

POs include: supplier, items, quantities, expected prices, expected delivery, notes, approval, status.

Receiving automatically compares PO vs actual delivery and highlights quantity differences, price differences, unexpected items, missing items.

## 28. Buying / Reorder List

Low-stock alerts are not enough. Generate suggested purchasing lists using: current stock, minimum stock, target stock, consumption, sales history, production requirements, supplier pack sizes, lead time, open purchase orders, expected deliveries.

Example: Milk current 30 L, minimum 40 L, target 100 L → suggested purchase 70 L. **Explain why** each quantity was suggested.

The manager can accept, modify, remove, add, or convert to a purchase order. Never make purchasing blindly automatic.

## 29. Production Planning

Support: what to make today, required quantities, existing finished stock, expected demand, ingredient availability, use-by dates, batch dates, batch quantities, made, sold, waste, remaining.

The system helps answer: **What should we make today and why?**

## 30. Production Traceability

Every batch is traceable and must reconcile. Example: Batch B1024 — produced 50 kg, sold 35 kg, waste 5 kg, remaining 10 kg.

## 31. Staff

Implement: employees, attendance, clock-in/out, scheduled shifts, actual shifts, overtime where appropriate, absence, late arrival, early departure, salaries, salary payments, advances, deductions, payroll history.

Salary must not exist only as a generic expense. Accounting is still generated automatically.

## 32. Customers

Support: name, phone, delivery address, notes, order history, preferences where appropriate, loyalty. Customer identification remains optional for normal anonymous walk-in sales.

## 33. Loyalty

Support configurable loyalty (points, visits, spending thresholds, rewards). Prevent duplicate points, points from cancelled or refunded sales, and unauthorized manual adjustments. Audit loyalty changes.

## 34. Waste

Separate categories: expired, spoiled, damaged, production waste, preparation waste, staff meals, free items, samples, other. Do not treat them as one generic waste category.

Each has appropriate inventory effect, accounting classification, approval, reason, person responsible, and reporting.

## 35. Waste Approval Control

The approval limit must not be bypassable by splitting losses into multiple small entries. Consider related entries by user, shift, day, item, category, and related operation.

Example: approval limit $50 — a user must not bypass it with $40 + $40 + $40. The system identifies the aggregate activity and requests appropriate approval.

## 36. Theoretical vs Actual Usage

Implement usage variance analysis:
- **Theoretical usage** — what recipes say should have been consumed.
- **Actual usage** — what inventory movement/counts indicate was consumed.

Example: opening milk 100 L + purchases 50 L − closing 60 L = actual usage 90 L; theoretical 82 L; variance 8 L.

Show: item, theoretical usage, actual usage, variance, variance %, sales volume, period, branch.

Do not automatically accuse employees of theft. Identify discrepancies for investigation. Possible causes: over-pouring, incorrect recipes, unrecorded waste, staff consumption, theft, counting errors, production errors.

## 37. Configurable Business Rules

Move rules currently hard-coded in the database to an appropriate settings/admin interface (discount limits, waste approval limits, negative-stock behavior, other thresholds). Rules may be configured by role, branch, transaction type, and product/category where appropriate. Changing a rule is itself audited.

## 38. Negative Stock

Configurable policies: block; allow with manager approval; allow with immediate alert; allow for selected items. Never silently create unexplained negative inventory.

## 39. Duplicate Transaction Protection

Duplicate protection covers **all** transactional operations: sales, payments, deliveries, purchases, expenses, waste, production, supplier payments, supplier returns, stock adjustments, transfers, refunds, cash movements.

Use proper backend/database-level idempotency — not just disabled buttons. If the connection drops after submission and the user retries, the system safely identifies the original request and prevents duplication.

## 40. Branches

Support multiple branches without disconnected copies of the application. Relevant records support branch identification: sales, cash, inventory, purchases, waste, production, staff, expenses, reports, transfers.

Management can view one branch, selected branches, or the consolidated company.

## 41. Accounting

All operational transactions integrate correctly with accounting. For each transaction determine:
1. Operational effect
2. Inventory effect
3. Cash/bank effect
4. Receivable/payable effect
5. Revenue/cost/expense effect
6. Required journal entries
7. Reporting effect
8. Audit requirements

Accounting is not an afterthought.

## 42. Multi-Currency Accounting

The General Ledger preserves original amount, original currency, exchange rate, and reporting amount. Receivables and payables preserve currency — e.g. a supplier with USD payable $4,000 and IQD payable 2,500,000 IQD shows these separately.

## 43. Foreign Exchange Differences

Support appropriate FX gain/loss treatment. Example: invoice $1,000 at 1,500 = 1,500,000 IQD; payment $1,000 at 1,520 = 1,520,000 IQD; difference 20,000 IQD — handled per the configured accounting treatment. Do not hide currency differences inside unrelated expenses.

## 44. Inventory Costing With Multiple Currencies

Purchases may be in IQD or USD. Always preserve original purchase amount, original currency, exchange rate, and reporting equivalent. Inventory costing uses a consistent, defined methodology. Do not silently mix currencies.

## 45. Production Costing With Multiple Currencies

Production batches correctly consume ingredient costs regardless of purchase currency. Historical cost remains traceable. Current exchange rates must not rewrite historical production costs.

## 46. Reports

- **Sales:** by hour, day of week, date, product, category, size, modifier, employee, payment method, currency, branch; discounts, refunds, voids, cancellations
- **Waste:** by type, item, employee, branch, period, cost
- **Inventory:** current stock, stock movement, count variance, usage variance, negative stock, expiring stock
- **Production:** planned, produced, sold, waste, remaining, batch cost
- **Suppliers:** purchases, returns, credit notes, payments, outstanding, aging
- **Cash:** cashier sessions, cash counts, over/short, cash movement, currency breakdown

## 47. Balance Sheet

Implement a proper balance sheet from the actual accounting ledger — not a separate calculation disconnected from accounting.
- **Assets:** cash, bank, inventory, receivables, other assets
- **Liabilities:** supplier payables, other liabilities
- **Equity:** capital, retained earnings, other relevant equity

## 48. Cash Flow Statement

Implement a proper cash-flow statement from accounting/cash transactions, with operating, investing, and financing activities. It must reconcile with cash and bank balances.

## 49. PDF Export

Support PDF export for: sales, purchases, suppliers, waste, inventory, production, cash, P&L, Trial Balance, Balance Sheet, Cash Flow, audit reports.

## 50. Document Attachments

Allow attaching supplier invoices, delivery documents, receipts, credit notes, supporting documents, and relevant images, linked to the appropriate transaction/document.

## 51. Dashboard

Focus on actionable information, not just numbers.
- **What happened?** Sales, cash, stock, production, waste, purchases, supplier obligations
- **What is wrong?** Usage variance, cash shortage, negative stock, unusual waste, supplier price changes, delivery discrepancies, reconciliation failures, duplicate transaction risks
- **What needs action?** Purchase approval, waste review, cash investigation, stock count, refund approval, delivery receiving, supplier payment, production

## 52. Alerts

Priorities: **Critical** (immediate action), **Warning** (requires attention), **Information** (useful information). Alerts should ideally carry an action: review, approve, count, investigate, open transaction, resolve. Do not overwhelm users with meaningless alerts.

## 53. Permissions

Use the existing 9-role architecture. Permissions control: view, create, edit, cancel, refund, approve, export, financial visibility, stock adjustments, cash adjustments, rule changes, accounting corrections. Sensitive operations require appropriate authorization. Important permissions are enforced **server-side**.

## 54. Audit Trail

Sensitive actions record: user, date/time, branch, action, original value, new value, reason, approval, related transaction.

Especially: refunds, voids, cancellations, discounts, waste, stock adjustments, cash adjustments, supplier corrections, accounting corrections, rule changes, exchange-rate changes, permission changes, manual overrides.

## 55. Reconciliation

The system continuously helps answer: **Does reality match what the system says?**

- **Cash:** expected vs actual
- **Card:** recorded vs bank settlement
- **Delivery platforms:** recorded orders vs platform statement
- **Inventory:** system stock vs counted stock
- **Usage:** theoretical vs actual
- **Supplier:** purchases vs invoices vs payments vs credits
- **Production:** produced vs sold vs waste vs remaining
- **Accounting:** subledgers vs general ledger

## 56. No Silent Data Loss

Never silently delete transactions, rewrite historical transactions, remove audit records, change closed accounting periods, rewrite inventory history, or rewrite payment history. Use reversal, adjustment, correction, or controlled edit where appropriate.

## 57. User Experience

Powerful without feeling complicated. The user should feel "the system understands what I am trying to do," not "I have to understand the system before I can use it."

## 58. Minimize Clicks

For frequent tasks use smart defaults, contextual actions, search, keyboard shortcuts, quick actions, auto-population, templates, clear confirmations, progressive disclosure. Do not hide important financial/control information merely to reduce clicks.

## 59. Information Hierarchy

Every screen answers:
1. What am I looking at?
2. What is happening?
3. What do I need to do?
4. What happens if I continue?
5. Is anything wrong?

Basic users see what they need; managers see more detail; accountants/admins access deeper financial and audit information.

## 60. One Unified Operating System

The product must not feel like separate Sales + Inventory + Accounting + HR + Purchasing + Reports applications.

- **Receiving goods:** receiving → inventory → supplier balance → cost → accounting → reports → audit
- **Selling:** sale → payment → inventory → recipe consumption → COGS → accounting → reports → customer → audit
- **Recording waste:** waste → inventory → classification → cost → accounting → approval → audit → reporting

## 61. Data Accuracy Over Automation

Never automate an incorrect assumption. If information is missing: ask, warn, require confirmation, or classify it clearly as an adjustment.

Never silently guess: exchange rate, supplier, branch, inventory item, waste reason, accounting treatment.

## 62. Do Not Over-Automate

Automate deterministic repetitive work. Require human confirmation for large refunds, large waste, major stock adjustments, accounting corrections, important rule changes, suspicious discrepancies, significant financial adjustments.

## 63. Database / Backend Quality

Review: transaction integrity, database constraints, unique transaction IDs, idempotency, race conditions, concurrent edits, permissions, audit logging, referential integrity, inventory consistency, accounting consistency, multi-currency integrity. Important controls are enforced server-side.

## 64. Testing

Test realistic scenarios:
- **Sales:** cash, card, split payment, mixed currency, modifier, size, discount, cancellation, full refund, partial refund
- **Inventory:** recipe consumption, waste, production, count, usage variance, negative stock, adjustment
- **Purchasing:** PO, partial delivery, full delivery, wrong quantity, wrong price, return, credit note
- **Cash:** opening, cash sales, refund, cash transfer, blind count, shortage, overage, two cashier sessions, IQD cash, USD cash, mixed-currency payments
- **Production:** batch, sale, waste, expiry, remaining stock
- **Staff:** attendance, shift, payroll, advance, salary
- **Branches:** Branch A, Branch B, consolidated reports, transfers
- **Connectivity** — for every transactional operation:
  1. Start transaction.
  2. Simulate connection loss.
  3. Retry.
  4. Confirm no duplicate transaction exists.

## 65. User Acceptance Standard

A feature is complete only when: the workflow is understandable; steps are reasonable; the user knows what to do; errors are clear; controls cannot easily be bypassed; and financial result, inventory, accounting, reports, audit trail, permissions, multi-currency behavior, and offline/retry behavior are all correct and safe.

## 66. Management Questions

The system continuously helps answer: What happened? Why? Is it normal? Is something wrong? What needs action?

Examples: Why is milk usage higher? Why is cash short? Why did waste increase? What needs ordering? What should be produced? What is expiring? Which supplier price changed? What is owed? What has not been reconciled? Are there suspicious transaction patterns?

## 67. Implementation Method

Before changing code, perform a complete audit and return:

- A. Already implemented correctly
- B. Partially implemented
- C. Missing
- D. Architecture conflicts
- E. Database changes
- F. Backend changes
- G. Frontend changes
- H. Accounting changes
- I. Inventory changes
- J. Reporting changes
- K. Permissions/security changes
- L. Multi-currency changes
- M. Testing matrix

Only after this analysis should implementation begin.

## 68. Priority Order

- **P0 — Integrity and control:** duplicate protection, cashier sessions, blind cash counts, usage variance, partial refunds, supplier corrections, accounting integrity, multi-currency foundation
- **P1 — Core operations:** product sizes, add-ons, split payments, IQD/USD payments, purchase orders, supplier returns, credit notes, buying list, production planning, waste controls
- **P2 — People and customers:** staff, attendance, shifts, payroll, customers, delivery information, loyalty
- **P3 — Management:** advanced reports, waste reports, balance sheet, cash flow, PDF, attachments, branch management, advanced reconciliation

After implementation, perform a complete UX/integration pass.

## 69. Final Product Standard

The finished system must feel like a single intelligent business operating system, not a collection of modules, connecting operations → inventory → money → accounting → people → customers → suppliers → production → reports → controls → management decisions automatically wherever appropriate.

## 70. Final UX Principle

Powerful enough for management, simple enough for an employee who has never used it before. Employees should not need to understand accounting, inventory costing, exchange-rate calculations, COGS, reconciliation, journal entries, FX accounting, or complex reporting unless their role requires it.

The system handles the complexity. The user performs the business operation.

## 71. Final Architectural Principle

Always ask: can the system achieve the same control and accuracy with fewer steps, less manual entry, and less cognitive effort? If yes, use the simpler workflow — but never reduce controls merely to make the interface look simpler.

## 72. Final Definition of Success

- **Employees** can work quickly and comfortably.
- **Managers** understand what is happening and what requires attention.
- **Accountants** trust the numbers and can trace transactions.
- **Owners** trust the system's information when making business decisions.
- **The business** operates with less manual work, less duplicate recording, fewer errors, and better inventory control, cash control, purchasing, production planning, staff accountability, financial visibility, and management decisions.

## 73. Final Command to Claude

Treat this document as the master specification. Before implementing anything:

1. Inspect the existing system.
2. Understand what is already built.
3. Preserve correct functionality.
4. Identify gaps against this specification.
5. Identify architecture that must be strengthened.
6. Identify database changes.
7. Identify accounting implications.
8. Identify inventory implications.
9. Identify multi-currency implications.
10. Identify UX improvements.
11. Identify security/control implications.
12. Identify testing requirements.

Then implement systematically.

- Do not build superficial screens.
- Do not create disconnected modules.
- Do not duplicate data entry.
- Do not silently guess missing information.
- Do not sacrifice accuracy for convenience.
- Do not sacrifice control for speed.
- Do not make employees carry system complexity.

Build the intelligence into the system. The final product should feel simple on the surface and extremely sophisticated underneath:

**Simple for the employee. Powerful for the manager. Trustworthy for the accountant. Reliable for the owner. Accurate throughout the entire business.**
