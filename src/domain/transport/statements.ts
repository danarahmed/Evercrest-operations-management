import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, catalogItems, jobs, payments, payStatementItems, payStatements, trips, tripSettlements, trucks } from "@/db/schema";
import { STATEMENT_PARTIES, type StatementParty } from "@/db/schema/statements";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { registerApprovable } from "../approvals/approvals";
import { recordPayment } from "../finance/payments";
import { D, dec, toStr } from "../money";
import { nextNumber } from "../sequences";
import type { PartySettlement, SettlementCalculation } from "./settlement";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const sideOf = (calc: SettlementCalculation, party: StatementParty): PartySettlement | null => (party === "driver" ? calc.driver : calc.transporter);

/**
 * Put settled trips on one pay statement, e.g. several drivers paid together,
 * or all of one transporter's trips (with every driver shown). Amounts come
 * from the settlement snapshots; nothing is recalculated.
 */
export const createPayStatement = defineCommand({
  name: "statements.create",
  permission: "settlements.create",
  input: z.object({
    party: z.enum(STATEMENT_PARTIES),
    settlementIds: z.array(uuid).min(1),
    statementDate: isoDate,
    notes: z.string().nullish(),
  }),
  async handler({ tx, actor, audit }, { party, settlementIds, statementDate, notes }) {
    const ids = [...new Set(settlementIds)];
    const rows = await tx
      .select({ s: tripSettlements, trip: trips })
      .from(tripSettlements)
      .innerJoin(trips, eq(trips.id, tripSettlements.tripId))
      .where(and(eq(tripSettlements.companyId, actor.companyId), inArray(tripSettlements.id, ids)))
      .for("update", { of: tripSettlements });
    if (rows.length !== ids.length) throw new NotFound("trip_settlement", ids.find((id) => !rows.some((r) => r.s.id === id))!);

    const problems: string[] = [];
    let currency: string | null = null;
    const items = [];
    for (const { s, trip } of rows) {
      if (s.status !== "posted") { problems.push(`${s.settlementNo} is reversed`); continue; }
      const side = sideOf(s.calculation as SettlementCalculation, party);
      const partnerId = party === "driver" ? trip.driverId : trip.transporterId;
      if (!side || !partnerId) { problems.push(`${trip.tripNo} has no transporter`); continue; }
      currency ??= side.currency;
      if (side.currency !== currency) { problems.push(`${trip.tripNo} is in ${side.currency}; put it on a separate ${side.currency} statement`); continue; }
      items.push({ settlementId: s.id, tripId: trip.id, party, partnerId, amount: side.netFinal });
    }
    const [taken] = await tx
      .select({ tripNo: trips.tripNo, no: payStatements.statementNo })
      .from(payStatementItems)
      .innerJoin(payStatements, eq(payStatements.id, payStatementItems.statementId))
      .innerJoin(trips, eq(trips.id, payStatementItems.tripId))
      .where(and(inArray(payStatementItems.settlementId, ids), eq(payStatementItems.party, party), eq(payStatementItems.active, true)))
      .limit(1);
    if (taken) problems.push(`${taken.tripNo} is already on ${taken.no}`);
    if (problems.length) throw new ValidationError("These trips cannot be put on the statement", { missing: problems });

    const total = items.reduce((sum, i) => sum.plus(dec(i.amount)), new D(0));
    const statementNo = await nextNumber(tx, actor.companyId, "PST", Number(statementDate.slice(0, 4)));
    const [st] = await tx
      .insert(payStatements)
      .values({ companyId: actor.companyId, statementNo, party, currency: currency!, statementDate, total: toStr(total), notes: notes ?? null, createdBy: actor.userId })
      .returning();
    await tx.insert(payStatementItems).values(items.map((i) => ({ ...i, statementId: st.id })));
    await audit({ action: "statements.create", entityType: "pay_statement", entityId: st.id, after: { statementNo, party, currency, total: toStr(total), trips: rows.map((r) => r.trip.tripNo) } });
    return { id: st.id, statementNo };
  },
});

