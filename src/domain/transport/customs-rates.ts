import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { customsBookingLines, customsBookings, customsRates, jobCustoms } from "@/db/schema";

/**
 * Customs duty rates and a job's customs settings (owner's rules, 2026-11). Read-only helpers shared by the live
 * calculation and the customs commands (kept apart from both so they never import each other).
 */

export async function loadCustomsCard(db: Db, jobId: string) {
  const [rates, [settings]] = await Promise.all([
    db.select().from(customsRates).where(eq(customsRates.jobId, jobId)).orderBy(asc(customsRates.effectiveFrom)),
    db.select().from(jobCustoms).where(eq(jobCustoms.jobId, jobId)),
  ]);
  return { rates, agentId: settings?.agentId ?? null, billedToCustomer: settings?.billedToCustomer ?? false };
}
export type CustomsCard = Awaited<ReturnType<typeof loadCustomsCard>>;

/** The rate on a date: the route's own line first (latest on or before the date), else the job-wide one. */
export function customsRateOn(card: CustomsCard, routeId: string | null, date: string | null) {
  if (!date) return null;
  const latest = (rows: CustomsCard["rates"]) => rows.filter((r) => r.effectiveFrom <= date).reduce<CustomsCard["rates"][number] | null>((a, r) => (!a || r.effectiveFrom >= a.effectiveFrom ? r : a), null);
  return (routeId && latest(card.rates.filter((r) => r.routeId === routeId))) || latest(card.rates.filter((r) => r.routeId === null));
}

/** The live customs booking each trip is on, if any. */
export async function customsBookedByTrip(db: Db, tripIds: string[]) {
  const out = new Map<string, { bookingId: string; bookingNo: string }>();
  if (!tripIds.length) return out;
  const rows = await db
    .select({ tripId: customsBookingLines.tripId, bookingId: customsBookings.id, bookingNo: customsBookings.bookingNo })
    .from(customsBookingLines)
    .innerJoin(customsBookings, eq(customsBookings.id, customsBookingLines.bookingId))
    .where(and(inArray(customsBookingLines.tripId, tripIds), eq(customsBookingLines.active, true)));
  for (const r of rows) out.set(r.tripId, { bookingId: r.bookingId, bookingNo: r.bookingNo });
  return out;
}

/** Is this trip's customs already booked (then its customs quantity is locked)? */
export async function customsBooked(db: Db, tripId: string) {
  return (await customsBookedByTrip(db, [tripId])).has(tripId);
}
