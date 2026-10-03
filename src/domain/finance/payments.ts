import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accounts, invoiceLines, invoices, journalLines, moneyAccounts, payments, payStatementItems, payStatements } from "@/db/schema";
import { invoiceOutstanding } from "./invoices";
import { PAYMENT_PURPOSES } from "@/db/schema/finance";
import { defineCommand } from "@/server/command";
import { ApprovalRequired, Conflict, NotFound, ValidationError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { amountString, currencyCode } from "../currency";
import { type Capability, type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { getTrip, isSettled } from "../transport/trips";
import { D, dec, toStr } from "../money";
import { nextNumber } from "../sequences";
import { openDebt } from "../transport/statement-debts";
import { registerApprovable } from "../approvals/approvals";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createMoneyAccount = defineCommand({
  name: "money_accounts.create",
  permission: "money_accounts.manage",
  input: z.object({
    name: z.string().trim().min(1),
    kind: z.enum(["cash", "bank"]),
    currency: currencyCode,
    ledgerAccountId: uuid,
    branchId: uuid.nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.ledgerAccountId), eq(accounts.companyId, actor.companyId)));
    if (!acc) throw new NotFound("account", input.ledgerAccountId);
    if (acc.type !== "asset" || !acc.postable) throw new ValidationError("A money account must use a postable asset account");
    if (acc.currency !== input.currency)
      throw new ValidationError(`Ledger account ${acc.code} must be restricted to ${input.currency}`);
    const [row] = await tx.insert(moneyAccounts).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "money_accounts.create", entityType: "money_account", entityId: row.id, after: input });
    return { id: row.id };
  },
});

/**
 * Money paid out or received. Each purpose decides the counter-account; the
 * money account decides the cash/bank side. Posted immediately and atomically.
 */
