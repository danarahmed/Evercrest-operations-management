import { and, asc, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { businessPartners, jobRoutes, jobs, tripFees, trips, trucks } from "@/db/schema";
import { D, dec, toStr } from "../money";
import { loadRuleCard, type RuleCard, termsOn } from "./terms";
import { advancesByTrip } from "./trip-import";
import { calculateTrip, type FeeForCalc, type TripCalc } from "./trip-calc";

/**
 * The live view of trips (accounting method D): every trip calculated from
 * its job's rule card in force on its loading date, plus totals per currency.
 * Estimated until discharged; nothing here is posted to the books. Filters
 * combine like a spreadsheet's; totals follow the filtered rows.
 */

const transporters = alias(businessPartners, "transporter");

export interface TripLine {
  id: string;
  jobId: string;
  jobNo: string;
  jobName: string;
  tripNo: string;
  manifestNo: string | null;
  loadingDate: string | null;
  arrivalDate: string | null;
  dischargeDate: string | null;
  routeId: string | null;
  route: string | null;
  driverId: string;
  driver: string;
  transporterId: string | null;
  transporter: string | null;
  plate: string;
  status: string;
  loadedQty: string | null;
  loadedUnit: string | null;
  dischargedQty: string | null;
  dischargedUnit: string | null;
  notes: string | null;
  /** Advances paid on the trip, per currency (all currencies, unlike calc.carrier.advance). */
  advances: Record<string, string>;
  calc: TripCalc | null;
  /** estimated | confirmed | cancelled | norule */
  state: TripState;
}
export type TripState = "estimated" | "confirmed" | "cancelled" | "norule";

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
  estimatedTrips: number;
}

export const TRIP_SORTS = ["loadingDate", "manifest", "route", "driver", "transporter", "plate", "loaded", "discharged", "net", "fine", "carrierPay", "advance", "toPay", "fees", "cost", "billed", "margin", "state", "job"] as const;
export type TripSort = (typeof TRIP_SORTS)[number];
export const TRIP_CHIPS = ["nodischarge", "noadvance", "hasfine", "pricediff", "nomanifest", "noroute", "pricetbd"] as const;
export type TripChip = (typeof TRIP_CHIPS)[number];

