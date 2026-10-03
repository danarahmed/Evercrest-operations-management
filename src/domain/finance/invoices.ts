import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accounts, businessPartners, currencies, invoiceLines, invoices, jobs, journalEntries, journalLines, partnerRoles, payments, trips, trucks } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { type PostingKey, postingAccount } from "../accounting/posting";
import { amountString, currencyCode } from "../currency";
import { getJob } from "../jobs/commands";
import { D, dec, roundTo, roundToIncrement, toStr } from "../money";
import { getSetting } from "@/server/settings";
import { nextNumber } from "../sequences";
import { getTrip } from "../transport/trips";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const lineInput = z.object({
  description: z.string().trim().min(1),
  catalogItemId: uuid.nullish(),
  quantity: amountString,
  unit: z.string().nullish(),
  unitPrice: amountString,
  accountId: uuid,
  jobId: uuid.nullish(),
  tripId: uuid.nullish(),
});

/** Which payable account a bill uses depends on who is billing us. */
const PAYABLE_KEYS = { supplier: "supplier_payables", transporter: "payables_to_transporters", driver: "payables_to_drivers" } as const satisfies Record<string, PostingKey>;

export const createInvoice = defineCommand({
  name: "invoices.create",
  permission: "invoices.create",
  input: z.object({
    kind: z.enum(["sales", "bill"]),
    partnerId: uuid,
    /** For bills: the role the partner bills us in. Ignored for sales. */
    billFrom: z.enum(["supplier", "transporter", "driver"]).optional(),
    currency: currencyCode,
    invoiceDate: isoDate,
    dueDate: isoDate.nullish(),
    externalRef: z.string().trim().nullish(),
    notes: z.string().nullish(),
    lines: z.array(lineInput).min(1),
    /** Round the final total to the configured increment for this currency (e.g. 250 IQD). */
    roundTotal: z.boolean().optional(),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const role = input.kind === "sales" ? "customer" : input.billFrom;
    if (!role) throw new ValidationError("Say whether the bill is from a supplier, transporter or driver");
    const [hasRole] = await tx.select().from(partnerRoles).where(and(eq(partnerRoles.partnerId, input.partnerId), eq(partnerRoles.role, role)));
    if (!hasRole) throw new ValidationError(`Partner is not marked as a ${role}`);
    if (input.kind === "bill" && input.externalRef) {
      const [dup] = await tx
        .select({ no: invoices.invoiceNo })
        .from(invoices)
        .where(and(eq(invoices.companyId, actor.companyId), eq(invoices.partnerId, input.partnerId), eq(invoices.externalRef, input.externalRef), eq(invoices.status, "posted")));
      if (dup) throw new Conflict(`This partner's bill ${input.externalRef} is already recorded as ${dup.no}`);
    }
    const [cur] = await tx.select().from(currencies).where(eq(currencies.code, input.currency));
    if (!cur) throw new NotFound("currency", input.currency);

    const accIds = [...new Set(input.lines.map((l) => l.accountId))];
    const accRows = await tx.select().from(accounts).where(and(eq(accounts.companyId, actor.companyId), inArray(accounts.id, accIds)));
    const allowed = input.kind === "sales" ? ["income"] : ["expense", "asset"];
    const lines = [];
    for (const [i, l] of input.lines.entries()) {
      const acc = accRows.find((a) => a.id === l.accountId);
      if (!acc || !allowed.includes(acc.type))
        throw new ValidationError(`Line ${i + 1}: use ${input.kind === "sales" ? "an income" : "an expense or asset"} account`);
      let jobId = l.jobId ?? null;
      if (l.tripId) {
        const trip = await getTrip(tx, actor.companyId, l.tripId);
        if (jobId && jobId !== trip.jobId) throw new ValidationError(`Line ${i + 1}: trip belongs to a different job`);
        jobId = trip.jobId;
      }
      if (jobId) {
        const job = await getJob(tx, actor.companyId, jobId);
        if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Line ${i + 1}: job ${job.jobNo} is ${job.status}`);
        if (input.kind === "sales" && job.customerId !== input.partnerId)
          throw new ValidationError(`Line ${i + 1}: job ${job.jobNo} belongs to a different customer`);
      }
      const amount = roundTo(dec(l.quantity).times(dec(l.unitPrice)), cur.minorUnits);
      if (amount.lte(0)) throw new ValidationError(`Line ${i + 1}: amount must be greater than zero`);
      lines.push({ ...l, jobId, tripId: l.tripId ?? null, amount });
    }
    const linesTotal = lines.reduce((s, l) => s.plus(l.amount), new D(0));
    let total = linesTotal;
    let rounding = new D(0);
    let roundingAcc: { id: string } | null = null;
    if (input.roundTotal) {
      const inc = ((await getSetting(tx, actor.companyId, "rounding.final_increment")) ?? {})[input.currency];
      if (inc) {
        total = roundToIncrement(linesTotal, inc);
        rounding = linesTotal.minus(total);
        if (!rounding.isZero()) roundingAcc = await postingAccount(tx, actor.companyId, "rounding_differences");
      }
    }
    if (total.lte(0)) throw new ValidationError("Invoice total must be greater than zero");

    const balanceAcc =
      input.kind === "sales"
        ? await postingAccount(tx, actor.companyId, "customer_receivables")
        : await postingAccount(tx, actor.companyId, PAYABLE_KEYS[input.billFrom!]);
    const invoiceNo = await nextNumber(tx, actor.companyId, input.kind === "sales" ? "INV" : "BILL", Number(input.invoiceDate.slice(0, 4)));
    const balanceLine = { accountId: balanceAcc.id, currency: input.currency, partnerId: input.partnerId };
    const entry = await postEntry(ctx, {
      entryDate: input.invoiceDate,
      description: `${invoiceNo} ${input.kind === "sales" ? "invoice" : "bill"}${input.externalRef ? ` (${input.externalRef})` : ""}`,
      sourceType: "invoice",
      sourceId: invoiceNo,
      lines:
        input.kind === "sales"
          ? [
              { ...balanceLine, debit: toStr(total) },
              ...lines.map((l) => ({ accountId: l.accountId, currency: input.currency, jobId: l.jobId, credit: toStr(l.amount), memo: l.description })),
              // Rounded down: the difference is a debit to rounding; rounded up: a credit.
              ...(roundingAcc ? [{ accountId: roundingAcc.id, currency: input.currency, ...(rounding.gt(0) ? { debit: toStr(rounding) } : { credit: toStr(rounding.neg()) }), memo: "rounding" }] : []),
            ]
          : [
              ...lines.map((l) => ({ accountId: l.accountId, currency: input.currency, jobId: l.jobId, debit: toStr(l.amount), memo: l.description })),
              { ...balanceLine, credit: toStr(total) },
              ...(roundingAcc ? [{ accountId: roundingAcc.id, currency: input.currency, ...(rounding.gt(0) ? { credit: toStr(rounding) } : { debit: toStr(rounding.neg()) }), memo: "rounding" }] : []),
            ],
    });
    const [inv] = await tx
      .insert(invoices)
      .values({
        companyId: actor.companyId,
        invoiceNo,
        kind: input.kind,
        partnerId: input.partnerId,
        balanceAccountId: balanceAcc.id,
        currency: input.currency,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? null,
        externalRef: input.externalRef ?? null,
        notes: input.notes ?? null,
        total: toStr(total),
        rounding: toStr(rounding),
        journalEntryId: entry.id,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(invoiceLines).values(
      lines.map((l, i) => ({
        invoiceId: inv.id,
        lineNo: i + 1,
        description: l.description,
        catalogItemId: l.catalogItemId ?? null,
        quantity: l.quantity,
        unit: l.unit ?? null,
        unitPrice: l.unitPrice,
        amount: toStr(l.amount),
        accountId: l.accountId,
        jobId: l.jobId,
        tripId: l.tripId,
      })),
    );
    await audit({ action: "invoices.create", entityType: "invoice", entityId: inv.id, after: { invoiceNo, kind: input.kind, partnerId: input.partnerId, currency: input.currency, total: toStr(total) } });
    return { id: inv.id, invoiceNo, total: toStr(total) };
  },
});

/** Total minus posted payments applied to it. */
export async function invoiceOutstanding(db: Db, invoiceId: string): Promise<string> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw new NotFound("invoice", invoiceId);
  if (inv.status === "cancelled") return "0";
  const [p] = await db
    .select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(and(eq(payments.invoiceId, invoiceId), eq(payments.status, "posted")));
  return toStr(dec(inv.total).minus(dec(p.paid)));
}

export const cancelInvoice = defineCommand({
  name: "invoices.cancel",
  permission: "invoices.cancel",
  input: z.object({ invoiceId: uuid, cancelDate: isoDate, reason: z.string().min(1) }),
  async handler(ctx, { invoiceId, cancelDate, reason }) {
    const { tx, actor, audit } = ctx;
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, actor.companyId)));
    if (!inv) throw new NotFound("invoice", invoiceId);
    if (inv.status === "cancelled") throw new Conflict("Invoice is already cancelled");
    if (dec(await invoiceOutstanding(tx, invoiceId)).lt(dec(inv.total)))
      throw new Conflict("Invoice has payments applied; reverse them first");
    const rev = await reverseEntry(ctx, inv.journalEntryId, cancelDate, `${inv.invoiceNo}: ${reason}`);
    await tx.update(invoices).set({ status: "cancelled", reversalEntryId: rev.id }).where(eq(invoices.id, invoiceId));
    await audit({ action: "invoices.cancel", entityType: "invoice", entityId: invoiceId, before: { status: "posted" }, after: { status: "cancelled" }, reason });
    return { invoiceId };
  },
});

export interface Profitability {
  currency: string;
  revenue: string;
  costs: string;
  profit: string;
}

/**
 * Job profitability from the ledger: income − expenses on lines tagged with the job,
 * per currency (never converted). Advances and customer-recoverable amounts sit
 * on asset accounts and therefore do not count as cost.
 */
export async function jobProfitability(db: Db, jobId: string): Promise<Profitability[]> {
  const rows = await db
    .select({
      currency: journalLines.currency,
      type: accounts.type,
      net: sql<string>`sum(${journalLines.credit} - ${journalLines.debit})`,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.jobId, jobId), inArray(accounts.type, ["income", "expense"])))
    .groupBy(journalLines.currency, accounts.type);
  const byCur = new Map<string, { revenue: InstanceType<typeof D>; costs: InstanceType<typeof D> }>();
  for (const r of rows) {
    const e = byCur.get(r.currency) ?? { revenue: new D(0), costs: new D(0) };
    if (r.type === "income") e.revenue = e.revenue.plus(dec(r.net));
    else e.costs = e.costs.plus(dec(r.net).neg());
    byCur.set(r.currency, e);
  }
  return [...byCur].sort(([a], [b]) => a.localeCompare(b)).map(([currency, e]) => ({
    currency,
    revenue: toStr(e.revenue),
    costs: toStr(e.costs),
    profit: toStr(e.revenue.minus(e.costs)),
  }));
}

/**
 * What a partner owes us (positive) or we owe them (negative), per currency,
 * across receivable/payable/advance accounts.
 */
export async function partnerBalances(db: Db, companyId: string, partnerId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ currency: journalLines.currency, bal: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(accounts.companyId, companyId), eq(journalLines.partnerId, partnerId), inArray(accounts.type, ["asset", "liability"])))
    .groupBy(journalLines.currency);
  return Object.fromEntries(rows.filter((r) => !dec(r.bal).isZero()).map((r) => [r.currency, toStr(dec(r.bal))]));
}

const drivers = alias(businessPartners, "driver");

/**
 * An invoice with every line; trip lines also show the trip's driver, truck and
 * quantities, so an invoice covering many drivers lists each of them.
 */
export async function invoiceDetail(db: Db, companyId: string, invoiceId: string) {
  const [inv] = await db
    .select({ invoice: invoices, partner: businessPartners.name })
    .from(invoices)
    .innerJoin(businessPartners, eq(businessPartners.id, invoices.partnerId))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId)));
  if (!inv) throw new NotFound("invoice", invoiceId);
  const lines = await db
    .select({ line: invoiceLines, trip: trips, driver: drivers.name, plate: trucks.plate, jobNo: jobs.jobNo })
    .from(invoiceLines)
    .leftJoin(trips, eq(trips.id, invoiceLines.tripId))
    .leftJoin(drivers, eq(drivers.id, trips.driverId))
    .leftJoin(trucks, eq(trucks.id, trips.truckId))
    .leftJoin(jobs, eq(jobs.id, invoiceLines.jobId))
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(invoiceLines.lineNo));
  const linesTotal = lines.reduce((sum, l) => sum.plus(dec(l.line.amount)), new D(0));
  const num = (v: string) => toStr(dec(v));
  return {
    invoice: { ...inv.invoice, total: num(inv.invoice.total), rounding: num(inv.invoice.rounding) },
    partner: inv.partner,
    lines: lines.map((l) => ({ ...l, line: { ...l.line, quantity: num(l.line.quantity), unitPrice: num(l.line.unitPrice), amount: num(l.line.amount) } })),
    linesTotal: toStr(linesTotal),
    outstanding: inv.invoice.status === "posted" ? await invoiceOutstanding(db, invoiceId) : "0",
    tripCount: new Set(lines.map((l) => l.trip?.id).filter(Boolean)).size,
    driverCount: new Set(lines.map((l) => l.trip?.driverId).filter(Boolean)).size,
  };
}
