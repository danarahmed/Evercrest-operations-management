# Open questions (consolidated after parts 1–12)

Answer by number. Where a question has a **proposed default**, a short "ok" is enough.

## Prices and rules
1. When a customer or driver price changes during a job, which date decides the price of a trip: **loading date** (proposed) or discharge date?
2. When the price changes and a fee is no longer included, is that fee then billed to the customer separately, or does it become our cost?
3. Customer price "by quantity": does the price per ton drop when more tons are moved (volume tiers), or is it just different per job?
4. "Setting data" and "forgiveness of each trip" (part 2): what are they, and who pays/receives?
5. MT fine forgiveness at the border (passed back to the driver): what is it? A small example with numbers helps.
6. Customer allowance "per truck or per MT": typical numbers? Is their fine price the product's value?
7. Other demurrage methods besides "days between arrival and discharge minus free days": what are they? Is demurrage also charged to the customer, at a different rate?
8. Price decided after the job: is it cost + margin or negotiated? Can trips be loaded and advances paid with no customer price yet? (proposed: yes, price "to be decided")

## The diesel file
9. Column "کۆمپانیا" (Ever crest, Rekan, Amanj, QZL, Dazzle, darawan): who are they?
10. The transporter's $50 deduction should be a company cost (the settlement form counts it; the master file doesn't). Confirm the form is right. (proposed: yes)
11. Border commission ($10): part of the load cost? (proposed: yes)
12. Customs: charged on **loaded** tons or on separate "customs tons"?
13. Kafala and insurance are $0 on 34 trips: why — different route, or paid elsewhere?
14. Visa/insurance deduction from the driver (column X): when does it apply?

## Carriers and claims
15. Remote payers who settle with their own figures: who are they (our site staff, a transporter, an exchanger)? What do they send back (Excel, paper, photo)?
16. Trips with an unknown transporter: when does this happen, and how is it resolved today?
17. Paying part of a transporter's balance: does it matter which claims are paid first (proposed: oldest first, automatically)?
18. Accident/contamination recovery: who decides the amount? (proposed: owner approval)

## Customers
19. Customer advances to us: per job? Deducted from the next invoice(s) automatically? (proposed: yes)
20. Customer pays with product: how is the product valued, and does it go into our stock to sell later?
21. Invoicing before all trips are discharged: on loaded quantity with a correction later? (proposed: yes)

## Storage and products
22. "Contractor forgiveness" for route + storage losses: whose allowance — the customer's or the supplier's? Per ton or percentage?
23. Do we pay storage fees to depots (e.g. Kawergosk, Banias)?
24. When the product is ours: do we sell it gradually to several customers (stock), or is each purchase tied to one sale?

## Money
25. Paying a USD debt in IQD: cleared at the day's rate, any difference to exchange gain/loss? (proposed: yes)
26. "Partner" in "profit in IQD put on the partner at dollar": the company's owners/partners (owners' accounts)?
27. Daily rate: only the accountant sets it, once per morning? Can it change during the day?
28. Loans: with interest or without? Repayment schedule or open?
29. Which accounting program does the accountant use now? Import opening balances from it at go-live? (proposed: yes)
30. Should trips post to the books when loaded (cost and revenue as we go — proposed, gives live profit) or only when claimed/invoiced?

## Overheads, staff, payroll
31. Office salaries, rent and other shared costs: spread over active jobs **by tons moved** (proposed), by days active, equally, or by revenue?
32. Staff categories you use?
33. Check-in/out: used to calculate pay (daily wage, overtime, absences) or only to know who was present?
34. How are staff paid: monthly salary, daily rate, per job? Temporary loading staff: a job cost or salary?
35. Cash held by site employees: how is it sent to them, and how do they report back?

