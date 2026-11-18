import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { claimItems, claims, fineWaivers, payments, tripFees, trips } from "@/db/schema";
import { dec } from "../money";
import { loadRuleCard, type RuleCard, termsOn } from "./terms";
import { calculateTrip, type FeeForCalc, type TripCalc } from "./trip-calc";

type Trip = typeof trips.$inferSelect;

/**
 * The live calculation of trips from their jobs' rule cards (accounting
 * method D): the same numbers for the trip grid, the trip dialog, a claim
 * preview and a remote settlement comparison, so every screen agrees.
 */
export interface LiveTrip {
  calc: TripCalc | null;
  /** Rule card version in force on the loading date, if any. */
  termsId: string | null;
  advances: Record<string, string>;
  /** Advances per payee, in the job currency only (what the claim clears). */
  advancesByPayee: Record<string, string>;
  fineWaived: string;
  claim: { id: string; claimNo: string; status: string } | null;
}

/** Posted advances per trip, per currency (all currencies). */
export async function advancesByTrip(db: Db, tripIds: string[]) {
  const out = new Map<string, Record<string, string>>();
  if (!tripIds.length) return out;
  const rows = await db
    .select({ tripId: payments.tripId, currency: payments.currency, amount: payments.amount })
    .from(payments)
    .where(and(inArray(payments.tripId, tripIds), eq(payments.purpose, "advance"), eq(payments.status, "posted")));
  for (const r of rows) {
    const m = out.get(r.tripId!) ?? {};
    m[r.currency] = dec(m[r.currency] ?? "0").plus(dec(r.amount)).toFixed();
    out.set(r.tripId!, m);
  }
  return out;
}

/** Posted advances per trip and payee in one currency. */
async function advancesByPayee(db: Db, tripIds: string[], currency: string) {
  const out = new Map<string, Record<string, string>>();
  if (!tripIds.length) return out;
  const rows = await db
    .select({ tripId: payments.tripId, partnerId: payments.partnerId, total: sql<string>`sum(${payments.amount})` })
    .from(payments)
    .where(and(inArray(payments.tripId, tripIds), eq(payments.purpose, "advance"), eq(payments.status, "posted"), eq(payments.currency, currency)))
    .groupBy(payments.tripId, payments.partnerId);
  for (const r of rows) {
    const m = out.get(r.tripId!) ?? {};
    m[r.partnerId ?? ""] = dec(r.total).toFixed();
    out.set(r.tripId!, m);
  }
  return out;
}

/** Approved fine waivers per trip (sum, job currency). */
export async function waiversByTrip(db: Db, tripIds: string[]) {
  const out = new Map<string, string>();
  if (!tripIds.length) return out;
  const rows = await db
    .select({ tripId: fineWaivers.tripId, total: sql<string>`sum(${fineWaivers.amount})` })
    .from(fineWaivers)
    .where(inArray(fineWaivers.tripId, tripIds))
    .groupBy(fineWaivers.tripId);
  for (const r of rows) out.set(r.tripId, dec(r.total).toFixed());
  return out;
}

/** The live claim (not cancelled) each trip is on, if any. */
export async function claimsByTrip(db: Db, tripIds: string[]) {
  const out = new Map<string, { id: string; claimNo: string; status: string }>();
  if (!tripIds.length) return out;
  const rows = await db
    .select({ tripId: claimItems.tripId, id: claims.id, claimNo: claims.claimNo, status: claims.status })
    .from(claimItems)
    .innerJoin(claims, eq(claims.id, claimItems.claimId))
    .where(and(inArray(claimItems.tripId, tripIds), eq(claimItems.active, true)));
  for (const r of rows) out.set(r.tripId, { id: r.id, claimNo: r.claimNo, status: r.status });
  return out;
}

/**
 * Calculate many trips at once (one rule card load per job). Returns a map by
 * trip id; `calc` is null for cancelled trips and trips without a rule.
 */
export async function liveTrips(db: Db, companyId: string, rows: Trip[], preloaded: Map<string, RuleCard> = new Map()): Promise<Map<string, LiveTrip>> {
  const out = new Map<string, LiveTrip>();
  if (!rows.length) return out;
  const cards = preloaded;
  for (const id of new Set(rows.map((r) => r.jobId))) if (!cards.has(id)) cards.set(id, await loadRuleCard(db, companyId, id));
  const ids = rows.map((r) => r.id);
  const feeRows = await db.select().from(tripFees).where(inArray(tripFees.tripId, ids));
  const feeName = new Map([...cards.values()].flatMap((c) => c.allFeeTypes.map((f) => [f.id, f.name] as const)));
  const feesBy = new Map<string, FeeForCalc[]>();
  for (const fee of feeRows) {
    const list = feesBy.get(fee.tripId) ?? [];
    list.push({ feeTypeId: fee.feeTypeId, name: feeName.get(fee.feeTypeId) ?? "", rate: fee.rate, basis: fee.basis, currency: fee.currency, deductFromCarrier: fee.deductFromCarrier, billedToCustomer: fee.billedToCustomer });
    feesBy.set(fee.tripId, list);
  }
  const [advances, waivers, claimed] = await Promise.all([advancesByTrip(db, ids), waiversByTrip(db, ids), claimsByTrip(db, ids)]);
  const byPayee = new Map<string, Map<string, Record<string, string>>>();
  for (const trip of rows) {
    const card = cards.get(trip.jobId)!;
    const terms = trip.loadingDate ? termsOn(card, trip.routeId, trip.loadingDate) : null;
    const calc =
      terms && trip.status !== "cancelled"
        ? calculateTrip(
            {
              loadedQty: trip.loadedQty,
              dischargedQty: trip.dischargedQty,
              arrivalDate: trip.arrivalDate,
              dischargeDate: trip.dischargeDate,
              carrierPriceOverride: trip.carrierPriceOverride,
              rewardOverride: trip.rewardOverride,
              transporterCut: trip.transporterCut,
              carrierDeduction: trip.carrierDeduction,
              advances: advances.get(trip.id) ?? {},
              fineWaived: waivers.get(trip.id) ?? "0",
            },
            terms,
            feesBy.get(trip.id) ?? [],
          )
        : null;
    let perPayee: Record<string, string> = {};
    if (terms) {
      if (!byPayee.has(terms.currency)) byPayee.set(terms.currency, await advancesByPayee(db, ids, terms.currency));
      perPayee = byPayee.get(terms.currency)!.get(trip.id) ?? {};
    }
    out.set(trip.id, { calc, termsId: terms?.id ?? null, advances: advances.get(trip.id) ?? {}, advancesByPayee: perPayee, fineWaived: waivers.get(trip.id) ?? "0", claim: claimed.get(trip.id) ?? null });
  }
  return out;
}