export const recordPayment = defineCommand({
  name: "payments.record",
  permission: "payments.create",
  input: z.object({
    direction: z.enum(["in", "out"]),
    purpose: z.enum(PAYMENT_PURPOSES),
    moneyAccountId: uuid,
    amount: amountString,
    currency: currencyCode,
    paymentDate: isoDate,
    method: z.enum(["cash", "bank_transfer", "cheque", "other"]),
    partnerId: uuid.nullish(),
    jobId: uuid.nullish(),
    tripId: uuid.nullish(),
    /** Settle this invoice (customer receipt or bill payment). */
    invoiceId: uuid.nullish(),
    /** Pay statement whose payee this pays (purpose "settlement" only). */
    statementId: uuid.nullish(),
    /** Expense account for a direct expense paid now. */
    counterAccountId: uuid.nullish(),
    reference: z.string().nullish(),
    notes: z.string().nullish(),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    if (dec(input.amount).lte(0)) throw new ValidationError("Amount must be greater than zero");
    const [money] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, input.moneyAccountId), eq(moneyAccounts.companyId, actor.companyId)));
    if (!money?.active) throw new NotFound("money_account", input.moneyAccountId);
    if (money.currency !== input.currency)
      throw new ValidationError(`${money.name} holds ${money.currency}; this payment is in ${input.currency}`);

    let jobId = input.jobId ?? null;
    let partnerId = input.partnerId ?? null;
    if (input.tripId) {
      const trip = await getTrip(tx, actor.companyId, input.tripId);
      if (trip.status === "cancelled") throw new Conflict("Trip is cancelled");
      if (input.purpose === "advance" && (await isSettled(tx, trip.id)))
        throw new Conflict(`${trip.tripNo} is already settled; pay the settlement balance instead of a new advance`);
      if (jobId && jobId !== trip.jobId) throw new ValidationError("Trip belongs to a different job");
      jobId = trip.jobId;
      if (input.purpose === "advance" && partnerId && partnerId !== trip.driverId && partnerId !== trip.transporterId)
        throw new ValidationError("An advance must be paid to the trip's driver or transporter");
      partnerId ??= trip.driverId;
    }
    if (jobId) {
      const job = await getJob(tx, actor.companyId, jobId);
      if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);
      if (input.purpose === "advance" && !(job.capabilities as Capability[]).includes("advances"))
        throw new ValidationError("Advances are not enabled for this job");
    }

    let counter: typeof accounts.$inferSelect;
    if (input.invoiceId) {
      // Row lock: concurrent payments on one invoice are serialized, so it cannot be overpaid.
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.companyId, actor.companyId))).for("update");
      if (!inv) throw new NotFound("invoice", input.invoiceId);
      if (inv.status !== "posted") throw new Conflict("Invoice is cancelled");
      const expected = inv.kind === "sales" ? { direction: "in", purpose: "customer_receipt" } : { direction: "out", purpose: "supplier_payment" };
      if (input.direction !== expected.direction || input.purpose !== expected.purpose)
        throw new ValidationError(`An ${inv.kind === "sales" ? "invoice is settled by a customer receipt" : "bill is settled by a supplier payment"}`);
      if (inv.currency !== input.currency)
        throw new ValidationError(`${inv.invoiceNo} is in ${inv.currency}; pay it in ${inv.currency} (or record a currency exchange first)`);
      if (partnerId && partnerId !== inv.partnerId) throw new ValidationError("Payment partner differs from the invoice partner");
      partnerId = inv.partnerId;
      const outstanding = dec(await invoiceOutstanding(tx, inv.id));
      if (dec(input.amount).gt(outstanding))
        throw new ValidationError(`Payment exceeds the outstanding ${toStr(outstanding)} ${inv.currency} on ${inv.invoiceNo}`);
      [counter] = await tx.select().from(accounts).where(eq(accounts.id, inv.balanceAccountId));
    } else if (input.purpose === "settlement" || input.statementId) {
      counter = await statementPayment(tx, actor.companyId, input, partnerId);
      jobId = null; // one payment can cover trips of several jobs; the costs already sit on each job
    } else if (input.purpose === "expense") {
      if (input.direction !== "out") throw new ValidationError("An expense is money paid out");
      if (!input.counterAccountId) throw new ValidationError("Choose the expense account");
      const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.counterAccountId), eq(accounts.companyId, actor.companyId)));
      if (!acc || acc.type !== "expense" || !acc.postable) throw new ValidationError("Choose a postable expense account");
      counter = acc;
    } else {
      counter = await counterAccount(tx, actor.companyId, input.purpose, input.direction);
    }
    if (input.purpose === "advance") {
      if (input.direction !== "out") throw new ValidationError("An advance is money paid out");
      if (!partnerId) throw new ValidationError("An advance needs a payee");
    }

    if (input.direction === "out" && !ctx.approval) await assertWithinLimit(tx, actor.companyId, input.currency, input.amount, partnerId, input.paymentDate);

    const paymentNo = await nextNumber(tx, actor.companyId, input.direction === "out" ? "PAY" : "RCV", Number(input.paymentDate.slice(0, 4)));
    const cashSide = { accountId: money.ledgerAccountId, currency: input.currency, jobId };
    // Expenses carry the job (cost) but no partner balance; balance-sheet sides carry the partner.
    const otherSide = { accountId: counter.id, currency: input.currency, partnerId: counter.type === "expense" ? null : partnerId, jobId };
    const entry = await postEntry(ctx, {
      entryDate: input.paymentDate,
      description: `${paymentNo} ${input.purpose}${input.reference ? ` (${input.reference})` : ""}`,
      sourceType: "payment",
      sourceId: paymentNo,
      lines:
        input.direction === "out"
          ? [{ ...otherSide, debit: input.amount }, { ...cashSide, credit: input.amount }]
          : [{ ...cashSide, debit: input.amount }, { ...otherSide, credit: input.amount }],
    });
    const [row] = await tx
      .insert(payments)
      .values({ ...input, partnerId, jobId, tripId: input.tripId ?? null, invoiceId: input.invoiceId ?? null, statementId: input.statementId ?? null, counterAccountId: counter.id, paymentNo, companyId: actor.companyId, journalEntryId: entry.id, createdBy: actor.userId })
      .returning();
    await audit({ action: "payments.record", entityType: "payment", entityId: row.id, after: { paymentNo, ...input, partnerId, jobId } });
    return { id: row.id, paymentNo, journalEntryId: entry.id };
  },
});

