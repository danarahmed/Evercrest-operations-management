# Part 10 — Documents

_Owner's answer, verbatim (2026-10)._

> 1. it is according to the jobs we have, most of the documents we need are those below
>
> * manifest and discharging bills: the most important ones who tell us where they load and discharge with the amount been loaded and discharged, name of the drivers and plate number, when they load or discharge, and the manifest number the most important one it tells us
> * visa, insurance, surplus mt forgiveness, entrance bills etc: we get them sometimes and sometimes we cant
>
> and more i cant remember now, we can set them later
>
> 2. for the invoices we create what matters they all discharged and sometimes i can invoice without all of them discharged, for the driver what matters the most is the manifest and the discharged bill and the other expenses we have like the visa and insurance etc.. according to the jobs if it needs it
> 3. you have to come up with an idea to set those things up because it is one of the difficult part i cant set roles for the employees and they dont have it so they work randomly on the jobs and everyone doing some different tasks for different jobs we have, and you must consider fast workflow and accuracy and easy to understand
> 4. if the drivers paid any fees or expenses we have more than one times, and you will recommend me more you must

## What this tells us (first reading)

- **Documents depend on the job.** Main ones:
  - **Manifest** and **discharge bill** — the most important. They give loading and discharge place, loaded and discharged quantity, driver name, plate number, loading/discharge dates, and the **manifest number** (the key identifier of a trip).
  - **Visa, insurance, surplus-MT forgiveness, entrance bills, etc.** — sometimes received, sometimes not.
  - More to be added later → document types must be configurable.
- **For invoicing the customer:** normally all trips discharged; **sometimes the owner invoices before all are discharged** (an owner decision/exception).
- **For paying the driver/carrier:** the **manifest and discharge bill**, plus the fee documents (visa, insurance…) **when the job requires them**.
- **Who handles documents:** today nobody has defined roles; employees work on any job and any task randomly. Owner asks me to design the document workflow **and** the roles: fast, accurate, easy to understand.
- **Point 4 (problems with documents):** drivers' fees/expenses get **paid more than once** (duplicate payments). Owner asks me to recommend more protections.
  → Each fee document / receipt must be recorded once and linked to its trip; the same fee for the same trip (or the same receipt number) cannot be paid twice.

## Open questions (to ask later)

- P10-Q1 Scanned copies: should every manifest/discharge bill be photographed into the system? How many years to keep them?
- P10-Q2 Invoicing before all trips are discharged: is the invoice then based on loaded quantity, with a correction later?
- P10-Q3 Lost manifest: how is the trip proven then (copy from the storage, customer's record)?
