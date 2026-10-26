# Part 8 — Money handling

_Owner's answer, verbatim (2026-10)._

> 1. we have a safe at the office for both iqd and usd, and we will have safes due to the jobs we have at the site do they count as safe or not? what do you mean counted or controlled explain me more
> 2. we do not have it yet but we may have it with both currencies and it should be able to add them the accountant when we have.
> 3. we use them for both and sometimes they have fees for the hawala so it has to go to hawalla fees and it is not fixed, sometimes we owe them money and sometimes we have money
> 4. we have different ways of exchanging:
>
> * when we want to pay someone that we owe in usd and the safe does not have the proper amount we pay it in iqd, and all the way around
> * the sarraf we have at bazar sometimes we have iqd and we owe in usd we exchange some amount of iqd to usd, and all the way around
> * sometimes our profit in iqd and we put it on the partner we have at dollar, or all the way around
> * or some of our expenses in iqd and the revenue of the jobs in dollar so we have to exchange it to dollar or all the way around
>
> it will be applied for almost every account we have, at the rate of the day we always set the exchange rating for every journal we have at the beginning of the day, the accountant, but for the sarraff they decide, we have not yet but we should in this system
>
> 5. yes we do all of them
> 6. we should be able to add as much employees as we have and yes sometimes we give them advances
> 7. keep a space for that in the system we dont need it that for now but we will need it in future
> 8. yes  we have, they use another program, basic reports of accounting, all the four statements
> 9. we always have a problems due to those jobs we get as i told you before so we do not know the state of our money where they at and for each jobs how much we owe or how much is left, till the work will be finished i want you to come up with recommended reports as you know our jobs very well and our problems you might know better at the other parts too

## What this tells us (first reading)

- **Safes:** one office safe holding **IQD and USD**; **site safes** per job/site will exist too (owner asks whether they count as safes — yes, see clarification below).
- **Banks:** none yet; later, in both currencies; the accountant must be able to add bank accounts.
- **Money exchangers (sarraf / hawala):** used **both to pay and to move money**. Hawala **fees vary** and go to a **hawala fees** expense. The balance with a sarraf can go either way (we owe them / they hold our money). → Each sarraf is a partner with a running account in each currency; a transfer through them records the fee separately.
- **Exchange (USD ↔ IQD) happens in four ways:**
  1. **Paying a debt in the other currency:** we owe USD but pay IQD from the safe (or the reverse).
  2. **Exchange at the bazaar sarraf:** convert some IQD to USD (or the reverse).
  3. **Moving profit between currencies onto a partner's account:** profit in IQD booked to a partner whose account is in USD (or the reverse).
  4. **Matching currencies:** expenses in IQD while job revenue is USD → exchange.
  - Applies to almost every account.
  - **Daily rate:** the accountant sets the exchange rate **at the start of each day**, used for every journal that day. **Sarraf deals use the sarraf's own rate.** Not done yet; the system must do it.
- **Loans/borrowing with partners, employees, other companies:** yes, all of them.
- **Employees:** unlimited number; **salary advances** happen.
- **Taxes/government fees:** not needed now — **leave room** for it in the design.
- **Accountant:** exists; uses another program; produces basic reports and **all four financial statements** (income statement, balance sheet, cash flow, changes in equity).
- **Owner's core problem:** not knowing **where the money is**, and **per job how much is owed or left**, until the job is finished. → Owner asks me to **recommend the reports**, using everything learned in all parts.

## H1 clarification ("counted or controlled")
Explained to the owner: every place that physically holds company cash — the office safe and each site safe or site employee holding cash — is a cash box in the system, each with its own balance per currency and a responsible person. "Counted" = periodically counting the real cash and comparing it with what the system says it should be (differences recorded and approved). "Controlled" = who is responsible for each box, who may pay out of it, and limits/approvals.

## Open questions (to ask later)

- P8-Q1 Paying a USD debt in IQD: is the debt cleared at the day's rate (and any difference booked as exchange gain/loss)?
- P8-Q2 "Partner" in point 4.3: is this the company owner/partners (equity/current account), or a business partner?
- P8-Q3 Who may set the daily rate: only the accountant? Can it change during the day?
- P8-Q4 Loans: interest or none? Repayment schedule or open?
- P8-Q5 The current accounting program: which one? Should opening balances be imported from it?
