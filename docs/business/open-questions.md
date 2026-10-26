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
