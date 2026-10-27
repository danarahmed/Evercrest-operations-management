import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { businessPartners, jobRoutes, tripFees, trips, trucks } from "@/db/schema";
import { D, dec, toStr } from "../money";
import { loadRuleCard, termsOn } from "./terms";
import { advancesByTrip } from "./trip-import";
import { calculateTrip, type FeeForCalc, type TripCalc } from "./trip-calc";

/**
 * The live view of a job's trips (accounting method D): every trip calculated
 * from the rule card in force on its loading date, plus job totals per
 * currency. Estimated until discharged; nothing here is posted to the books.
 */

const transporters = alias(businessPartners, "transporter");

export interface TripLine {
  id: string;
  tripNo: string;
  manifestNo: string | null;
  loadingDate: string | null;
  dischargeDate: string | null;
  route: string | null;
  driver: string;
  transporter: string | null;
  plate: string;
  status: string;
  loadedQty: string | null;
  loadedUnit: string | null;
  dischargedQty: string | null;
  dischargedUnit: string | null;
  /** Advances paid on the trip, per currency (all currencies, unlike calc.carrier.advance). */
  advances: Record<string, string>;
  calc: TripCalc | null;
}

export interface JobTripTotals {
  currency: string;
  trips: number;
  loaded: string;
  net: string;
  onTheWay: number;
  discharged: number;
  carrierTotal: string;
  advances: string;
  carrierToPay: string;
  fees: string;
  cost: string;
  customerTotal: string;
  /** Trips whose customer price is still to be decided (excluded from customerTotal and margin). */
  priceTbd: number;
  margin: string;
  /** Part of the totals still estimated (trips not discharged). */
  estimatedTrips: number;
}

export async function jobTripLines(db: Db, companyId: string, jobId: string): Promise<{ lines: TripLine[]; totals: JobTripTotals[]; withoutRules: number }> {
  const card = await loadRuleCard(db, companyId, jobId);
  const rows = await db
    .select({ trip: trips, driver: businessPartners.name, transporter: transporters.name, plate: trucks.plate, route: jobRoutes.name })
    .from(trips)
    .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .leftJoin(jobRoutes, eq(jobRoutes.id, trips.routeId))
    .where(and(eq(trips.jobId, jobId), eq(trips.companyId, companyId)))
    .orderBy(asc(trips.loadingDate), asc(trips.tripNo));
  const ids = rows.map((r) => r.trip.id);
  const feeRows = ids.length ? await db.select().from(tripFees).where(inArray(tripFees.tripId, ids)) : [];
  const feeName = new Map(card.allFeeTypes.map((f) => [f.id, f.name]));
  const feesBy = new Map<string, FeeForCalc[]>();
  for (const f of feeRows) {
    const list = feesBy.get(f.tripId) ?? [];
    list.push({ feeTypeId: f.feeTypeId, name: feeName.get(f.feeTypeId) ?? "", rate: f.rate, basis: f.basis, currency: f.currency, deductFromCarrier: f.deductFromCarrier, billedToCustomer: f.billedToCustomer });
    feesBy.set(f.tripId, list);
  }
  const advances = await advancesByTrip(db, ids);

  let withoutRules = 0;
  const lines: TripLine[] = rows.map(({ trip, driver, transporter, plate, route }) => {
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
            },
            terms,
            feesBy.get(trip.id) ?? [],
          )
        : null;
    if (!calc && trip.status !== "cancelled") withoutRules++;
    return {
      id: trip.id,
      tripNo: trip.tripNo,
      manifestNo: trip.manifestNo,
      loadingDate: trip.loadingDate,
      dischargeDate: trip.dischargeDate,
      route,
      driver,
      transporter,
      plate: trip.plateText ?? plate,
      status: trip.status,
      loadedQty: trip.loadedQty,
      loadedUnit: trip.loadedUnit,
      dischargedQty: trip.dischargedQty,
      dischargedUnit: trip.dischargedUnit,
      advances: advances.get(trip.id) ?? {},
      calc,
    };
  });

  const byCurrency = new Map<string, TripLine[]>();
  for (const l of lines) if (l.calc) byCurrency.set(l.calc.currency, [...(byCurrency.get(l.calc.currency) ?? []), l]);
  const totals: JobTripTotals[] = [...byCurrency].map(([currency, ls]) => {
    const sum = (pick: (c: TripCalc) => string | null) => toStr(ls.reduce((a, l) => a.plus(dec(pick(l.calc!) ?? "0")), new D(0)));
    const priced = ls.filter((l) => l.calc!.customer.total !== null);
    return {
      currency,
      trips: ls.length,
      loaded: sum((c) => c.loaded),
      net: sum((c) => c.net),
      onTheWay: ls.filter((l) => l.calc!.state === "estimated").length,
      discharged: ls.filter((l) => l.calc!.state === "confirmed").length,
      carrierTotal: sum((c) => c.carrier.total),
      advances: sum((c) => c.carrier.advance),
      carrierToPay: sum((c) => c.carrier.toPay),
      fees: sum((c) => c.feesTotal),
      cost: sum((c) => c.cost),
      customerTotal: toStr(priced.reduce((a, l) => a.plus(dec(l.calc!.customer.total!)), new D(0))),
      priceTbd: ls.length - priced.length,
      margin: toStr(priced.reduce((a, l) => a.plus(dec(l.calc!.margin!)), new D(0))),
      estimatedTrips: ls.filter((l) => l.calc!.state === "estimated").length,
    };
  });
  return { lines, totals, withoutRules };
}