/** What each payee is owed on a statement (sum of their items), and whether it is already paid. */
export async function statementPayees(db: Db, statementId: string) {
  const rows = await db
    .select({ partnerId: payStatementItems.partnerId, name: businessPartners.name, total: sql<string>`sum(${payStatementItems.amount})` })
    .from(payStatementItems)
    .innerJoin(businessPartners, eq(businessPartners.id, payStatementItems.partnerId))
    .where(and(eq(payStatementItems.statementId, statementId), eq(payStatementItems.active, true)))
    .groupBy(payStatementItems.partnerId, businessPartners.name)
    .orderBy(asc(businessPartners.name));
  const paid = await db
    .select()
    .from(payments)
    .where(and(eq(payments.statementId, statementId), eq(payments.status, "posted")));
  return rows.map((r) => {
    const p = paid.find((x) => x.partnerId === r.partnerId);
    return { partnerId: r.partnerId, name: r.name, total: toStr(dec(r.total)), payment: p ? { id: p.id, no: p.paymentNo, date: p.paymentDate } : null };
  });
}

/** Paid when every payee owed a positive amount has a posted payment. */
async function refreshStatus(tx: Db, statementId: string) {
  const [st] = await tx.select().from(payStatements).where(eq(payStatements.id, statementId));
  if (st.status === "cancelled") return st.status;
  const payees = await statementPayees(tx, statementId);
  const status = payees.every((p) => !dec(p.total).gt(0) || p.payment) ? "paid" : "open";
  if (status !== st.status) await tx.update(payStatements).set({ status }).where(eq(payStatements.id, statementId));
  return status;
}

/**
 * Pay the statement from one money account: one payment per payee (so each
 * driver's balance and the payout limits stay per person), all in one step.
 * Payees already paid, or who owe rather than are owed, are skipped.
 */
