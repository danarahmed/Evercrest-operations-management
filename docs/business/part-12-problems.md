# Part 12 — Problems today

_Owner's answer, verbatim (2026-10)._

> 1. auditing between data managements and accountant, and settlements of the cash safes we have and pay driver, then finalizing the data that went to the accountant after entering its journals sometimes it is  alot of journals should be entered in the day, and on the end of the months finalizing each jobs we have takes alot
> 2. money will be loss between data managements and finance because of their entries and the complexity of our jobs
> 3. maybe fines sometimes they tell the excuses and we give them a forgiveness or cut some of the fine
> 4. how much i loaded per jobd, amounts, on way , discharged, the moeny we owe overall and the money we have, the state of the finance daily not every three months i want always the data be there to tell me what to do not what we just recorded and dead number
> 5. trips and its everything, check in and check out with a salary of the employees at the end of the months
> 6. managing trips and jobs, managing the finance, and analyzing data not just recording it

## What this tells us (first reading)

1. **What takes the most time:**
   - **Reconciling** the data team's figures with the accountant's.
   - **Settling the cash safes** and **paying drivers**.
   - **Finalising** what went to the accountant after the journals are entered — sometimes a great many journals per day.
   - **Month-end closing of every job** takes a long time.
2. **Where money is lost:** between the data team and finance, through entry mistakes and the complexity of the jobs.
3. **What causes disputes:** fines — drivers give excuses; the owner sometimes forgives all or part of a fine. → Fine waivers/reductions must be a recorded decision (who, why, how much), not a silent edit.
4. **What the owner wants to see instantly:**
   - Per job: **loaded, amounts, on the way, discharged.**
   - **Total we owe** and **total we have**.
   - **Daily** financial position, not quarterly.
   - Data that **tells him what to do** (actionable), not dead recorded numbers.
5. **Move from Excel/paper into the system:** **trips and everything about them**; **check-in/check-out** of employees with **salary at month end** (attendance-based payroll).
6. **Top three things to fix:** (1) **managing trips and jobs**, (2) **managing the finance**, (3) **analysing data**, not just recording it.

## Notes for the design

- Point 1 and 2 are solved by one source of truth: operations enter once; journals are generated automatically; the accountant reviews. No re-keying → no mismatch to audit.
- Month-end job closing becomes continuous: each job shows live what is complete, pending and missing; closing a month is a check, not a project.
- Fine waivers go through the approval flow with reason.
- Owner dashboard = action list ("what to do today"): approvals, overdue papers, cash boxes to count, carriers owed, customers late, jobs losing money.
- Payroll from attendance: confirm pay rules (P5-Q2, P5-Q3).
