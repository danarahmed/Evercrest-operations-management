import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { currencies, invoiceLines, invoices, jobs, payments, payStatementItems, payStatements, trips, tripSettlements } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { convertQuantity } from "../masterdata/catalog";
import { D, type Dec, dec, roundTo, roundToIncrement, toStr } from "../money";
import { nextNumber } from "../sequences";
import { type Rate, resolveRate } from "./rates";
import { getTrip } from "./trips";

type Trip = typeof trips.$inferSelect;
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A reason the calculation cannot be completed. Missing data is never treated as zero. */
export interface Missing {
  code: string;
  message: string;
}

export interface TripQuantities {
  unit: string;
  loaded: string;
  discharged: string;
  /** Discharged, capped at loaded: what the driver is paid on and the customer billed on. */
  actual: string;
  /** Loaded − discharged, never negative (no surplus). */
  loss: string;
}

/** Quantities in the loaded unit. Requires both loaded and discharged quantities. */
export async function tripQuantities(db: Db, trip: Trip): Promise<TripQuantities | Missing> {
  if (trip.loadedQty === null) return { code: "transport.loaded_qty_missing", message: `${trip.tripNo}: loaded quantity is missing` };
  if (trip.dischargedQty === null) return { code: "transport.discharged_qty_missing", message: `${trip.tripNo}: discharged quantity is missing` };
  let discharged: Dec;
  try {
    discharged = await convertQuantity(db, trip.dischargedQty, trip.dischargedUnit!, trip.loadedUnit!);
  } catch (e) {
    return { code: "transport.units_incomparable", message: `${trip.tripNo}: ${(e as Error).message}` };
  }
  const loaded = dec(trip.loadedQty);
  const actual = D.min(loaded, discharged);
  const loss = D.max(loaded.minus(discharged), 0);
  return { unit: trip.loadedUnit!, loaded: toStr(loaded), discharged: toStr(discharged), actual: toStr(actual), loss: toStr(loss) };
}

const isMissing = (x: unknown): x is Missing => typeof x === "object" && x !== null && "code" in x && "message" in x && !("unit" in x);

