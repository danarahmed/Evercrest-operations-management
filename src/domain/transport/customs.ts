import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, customsBookingLines, customsBookings, customsRates, customsStatements, jobCustoms, journalLines, moneyAccounts, partnerRoles, payments, trips } from "@/db/schema";
import { defineCommand, type CommandContext } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { registerApprovable } from "../approvals/approvals";
import { amountString, currencyCode } from "../currency";
import { assertWithinLimit } from "../finance/payments";
import { getJob } from "../jobs/commands";
import { normalizeName } from "../masterdata/partners";
import { D, dec, toStr } from "../money";
import { nextNumber } from "../sequences";
import { customsBookedByTrip, loadCustomsCard } from "./customs-rates";
import { liveTrips } from "./live-calc";
import { manifestKey } from "./trip-import";

/**
 * Customs duty at the border (owner's rules, 2026-11). The job's customs agent — the company's person at the
 * border — is paid in lump sums for the job ("Pay the customs agent": the money is with him, account 1350). The
 * duty of the trucks (customs MT × the job's rate) is booked against those payments ("Book customs": a job cost in
 * 5600 Customs duties, or owed by the customer in 1160 when the contract makes him pay it back). What is left is
 * the agent's balance for the job: money still in his hands, or owed to him. His own statement can be imported and
 * compared truck by truck.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The job's customs rate per unit from a date (job-wide, or for one route). The same job, route and date again replaces it. */
export const setCustomsRate = defineCommand({
  name: "customs_rates.set",
  permission: "job_terms.manage",
  input: z.object({ jobId: uuid, routeId: uuid.nullish(), effectiveFrom: isoDate, rate: amountString, currency: currencyCode, note: z.string().trim().max(500).nullish() }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (["financially_closed", "cancelled"].includes(job.status)) throw new ValidationError(`Job is ${job.status}`);
    const routeId = input.routeId || null;
    const [prev] = await tx
      .select()
      .from(customsRates)
      .where(and(eq(customsRates.jobId, job.id), routeId ? eq(customsRates.routeId, routeId) : sql`${customsRates.routeId} is null`, eq(customsRates.effectiveFrom, input.effectiveFrom)));
    const fields = { rate: input.rate, currency: input.currency, note: input.note ?? null };
    let id: string;
    if (prev) {
      await tx.update(customsRates).set(fields).where(eq(customsRates.id, prev.id));
      id = prev.id;
    } else {
      [{ id }] = await tx.insert(customsRates).values({ ...fields, companyId: actor.companyId, jobId: job.id, routeId, effectiveFrom: input.effectiveFrom, createdBy: actor.userId }).returning({ id: customsRates.id });
    }
    await audit({ action: "customs_rates.set", entityType: "job", entityId: job.id, before: prev ? { rate: prev.rate, currency: prev.currency } : undefined, after: { routeId, effectiveFrom: input.effectiveFrom, ...fields } });
    return { id };
  },
});