/**
 * Settlement balances are paid only through a pay statement, for exactly what
 * the statement says the payee is owed, so a driver cannot be paid twice or
 * paid an amount nobody calculated.
 */
async function statementPayment(
  tx: Db,
  companyId: string,
  input: { purpose: string; direction: string; statementId?: string | null; amount: string; currency: string; tripId?: string | null; invoiceId?: string | null },
  partnerId: string | null,
) {
  if (input.purpose !== "settlement" || !input.statementId) throw new ValidationError("Settlement balances are paid through a pay statement");
  if (input.tripId || input.invoiceId) throw new ValidationError("A statement payment is not linked to a single trip or invoice");
  if (!partnerId) throw new ValidationError("Choose who is paid");
  const [st] = await tx.select().from(payStatements).where(and(eq(payStatements.id, input.statementId), eq(payStatements.companyId, companyId)));
  if (!st) throw new NotFound("pay_statement", input.statementId);
  if (st.status === "cancelled") throw new Conflict(`${st.statementNo} is cancelled`);
  if (st.currency !== input.currency) throw new ValidationError(`${st.statementNo} is in ${st.currency}; pay it in ${st.currency}`);
  // Serialize money movements for the same payee on the same statement.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`statement:${st.id}:${partnerId}`}))`);
  const counter = () => postingAccount(tx, companyId, st.party === "driver" ? "payables_to_drivers" : "payables_to_transporters");

  if (input.direction === "in") {
    // The payee pays back what they owe on this statement (advances larger than pay).
    const open = await openDebt(tx, companyId, st.id, partnerId);
    if (!open.gt(0)) throw new ValidationError(`This payee owes nothing open on ${st.statementNo}`);
    if (dec(input.amount).gt(open)) throw new ValidationError(`This payee owes ${toStr(open)} ${st.currency} on ${st.statementNo}; the repayment cannot be more`);
    return counter();
  }

  const [owed] = await tx
    .select({ total: sql<string>`coalesce(sum(${payStatementItems.amount}), 0)` })
    .from(payStatementItems)
    .where(and(eq(payStatementItems.statementId, st.id), eq(payStatementItems.partnerId, partnerId), eq(payStatementItems.active, true)));
  if (!dec(owed.total).gt(0)) throw new ValidationError(`Nothing is owed to this payee on ${st.statementNo}`);
  if (!dec(input.amount).eq(dec(owed.total)))
    throw new ValidationError(`${st.statementNo} owes this payee ${toStr(dec(owed.total))} ${st.currency}; pay exactly that amount`);
  const [already] = await tx
    .select({ no: payments.paymentNo })
    .from(payments)
    .where(and(eq(payments.statementId, st.id), eq(payments.partnerId, partnerId), eq(payments.direction, "out"), eq(payments.status, "posted")));
  if (already) throw new Conflict(`Already paid on ${st.statementNo} (${already.no})`);
  return counter();
}

/**
 * Payments out above the configured limit need approval. Payments to the same
 * payee on the same day are added together, so a large payment cannot slip
 * through as several small ones.
 */
async function assertWithinLimit(tx: Db, companyId: string, currency: string, amount: string, partnerId: string | null, date: string) {
  const limits = (await getSetting(tx, companyId, "approvals.payment_out_limits")) ?? {};
  const limit = limits[currency];
  if (limit === undefined) return;
  let sameDay = new D(0);
  if (partnerId) {
    // Serialize concurrent payments to the same payee/day/currency so their sum is checked correctly.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payout:${companyId}:${partnerId}:${currency}:${date}`}))`);
    const [r] = await tx
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(and(eq(payments.companyId, companyId), eq(payments.partnerId, partnerId), eq(payments.currency, currency), eq(payments.paymentDate, date), eq(payments.direction, "out"), eq(payments.status, "posted")));
    sameDay = dec(r.total);
  }
  const total = sameDay.plus(dec(amount));
  if (total.gt(dec(limit)))
    throw new ApprovalRequired(`Payments over ${limit} ${currency} need approval`, { limit, currency, total: toStr(total), alreadyPaidToday: toStr(sameDay) });
}

