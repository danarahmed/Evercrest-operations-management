import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { catalogItems, deliveries, invoiceLines, invoices } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { amountString } from "../currency";
import { postingAccount } from "../accounting/posting";
import { createInvoice } from "../finance/invoices";
import { type Capability, type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { convertQuantity, getUnit } from "../masterdata/catalog";
import { dec, toStr } from "../money";
import { nextNumber } from "../sequences";
import { resolveRate } from "../transport/rates";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LOCKED = ["financially_closed", "cancelled"];

/** Record products handed to the customer. */
export const recordDelivery = defineCommand({
  name: "deliveries.record",
  permission: "jobs.manage",
  input: z.object({
    jobId: uuid,
    productId: uuid,
    quantity: amountString,
    unit: z.string(),
    deliveryDate: isoDate,
    deliveredTo: z.string().trim().nullish(),
    reference: z.string().trim().nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    if (!(job.capabilities as Capability[]).includes("products")) throw new ValidationError("Products are not switched on for this job");
    if (!dec(input.quantity).gt(0)) throw new ValidationError("Quantity must be greater than zero");
    const [p] = await tx.select().from(catalogItems).where(and(eq(catalogItems.id, input.productId), eq(catalogItems.companyId, actor.companyId)));
    if (!p || p.kind !== "product") throw new NotFound("product", input.productId);
    await getUnit(tx, input.unit);
    const deliveryNo = await nextNumber(tx, actor.companyId, "DLV", Number(input.deliveryDate.slice(0, 4)));
    const [row] = await tx.insert(deliveries).values({ ...input, companyId: actor.companyId, deliveryNo, createdBy: actor.userId }).returning();
    await audit({ action: "deliveries.record", entityType: "delivery", entityId: row.id, after: { deliveryNo, jobNo: job.jobNo, ...input } });
    return { id: row.id, deliveryNo };
  },
});

/** Cancel a delivery recorded by mistake (only if it is not invoiced). */
export const cancelDelivery = defineCommand({
  name: "deliveries.cancel",
  permission: "jobs.manage",
  input: z.object({ deliveryId: uuid, reason: z.string().trim().min(1) }),
  async handler({ tx, actor, audit }, { deliveryId, reason }) {
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.companyId, actor.companyId)));
    if (!d) throw new NotFound("delivery", deliveryId);
    if (d.status === "cancelled") throw new Conflict(`${d.deliveryNo} is already cancelled`);
    if ((await invoicedDeliveryIds(tx, [d.id])).size) throw new Conflict(`${d.deliveryNo} is invoiced; cancel the invoice first`);
    await tx.update(deliveries).set({ status: "cancelled" }).where(eq(deliveries.id, deliveryId));
    await audit({ action: "deliveries.cancel", entityType: "delivery", entityId: deliveryId, before: { status: d.status }, after: { status: "cancelled" }, reason });
    return { id: deliveryId };
  },
});

/** Deliveries on a posted customer invoice. */
export async function invoicedDeliveryIds(db: Db, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .selectDistinct({ id: invoiceLines.deliveryId })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(inArray(invoiceLines.deliveryId, ids), eq(invoices.kind, "sales"), eq(invoices.status, "posted")));
  return new Set(rows.map((r) => r.id!));
}

/**
 * Invoice deliveries of one job: quantity × the product price in force on the
 * delivery date (Setup → rates), or a price typed now when no rule exists.
 * The final total is rounded like every customer invoice.
 */