/** Who the job's customs agent is (a person or office at the border; a new name becomes a new partner), and who carries the duty. */
export const setJobCustoms = defineCommand({
  name: "job_customs.set",
  permission: "job_terms.manage",
  input: z.object({ jobId: uuid, agentId: uuid.nullish(), agentName: z.string().trim().max(120).nullish(), billedToCustomer: z.boolean().default(false) }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    let agentId = input.agentId || null;
    if (agentId) {
      const [p] = await tx.select({ id: businessPartners.id }).from(businessPartners).where(and(eq(businessPartners.id, agentId), eq(businessPartners.companyId, actor.companyId)));
      if (!p) throw new NotFound("partner", agentId);
    } else if (input.agentName) {
      const key = normalizeName(input.agentName);
      const [found] = await tx.select({ id: businessPartners.id }).from(businessPartners).where(and(eq(businessPartners.companyId, actor.companyId), eq(businessPartners.searchKey, key)));
      agentId = found?.id ?? null;
      if (!agentId) {
        [{ id: agentId }] = await tx.insert(businessPartners).values({ companyId: actor.companyId, kind: "person", name: input.agentName, searchKey: key }).returning({ id: businessPartners.id });
        await audit({ action: "partners.create", entityType: "partner", entityId: agentId, after: { name: input.agentName, roles: ["customs_agent"], via: "job_customs" } });
      }
    }
    if (agentId) {
      const [has] = await tx.select().from(partnerRoles).where(and(eq(partnerRoles.partnerId, agentId), eq(partnerRoles.role, "customs_agent")));
      if (!has) await tx.insert(partnerRoles).values({ partnerId: agentId, role: "customs_agent" });
    }
    const [prev] = await tx.select().from(jobCustoms).where(eq(jobCustoms.jobId, job.id));
    if (prev?.agentId && prev.agentId !== agentId) {
      const bal = await agentBalance(tx, actor.companyId, job.id, prev.agentId);
      if (Object.values(bal).some((v) => !dec(v).isZero())) throw new Conflict("The current customs agent still has a balance on this job; settle it before changing the agent");
    }
    if (prev) await tx.update(jobCustoms).set({ agentId, billedToCustomer: input.billedToCustomer, updatedAt: new Date() }).where(eq(jobCustoms.id, prev.id));
    else await tx.insert(jobCustoms).values({ companyId: actor.companyId, jobId: job.id, agentId, billedToCustomer: input.billedToCustomer });
    await audit({ action: "job_customs.set", entityType: "job", entityId: job.id, before: prev ? { agentId: prev.agentId, billedToCustomer: prev.billedToCustomer } : undefined, after: { agentId, billedToCustomer: input.billedToCustomer } });
    return { id: job.id };
  },
});

/** The agent's balance on a job per currency: paid to him − duty booked against it (positive = money still with him). */
export async function agentBalance(db: Db, companyId: string, jobId: string, agentId: string): Promise<Record<string, string>> {
  const account = await postingAccount(db, companyId, "customs_advances");
  const rows = await db
    .select({ currency: journalLines.currency, bal: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
    .from(journalLines)
    .where(and(eq(journalLines.jobId, jobId), eq(journalLines.partnerId, agentId), eq(journalLines.accountId, account.id)))
    .groupBy(journalLines.currency);
  return Object.fromEntries(rows.map((r) => [r.currency, toStr(dec(r.bal))]));
}

/**
 * A lump payment to the job's customs agent (e.g. 20,000, then 10,000): the money is with him until the duty of
 * the trucks is booked against it. The payment limit applies; above it the payment waits for approval.
 */
export const payCustomsAgent = defineCommand({
  name: "customs.pay_agent",
  permission: "payments.create",
  input: z.object({
    jobId: uuid,
    amount: amountString,
    moneyAccountId: uuid,
    paymentDate: isoDate,
    method: z.enum(["cash", "bank_transfer", "cheque", "other"]).default("cash"),
    reference: z.string().trim().max(200).nullish(),
  }),
  async handler(ctx: CommandContext, input) {
    const { tx, actor, audit } = ctx;
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    const settings = await loadCustomsCard(tx, job.id);
    if (!settings.agentId) throw new ValidationError("Set the job's customs agent first (Rules → Customs)");
    if (!dec(input.amount).gt(0)) throw new ValidationError("The amount must be above zero");
    const [money] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, input.moneyAccountId), eq(moneyAccounts.companyId, actor.companyId)));
    if (!money?.active) throw new NotFound("money_account", input.moneyAccountId);
    if (!ctx.approval) await assertWithinLimit(tx, actor.companyId, money.currency, input.amount, settings.agentId, input.paymentDate);
    const advances = await postingAccount(tx, actor.companyId, "customs_advances");
    const paymentNo = await nextNumber(tx, actor.companyId, "PAY", Number(input.paymentDate.slice(0, 4)));
    const entry = await postEntry(ctx, {
      entryDate: input.paymentDate,
      description: `${paymentNo} customs agent, ${job.jobNo}${input.reference ? ` (${input.reference})` : ""}`,
      sourceType: "payment",
      sourceId: paymentNo,
      lines: [
        { accountId: advances.id, currency: money.currency, partnerId: settings.agentId, jobId: job.id, debit: input.amount, memo: "paid to the customs agent" },
        { accountId: money.ledgerAccountId, currency: money.currency, credit: input.amount },
      ],
    });
    const [pay] = await tx
      .insert(payments)
      .values({
        companyId: actor.companyId,
        paymentNo,
        direction: "out",
        purpose: "other",
        moneyAccountId: money.id,
        amount: input.amount,
        currency: money.currency,
        paymentDate: input.paymentDate,
        method: input.method,
        partnerId: settings.agentId,
        jobId: job.id,
        counterAccountId: advances.id,
        reference: input.reference || null,
        notes: "Customs agent",
        journalEntryId: entry.id,
        createdBy: actor.userId,
      })
      .returning({ id: payments.id });
    await audit({ action: "customs.pay_agent", entityType: "payment", entityId: pay.id, after: { paymentNo, jobNo: job.jobNo, amount: input.amount, currency: money.currency } });
    return { id: pay.id, paymentNo };
  },
});
registerApprovable(payCustomsAgent);

