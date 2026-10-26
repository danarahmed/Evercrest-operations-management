# Part 1 — Company overview and the work we do

_Owner's answer, verbatim (2026-10)._

> 1. we do some kind of different works today and most of them goes around petroleum field like, ( transportation, buy and sell products, agreement for the drivers going through checkpoints with a fee that we keeping for ourself between that with different products
> 2. transportation and it takes the most effort
> 3. * jobs: we might have different types of jobs like transporting ( crude, fuel oil,nephtha, condensate, diesel and etc ), buying and selling almost the same products sometimes the transportation included with a cost of the buying and some different types of expenses i will share with you in later parts.
> *trips: idk exactly but it gets to more than 10k trips if we are in a good position monthly
> *trucks i dont know that too because sometimes they load more than one in a month
> * invoices is per jobs we take and sometimes it is monthly on loading amount sometimes it takes more after starting a job to create an invoice and sometimes it is on unloading
> 4. for now we have one company and one office but in future it may be more and we keep them as separate books but the owner should be able to see the state of the companies work under that system in overall way not just by branches or a subsidiary company
> 5. i dont know really but in future we may work in different area rather than just petroleum so the system should be able to handle the other jobs that is not related to petroleum but we dont need to build it now neither so what you should built now is a system with a capability of expanding its handling

## What this tells us (first reading)

- Three lines of business today, all around petroleum:
  1. **Transportation** of crude, fuel oil, naphtha, condensate, diesel, etc. — the most effort.
  2. **Buying and selling** the same kinds of products; sometimes transport is included in the buy price.
  3. **Checkpoint passage agreements**: the company arranges for drivers to pass checkpoints for a fee and keeps a margin; varies by product.
- **Volume:** more than 10,000 trips a month in a good month. A truck can load several times a month. → The system must be fast at this scale (bulk entry, imports, quick lists and reports).
- **Invoicing varies by job:** per job; monthly on loaded quantity; monthly or later on unloaded quantity; sometimes long after the job starts.
- **Companies:** one company and one office now; later several companies with **separate books**, and the owner sees all of them together (consolidated view), not only one at a time.
- **Future:** non-petroleum work later. Build the foundation to expand, but do not build it now.

## Open questions (to ask later)

- P1-Q1 Checkpoint agreements: who pays whom (driver pays us? customer pays us?), per truck or per trip, what we pay to whom, and whether this is attached to our own transport jobs or a separate service for outside drivers.
- P1-Q2 Invoicing "monthly on loading amount" vs "on unloading": is this chosen per customer, per contract, or per job? Can one job have several invoices (e.g. monthly)?
- P1-Q3 Buy-and-sell with transport included: is the transport cost part of the purchase price from the supplier, or do we pay a transporter separately and add it to the sale price?
- P1-Q4 Several companies later: do they share customers, drivers, transporters and trucks, or does each have its own? Can one company work for another (inter-company)?