export const payStatement = defineCommand({
  name: "statements.pay",
  permission: "payments.create",
  input: z.object({
    statementId: uuid,
    moneyAccountId: uuid,
    paymentDate: isoDate,
    method: z.enum(["cash", "bank_transfer", "cheque", "other"]),
    /** Pay only these payees (e.g. drivers now, the transporter later). Default: everyone still unpaid. */
    partnerIds: z.array(uuid).nullish(),
    reference: z.string().nullish(),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const [st] = await tx.select().from(payStatements).where(and(eq(payStatements.id, input.statementId), eq(payStatements.companyId, actor.companyId))).for("update");
    if (!st) throw new NotFound("pay_statement", input.statementId);
    if (st.status !== "open") throw new Conflict(`${st.statementNo} is ${st.status}`);
    const due = (await statementPayees(tx, st.id)).filter((p) => !p.payment && dec(p.total).gt(0) && (!input.partnerIds?.length || input.partnerIds.includes(p.partnerId)));
    if (!due.length) throw new ValidationError("Nobody on this statement is waiting for payment");
    const made = [];
    for (const p of due) {
      const r = await recordPayment.handler(ctx, {
        direction: "out",
        purpose: "settlement",
        moneyAccountId: input.moneyAccountId,
        amount: p.total,
        currency: st.currency,
        paymentDate: input.paymentDate,
        method: input.method,
        partnerId: p.partnerId,
        statementId: st.id,
        reference: input.reference ?? st.statementNo,
      });
      made.push({ partner: p.name, amount: p.total, paymentNo: r.paymentNo });
    }
    const status = await refreshStatus(tx, st.id);
    await audit({ action: "statements.pay", entityType: "pay_statement", entityId: st.id, after: { status, payments: made } });
    return { id: st.id, status, payments: made };
  },
});

/** Withdraw an unpaid statement; its trips can then go on another statement. */
export const cancelPayStatement = defineCommand({
  name: "statements.cancel",
  permission: "settlements.reverse",
  input: z.object({ statementId: uuid, reason: z.string().min(1) }),
  async handler({ tx, actor, audit }, { statementId, reason }) {
    const [st] = await tx.select().from(payStatements).where(and(eq(payStatements.id, statementId), eq(payStatements.companyId, actor.companyId))).for("update");
    if (!st) throw new NotFound("pay_statement", statementId);
    if (st.status === "cancelled") throw new Conflict(`${st.statementNo} is already cancelled`);
    const [paid] = await tx.select({ no: payments.paymentNo }).from(payments).where(and(eq(payments.statementId, statementId), eq(payments.status, "posted"))).limit(1);
    if (paid) throw new Conflict(`${st.statementNo} has payment ${paid.no}; reverse the payments first`);
    await tx.update(payStatements).set({ status: "cancelled" }).where(eq(payStatements.id, statementId));
    await tx.update(payStatementItems).set({ active: false }).where(eq(payStatementItems.statementId, statementId));
    await audit({ action: "statements.cancel", entityType: "pay_statement", entityId: statementId, before: { status: st.status }, after: { status: "cancelled" }, reason });
    return { id: statementId };
  },
});

/** Called when a payment of a statement is reversed: the statement is open again for that payee. */
export async function reopenStatement(tx: Db, statementId: string) {
  return refreshStatus(tx, statementId);
}

/** The live statement a settlement side is on, if any. */

const transporters = alias(businessPartners, "transporter");

/** Settled trips whose side for this party is not yet on a live statement. */
export async function awaitingStatement(db: Db, companyId: string, party: StatementParty) {
  const payee = party === "driver" ? trips.driverId : trips.transporterId;
  const rows = await db
    .select({ s: tripSettlements, tripNo: trips.tripNo, jobNo: jobs.jobNo, payee: businessPartners.name, loadingDate: trips.loadingDate })
    .from(tripSettlements)
    .innerJoin(trips, eq(trips.id, tripSettlements.tripId))
    .innerJoin(jobs, eq(jobs.id, trips.jobId))
    .innerJoin(businessPartners, eq(businessPartners.id, payee))
    .leftJoin(payStatementItems, and(eq(payStatementItems.settlementId, tripSettlements.id), eq(payStatementItems.party, party), eq(payStatementItems.active, true)))
    .where(and(eq(tripSettlements.companyId, companyId), eq(tripSettlements.status, "posted"), isNull(payStatementItems.id)))
    .orderBy(asc(businessPartners.name), asc(trips.tripNo));
  return rows.flatMap((r) => {
    const side = sideOf(r.s.calculation as SettlementCalculation, party);
    return side ? [{ settlementId: r.s.id, settlementNo: r.s.settlementNo, tripNo: r.tripNo, jobNo: r.jobNo, payee: r.payee, loadingDate: r.loadingDate, currency: side.currency, net: side.netFinal }] : [];
  });
}

export async function listStatements(db: Db, companyId: string) {
  return db.select().from(payStatements).where(eq(payStatements.companyId, companyId)).orderBy(desc(payStatements.createdAt)).limit(100);
}

/** Everything needed to print the statement: every trip with its driver, truck and full calculation. */
export async function statementDetail(db: Db, companyId: string, statementId: string) {
  const [st] = await db.select().from(payStatements).where(and(eq(payStatements.id, statementId), eq(payStatements.companyId, companyId)));
  if (!st) throw new NotFound("pay_statement", statementId);
  const rows = await db
    .select({
      item: payStatementItems,
      settlementNo: tripSettlements.settlementNo,
      calc: tripSettlements.calculation,
      trip: trips,
      jobNo: jobs.jobNo,
      driver: businessPartners.name,
      transporter: transporters.name,
      plate: trucks.plate,
      product: catalogItems.name,
    })
    .from(payStatementItems)
    .innerJoin(tripSettlements, eq(tripSettlements.id, payStatementItems.settlementId))
    .innerJoin(trips, eq(trips.id, payStatementItems.tripId))
    .innerJoin(jobs, eq(jobs.id, trips.jobId))
    .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .leftJoin(catalogItems, eq(catalogItems.id, trips.productId))
    .where(eq(payStatementItems.statementId, statementId))
    .orderBy(asc(businessPartners.name), asc(trips.tripNo));
  return {
    statement: { ...st, total: toStr(dec(st.total)) },
    lines: rows.map((r) => {
      const calc = r.calc as SettlementCalculation;
      return {
        tripNo: r.trip.tripNo,
        jobNo: r.jobNo,
        settlementNo: r.settlementNo,
        payeeId: r.item.partnerId,
        driver: r.driver,
        transporter: r.transporter,
        plate: r.plate,
        product: r.product,
        loadingDate: r.trip.loadingDate,
        dischargeDate: r.trip.dischargeDate,
        calc,
        side: sideOf(calc, st.party)!,
        amount: toStr(dec(r.item.amount)),
      };
    }),
    payees: await statementPayees(db, statementId),
  };
}

registerApprovable(payStatement);
