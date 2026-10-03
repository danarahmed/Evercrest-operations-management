import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { jobs, trips } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, ValidationError } from "@/server/errors";
import { postingAccount } from "../accounting/posting";
import { createInvoice } from "../finance/invoices";
import { type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { convertQuantity } from "../masterdata/catalog";
import { toStr } from "../money";
import { resolveRate } from "./rates";
import { billedTripIds, demurrageDays, postedSettlement, tripQuantities } from "./settlement";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Invoice the customer for discharged trips of one job: actual quantity × the
 * customer price in force on each trip's loading date, plus customer demurrage
 * where a rule exists. All trips on one invoice must share the currency.
 * The final total is rounded to the configured increment.
 */
export const billTrips = defineCommand({
  name: "billing.bill_trips",
  permission: "billing.create",
  input: z.object({ jobId: uuid, tripIds: z.array(uuid).min(1), invoiceDate: isoDate, dueDate: isoDate.nullish() }),
  async handler(ctx, { jobId, tripIds, invoiceDate, dueDate }) {
    const { tx, actor } = ctx;
    const job = await getJob(tx, actor.companyId, jobId);
    const list = await tx.select().from(trips).where(and(eq(trips.jobId, jobId), inArray(trips.id, tripIds)));
    if (list.length !== new Set(tripIds).size) throw new ValidationError("Some trips do not belong to this job");
    const already = await billedTripIds(tx, tripIds);
    if (already.size) throw new Conflict(`Already billed: ${list.filter((t) => already.has(t.id)).map((t) => t.tripNo).join(", ")}`);

    const revenue = await postingAccount(tx, actor.companyId, "transport_revenue");
    const lines: { description: string; quantity: string; unit?: string; unitPrice: string; accountId: string; tripId: string }[] = [];
    const problems: string[] = [];
    let currency: string | null = null;
    for (const trip of list) {
      if (trip.status !== "discharged") { problems.push(`${trip.tripNo} is not discharged`); continue; }
      const q = await tripQuantities(tx, trip);
      if ("code" in q && !("unit" in q)) { problems.push(q.message); continue; }
      const qty = q as Exclude<typeof q, { code: string }>;
      const rctx = { productId: trip.productId, customerId: job.customerId, transporterId: trip.transporterId, contractId: job.contractId };
      const price = await resolveRate(tx, actor.companyId, "customer_price", trip.loadingDate!, rctx);
      if (!price) { problems.push(`No customer price rule in force on ${trip.loadingDate} for ${trip.tripNo}`); continue; }
      currency ??= price.currency!;
      if (price.currency !== currency) { problems.push(`${trip.tripNo} is priced in ${price.currency}; bill it on a separate ${price.currency} invoice`); continue; }
      if (price.basis === "per_trip") lines.push({ description: `${trip.tripNo} transport`, quantity: "1", unitPrice: price.amount, accountId: revenue.id, tripId: trip.id });
      else {
        const inUnit = await convertQuantity(tx, qty.actual, qty.unit, price.unit!);
        lines.push({ description: `${trip.tripNo} transport ${toStr(inUnit)} ${price.unit}`, quantity: toStr(inUnit), unit: price.unit!, unitPrice: price.amount, accountId: revenue.id, tripId: trip.id });
      }
      const demBill = await resolveRate(tx, actor.companyId, "demurrage_bill", trip.loadingDate!, rctx);
      if (demBill) {
        const days = demurrageDays(demBill, trip);
        if (typeof days !== "number") { problems.push(days.message); continue; }
        if (demBill.currency !== currency) { problems.push(`${trip.tripNo}: demurrage is priced in ${demBill.currency}`); continue; }
        if (days > 0) {
          const demAcc = await postingAccount(tx, actor.companyId, "demurrage_revenue");
          lines.push({ description: `${trip.tripNo} demurrage ${days} days`, quantity: String(days), unitPrice: demBill.amount, accountId: demAcc.id, tripId: trip.id });
        }
      }
    }
    if (problems.length) throw new ValidationError("These trips cannot be billed yet", { missing: problems });
    // Same rules and controls as any invoice (customer role, closed jobs, posting, audit).
    return createInvoice.handler(ctx, {
      kind: "sales",
      partnerId: job.customerId,
      currency: currency!,
      invoiceDate,
      dueDate: dueDate ?? null,
      lines,
      roundTotal: true,
    });
  },
});

/** Discharged, live trips of a job. */
async function dischargedTrips(tx: Db, jobId: string) {
  return tx.select().from(trips).where(and(eq(trips.jobId, jobId), eq(trips.status, "discharged")));
}

// Settlement must be done before a transport job is financially closed.
registerCapabilityModule({
  capability: "transportation",
  async blockers(tx: Db, job: Job) {
    const out = [];
    for (const t of await dischargedTrips(tx, job.id))
      if (!(await postedSettlement(tx, t.id)))
        out.push({ code: "transport.awaiting_settlement", action: `Settle ${t.tripNo}`, params: { trip: t.tripNo }, blocks: "financially_closed" as const });
    return out;
  },
  async inUse() {
    return false;
  },
});

// With billing on, every discharged trip must be invoiced before financial close.
registerCapabilityModule({
  capability: "billing",
  async blockers(tx: Db, job: Job) {
    const discharged = await dischargedTrips(tx, job.id);
    const billed = await billedTripIds(tx, discharged.map((t) => t.id));
    return discharged
      .filter((t) => !billed.has(t.id))
      .map((t) => ({ code: "transport.awaiting_billing", action: `Bill ${t.tripNo}`, params: { trip: t.tripNo }, blocks: "financially_closed" as const }));
  },
  async inUse(tx: Db, job: Job) {
    const [j] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, job.id), ne(jobs.status, "cancelled")));
    return !!j && (await billedTripIds(tx, (await dischargedTrips(tx, job.id)).map((t) => t.id))).size > 0;
  },
});
