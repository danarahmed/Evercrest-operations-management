import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { feeTypes, moneyAccounts, payments, tripFees, trips } from "@/db/schema";
import { defineCommand, type CommandContext } from "@/server/command";
import { ApprovalRequired, Conflict, NotFound, ValidationError } from "@/server/errors";
import { postEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { registerApprovable } from "../approvals/approvals";
import { amountString } from "../currency";
import { assertWithinLimit } from "../finance/payments";
import { getJob } from "../jobs/commands";
import { D, dec, toStr } from "../money";
import { nextNumber } from "../sequences";
import { liveTrips } from "./live-calc";
import { loadRuleCard, termsOn } from "./terms";
import { isSettled, plateKey } from "./trips";
/** Same rule as the import: a manifest number matched ignoring case, spaces and digit style. */
const manifestKey = (m: string) => plateKey(m);

/**
 * Fees on trips (owner's rules, 2026-11): fees are never added automatically. Each kind of fee is set up once
 * (usual amount, per trip or per ton, who pays it at the time, who carries it in the end, its account), and
 * operations tick the fees each trip had. Fees the company paid are paid later in one go with "Pay fees";
 * fees the customer paid directly cost the company nothing and, when taken back from the carrier, are owed
 * back to the customer.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const feeChoice = z.object({
  feeTypeId: uuid,
  amount: amountString.nullish(),
  /** Who paid it on this trip (empty = the kind's usual payer). "carrier": the driver paid it and gets it back. */
  paidBy: z.enum(["company", "customer", "carrier"]).nullish(),
  /** A fee the driver paid: its receipt was brought. */
  receipt: z.boolean().nullish(),
});
export type FeeChoice = z.infer<typeof feeChoice>;

/** The trip fee row for a fee type: the usual amount unless one is typed; the fee type's own rules. */
async function feeRow(tx: Db, companyId: string, trip: typeof trips.$inferSelect, choice: FeeChoice) {
  const [ft] = await tx.select().from(feeTypes).where(and(eq(feeTypes.id, choice.feeTypeId), eq(feeTypes.companyId, companyId)));
  if (!ft) throw new NotFound("fee_type", choice.feeTypeId);
  const rate = choice.amount ?? ft.defaultAmount;
  if (rate === null || rate === undefined) throw new ValidationError(`${ft.name} has no usual amount; type the amount`);
  if (dec(rate).lt(0)) throw new ValidationError("A fee cannot be negative");
  let currency = ft.defaultCurrency;
  if (!currency) {
    const card = await loadRuleCard(tx, companyId, trip.jobId);
    currency = (trip.loadingDate ? termsOn(card, trip.routeId, trip.loadingDate)?.currency : null) ?? card.terms[0]?.currency ?? null;
  }
  if (!currency) throw new ValidationError(`Set the currency of ${ft.name} in Setup, or the job's rule card first`);
  return {
    companyId,
    tripId: trip.id,
    feeTypeId: ft.id,
    rate: toStr(dec(rate)),
    basis: ft.defaultBasis,
    currency,
    deductFromCarrier: ft.deductFromCarrier,
    billedToCustomer: ft.paidBy === "company" && ft.billedToCustomer,
    paidBy: choice.paidBy ?? ft.paidBy,
    receiptReceived: (choice.paidBy ?? ft.paidBy) === "carrier" && !!choice.receipt,
    source: "entered" as const,
    name: ft.name,
  };
}

/**
 * Make a trip's fees exactly the ticked list. A fee already paid with "Pay fees" stays as it is (reverse that payment
 * first to change it). Returns the change for the trip's history.
 */