/** Trips whose customs is due and not yet booked (loaded on or before `upTo`), with their live duty. */
export async function unbookedCustoms(db: Db, companyId: string, jobId: string, upTo?: string) {
  const rows = await db.select().from(trips).where(and(eq(trips.jobId, jobId), inArray(trips.status, ["loaded", "discharged"])));
  const due = rows.filter((t) => t.loadingDate && (!upTo || t.loadingDate <= upTo));
  const [live, booked] = await Promise.all([liveTrips(db, companyId, due), customsBookedByTrip(db, due.map((t) => t.id))]);
  return due
    .filter((t) => !booked.has(t.id))
    .map((t) => ({ trip: t, customs: live.get(t.id)?.calc?.customs ?? null }))
    .filter((x): x is { trip: typeof x.trip; customs: NonNullable<typeof x.customs> } => !!x.customs && dec(x.customs.amount).gt(0));
}

/**
 * Book the duty of the trucks not yet booked (loaded up to the booking date) against the customs agent: a job
 * cost in Customs duties (or owed by the customer when he pays it back), and less money with the agent.
 */
export const bookCustoms = defineCommand({
  name: "customs.book",
  permission: "claims.manage",
  input: z.object({ jobId: uuid, bookingDate: isoDate }),
  async handler(ctx: CommandContext, input) {
    const { tx, actor, audit } = ctx;
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    const settings = await loadCustomsCard(tx, job.id);
    if (!settings.agentId) throw new ValidationError("Set the job's customs agent first (Rules → Customs)");
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.jobId, job.id)).for("update");
    const due = await unbookedCustoms(tx, actor.companyId, job.id, input.bookingDate);
    if (!due.length) throw new ValidationError("No customs to book: every loaded trip up to that date is booked, or the job has no customs rate");
    const advances = await postingAccount(tx, actor.companyId, "customs_advances");
    const cost = await postingAccount(tx, actor.companyId, settings.billedToCustomer ? "customs_to_bill" : "customs_duties");
    const out: { id: string; bookingNo: string; total: string; currency: string; trips: number }[] = [];
    for (const currency of [...new Set(due.map((d) => d.customs.currency))]) {
      const lines = due.filter((d) => d.customs.currency === currency);
      const total = lines.reduce((a, l) => a.plus(dec(l.customs.amount)), new D(0));
      const qty = lines.reduce((a, l) => a.plus(dec(l.customs.qty)), new D(0));
      const bookingNo = await nextNumber(tx, actor.companyId, "CUS", Number(input.bookingDate.slice(0, 4)));
      const entry = await postEntry(ctx, {
        entryDate: input.bookingDate,
        description: `${bookingNo} customs duty, ${job.jobNo}, ${lines.length} trucks, ${toStr(qty)}`,
        sourceType: "customs",
        sourceId: bookingNo,
        lines: [
          { accountId: cost.id, currency, jobId: job.id, partnerId: settings.billedToCustomer ? job.customerId : null, debit: toStr(total), memo: settings.billedToCustomer ? "customs: to bill the customer" : "customs duty" },
          { accountId: advances.id, currency, jobId: job.id, partnerId: settings.agentId, credit: toStr(total), memo: "customs duty against the agent" },
        ],
      });
      const [booking] = await tx
        .insert(customsBookings)
        .values({ companyId: actor.companyId, bookingNo, jobId: job.id, agentId: settings.agentId, bookingDate: input.bookingDate, currency, quantity: toStr(qty), total: toStr(total), journalEntryId: entry.id, createdBy: actor.userId })
        .returning();
      await tx.insert(customsBookingLines).values(lines.map((l) => ({ bookingId: booking.id, tripId: l.trip.id, quantity: l.customs.qty, rate: l.customs.rate, amount: l.customs.amount })));
      await audit({ action: "customs.book", entityType: "customs_booking", entityId: booking.id, after: { bookingNo, jobNo: job.jobNo, trucks: lines.length, quantity: toStr(qty), total: toStr(total), currency } });
      out.push({ id: booking.id, bookingNo, total: toStr(total), currency, trips: lines.length });
    }
    return { id: out[0].id, bookings: out };
  },
});