export interface TripFilters {
  jobId?: string | null;
  /** Company-wide view: limit to these jobs. */
  jobIds?: string[];
  q?: string;
  routeIds?: string[];
  transporterIds?: string[];
  /** "direct" = no transporter */
  direct?: boolean;
  driverIds?: string[];
  states?: TripState[];
  loadedFrom?: string;
  loadedTo?: string;
  dischargedFrom?: string;
  dischargedTo?: string;
  chips?: TripChip[];
  sort?: TripSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface TripFilterOptions {
  routes: { id: string; name: string }[];
  transporters: { id: string; name: string }[];
  drivers: { id: string; name: string }[];
  jobs: { id: string; no: string; name: string }[];
}

const num = (x: string | null | undefined) => (x === null || x === undefined ? null : Number(x));

function sortValue(l: TripLine, key: TripSort): string | number | null {
  const c = l.calc;
  switch (key) {
    case "loadingDate": return l.loadingDate;
    case "manifest": return l.manifestNo ?? l.tripNo;
    case "route": return l.route;
    case "driver": return l.driver;
    case "transporter": return l.transporter;
    case "plate": return l.plate;
    case "loaded": return num(c?.loaded ?? l.loadedQty);
    case "discharged": return num(c?.discharged ?? l.dischargedQty);
    case "net": return num(c?.net);
    case "fine": return num(c?.carrier.fine);
    case "carrierPay": return num(c?.carrier.total);
    case "advance": return num(c?.carrier.advance) ?? num(Object.values(l.advances)[0]);
    case "toPay": return num(c?.carrier.toPay);
    case "fees": return num(c?.feesTotal);
    case "cost": return num(c?.cost);
    case "billed": return num(c?.customer.total);
    case "margin": return num(c?.margin);
    case "state": return l.state;
    case "job": return l.jobNo;
  }
}

function matchesChips(l: TripLine, chips: TripChip[]): boolean {
  const c = l.calc;
  return chips.every((chip) => {
    switch (chip) {
      case "nodischarge": return l.dischargedQty === null && l.status !== "cancelled";
      case "noadvance": return Object.keys(l.advances).length === 0;
      case "hasfine": return !!c && c.carrier.fine !== "0";
      case "pricediff": return !!c && (c.flags.includes("carrier_price_differs") || c.flags.includes("reward_differs"));
      case "nomanifest": return !l.manifestNo;
      case "noroute": return !l.routeId;
      case "pricetbd": return !!c && c.customer.total === null;
    }
  });
}

export async function tripLines(db: Db, companyId: string, f: TripFilters): Promise<{ lines: TripLine[]; totals: JobTripTotals[]; withoutRules: number; total: number; page: number; pageSize: number; options: TripFilterOptions }> {
  const where: SQL[] = [eq(trips.companyId, companyId)];
  if (f.jobId) where.push(eq(trips.jobId, f.jobId));
  else if (f.jobIds?.length) where.push(inArray(trips.jobId, f.jobIds));
  if (f.routeIds?.length) where.push(inArray(trips.routeId, f.routeIds));
  if (f.driverIds?.length) where.push(inArray(trips.driverId, f.driverIds));
  if (f.transporterIds?.length || f.direct) {
    // Chosen transporters, and/or trips with no transporter ("direct" drivers).
    const parts: SQL[] = [];
    if (f.transporterIds?.length) parts.push(inArray(trips.transporterId, f.transporterIds));
    if (f.direct) parts.push(isNull(trips.transporterId));
    where.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }
  if (f.loadedFrom) where.push(gte(trips.loadingDate, f.loadedFrom));
  if (f.loadedTo) where.push(lte(trips.loadingDate, f.loadedTo));
  if (f.dischargedFrom) where.push(gte(trips.dischargeDate, f.dischargedFrom));
  if (f.dischargedTo) where.push(lte(trips.dischargeDate, f.dischargedTo));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(trips.manifestNo, like), ilike(trips.tripNo, like), ilike(businessPartners.name, like), ilike(transporters.name, like), ilike(trucks.plate, like), ilike(trips.plateText, like))!);
  }

  const rows = await db
    .select({ trip: trips, driver: businessPartners.name, transporter: transporters.name, plate: trucks.plate, route: jobRoutes.name, jobNo: jobs.jobNo, jobName: jobs.name })
    .from(trips)
    .innerJoin(jobs, eq(jobs.id, trips.jobId))
    .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .leftJoin(jobRoutes, eq(jobRoutes.id, trips.routeId))
    .where(and(...where))
    .orderBy(asc(trips.loadingDate), asc(trips.tripNo));

  const jobIds = [...new Set(rows.map((r) => r.trip.jobId))];
  const cards = new Map<string, RuleCard>();
  for (const id of jobIds) cards.set(id, await loadRuleCard(db, companyId, id));
  const ids = rows.map((r) => r.trip.id);
  const feeRows = ids.length ? await db.select().from(tripFees).where(inArray(tripFees.tripId, ids)) : [];
  const feeName = new Map([...cards.values()].flatMap((c) => c.allFeeTypes.map((f) => [f.id, f.name] as const)));
  const feesBy = new Map<string, FeeForCalc[]>();
  for (const fee of feeRows) {
    const list = feesBy.get(fee.tripId) ?? [];
    list.push({ feeTypeId: fee.feeTypeId, name: feeName.get(fee.feeTypeId) ?? "", rate: fee.rate, basis: fee.basis, currency: fee.currency, deductFromCarrier: fee.deductFromCarrier, billedToCustomer: fee.billedToCustomer });
    feesBy.set(fee.tripId, list);
  }
  const advances = await advancesByTrip(db, ids);

  let withoutRules = 0;
  let lines: TripLine[] = rows.map(({ trip, driver, transporter, plate, route, jobNo, jobName }) => {
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
            },
            terms,
            feesBy.get(trip.id) ?? [],
          )
        : null;
    if (!calc && trip.status !== "cancelled") withoutRules++;
    const state: TripState = trip.status === "cancelled" ? "cancelled" : !calc ? "norule" : calc.state;
    return {
      id: trip.id,
      jobId: trip.jobId,
      jobNo,
      jobName,
      tripNo: trip.tripNo,
      manifestNo: trip.manifestNo,
      loadingDate: trip.loadingDate,
      arrivalDate: trip.arrivalDate,
      dischargeDate: trip.dischargeDate,
      routeId: trip.routeId,
      route,
      driverId: trip.driverId,
      driver,
      transporterId: trip.transporterId,
      transporter,
      plate: trip.plateText ?? plate,
      status: trip.status,
      loadedQty: trip.loadedQty,
      loadedUnit: trip.loadedUnit,
      dischargedQty: trip.dischargedQty,
      dischargedUnit: trip.dischargedUnit,
      notes: trip.notes,
      advances: advances.get(trip.id) ?? {},
      calc,
      state,
    };
  });

  // Filter choices come from the unfiltered set of this job (or company), so a filter can always be widened again.
  const uniq = <T extends { id: string; name: string }>(xs: (T | null)[]) => [...new Map(xs.filter((x): x is T => !!x).map((x) => [x.id, x])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const options: TripFilterOptions = {
    routes: f.jobId ? cards.get(f.jobId)?.routes.map((r) => ({ id: r.id, name: r.name })) ?? [] : uniq(lines.map((l) => (l.routeId && l.route ? { id: l.routeId, name: l.route } : null))),
    transporters: uniq(lines.map((l) => (l.transporterId && l.transporter ? { id: l.transporterId, name: l.transporter } : null))),
    drivers: uniq(lines.map((l) => ({ id: l.driverId, name: l.driver }))),
    jobs: [...new Map(lines.map((l) => [l.jobId, { id: l.jobId, no: l.jobNo, name: l.jobName }])).values()].sort((a, b) => b.no.localeCompare(a.no)),
  };

  if (f.states?.length) lines = lines.filter((l) => f.states!.includes(l.state));
  if (f.chips?.length) lines = lines.filter((l) => matchesChips(l, f.chips!));

  const sort = f.sort ?? "loadingDate";
  const dir = f.dir ?? (f.sort ? "asc" : "desc");
  lines.sort((a, b) => {
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    if (x === y) return a.tripNo.localeCompare(b.tripNo);
    if (x === null) return 1;
    if (y === null) return -1;
    const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return dir === "asc" ? r : -r;
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

  const pageSize = Math.min(Math.max(f.pageSize ?? 100, 10), 500);
  const total = lines.length;
  const page = Math.min(Math.max(f.page ?? 1, 1), Math.max(Math.ceil(total / pageSize), 1));
  return { lines: lines.slice((page - 1) * pageSize, page * pageSize), totals, withoutRules, total, page, pageSize, options };
}

/** Kept for callers that want one job without filters. */
export const jobTripLines = (db: Db, companyId: string, jobId: string) => tripLines(db, companyId, { jobId, pageSize: 500 });
