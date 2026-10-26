# Part 11 — Your team

_Owner's answer, verbatim (2026-10)._

> 1. our biggest problem is that we don't know what each of them specifically doing they manage cash advances, datas, settlements and everything relate it to the jobs, so you must find a way to fix that i dont know that one we have 5 employees at the office who are managing the data
> 2. this one to you have to come up with an idea
> 3. no but it has to support mobile using maybe for the owner
> 4. it should have all and they prefer kurdish i think

## What this tells us (first reading)

- **5 office employees** manage the data. Each of them handles cash advances, trip data, settlements — everything for the jobs, with no defined split. **The owner doesn't know what each one is specifically doing.** → Owner asks me to design the roles and a way to see who does what.
- **Who sees what:** owner asks me to propose it (together with part 6: employees never see profit or margins).
- **Mobile:** staff don't need it now; **the owner needs it on the phone** (approvals, money position, job status).
- **Languages:** all three (Kurdish, Arabic, English) must exist; **staff likely prefer Kurdish** → Kurdish as the default for staff accounts.

## Design direction (to be detailed in the final design)

- Roles proposed from the work itself (trip data entry, documents/matching, settlements, cash/payments, accounting review, manager/owner) with a clear hand-off order, so no one person both creates and approves money.
- Each person gets a **"my work" list**; every action is recorded with the person's name, so the owner can see per employee what they did, how much, and what is waiting on them.
- Owner's phone view: approvals waiting, cash position by box and currency, jobs at risk.

## Open questions (to ask later)

- P11-Q1 Of the 5 office employees, does anyone already specialise (e.g. one mainly on settlements, one on cash)? That helps fit roles to people.
- P11-Q2 Besides the 5, who else will use the system: the accountant(s), site employees, a manager?