/** Amount for a money rule on a basis: per trip, per day, or per unit of a quantity (converted to the rate's unit). */
async function charge(db: Db, rate: Rate, q: TripQuantities, days?: number): Promise<Dec> {
  if (rate.basis === "per_trip") return dec(rate.amount);
  if (rate.basis === "per_day") return dec(rate.amount).times(days ?? 0);
  const qty = rate.basis === "loaded_qty" ? q.loaded : rate.basis === "discharged_qty" ? q.discharged : q.actual;
  const inRateUnit = await convertQuantity(db, qty, q.unit, rate.unit!);
  return inRateUnit.times(dec(rate.amount));
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/** Demurrage days: (end − start) − free days, never negative. Start/end dates must exist. */
export function demurrageDays(rate: Rate, trip: Trip): number | Missing {
  const start = rate.startEvent === "arrival" ? trip.arrivalDate : trip.loadingDate;
  if (!start)
    return { code: rate.startEvent === "arrival" ? "transport.arrival_date_missing" : "transport.loading_date_missing", message: `${trip.tripNo}: ${rate.startEvent} date is required for demurrage` };
  if (!trip.dischargeDate) return { code: "transport.discharge_date_missing", message: `${trip.tripNo}: discharge date is required for demurrage` };
  return Math.max(daysBetween(start, trip.dischargeDate) - (rate.freeDays ?? 0), 0);
}

async function minorUnits(db: Db, currency: string) {
  const [cur] = await db.select().from(currencies).where(eq(currencies.code, currency));
  return cur.minorUnits;
}

/** `precise` is already in currency precision; the final amount is rounded to the configured increment. */
async function finalize(db: Db, companyId: string, currency: string, precise: Dec) {
  const increments = (await getSetting(db, companyId, "rounding.final_increment")) ?? {};
  const final = increments[currency] ? roundToIncrement(precise, increments[currency]) : precise;
  return { precise, final, rounding: precise.minus(final) };
}

async function advancesFor(db: Db, companyId: string, tripId: string, partnerId: string) {
  const rows = await db
    .select({ currency: payments.currency, total: sql<string>`sum(${payments.amount})` })
    .from(payments)
    .where(and(eq(payments.companyId, companyId), eq(payments.tripId, tripId), eq(payments.partnerId, partnerId), eq(payments.purpose, "advance"), eq(payments.status, "posted")))
    .groupBy(payments.currency);
  return Object.fromEntries(rows.map((r) => [r.currency, dec(r.total)]));
}

const rateRef = (r: Rate) => ({ id: r.id, amount: r.amount, currency: r.currency, unit: r.unit, basis: r.basis, effectiveFrom: r.effectiveFrom });

export interface PartySettlement {
  currency: string;
  lines: { code: string; amount: string }[];
  advancesDeducted: string;
  /** Advances paid in another currency: shown, not deducted (no silent conversion). */
  advancesOtherCurrency: Record<string, string>;
  net: string;
  rounding: string;
  netFinal: string;
}

export interface SettlementCalculation {
  tripId: string;
  tripNo: string;
  rateDate: string;
  quantities: TripQuantities;
  allowance: string | null;
  chargeableShortage: string;
  demurrageDays: number | null;
  rates: Record<string, ReturnType<typeof rateRef>>;
  driver: PartySettlement;
  transporter: PartySettlement | null;
}

/**
 * Calculate a trip's settlement under the rules in force on its loading date.
 * Returns everything that is missing instead of guessing.
 */
export async function calculateSettlement(db: Db, companyId: string, trip: Trip): Promise<{ ok: true; calc: SettlementCalculation } | { ok: false; missing: Missing[] }> {
  const missing: Missing[] = [];
  if (trip.status !== "discharged") return { ok: false, missing: [{ code: "transport.not_discharged", message: `${trip.tripNo} is not discharged yet` }] };
  const q = await tripQuantities(db, trip);
  if (isMissing(q)) return { ok: false, missing: [q] };
  const [job] = await db.select().from(jobs).where(eq(jobs.id, trip.jobId));
  const date = trip.loadingDate!;
  const ctx = { productId: trip.productId, customerId: job.customerId, transporterId: trip.transporterId, contractId: job.contractId };
  const need = async (type: Parameters<typeof resolveRate>[2], label: string) => {
    const r = await resolveRate(db, companyId, type, date, ctx);
    if (!r) missing.push({ code: `rates.${type}_missing`, message: `No ${label} rule in force on ${date} for ${trip.tripNo}` });
    return r;
  };
  const used: Record<string, ReturnType<typeof rateRef>> = {};

  // Driver side
  const pay = await need("driver_pay", "driver pay");
  const lossQty = dec(q.loss);
  let allowanceQty: Dec | null = null;
  let chargeable = new D(0);
  let fine = new D(0);
  let fineRate: Rate | null = null;
  if (lossQty.gt(0)) {
    const allowance = await need("allowance", "allowance");
    if (allowance) {
      used.allowance = rateRef(allowance);
      allowanceQty = await convertQuantity(db, allowance.amount, allowance.unit!, q.unit);
      chargeable = D.max(lossQty.minus(allowanceQty), 0);
      if (chargeable.gt(0)) {
        fineRate = await need("shortage_fine", "shortage fine price");
        if (fineRate) fine = (await convertQuantity(db, chargeable, q.unit, fineRate.unit!)).times(dec(fineRate.amount));
      }
    }
  }
  const demPay = await resolveRate(db, companyId, "demurrage_pay", date, ctx);
  let days: number | null = null;
  if (demPay) {
    const d = demurrageDays(demPay, trip);
    if (typeof d === "number") days = d;
    else missing.push(d);
  }
  let transporterSide: { fee: Rate } | null = null;
  if (trip.transporterId) {
    const fee = await need("transporter_fee", "transporter fee");
    if (fee) transporterSide = { fee };
  }
  if (!pay) return { ok: false, missing };
  const C = pay.currency!;
  for (const [name, r] of [["shortage fine", fineRate], ["demurrage pay", demPay]] as const)
    if (r && r.currency !== C) missing.push({ code: "rates.currency_mismatch", message: `${name} is in ${r.currency} but driver pay is in ${C}` });
  if (missing.length) return { ok: false, missing };

  used.driver_pay = rateRef(pay);
  if (fineRate) used.shortage_fine = rateRef(fineRate);
  if (demPay) used.demurrage_pay = rateRef(demPay);
  // Every posted component is first rounded to the currency's precision so the entry balances exactly.
  const mu = await minorUnits(db, C);
  const gross = roundTo(await charge(db, pay, q), mu);
  const demurrage = demPay ? roundTo(await charge(db, demPay, q, days!), mu) : new D(0);
  fine = roundTo(fine, mu);
  const driverAdv = await advancesFor(db, companyId, trip.id, trip.driverId);
  const driverAdvC = driverAdv[C] ?? new D(0);
  const driverFin = await finalize(db, companyId, C, gross.plus(demurrage).minus(fine).minus(driverAdvC));
  const otherCur = (adv: Record<string, Dec>, cur: string) => Object.fromEntries(Object.entries(adv).filter(([c]) => c !== cur).map(([c, v]) => [c, toStr(v)]));

  const driver: PartySettlement = {
    currency: C,
    lines: [
      { code: "driver_pay", amount: toStr(gross) },
      ...(demurrage.gt(0) ? [{ code: "demurrage", amount: toStr(demurrage) }] : []),
      ...(fine.gt(0) ? [{ code: "shortage_fine", amount: toStr(fine.neg()) }] : []),
    ],
    advancesDeducted: toStr(driverAdvC),
    advancesOtherCurrency: otherCur(driverAdv, C),
    net: toStr(driverFin.precise),
    rounding: toStr(driverFin.rounding),
    netFinal: toStr(driverFin.final),
  };

  let transporter: PartySettlement | null = null;
  if (transporterSide) {
    const fee = transporterSide.fee;
    used.transporter_fee = rateRef(fee);
    const F = fee.currency!;
    const amount = roundTo(await charge(db, fee, q), await minorUnits(db, F));
    const adv = await advancesFor(db, companyId, trip.id, trip.transporterId!);
    const advF = adv[F] ?? new D(0);
    const fin = await finalize(db, companyId, F, amount.minus(advF));
    transporter = {
      currency: F,
      lines: [{ code: "transporter_fee", amount: toStr(amount) }],
      advancesDeducted: toStr(advF),
      advancesOtherCurrency: otherCur(adv, F),
      net: toStr(fin.precise),
      rounding: toStr(fin.rounding),
      netFinal: toStr(fin.final),
    };
  }

  return {
    ok: true,
    calc: {
      tripId: trip.id,
      tripNo: trip.tripNo,
      rateDate: date,
      quantities: q,
      allowance: allowanceQty ? toStr(allowanceQty) : null,
      chargeableShortage: toStr(chargeable),
      demurrageDays: days,
      rates: used,
      driver,
      transporter,
    },
  };
}

/** Signed amount helper: positive = debit, negative = credit. Zero lines are skipped. */
function lineFor(accountId: string, currency: string, signed: Dec, extra: { partnerId?: string | null; jobId?: string | null; memo?: string }) {
  if (signed.isZero()) return [];
  return [{ accountId, currency, ...extra, ...(signed.gt(0) ? { debit: toStr(signed) } : { credit: toStr(signed.neg()) }) }];
}

/** Calculate and post a trip's settlement (driver and, if any, transporter) in one step. */
export const settleTrip = defineCommand({
  name: "settlements.create",
  permission: "settlements.create",
  input: z.object({ tripId: uuid, settlementDate: isoDate }),
  async handler(ctx, { tripId, settlementDate }) {
    const { tx, actor, audit } = ctx;
    const trip = await getTrip(tx, actor.companyId, tripId);
    // Serialize settlement of the same trip.
    await tx.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).for("update");
    const [existing] = await tx.select().from(tripSettlements).where(and(eq(tripSettlements.tripId, tripId), eq(tripSettlements.status, "posted")));
    if (existing) throw new Conflict(`${trip.tripNo} is already settled (${existing.settlementNo})`);
    const result = await calculateSettlement(tx, actor.companyId, trip);
    if (!result.ok) throw new ValidationError(`${trip.tripNo} cannot be settled yet`, { missing: result.missing });
    const c = result.calc;
    const acct = (k: Parameters<typeof postingAccount>[2]) => postingAccount(tx, actor.companyId, k);
    const jobId = trip.jobId;

    const lines = [];
    // Driver side, currency C
    const d = c.driver;
    const pay = dec(d.lines.find((l) => l.code === "driver_pay")!.amount);
    const dem = dec(d.lines.find((l) => l.code === "demurrage")?.amount ?? "0");
    const fine = dec(d.lines.find((l) => l.code === "shortage_fine")?.amount ?? "0").neg();
    lines.push(...lineFor((await acct("driver_costs")).id, d.currency, pay.plus(dem), { jobId, memo: `${trip.tripNo} driver pay` }));
    if (fine.gt(0)) lines.push(...lineFor((await acct("shortage_fines")).id, d.currency, fine.neg(), { jobId, memo: `${trip.tripNo} shortage fine` }));
    if (dec(d.advancesDeducted).gt(0)) lines.push(...lineFor((await acct("advances")).id, d.currency, dec(d.advancesDeducted).neg(), { partnerId: trip.driverId, jobId }));
    lines.push(...lineFor((await acct("payables_to_drivers")).id, d.currency, dec(d.netFinal).neg(), { partnerId: trip.driverId, jobId }));
    if (!dec(d.rounding).isZero()) lines.push(...lineFor((await acct("rounding_differences")).id, d.currency, dec(d.rounding).neg(), { jobId, memo: "rounding" }));

    // Transporter side, currency F
    const t = c.transporter;
    if (t) {
      lines.push(...lineFor((await acct("transporter_costs")).id, t.currency, dec(t.lines[0].amount), { jobId, memo: `${trip.tripNo} transporter fee` }));
      if (dec(t.advancesDeducted).gt(0)) lines.push(...lineFor((await acct("advances")).id, t.currency, dec(t.advancesDeducted).neg(), { partnerId: trip.transporterId, jobId }));
      lines.push(...lineFor((await acct("payables_to_transporters")).id, t.currency, dec(t.netFinal).neg(), { partnerId: trip.transporterId, jobId }));
      if (!dec(t.rounding).isZero()) lines.push(...lineFor((await acct("rounding_differences")).id, t.currency, dec(t.rounding).neg(), { jobId, memo: "rounding" }));
    }

    const settlementNo = await nextNumber(tx, actor.companyId, "STL", Number(settlementDate.slice(0, 4)));
    const entry = await postEntry(ctx, { entryDate: settlementDate, description: `${settlementNo} settlement of ${trip.tripNo}`, sourceType: "trip_settlement", sourceId: settlementNo, lines });
    const [row] = await tx
      .insert(tripSettlements)
      .values({
        companyId: actor.companyId,
        settlementNo,
        tripId,
        currency: d.currency,
        calculation: c as never,
        driverNet: d.netFinal,
        transporterNet: t?.netFinal ?? null,
        journalEntryId: entry.id,
        createdBy: actor.userId,
      })
      .returning();
    await audit({ action: "settlements.create", entityType: "trip_settlement", entityId: row.id, after: { settlementNo, tripNo: trip.tripNo, driverNet: d.netFinal, transporterNet: t?.netFinal ?? null, currency: d.currency } });
    return { id: row.id, settlementNo, calculation: c };
  },
});

