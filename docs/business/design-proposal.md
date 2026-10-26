# Evercrest ERP — Design proposal (v1, for the owner's approval)

Built from the owner's answers in parts 1–12 and the diesel-to-Syria files. Nothing here is built yet. Each section says what the system will do; section 16 lists what changes from the current draft; section 17 the build order. Open questions are in [open-questions.md](open-questions.md).

---

## 1. The business in one page

- **Work:** petroleum transport (crude, fuel oil, naphtha, condensate, diesel…) inside Iraq and abroad (Syria, Jordan…); buying and selling the same products; checkpoint passage agreements. Up to **10,000+ trips a month**.
- **Agreements are verbal**, by phone. Prices are per ton or per trip, differ by job and route, and **change during a job**, together with which fees the price includes.
- **Carriers:** mostly outside trucks — **transporters** (paid later through their account, after they bring the documents) and **independent drivers** (paid at our site). Own trucks later.
- **The papers decide who is paid:** on the way back, drivers give their manifest to whichever transporter pays them first; that transporter claims the trip. The trip's advance and fines go with it.
- **Money:** cash in USD and IQD; office safe + site safes; money exchangers (sarraf/hawala) for paying and moving money, with variable fees; frequent USD↔IQD exchange at a daily rate set each morning; banks later.
- **Today's pain:** data typed twice (field file → office file → accountant journals), wrong remote settlements, papers returning late, duplicate fee payments, no clear roles, month-end closing per job takes very long, and the owner cannot see money position or job profit until a job ends.

## 2. Principles of the new design

1. **Enter once.** A number is typed (or imported) once, at its source. Everything else — settlements, claims, invoices, journals, reports — is computed from it.
2. **Rules, not instructions.** The owner/manager sets each job's rules; staff work inside them; anything outside is an exception that waits for approval.
3. **The system does the accounting.** Every operational action creates its journal entry automatically; the accountant reviews and accepts.
4. **Live, not historical.** Every job, carrier, customer and cash box shows its position now, and what is missing.
5. **Each person has a lane.** Clear roles, a personal to-do list, every action signed with a name.
6. **Strict with money:** nothing deleted, everything traceable, no one approves their own money, each manifest and each fee paid once.

## 3. Jobs and the job's rule card

A **job** = one piece of work for one customer (e.g. "Diesel Kawergosk → Banias, Oct 2026"). Created in a minute: customer, name, kind of work, product, unit, currency, start date, responsible person.

Each job has a **rule card**. Every rule has a **start date**; a change creates a new version from a date, and each trip uses the version valid on its date (loading date unless the owner decides otherwise). Older trips never change.

