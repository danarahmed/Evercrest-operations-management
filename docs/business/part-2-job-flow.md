# Part 2 — One real job from start to finish

_Owner's answer, verbatim (2026-10)._

> 1. most of the time is phone call
> 2. the manager or me who is working between finance and the petroleum management, i will create file for the employees to collect data after the job starts and telling the accountants how they should handle the accounts that been affected by the jobs
> 3. we have two situations, once we don't agree on the contract price till we can see how much it costs on us and then we will decide, and one is set before the jobs starts on everything that this contract cover it like ( visa, insurance, fine mt forgiveness on border which we give it back to the driver, entrance fee, setting data, demurrage, transportation, forgiveness of each trips, custom, etc. ) and it is not per jobs it will change due to the jobs we get and some has all of it some does not have it, we have mores like that i will give you later, no it is on the call we don't have a written one
> 4. loading starts where our temporary employees manage it for the specific jobs paying cash advances sometimes and send back the loaded data and cash advance then in the company one of our employee work on it and copy paste it to our files which is different than their file, and set the price and rewards may we give to the driver and route of the trips where it goes to where some more data if we have that we agree in the contract, then we get back discharge data from the storage, and sometimes we cant get it back until the driver brings us back the documents on return, then when everything is set we have settlement we may pay it in different ways, on some location we set and may it comes back to the office then we pay at the office or it goes to payable account on the name of the transporter, you will have clearer idea about the jobs when i send you one of our jobs and for the roles of the employees i want you to come up with an idea to set roles for our jobs after you understand the business and the work we do
> 5. we give the accountant the details of the load and then the cash advances that has been given to them each job itself and then at the end for the settlements we create settlements and send it to the places we have to pay directly to the drivers, but we have some places sometimes due to urgency of the payment we cant give them the settlement they have their own data and send us back the settlement we check it here at the office which is the things that takes alot of effort because of the wrong payments and the delaying in return, at the end if everything is right i sign it and give it to the accountant
> 6. sometimes we have contract the amount has been mentioned and sometimes the one we have the contract with just telling us to stop and it is finished
> 7. if you mean the company we transport or getting the jobs done for them we do it monthly or sometimes we dont know it takes more than a month, for the payments it will be delayed alot we dont know because they are close to us we dont agree on that but we might have different companies that we agree on when to complete the payment, and the pay cash advances to us on the jobs we get
> 8. we have this problem right now, it takes a lot of effort we do not know it till the job finished and every expenses relate to that job recorded, we have the problems when the transporters bring back the manifests and the documents very late and those expenses not been recorded because of lack of the documents and not knowing who is the transporter to put the money on their accounts, and every jobs we have is not like that those which is internal in iraq is easier to get it to done but those we transport abroad takes more time to discharges and get back the data to confirm

## What this tells us (first reading)

- **Work arrives by phone.** Agreements are verbal; usually no written contract.
- **Who sets a job up:** the manager or the owner (between finance and petroleum operations). They decide what data staff collect and tell the accountants how the job's accounts are treated. → The system should let a manager set up a job's terms and money rules once, so staff and accountants follow them instead of instructions by phone/file.
- **Two pricing situations:**
  1. **Price decided later** — after the costs are known.
  2. **Agreed up front** — a bundle of terms that differs per job: visa, insurance, MT fine forgiveness at the border (passed back to the driver), entrance fee, "setting data", demurrage, transportation, per-trip forgiveness, customs, and more (owner will list later). Some jobs have all, some only some.
  → A job needs a flexible list of **terms / charge items**, each with its own rule, not fixed fields. The price may also be **open (to be decided)** and set later.
- **Field flow (loading):** temporary employees at the loading site manage the job, sometimes pay **cash advances** on the spot, and send back loading data + advances. An office employee re-types/copies it into the company's own files (different format), adds price, **driver rewards**, route (from → to) and any contract data. **Discharge data** comes from the storage/receiving site; sometimes only when the driver returns with the documents.
  → Field staff should enter loading data and advances directly (or import their sheet) — no re-typing. The office completes price, rewards and route. Discharge data is matched later, trip by trip.
- **Settlement and payment:** paid in different ways — at a set location, at the office, or credited to the **transporter's payable account**.
- **Remote settlements (biggest effort):** at some locations, due to urgency, the remote side pays drivers using **their own data and calculation**, then sends the settlement to the office; the office checks it — wrong payments and late returns are the main pain. Owner signs, then accountant records.
  → Need: the system computes the correct settlement per trip; remote payers' settlements are imported/entered and **automatically compared** against the system's figures, with differences flagged; owner approves.
- **Accountant receives:** load details, the job's cash advances, then settlements.
- **Job end:** sometimes the contract states a total amount; sometimes the customer just says "stop" and the job ends.
- **Customer billing:** usually monthly; sometimes longer. Customer payments are often very late with no fixed terms (close relationships); other customers have agreed payment dates. **Customers sometimes pay cash advances to us** on jobs.
- **Profit is unknown until the job is fully finished** and all expenses recorded. Main blockers: transporters return manifests/documents very late; expenses can't be recorded without documents or when the transporter of a trip isn't known.
- **Domestic (inside Iraq) vs abroad:** cross-border jobs take much longer to discharge and to confirm data.
- **Roles:** owner asks me to propose staff roles once I understand the business.

## Open questions (to ask later)

- P2-Q1 "Setting data" and "forgiveness of each trip": what exactly are these, and who pays/receives?
- P2-Q2 MT fine forgiveness at the border: is it a fine the border/customer forgives that we then pass back to the driver? Show a numeric example.
- P2-Q3 For each term (visa, insurance, entrance fee, customs, demurrage…): who pays it (we, driver, transporter), who reimburses whom, and is it billed to the customer?
- P2-Q4 Price decided later: is the cost total + margin, or negotiated? Can trips be loaded and advances paid with no price yet?
- P2-Q5 Remote settlements: who are the remote payers (our temporary employees, a transporter, an exchanger)? What file do they send back (Excel, paper, photo)?
- P2-Q6 Trips with unknown transporter: how does that happen (driver didn't say, changed transporter)? How is it resolved?
- P2-Q7 Customer cash advances to us: per job? How are they deducted from invoices?
- P2-Q8 Abroad jobs: which countries/routes, which extra documents and costs (customs, visas), and in which currency?