export async function setTripFeesTx(tx: Db, companyId: string, trip: typeof trips.$inferSelect, chosen: FeeChoice[]) {
  const current = await tx.select().from(tripFees).where(eq(tripFees.tripId, trip.id));
  const wanted = new Map(chosen.map((c) => [c.feeTypeId, c]));
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  for (const f of current) {
    const c = wanted.get(f.feeTypeId);
    const same = c && (c.amount === null || c.amount === undefined || dec(c.amount).eq(dec(f.rate))) && (!c.paidBy || c.paidBy === f.paidBy);
    if (f.paymentId && !same) throw new Conflict("A fee that is already paid cannot be changed or removed; reverse its payment first");
    if (!same) {
      before[f.feeTypeId] = `${toStr(dec(f.rate))}${f.paidBy === "carrier" ? " (driver paid)" : ""}`;
      await tx.delete(tripFees).where(eq(tripFees.id, f.id));
    } else if (f.paidBy === "carrier" && c.receipt !== undefined && c.receipt !== null && c.receipt !== f.receiptReceived) {
      // Only the receipt changed: keep the fee (and any approved exception).
      await tx.update(tripFees).set({ receiptReceived: c.receipt }).where(eq(tripFees.id, f.id));
      before[`${f.feeTypeId}:receipt`] = String(f.receiptReceived);
      after[`${f.feeTypeId}:receipt`] = String(c.receipt);
    }
  }
  const kept = new Set((await tx.select({ feeTypeId: tripFees.feeTypeId }).from(tripFees).where(eq(tripFees.tripId, trip.id))).map((r) => r.feeTypeId));
  for (const c of chosen) {
    if (kept.has(c.feeTypeId)) continue;
    const { name, ...row } = await feeRow(tx, companyId, trip, c);
    void name;
    await tx.insert(tripFees).values(row);
    after[c.feeTypeId] = `${row.rate}${row.paidBy === "carrier" ? " (driver paid)" : ""}`;
  }
  return { before, after, changed: Object.keys(before).length + Object.keys(after).length > 0 };
}

/** Add one kind of fee to many trips of a job at once (typed or pasted manifests), e.g. the customs of 20 trucks. */
export const addFeeToTrips = defineCommand({
  name: "trip_fees.add_many",
  permission: "trips.manage",
  input: z.object({ jobId: uuid, feeTypeId: uuid, amount: amountString.nullish(), manifests: z.array(z.string().trim().min(1)).min(1).max(500) }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    const keys = [...new Set(input.manifests.map(manifestKey))];
    const rows = await tx.select().from(trips).where(and(eq(trips.jobId, job.id), inArray(trips.manifestKey, keys), inArray(trips.status, ["planned", "loaded", "discharged"])));
    const found = new Set(rows.map((r) => r.manifestKey));
    const missing = input.manifests.filter((m) => !found.has(manifestKey(m)));
    if (missing.length) throw new ValidationError("These manifests are not on this job", { missing });
    const problems: string[] = [];
    let added = 0;
    for (const trip of rows) {
      if (await isSettled(tx, trip.id)) { problems.push(`${trip.manifestNo}: already claimed`); continue; }
      const [has] = await tx.select({ id: tripFees.id }).from(tripFees).where(and(eq(tripFees.tripId, trip.id), eq(tripFees.feeTypeId, input.feeTypeId)));
      if (has) continue;
      const { name, ...row } = await feeRow(tx, actor.companyId, trip, input);
      void name;
      await tx.insert(tripFees).values(row);
      await audit({ action: "trip_fees.add", entityType: "trip", entityId: trip.id, after: { [input.feeTypeId]: row.rate } });
      added++;
    }
    if (problems.length) throw new ValidationError("Some trips cannot get a fee", { missing: problems });
    return { added };
  },
});

/** Company-paid fees of a job not paid yet, with their amounts (from the live trip figures). */
export async function unpaidFees(db: Db, companyId: string, jobId: string) {
  const rows = await db
    .select({ fee: tripFees, trip: trips, name: feeTypes.name })
    .from(tripFees)
    .innerJoin(trips, eq(trips.id, tripFees.tripId))
    .innerJoin(feeTypes, eq(feeTypes.id, tripFees.feeTypeId))
    .where(and(eq(trips.jobId, jobId), eq(tripFees.paidBy, "company"), isNull(tripFees.paymentId), inArray(trips.status, ["planned", "loaded", "discharged"])));
  if (!rows.length) return [];
  const live = await liveTrips(db, companyId, [...new Map(rows.map((r) => [r.trip.id, r.trip])).values()]);
  return rows.map((r) => {
    const line = live.get(r.trip.id)?.calc?.fees.find((f) => f.feeTypeId === r.fee.feeTypeId);
    // Without a rule card the quantity is unknown: a per-trip fee is its rate; a per-ton fee waits for the card.
    const amount = line?.amount ?? (r.fee.basis === "per_trip" ? toStr(dec(r.fee.rate)) : null);
    return { id: r.fee.id, feeTypeId: r.fee.feeTypeId, name: r.name, tripId: r.trip.id, manifest: r.trip.manifestNo ?? r.trip.tripNo, loadingDate: r.trip.loadingDate, currency: r.fee.currency, amount };
  });
}

/**
 * Pay many trips' fees in one payment from one cash box (owner: "one payment for the customs of 20 trucks").
 * The books: each fee's account (its own, or "Trip fees") on the trip's job, against the cash box. The payment
 * limit applies to the total; above it the payment waits for approval.
 */