/** Undo a customs booking (wrong quantity, wrong rate): the entry is reversed and its trucks can be corrected and booked again. */
export const reverseCustomsBooking = defineCommand({
  name: "customs.reverse_booking",
  permission: "payments.reverse",
  input: z.object({ bookingId: uuid, reversalDate: isoDate, reason: z.string().trim().min(1) }),
  async handler(ctx: CommandContext, input) {
    const { tx, actor, audit } = ctx;
    const [b] = await tx.select().from(customsBookings).where(and(eq(customsBookings.id, input.bookingId), eq(customsBookings.companyId, actor.companyId))).for("update");
    if (!b) throw new NotFound("customs_booking", input.bookingId);
    if (b.status === "reversed") throw new Conflict(`${b.bookingNo} is already reversed`);
    const rev = await reverseEntry(ctx, b.journalEntryId, input.reversalDate, `${b.bookingNo}: ${input.reason}`);
    await tx.update(customsBookings).set({ status: "reversed", reversalEntryId: rev.id }).where(eq(customsBookings.id, b.id));
    await tx.update(customsBookingLines).set({ active: false }).where(eq(customsBookingLines.bookingId, b.id));
    await audit({ action: "customs.reverse_booking", entityType: "customs_booking", entityId: b.id, before: { status: "posted" }, after: { status: "reversed" }, reason: input.reason });
    return { id: b.id };
  },
});

// ---------- The border person's own statement ----------

const statementRow = z.object({ rowNo: z.number().int(), manifest: z.string().nullish(), plate: z.string().nullish(), quantity: z.string().nullish(), amount: z.string().nullish() });
export type CustomsStatementRow = z.infer<typeof statementRow>;

export const stageCustomsStatement = defineCommand({
  name: "customs_statements.stage",
  permission: "trips.manage",
  input: z.object({ jobId: uuid, fileName: z.string().min(1).max(200), rows: z.array(statementRow).min(1, "The sheet has no rows").max(20000) }),
  async handler({ tx, actor, audit }, input) {
    await getJob(tx, actor.companyId, input.jobId);
    const [row] = await tx.insert(customsStatements).values({ companyId: actor.companyId, jobId: input.jobId, fileName: input.fileName, rows: input.rows, createdBy: actor.userId }).returning({ id: customsStatements.id });
    await audit({ action: "customs_statements.stage", entityType: "customs_statement", entityId: row.id, after: { jobId: input.jobId, fileName: input.fileName, rows: input.rows.length } });
    return { id: row.id };
  },
});