export const billDeliveries = defineCommand({
  name: "deliveries.bill",
  permission: "billing.create",
  input: z.object({
    jobId: uuid,
    deliveryIds: z.array(uuid).min(1),
    invoiceDate: isoDate,
    dueDate: isoDate.nullish(),
    currency: z.enum(["IQD", "USD"]).nullish(),
    /** Used only for deliveries without a price rule. */
    unitPrice: amountString.nullish(),
  }),
  async handler(ctx, input) {
    const { tx, actor } = ctx;
    const job = await getJob(tx, actor.companyId, input.jobId);
    const list = await tx
      .select({ d: deliveries, product: catalogItems.name })
      .from(deliveries)
      .innerJoin(catalogItems, eq(catalogItems.id, deliveries.productId))
      .where(and(eq(deliveries.jobId, job.id), inArray(deliveries.id, input.deliveryIds), ne(deliveries.status, "cancelled")));
    if (list.length !== new Set(input.deliveryIds).size) throw new ValidationError("Some deliveries do not belong to this job or are cancelled");
    const already = await invoicedDeliveryIds(tx, input.deliveryIds);
    if (already.size) throw new Conflict(`Already invoiced: ${list.filter((x) => already.has(x.d.id)).map((x) => x.d.deliveryNo).join(", ")}`);
    const revenue = await postingAccount(tx, actor.companyId, "product_sales");
    const problems: string[] = [];
    let currency: string | null = input.currency ?? null;
    const lines = [];
    for (const { d, product } of list) {
      const rule = await resolveRate(tx, actor.companyId, "product_price", d.deliveryDate, { productId: d.productId, customerId: job.customerId, transporterId: null, contractId: job.contractId });
      let price: string;
      let unit = d.unit;
      let qty = dec(d.quantity);
      if (rule) {
        if (currency && rule.currency !== currency) { problems.push(`${d.deliveryNo}: ${product} is priced in ${rule.currency}`); continue; }
        currency = rule.currency!;
        price = rule.amount;
        qty = await convertQuantity(tx, d.quantity, d.unit, rule.unit!);
        unit = rule.unit!;
      } else if (input.unitPrice && currency) {
        price = input.unitPrice;
      } else {
        problems.push(`${d.deliveryNo}: no price rule for ${product} on ${d.deliveryDate}; type a unit price and currency`);
        continue;
      }
      lines.push({ description: `${d.deliveryNo} ${product}`, catalogItemId: d.productId, quantity: toStr(qty), unit, unitPrice: price, accountId: revenue.id, jobId: job.id, deliveryId: d.id });
    }
    if (problems.length) throw new ValidationError("These deliveries cannot be invoiced yet", { missing: problems });
    return createInvoice.handler(ctx, { kind: "sales", partnerId: job.customerId, currency: currency!, invoiceDate: input.invoiceDate, dueDate: input.dueDate ?? null, lines, roundTotal: true });
  },
});

export async function listDeliveries(db: Db, jobId: string) {
  const rows = await db
    .select({ d: deliveries, product: catalogItems.name })
    .from(deliveries)
    .innerJoin(catalogItems, eq(catalogItems.id, deliveries.productId))
    .where(eq(deliveries.jobId, jobId))
    .orderBy(desc(deliveries.deliveryDate), desc(deliveries.deliveryNo));
  const invoiced = await invoicedDeliveryIds(db, rows.map((r) => r.d.id));
  return rows.map((r) => ({ ...r, quantity: toStr(dec(r.d.quantity)), invoiced: invoiced.has(r.d.id) }));
}

// Products: with billing on, every delivery must be invoiced before financial close.
registerCapabilityModule({
  capability: "products",
  async blockers(tx: Db, job: Job) {
    if (!(job.capabilities as Capability[]).includes("billing")) return [];
    const live = await tx.select().from(deliveries).where(and(eq(deliveries.jobId, job.id), eq(deliveries.status, "delivered"))).orderBy(deliveries.deliveryNo);
    const invoiced = await invoicedDeliveryIds(tx, live.map((d) => d.id));
    return live
      .filter((d) => !invoiced.has(d.id))
      .map((d) => ({ code: "supply.awaiting_billing", action: `Invoice ${d.deliveryNo}`, params: { delivery: d.deliveryNo }, blocks: "financially_closed" as const }));
  },
  async inUse(tx: Db, job: Job) {
    const [d] = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.jobId, job.id), eq(deliveries.status, "delivered"))).limit(1);
    return !!d;
  },
});