async function counterAccount(tx: Db, companyId: string, purpose: (typeof PAYMENT_PURPOSES)[number], direction: "in" | "out") {
  switch (purpose) {
    case "advance":
      return postingAccount(tx, companyId, "advances");
    case "customer_receipt":
      return postingAccount(tx, companyId, "customer_receivables");
    case "supplier_payment":
      return postingAccount(tx, companyId, "supplier_payables");
    default:
      throw new ValidationError(`Payments for "${purpose}" (${direction}) are not supported yet`);
  }
}

/** Undo a payment by reversing its journal entry. The payment record stays, marked reversed. */
export const reversePayment = defineCommand({
  name: "payments.reverse",
  permission: "payments.reverse",
  input: z.object({ paymentId: uuid, reversalDate: isoDate, reason: z.string().min(1) }),
  async handler(ctx, { paymentId, reversalDate, reason }) {
    const { tx, actor, audit } = ctx;
    const [p] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.companyId, actor.companyId)));
    if (!p) throw new NotFound("payment", paymentId);
    if (p.status === "reversed") throw new Conflict("Payment is already reversed");
    const rev = await reverseEntry(ctx, p.journalEntryId, reversalDate, `${p.paymentNo}: ${reason}`);
    await tx.update(payments).set({ status: "reversed", reversalEntryId: rev.id }).where(eq(payments.id, paymentId));
    // The payee is owed again, so the statement is open again.
    if (p.statementId && p.direction === "out") await tx.update(payStatements).set({ status: "open" }).where(and(eq(payStatements.id, p.statementId), eq(payStatements.status, "paid")));
    await audit({ action: "payments.reverse", entityType: "payment", entityId: paymentId, before: { status: "posted" }, after: { status: "reversed", reversalEntryId: rev.id }, reason });
    return { paymentId, reversalEntryId: rev.id };
  },
});

/** Posted (not reversed) advances on a trip, per currency. Currencies are never added together. */
export async function tripAdvances(db: Db, companyId: string, tripId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ currency: payments.currency, total: sql<string>`sum(${payments.amount})` })
    .from(payments)
    .where(and(eq(payments.companyId, companyId), eq(payments.tripId, tripId), eq(payments.purpose, "advance"), eq(payments.status, "posted")))
    .groupBy(payments.currency);
  return Object.fromEntries(rows.map((r) => [r.currency, toStr(dec(r.total))]));
}

/** Balance of a money account per the ledger (its account is single-currency). */
export async function moneyAccountBalance(db: Db, moneyAccountId: string): Promise<string> {
  const [m] = await db.select().from(moneyAccounts).where(eq(moneyAccounts.id, moneyAccountId));
  if (!m) throw new NotFound("money_account", moneyAccountId);
  const [r] = await db
    .select({ bal: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
    .from(journalLines)
    .where(eq(journalLines.accountId, m.ledgerAccountId));
  return toStr(dec(r.bal));
}

registerCapabilityModule({
  capability: "advances",
  blockers: async () => [],
  async inUse(tx: Db, job: Job) {
    const [p] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.jobId, job.id), eq(payments.purpose, "advance"), eq(payments.status, "posted")))
      .limit(1);
    return !!p;
  },
});


// Expenses on a job: paid now (payment) or on credit (supplier bill lines carrying the job).
registerCapabilityModule({
  capability: "expenses",
  blockers: async () => [],
  async inUse(tx: Db, job: Job) {
    const [p] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.jobId, job.id), eq(payments.purpose, "expense"), eq(payments.status, "posted")))
      .limit(1);
    if (p) return true;
    const [b] = await tx
      .select({ id: invoiceLines.id })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
      .where(and(eq(invoiceLines.jobId, job.id), eq(invoices.kind, "bill"), eq(invoices.status, "posted")))
      .limit(1);
    return !!b;
  },
});

registerApprovable(recordPayment);