export const payFees = defineCommand({
  name: "fees.pay",
  permission: "payments.create",
  input: z.object({
    tripFeeIds: z.array(uuid).min(1).max(1000),
    moneyAccountId: uuid,
    paymentDate: isoDate,
    method: z.enum(["cash", "bank_transfer", "cheque", "other"]).default("cash"),
    reference: z.string().trim().nullish(),
  }),
  async handler(ctx: CommandContext, input) {
    const { tx, actor, audit } = ctx;
    const ids = [...new Set(input.tripFeeIds)];
    const rows = await tx
      .select({ fee: tripFees, trip: trips, ft: feeTypes })
      .from(tripFees)
      .innerJoin(trips, eq(trips.id, tripFees.tripId))
      .innerJoin(feeTypes, eq(feeTypes.id, tripFees.feeTypeId))
      .where(and(inArray(tripFees.id, ids), eq(tripFees.companyId, actor.companyId)))
      .for("update", { of: tripFees });
    if (rows.length !== ids.length) throw new NotFound("trip_fee", ids.find((i) => !rows.some((r) => r.fee.id === i)) ?? "");
    const [money] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, input.moneyAccountId), eq(moneyAccounts.companyId, actor.companyId)));
    if (!money?.active) throw new NotFound("money_account", input.moneyAccountId);
    for (const r of rows) {
      if (r.fee.paidBy !== "company")
        throw new ValidationError(`${r.ft.name} on ${r.trip.manifestNo ?? r.trip.tripNo} was paid by the ${r.fee.paidBy === "carrier" ? "driver (it is paid back on the trip's claim)" : "customer"}; the company does not pay it`);
      if (r.fee.paymentId) throw new Conflict(`${r.ft.name} on ${r.trip.manifestNo ?? r.trip.tripNo} is already paid`);
      if (r.trip.status === "cancelled") throw new Conflict(`${r.trip.tripNo} is cancelled`);
      if (r.fee.currency !== money.currency) throw new ValidationError(`${r.ft.name} on ${r.trip.manifestNo ?? r.trip.tripNo} is in ${r.fee.currency}; ${money.name} holds ${money.currency}`);
    }
    const jobIds = [...new Set(rows.map((r) => r.trip.jobId))];
    for (const id of jobIds) {
      const job = await getJob(tx, actor.companyId, id);
      if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Job ${job.jobNo} is ${job.status}`);
    }
    const live = await liveTrips(tx, actor.companyId, [...new Map(rows.map((r) => [r.trip.id, r.trip])).values()]);
    const fallback = await postingAccount(tx, actor.companyId, "trip_fees");
    // A fee on the customer's invoice is pass-through: owed by the customer until invoiced, never a job cost.
    let toBill: string | null = null;
    const customerOf = new Map<string, string>();
    // Group the debits per account and job, so the entry stays short but every fee is traceable.
    const debits = new Map<string, { accountId: string; jobId: string; partnerId: string | null; amount: InstanceType<typeof D>; memo: string[] }>();
    let total = new D(0);
    for (const r of rows) {
      const line = live.get(r.trip.id)?.calc?.fees.find((f) => f.feeTypeId === r.fee.feeTypeId);
      const amount = dec(line?.amount ?? (r.fee.basis === "per_trip" ? r.fee.rate : "NaN"));
      if (amount.isNaN()) throw new ValidationError(`${r.ft.name} on ${r.trip.manifestNo ?? r.trip.tripNo} is per ton and the trip has no rule card yet`);
      if (amount.isZero()) continue;
      const billed = line?.billedToCustomer ?? false;
      const accountId = billed ? (toBill ??= (await postingAccount(tx, actor.companyId, "fees_to_bill")).id) : (r.ft.expenseAccountId ?? fallback.id);
      if (billed && !customerOf.has(r.trip.jobId)) customerOf.set(r.trip.jobId, (await getJob(tx, actor.companyId, r.trip.jobId)).customerId);
      const k = `${accountId}:${r.trip.jobId}`;
      const d = debits.get(k) ?? { accountId, jobId: r.trip.jobId, partnerId: billed ? customerOf.get(r.trip.jobId)! : null, amount: new D(0), memo: [] };
      d.amount = d.amount.plus(amount);
      d.memo.push(`${r.trip.manifestNo ?? r.trip.tripNo} ${r.ft.name}`);
      debits.set(k, d);
      total = total.plus(amount);
    }
    if (!total.gt(0)) throw new ValidationError("Nothing to pay");
    if (!ctx.approval) await assertWithinLimit(tx, actor.companyId, money.currency, toStr(total), null, input.paymentDate);
    const paymentNo = await nextNumber(tx, actor.companyId, "PAY", Number(input.paymentDate.slice(0, 4)));
    const entry = await postEntry(ctx, {
      entryDate: input.paymentDate,
      description: `${paymentNo} fees, ${rows.length} on ${new Set(rows.map((r) => r.trip.id)).size} trips${input.reference ? ` (${input.reference})` : ""}`,
      sourceType: "payment",
      sourceId: paymentNo,
      lines: [
        ...[...debits.values()].map((d) => ({ accountId: d.accountId, currency: money.currency, jobId: d.jobId, partnerId: d.partnerId, debit: toStr(d.amount), memo: d.memo.join(", ").slice(0, 500) })),
        { accountId: money.ledgerAccountId, currency: money.currency, credit: toStr(total) },
      ],
    });
    const [pay] = await tx
      .insert(payments)
      .values({
        companyId: actor.companyId,
        paymentNo,
        direction: "out",
        purpose: "expense",
        moneyAccountId: money.id,
        amount: toStr(total),
        currency: money.currency,
        paymentDate: input.paymentDate,
        method: input.method,
        jobId: jobIds.length === 1 ? jobIds[0] : null,
        counterAccountId: [...debits.values()][0].accountId,
        reference: input.reference || null,
        notes: `Fees: ${rows.length}`,
        journalEntryId: entry.id,
        createdBy: actor.userId,
      })
      .returning();
    await tx.update(tripFees).set({ paymentId: pay.id }).where(inArray(tripFees.id, ids));
    await audit({ action: "fees.pay", entityType: "payment", entityId: pay.id, after: { paymentNo, total: toStr(total), currency: money.currency, fees: rows.map((r) => `${r.trip.manifestNo ?? r.trip.tripNo} ${r.ft.name}`) } });
    return { id: pay.id, paymentNo, total: toStr(total) };
  },
});
registerApprovable(payFees);

/** The fee types of the company, for forms (active ones) and for the grid's fee columns. */
export async function companyFeeTypes(db: Db, companyId: string) {
  return db.select().from(feeTypes).where(eq(feeTypes.companyId, companyId)).orderBy(feeTypes.name);
}

/**
 * A fee the driver paid, paid back without its receipt (owner's rule: an exception, always approved by a second
 * person, with a reason). After approval the trip can be claimed or settled by the site.
 */
export const waiveFeeReceipt = defineCommand({
  name: "trip_fees.receipt_waive",
  permission: "trips.manage",
  input: z.object({ tripFeeId: uuid, reason: z.string().trim().min(1, "Say why it is paid without its receipt").max(500) }),
  async handler(ctx: CommandContext, input) {
    const { tx, actor, audit } = ctx;
    const [row] = await tx
      .select({ fee: tripFees, trip: trips, name: feeTypes.name })
      .from(tripFees)
      .innerJoin(trips, eq(trips.id, tripFees.tripId))
      .innerJoin(feeTypes, eq(feeTypes.id, tripFees.feeTypeId))
      .where(and(eq(tripFees.id, input.tripFeeId), eq(tripFees.companyId, actor.companyId)))
      .for("update", { of: tripFees });
    if (!row) throw new NotFound("trip_fee", input.tripFeeId);
    const label = `${row.name} on ${row.trip.manifestNo ?? row.trip.tripNo}`;
    if (row.fee.paidBy !== "carrier") throw new ValidationError(`${label} was not paid by the driver`);
    if (row.fee.receiptReceived || row.fee.receiptWaived) throw new Conflict(`${label} needs nothing: its receipt is already in`);
    if (await isSettled(tx, row.trip.id)) throw new Conflict(`${row.trip.manifestNo ?? row.trip.tripNo} is already claimed`);
    if (!ctx.approval) throw new ApprovalRequired(`${label}: pay it back without its receipt — this needs approval`, { fee: row.name, trip: row.trip.manifestNo ?? row.trip.tripNo, reason: input.reason });
    await tx.update(tripFees).set({ receiptWaived: true, receiptWaiveReason: input.reason, receiptWaivedBy: ctx.approval.approvedBy }).where(eq(tripFees.id, row.fee.id));
    await audit({ action: "trip_fees.receipt_waive", entityType: "trip", entityId: row.trip.id, after: { fee: row.name, receiptWaived: true }, reason: input.reason });
    return { id: row.fee.id };
  },
});
registerApprovable(waiveFeeReceipt);