export type CustomsCompareStatus = "match" | "qty_differs" | "amount_differs" | "not_found" | "duplicate" | "no_rate";

/** Compare the agent's statement with the system, truck by truck (by manifest), and list the system's trucks he did not mention. */
export async function compareCustomsStatement(db: Db, companyId: string, statementId: string) {
  const [st] = await db.select().from(customsStatements).where(and(eq(customsStatements.id, statementId), eq(customsStatements.companyId, companyId)));
  if (!st) throw new NotFound("customs_statement", statementId);
  const jobTrips = await db.select().from(trips).where(and(eq(trips.jobId, st.jobId), inArray(trips.status, ["loaded", "discharged"])));
  const [live, booked] = await Promise.all([liveTrips(db, companyId, jobTrips), customsBookedByTrip(db, jobTrips.map((t) => t.id))]);
  const byKey = new Map(jobTrips.filter((t) => t.manifestKey).map((t) => [t.manifestKey!, t]));
  const seen = new Set<string>();
  const rows = st.rows as CustomsStatementRow[];
  const lines = rows.map((r) => {
    const key = r.manifest ? manifestKey(r.manifest) : "";
    const base = { rowNo: r.rowNo, manifest: r.manifest ?? null, plate: r.plate ?? null, theirQty: r.quantity ?? null, theirAmount: r.amount ?? null };
    if (!key) return { ...base, status: "not_found" as CustomsCompareStatus };
    if (seen.has(key)) return { ...base, status: "duplicate" as CustomsCompareStatus };
    seen.add(key);
    const t = byKey.get(key);
    if (!t) return { ...base, status: "not_found" as CustomsCompareStatus };
    const c = live.get(t.id)?.calc?.customs ?? null;
    const info = { tripId: t.id, ourQty: c?.qty ?? t.customsQty ?? t.loadedQty, ourAmount: c?.amount ?? null, currency: c?.currency ?? null, booked: booked.get(t.id)?.bookingNo ?? null };
    if (!c) return { ...base, ...info, status: "no_rate" as CustomsCompareStatus };
    if (r.quantity && !dec(r.quantity).eq(dec(c.qty))) return { ...base, ...info, status: "qty_differs" as CustomsCompareStatus };
    if (r.amount && !dec(r.amount).eq(dec(c.amount))) return { ...base, ...info, status: "amount_differs" as CustomsCompareStatus };
    return { ...base, ...info, status: "match" as CustomsCompareStatus };
  });
  const missing = jobTrips.filter((t) => t.manifestKey && !seen.has(t.manifestKey)).map((t) => ({ tripId: t.id, manifest: t.manifestNo, loadingDate: t.loadingDate, qty: live.get(t.id)?.calc?.customs?.qty ?? null }));
  const sum = (xs: (string | null | undefined)[]) => toStr(xs.reduce<InstanceType<typeof D>>((a, x) => (x ? a.plus(dec(x)) : a), new D(0)));
  return {
    statement: st,
    lines,
    missing,
    totals: { theirQty: sum(rows.map((r) => r.quantity)), theirAmount: sum(rows.map((r) => r.amount)), ourQty: sum(lines.map((l) => ("ourQty" in l ? l.ourQty : null))), ourAmount: sum(lines.map((l) => ("ourAmount" in l ? l.ourAmount : null))) },
    counts: Object.fromEntries((["match", "qty_differs", "amount_differs", "not_found", "duplicate", "no_rate"] as CustomsCompareStatus[]).map((s) => [s, lines.filter((l) => l.status === s).length])) as Record<CustomsCompareStatus, number>,
  };
}