## Approvals, documents, team
36. Approval limits: what may an employee pay alone (e.g. advances up to the job's normal amount), above what must you approve? Is anyone besides you an approver?
37. Should the accountant's "accept" lock the entry (correction only by reversal)? (proposed: yes)
38. Scanned copies: photograph every manifest and discharge bill into the system? Keep how many years? (proposed: yes, 10 years)
39. Lost manifest: how is the trip proven then?
40. Of the 5 office staff, does anyone already specialise? Besides them, who will use the system (accountant, site staff, a manager)?

## Companies and future
41. Future companies: shared customers/drivers/transporters, or separate? Can one company work for another?
42. Checkpoint passage agreements: who pays whom, per truck or per trip, and is it part of our transport jobs or a separate service for outside drivers?
43. Abroad jobs: which countries/routes, extra papers and costs, which currency?

---

## Owner's answers — round 1 (verbatim)

> #9 leave it, it is nothing
> #4,5 it is just like the visas or insurances is our fee or then it will be deducted from their settlement
> #15 explain more
> #22 customer's the one our revenue comes from their side
> #30 how is that work explain more
> #31 okay do it
> #33,34 we will decide later but it should be connected to their time and salary that they should work daily
> #36 it can pay alone anything i set the rule for and if it is not in the rule the system has to send me a warning if i accept it it should accept it for the jobs and for the accountant he can pay anything to anyone

### Decisions recorded
- **#9** Column "کۆمپانیا" in the diesel file: ignore (not needed in the system).
- **#4, #5** "Setting data", per-trip forgiveness and border MT-fine forgiveness are **fees like visa/insurance**: we pay them (our fee), or they are **deducted from the carrier's settlement** — i.e. ordinary fee types on the rule card with the "deducted from carrier" switch.
- **#22** The storage/route loss allowance is the **customer's** (the side our revenue comes from).
- **#31** Shared costs are spread over active jobs **by tons moved** — approved.
- **#33, #34** Pay rules decided later; payroll must be **linked to attendance time and a daily-work salary** (expected daily hours).
- **#36** Employees may pay **anything within the rules** the owner set, alone. Outside the rules → the system **warns the owner**; if he accepts, it goes through. The **accountant may pay anything to anyone** (no approval needed); all payments are still recorded and visible to the owner.
- **#15, #30** Explained again to the owner; answers pending.

## Owner's answers — round 2 (verbatim)

> #15 employee at site, excel, an scanned documents
> #30 explain me more about the option a how it works what it affects

### Decisions recorded
- **#15** Remote settlements are made by **our own site employee**, who sends back an **Excel sheet and scanned documents**. → Import their Excel, attach the scans, compare line by line with the system's calculation; differences are on that employee's cash box.
- **#30** Option A (record at loading, estimate then correct) explained in detail; answer pending.

## Owner's answers — round 3 (verbatim)

> yes go with D

### Decision recorded
- **#30** Accounting method **D**: books hold only real events (cash, advances, claims, invoices, payments); live job profit and positions are calculated from the trips (confirmed vs estimated); one automatic month-end summary accrual for trips awaiting papers, auto-reversed next month. (Options A record-at-loading, B papers-only, C live-only were explained; A rejected because of 20–30k extra entries a month for the accountant.)

## Owner's answers — round 4 (verbatim)

> #20 it may be both sometimes we store it at the storage then sell it back and sometimes we sell it directly to our customers
> #24 we have both in that case too, sometimes it is tied to one sale for example there is a truck of diesel we bought it and sell it directly to one of our customers, but if we store it then load it back it may be several customers
> #26 yes they are they have their percentage from profit and loss
> #28 no it does not, the place like the sarraf we lend money and maybe most of the time we are in debt we pay them a fixed fee per mt or trips we loaded according to the products so it goes like our expenses of the job
> #41 separate list, and maybe some common ones
> #42 our customers pay us and we pay the other part which our suppliers, lets say for nephtha we take 210 dollar per trip and we pay 190 dollar per trip to the supplier
> #43 what do you mean by extra paper

### Decisions recorded
- **#20, #24 Product flow — two paths, both needed:**
  1. **Direct (back-to-back):** bought and sold straight to one customer (e.g. a truck of diesel). Cost and sale tied together.
  2. **Via storage:** bought into a storage, then loaded out over time to one or several customers. → Stock per product per storage, with average cost; each sale takes its cost from the stock.
  Payment-in-product from a customer can go either way too (into storage, or sold on directly).
- **#26 Partners:** the company has **partners (co-owners) with a percentage share of profit and loss.** → Owners' current accounts per partner and currency; at period end, profit/loss is shared by percentage; moving profit to a partner in another currency is an exchange onto their account.
- **#28 Loans:** no interest. **Exchangers (sarraf) lend us money** — we are usually in debt to them — and charge a **fixed fee per MT or per trip loaded, by product.** That fee is a **job expense.** → Each sarraf financing a job: a fee rule on the job's rule card (per MT or per trip, by product), posted to the job as a cost, credited to the sarraf's account.
- **#41 Future companies:** separate lists, with some shared partners. → Partners belong to a company; a partner can be shared with other companies.
- **#42 Checkpoint passage agreements:** the **customer pays us per trip** and **we pay the supplier per trip** (e.g. naphtha: 210 USD/trip from customer, 190 USD/trip to supplier → 20 USD/trip margin). → A "checkpoint passage" kind of work: trips with a customer price and a supplier price per trip; no transport settlement.
- **#43** Explained ("extra papers" for abroad jobs); answer pending.

## Owner's answers — round 5 (verbatim)

> ok to all and for #43  we work internal and jordan and syria so the system should be flexable if it need any other documents or becoming a cost on the job or not

### Decisions recorded
- **All remaining proposed answers accepted** (#1, #8, #10, #11, #17, #18, #19, #21, #25, #29, #37, #38 as proposed). Questions that are rule-card settings (#2, #3, #6, #7, #12, #13, #14) are set per job; #16, #23, #27, #32, #35, #39, #40 will be settled while building/with the users.
- **#43** Work is **inside Iraq, Jordan and Syria**. Documents and costs per country/route must be configurable: any document type can be required for a route/job, and any cost can be a job cost or not — no fixed list.

**Status: questionnaire closed (2026-10-27). Building starts with step 1 of the design proposal.**