| Rule | Examples |
|---|---|
| Product, unit | Diesel, MT (or litres) |
| Routes | Erbil → Latakia, Erbil → Homs… (each route may have its own prices) |
| **Customer price** | 120 USD / MT, or per trip; by route; what it includes |
| **Carrier price** | 70 USD / MT to driver; transporter commission per ton or per trip; rewards |
| **Carrier shortage rule** | allowance −0.15 t per trip; fine 1,200 USD / t above it (per MT or per litre) |
| **Customer shortage rule** | their allowance (per truck or per MT) and their fine price |
| **Demurrage** | method (e.g. days between arrival and discharge, both excluded, minus free days) × price per day; carrier side and customer side |
| **Fees** (charge items) | visa, insurance, guarantee, entry slip, declaration fee, border commission, customs per ton… each with: who pays it, deducted from the carrier or not, billed to the customer or included, amount, documents needed |
| **Advances** | allowed or not; normal amount; maximum without approval (amount may differ per driver) |
| **Documents** | required to pay a carrier (manifest + discharge bill + the job's fee papers); required to invoice the customer |
| **Invoicing** | per job / monthly on loaded tons / monthly on discharged tons / at end |
| **Storage** | none / we keep the balance / product is ours; storage allowance and loss rate |
| **Milestones tracked** | loading only, or also border, arrival at storage, discharge |

**Fee types are a list the owner can extend at any time.** Each fee type carries its accounting behaviour (which account, whether it is our cost, a deduction from the carrier, or billed to the customer), so new fees never need a developer.

**Kinds of work** (transport, buy & sell, checkpoint passage, and later anything else) are templates that pre-fill the rule card. Non-petroleum work later uses the same job + rule card + fees model.

## 4. Trips

- **The manifest number is the trip's identity.** The same manifest cannot be entered twice in a job.
- **Entry at the speed of the work:** the loading-site sheet is **imported as it is** (Excel), or typed in a fast grid like Excel. No re-typing into a second file. Field staff can enter loading data directly when ready.
- Each trip records: loading date, route, loading and discharge place, driver, truck (plates, truck + trailer), **transporter at loading**, manifest, loaded quantity, advance paid (and from which cash box), and later discharge date/quantity and milestones (if the job tracks them).
- **Discharge data** is matched by manifest number — imported from the storage's list or entered when the driver returns.
- The trip **calculates itself** from the rule card: net tons = min(loaded, discharged); freight; carrier fine (beyond allowance); customer fine (their rule); fees; demurrage; reward; what the carrier is owed; what the customer is charged; our margin on the trip (owner only).
- **Status at a glance:** loaded → on the way → discharged → papers complete → claimed → paid; and on the customer side: not invoiced → invoiced → paid.
- History stays true: if a driver later works for another transporter or a truck changes driver, old trips keep what they were.

## 5. Carriers: transporters and independent drivers

- **One running account per carrier** (per currency) instead of payment per invoice: trips earned, advances, fees paid for them, fines, deductions for transporters, payments — all in one balance. The system shows at any time who owes whom.
- **Claims (مطالەبە):** when a transporter (or an independent driver himself) brings manifests, staff open a claim and scan/enter the manifest numbers. The system:
  - pulls each trip with all its numbers already calculated (no typing);
  - refuses a manifest already claimed by anyone (no double payment);
  - checks the required papers per trip; trips missing papers wait;
  - computes the claim exactly like today's settlement form (freight, reward, fines, deductions, advance, amount to pay) — the same rule every time, rounding in one place;
  - shows the claimant as payee: the trip's money goes to **whoever brings the papers**, with the advance and fines staying with the trip.
- **Negative trips** (fine larger than freight) are offset inside the claimant's claim and account; if never claimed, the debt stays on the driver and comes off his next trip (independents) or must be repaid.
- **Paying carriers:** cash payments against the balance — an advance, part of the balance, or all of it. Optional link to a claim.
- **Remote settlements:** when a site pays drivers with its own figures, its sheet is imported and **compared line by line** with the system's calculation. Only differences are shown (amount, missing trip, duplicate trip). The owner approves; wrong payments become a recorded receivable from whoever made them.
- **Fine waivers:** a driver's excuse → a waiver request (all or part, with reason) → owner approves → recorded. Never an edit.
- **Accident / contamination:** either the customer forgives it, or we recover an amount the owner sets (not the fine rate) — recorded as a separate charge to the carrier, with approval.

## 6. Customers and invoicing

- Each customer has a **settings card:** documents that go with invoices, detail per trip or monthly summary, whether they must approve quantities before invoicing, usual currency, usual allowance/fine rules.
- **Invoices are generated** from the trips according to the job's invoicing rule (monthly on loaded / discharged tons, per job, end of job). One company invoice layout, in the job's currency. Invoicing before all trips are discharged is allowed as an owner decision, with later correction.
- **Customer shortage deductions** are calculated per trip by the customer's rule and shown on the invoice; the difference against what we charged drivers shows whether shortages win or lose us money.
- **Customer advances to us** are recorded on the job and offset against its invoices.
- **Paid with product:** a customer can settle a balance by giving product; it is valued, enters our stock (or a job), and closes the receivable.
- **Late payers:** a receivables list per customer and job with age (0–30, 31–60, 61–90, 90+ days) and a reminder list. No fixed terms needed, but agreed terms can be set per customer.

## 7. Buying and selling, storage

- Buy price per supplier and job; sell price per customer and job (both dated). **Product cost = purchase + transport + related expenses** (landed cost), so the sale's profit is real.
- **Storage per job** (none / we keep the balance / ours): tracked storage keeps its balance from loadings and discharges. **Closing a storage:** the remaining balance is brought to zero; total loss (route + storage) is compared with the agreed allowance; only the surplus is a loss, at the agreed rate.

## 8. Cash, exchangers, currencies

- **Cash boxes:** the office safe and every site safe / site employee holding cash; each with USD and IQD balances and a responsible person. Money sent from the office to a site is a transfer between boxes; every advance or payment made at a site comes out of that site's box and is linked to the trip.
- **Cash counts:** each box is counted (daily for the office, at agreed times for sites); the system compares with its own balance; differences are recorded and approved.
- **Daily exchange rate:** the accountant enters it each morning; all cross-currency entries that day use it.
- **Paying in the other currency:** pay a USD debt with IQD (or the reverse) in one step; the debt is cleared at the day's rate.
- **Money exchangers (sarraf/hawala):** each one is an account in both currencies (we may owe them or they may hold our money). Exchanges with them use **their rate**; hawala fees (variable) go to a hawala fees expense; differences against the day's rate go to exchange gain/loss.
- **Banks:** added by the accountant when opened, in either currency.
- **Loans:** to/from partners, employees, other companies — each as an account with its balance.
- **Owners' accounts:** profit moved to a partner in another currency is a recorded exchange onto the partner's current account.
- **Taxes:** room left in the design (tax accounts and rules), not built now.
- Reports **never add USD and IQD together**; every figure shows its currency. (A converted view at today's rate can be added for the owner as an estimate only, clearly marked.)

## 9. Accounting done by the system

- Every action posts its own journal entry immediately, to the right accounts, in its currency: trip loaded (cost and receivable accruals as the owner chooses — see Q), advance paid, fee paid, fine, claim accepted, carrier payment, customer invoice, customer payment, exchange, hawala fee, cash transfer, cash count difference, overhead share, salary.
- **The accountant's review queue:** entries arrive grouped by day and job; the accountant checks and **accepts**; anything unusual is flagged (round amounts, back-dated, outside rules, large). Mistakes are corrected by a reversal from the source document, never by editing.
- **Month end:** accept the month's entries, run overhead sharing, lock the month. Job closing is continuous, so month end is a check, not a project.
- **Statements:** income statement, balance sheet, cash flow, changes in equity — per company and consolidated, per currency.

## 10. Overheads and job profit

- Salaries of site staff go to their job; office salaries, rent and other shared costs are spread monthly over the jobs active that month (basis chosen by the owner — see Q).
- Each job shows **direct profit** and **profit after overheads**, live while it runs, with what is still missing (trips not discharged, papers not back, fees not recorded) so the estimate is honest.

## 11. Staff, attendance, payroll

- Staff register with categories (office, site, temporary…). Attendance (check-in/check-out) on for the categories that need it.
- Monthly payroll from attendance and the pay rule of each person (monthly / daily — see Q); salary advances deducted automatically; salary entries posted automatically.

## 12. Roles, lanes and visibility

Suggested roles (one person can hold several; with 5 people this is expected):

| Role | Does | Cannot |
|---|---|---|
| **Trip data** | imports/enters loading files, discharge data | pay money, see customer prices or profit |
| **Documents** | receives papers, matches manifests, photographs them | pay money, see profit |
| **Settlements** | prepares carrier claims, imports remote settlements | approve or pay them |
| **Cash** | pays advances and approved claims from a cash box, records cash transfers and counts | create claims, change rules |
| **Accountant** | reviews/accepts entries, sets the daily rate, closes months, banks | change operational rules |
| **Manager / Owner** | sets rule cards, approves exceptions, waivers, payments over limits | — (owner sees everything) |

- **Nobody approves their own money.** The one who prepares a claim is not the one who approves or pays it.
- **Profit is hidden:** margins, profit and both sides of a price pair (customer vs carrier price, buy vs sell) are visible only to the owner and people he allows.
- **"My work" list** per person: what is waiting for them. **Owner's team view:** per employee, what they did today/this week and what is stuck with them.
- **Owner's phone view:** approvals, cash in each box, owed to us / by us, jobs needing attention.
- **Language:** Kurdish by default for staff; Arabic and English available.

## 13. Reports (built around "where is the money and what should I do")

**Owner's daily action board:** approvals waiting · cash boxes not counted / differences · papers overdue by job · trips with no claimant after N days · carriers we owe (top) · customers late (top) · jobs with negative or falling margin · price rules expiring/changed.

**Operations:** per job: loaded / on the way / discharged / papers complete / claimed / paid (trips and tons) · trips by route and date · trucks and drivers active · shortage report (by driver, transporter, route; customer side vs carrier side).

**Money:** cash position by box and currency (today) · carrier balances (owed by us / to us) · customer receivables with age · exchanger balances · daily cash movement · exchange gains/losses.

**Profit:** per job (direct and after overheads, live) · per customer · per route · per product · per month · shortage gain/loss · fee recovery (fees paid vs recovered from carriers vs billed to customers).

**Control:** remote settlement differences · fine waivers granted · duplicate attempts blocked · entries awaiting review · per-employee activity.

**Accounting:** the four statements, trial balance, general ledger, per company and consolidated.

## 14. Companies

One company now. The design keeps **separate books per company** and gives the owner a **consolidated view** of all companies together (side by side and combined, per currency).

## 15. Scale

10,000+ trips a month: bulk import, fast grids, server-side search/filter, summaries kept up to date, tested with years of data before go-live.

## 16. What changes from the current draft

**Keep (fits):** jobs + kinds of work, dated price rules, settlement maths (net = min, fine beyond allowance, rounding only on final amounts), one payment engine, exchange, approvals, documents with required-document rules, audit trail, append-only books, automatic numbering, three languages, design.

**Change:**
- Payee of a trip = **claimant who brings the papers** (today: the transporter set on the trip).
- Pay statements become **claims** exactly like the owner's settlement form, with manifest-based entry and duplicate blocking.
- Rule card gains **dated versions**, customer-side shortage rule, demurrage methods, **fee types with accounting behaviour**, advance limits, invoicing modes, storage modes.
- Trips: **bulk import**, manifest as identity, optional milestones.
- Accounting: add the **accountant's review queue**; journal coverage for every new action.
- Roles and visibility rebuilt as in section 12; profit hiding.
- Field-work module hidden (not needed now).

**New:** cash boxes per site with counts · daily rate · exchanger accounts with fees · paying in the other currency · remote settlement comparison · fine waiver flow · customer settings card · customer advances and payment in product · storage closing with loss · overhead sharing · staff/attendance/payroll · owner action board and phone view · consolidated multi-company view.

## 17. Build order (proposal)

1. **Rule card + trips + import** (with the diesel job as the first real test, reproducing the owner's Excel exactly — including fixing the inconsistencies found).
2. **Claims and carrier accounts** (claimant model, duplicate blocking, remote settlement comparison, fine waivers).
3. **Cash boxes, daily rate, exchangers, paying in other currency.**
4. **Automatic journals + accountant review queue.**
5. **Customer invoicing modes, advances, receivables ageing.**
6. **Roles, "my work" lists, visibility, owner action board + phone view.**
7. Storage modes and closing; overhead sharing; staff/attendance/payroll; multi-company view.

Each step is shown to the owner working on real data before the next.