/** Take the agent's MT for the chosen trucks whose quantity differs (only trucks not yet booked). Each change is in the trip's history. */
export const useStatementQuantities = defineCommand({
  name: "customs_statements.use_quantities",
  permission: "trips.manage",
  input: z.object({ statementId: uuid, tripIds: z.array(uuid).min(1).max(5000) }),
  async handler(ctx: CommandContext, input) {
    const { tx, actor, audit } = ctx;
    const cmp = await compareCustomsStatement(tx, actor.companyId, input.statementId);
    let changed = 0;
    for (const l of cmp.lines) {
      if (l.status !== "qty_differs" || !("tripId" in l) || !input.tripIds.includes(l.tripId!)) continue;
      if (l.booked) throw new Conflict(`${l.manifest}: its customs is already booked (${l.booked}); reverse that booking first`);
      const [t] = await tx.select().from(trips).where(eq(trips.id, l.tripId!)).for("update");
      const qty = dec(l.theirQty!);
      const value = t.loadedQty && qty.eq(dec(t.loadedQty)) ? null : toStr(qty);
      await tx.update(trips).set({ customsQty: value }).where(eq(trips.id, t.id));
      await audit({ action: "trips.save", entityType: "trip", entityId: t.id, before: { customsQty: t.customsQty }, after: { customsQty: value }, reason: `customs statement ${cmp.statement.fileName}` });
      changed++;
    }
    return { id: input.statementId, changed };
  },
});

/** The job's customs at a glance: settings, rates, trucks and duty, payments to the agent, bookings and his balance. */
export async function jobCustomsView(db: Db, companyId: string, jobId: string) {
  const card = await loadCustomsCard(db, jobId);
  const jobTrips = await db.select().from(trips).where(and(eq(trips.jobId, jobId), inArray(trips.status, ["loaded", "discharged"])));
  const [live, booked] = await Promise.all([liveTrips(db, companyId, jobTrips), customsBookedByTrip(db, jobTrips.map((t) => t.id))]);
  const withCustoms = jobTrips.map((t) => ({ trip: t, customs: live.get(t.id)?.calc?.customs ?? null })).filter((x) => x.customs);
  const totals = new Map<string, { trucks: number; qty: InstanceType<typeof D>; duty: InstanceType<typeof D>; unbookedTrucks: number; unbooked: InstanceType<typeof D>; differs: number }>();
  for (const { trip, customs } of withCustoms) {
    const t = totals.get(customs!.currency) ?? { trucks: 0, qty: new D(0), duty: new D(0), unbookedTrucks: 0, unbooked: new D(0), differs: 0 };
    t.trucks++;
    t.qty = t.qty.plus(dec(customs!.qty));
    t.duty = t.duty.plus(dec(customs!.amount));
    if (!booked.has(trip.id)) {
      t.unbookedTrucks++;
      t.unbooked = t.unbooked.plus(dec(customs!.amount));
    }
    if (customs!.differs) t.differs++;
    totals.set(customs!.currency, t);
  }
  const [agent] = card.agentId ? await db.select({ id: businessPartners.id, name: businessPartners.name }).from(businessPartners).where(eq(businessPartners.id, card.agentId)) : [];
  const paid = card.agentId
    ? await db.select().from(payments).where(and(eq(payments.jobId, jobId), eq(payments.partnerId, card.agentId), eq(payments.notes, "Customs agent"))).orderBy(desc(payments.paymentDate))
    : [];
  const bookings = await db.select().from(customsBookings).where(eq(customsBookings.jobId, jobId)).orderBy(desc(customsBookings.createdAt));
  const statements = await db.select({ id: customsStatements.id, fileName: customsStatements.fileName, createdAt: customsStatements.createdAt }).from(customsStatements).where(eq(customsStatements.jobId, jobId)).orderBy(desc(customsStatements.createdAt));
  return {
    card,
    agent: agent ?? null,
    balance: card.agentId ? await agentBalance(db, companyId, jobId, card.agentId) : {},
    totals: [...totals].map(([currency, t]) => ({ currency, trucks: t.trucks, qty: toStr(t.qty), duty: toStr(t.duty), unbookedTrucks: t.unbookedTrucks, unbooked: toStr(t.unbooked), differs: t.differs })),
    payments: paid,
    bookings,
    statements,
    rates: [...card.rates].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
  };
}