export const reverseSettlement = defineCommand({
  name: "settlements.reverse",
  permission: "settlements.reverse",
  input: z.object({ settlementId: uuid, reversalDate: isoDate, reason: z.string().min(1) }),
  async handler(ctx, { settlementId, reversalDate, reason }) {
    const { tx, actor, audit } = ctx;
    const [s] = await tx.select().from(tripSettlements).where(and(eq(tripSettlements.id, settlementId), eq(tripSettlements.companyId, actor.companyId)));
    if (!s) throw new NotFound("trip_settlement", settlementId);
    if (s.status === "reversed") throw new Conflict("Settlement is already reversed");
    const [onStatement] = await tx
      .select({ no: payStatements.statementNo })
      .from(payStatementItems)
      .innerJoin(payStatements, eq(payStatements.id, payStatementItems.statementId))
      .where(and(eq(payStatementItems.settlementId, settlementId), eq(payStatementItems.active, true)))
      .limit(1);
    if (onStatement) throw new Conflict(`${s.settlementNo} is on pay statement ${onStatement.no}; cancel the statement first`);
    const rev = await reverseEntry(ctx, s.journalEntryId, reversalDate, `${s.settlementNo}: ${reason}`);
    await tx.update(tripSettlements).set({ status: "reversed", reversalEntryId: rev.id }).where(eq(tripSettlements.id, settlementId));
    await audit({ action: "settlements.reverse", entityType: "trip_settlement", entityId: settlementId, before: { status: "posted" }, after: { status: "reversed" }, reason });
    return { settlementId };
  },
});

export async function postedSettlement(db: Db, tripId: string) {
  const [s] = await db.select().from(tripSettlements).where(and(eq(tripSettlements.tripId, tripId), eq(tripSettlements.status, "posted")));
  return s ?? null;
}

/** Trips already on a posted customer invoice. */
export async function billedTripIds(db: Db, tripIds: string[]): Promise<Set<string>> {
  if (!tripIds.length) return new Set();
  const rows = await db
    .selectDistinct({ tripId: invoiceLines.tripId })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(inArray(invoiceLines.tripId, tripIds), eq(invoices.kind, "sales"), eq(invoices.status, "posted")));
  return new Set(rows.map((r) => r.tripId!));
}
