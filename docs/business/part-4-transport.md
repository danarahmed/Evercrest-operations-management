# Part 4 — Transport

_Owner's answer, verbatim (2026-10)._

> 1. we transport every type of products so it should be set it at the job or before that somewhere, and the route is the same too
> 2. we mostly use outside but the system should be capable of handling our own trucks too we dont have it now
> 3. we work with both, for the transporters most of the time we dont pay them directly they send us back the manifests and the documents need for the job we agreed on and it goes to their payable account then we pay, but for the independents we mostly pay at our site i told you before
> 4. yes he can, yes it can, i dont understand the last part of the question explain me more
> 5. the trip will be assigned when we get back the file from the loading place and the employees reenter it again at the office, there is jobs we can determine whether the trip passes the border, at the storage, and unloaded but there is some we cant because we dont get those data back, at loading if the jobs has cash advance we pay them, and it is not a set price sometimes can change from driver to driver
> 6. the system should have all the measurement and we have to set it to the job
> 7. we will give the an allowance and over that allowance he will be fined at the set amount per liter or mt according to the job, it will be deducted of their payable amount that remained if they have cash advance, if they have not it will be deducted from their payable amount too, and if the fine amount is more than the existing amount for transporters it will be deducted from the overall of the settlement, and if it is the independent drivers they have to give it back
> 8. we have different ways to pay demurrage, on is calculated from the arrival date to the storage to the dicharged date and both the arrival and discharge date is not counted then he has how many days will be deducted by the amount of days we set then multiplying by the price per day
> 9. it will be given to the driver and if the driver is independent will be deducted from the net amount he will get and if it is the transporter it will be the same, it will be given in cash at the site due to the jobs currency
> 10. you have the file i gave you for the diesel, how we will get a contract with a customer on the expenses on us we will have the agreement with drivers or the transporters what will be deducted on their settlement, sometimes we pay them some fees then at the end when they get back the settlement we deducted on their remaining amount
> 11. if it is the independent drivers they have to give us back or after the next trip he will do we deduct it, if it is the transporter we will deducted on the overall settlement
> 12. we have some fees like i send you visa, insurance,etc.. so this should be adjustable and addable with its speciality for if it will be deducted or not, and you have consider accounting side too. not just for this for everything we talk about
> 13. it has two side one we get the agreement from the customer and we forgive him and one is we get back the money at the set amount we will set not the fine rate

## What this tells us (first reading)

- **Products and routes** of every kind; both are set on the job (or chosen from a list beforehand).
- **Trucks:** mostly outside trucks; the system must also support **own trucks** later (not now).
- **Two kinds of carriers:**
  - **Transporters:** usually not paid trip by trip. They return manifests and agreed documents → the amount goes to the **transporter's payable account** → paid later.
  - **Independent drivers:** mostly paid **at our site**.
- **Driver ↔ transporter and truck ↔ driver can change** (D4: yes, yes).
- **Trip entry:** trips are created when the loading-site file comes back; office staff re-enter it. Some jobs track border crossing, arrival at storage and unloading; for others that data never comes back. → Trip milestones must be **optional per job**.
- **Advances:** paid at loading when the job has advances; **amount varies per driver** (not one fixed amount).
- **Measurement units:** all units supported (MT, litres, …); the unit is set on the job.
- **Shortage fines (to the carrier):** allowance; above it, fined at the job's set amount **per litre or per MT**. Deducted from what remains payable after the advance (or from the payable if no advance).
  - If the fine is larger than what is owed: **transporter** → deducted from the transporter's overall settlement (other trips); **independent driver** → must pay it back (or deducted from the next trip, see item 11).
- **Demurrage (one method so far; others exist):** days between **arrival at storage** and **discharge**, **excluding both the arrival day and the discharge day**, minus the free days set on the job, × price per day.
  e.g. arrive 1st, discharge 6th → days 2,3,4,5 = 4 days; with 2 free days → 2 × price.
- **Advances (D9):** cash at the site in the **job's currency**; deducted from the net amount for both independents and transporters.
- **Fees / deductions (D10, D12):** per agreement with drivers/transporters, some fees we pay are later deducted from their remaining amount at settlement. Fees (visa, insurance, …) must be **configurable and addable**, each with its own behaviour: deducted from the carrier or not (and, from part 3, included in the customer price or billed separately). **Accounting must be designed for every such item**, not only these.
- **Carrier owes us (D11):** independent driver → pays back, or deducted from his next trip; transporter → deducted from the overall settlement.
- **D13 (accident / spill / contamination / stopped truck):** two ways — (a) the customer agrees and forgives it; (b) we recover the money from the carrier at **an amount we set** (not the shortage fine rate).

## D4 clarification
Explained with an example (driver moves from transporter Masoud to Rekan; truck changes driver). Owner's answer, verbatim:

> see i have this problem all the time we know who is the transporter but we cant rely on it to give them the payment until they bring back the documents, because on their way back to our country or recieving their remaining amount they go to the different transporters who pay them faster so i cant decide which transporter, who is bringing back its debt, last one agreed

→ **Key rule:** the transporter known at loading is **not** necessarily the one paid. On the way back, drivers hand their documents (manifest etc.) to whichever transporter pays them fastest; **that transporter brings the documents to us and claims the trip**. So the payee of a trip is decided only when the documents are presented in a claim (مطالەبە), not at loading. The owner cannot tell, from the loading data, which transporter will bring back a trip and therefore who carries its debt (advance, fines).
→ Old trips keep their old truck/driver (last part agreed).

### Proposed model (to confirm)
- A trip records **the transporter at loading** (information only) and later **the claimant** — the transporter (or the independent driver himself) who presents the manifest in a claim. **Money follows the documents:** the trip's net amount goes to the claimant's account.
- The **advance and fines stay attached to the trip**, not to a transporter: the claimant receives the trip's net (freight ± fines − fees − advance already paid). The claimant who pays the driver early has bought the trip *as it is*, advance already deducted.
- A trip can be claimed **once**; a second claim for the same manifest is refused (stops double payment).
- If a trip's net is negative (fine larger than the freight), it is offset inside the claimant's claim; if the trip is never claimed, the debt stays on the **driver**.

## Open questions (to ask later)

- P4-Q1 Other demurrage methods: what are they (e.g. from loading date, per day after X days, paid by customer to us as well)?
- P4-Q2 Demurrage: paid to the carrier, charged to the customer, or both (with different rates)?
- P4-Q3 Fine "per litre or MT according to the job": can a job use litres for loading and MT for the customer?
- P4-Q4 When a trip is entered later than loading, who is responsible for the advance until then (the loading-site employee's cash)?
- P4-Q5 Accident/contamination recovery: who decides the amount; does it need approval?
