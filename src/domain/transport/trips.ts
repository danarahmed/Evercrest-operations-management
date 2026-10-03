import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, catalogItems, partnerRoles, trips, trucks } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { type Capability, type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { convertQuantity, getUnit } from "../masterdata/catalog";
import { normalizeName } from "../masterdata/partners";
import { type Dec, dec, toStr } from "../money";
import { amountString } from "../currency";
import { nextNumber } from "../sequences";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveQty = amountString.refine((q) => dec(q).gt(0), "must be greater than zero");

/** Normalize a plate for matching: Arabic-Indic digits → Latin, drop separators, upper-case. */
export function plateKey(plate: string): string {
  return plate
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-_.]/g, "")
    .toUpperCase();
}

async function partnerHasRole(tx: Db, companyId: string, partnerId: string, role: "driver" | "transporter") {
  const [row] = await tx
    .select({ role: partnerRoles.role })
    .from(businessPartners)
    .leftJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
    .where(and(eq(businessPartners.id, partnerId), eq(businessPartners.companyId, companyId)));
  if (!row) throw new NotFound("partner", partnerId);
  if (!row.role) throw new ValidationError(`Partner is not marked as a ${role}`, { partnerId });
}

async function findOrCreateTruck(tx: Db, companyId: string, plate: string) {
  const key = plateKey(plate);
  if (!key) throw new ValidationError("Truck plate is required");
  const [existing] = await tx.select().from(trucks).where(and(eq(trucks.companyId, companyId), eq(trucks.plateKey, key)));
  if (existing) return { truck: existing, created: false };
  const [truck] = await tx.insert(trucks).values({ companyId, plate: plate.trim(), plateKey: key }).returning();
  return { truck, created: true };
}

/**
 * Start a trip with whatever is known. Minimum: job, driver (existing or just a
 * name) and truck plate. Transporter is optional (direct driver).
 */
export const createTrip = defineCommand({
  name: "trips.create",
  permission: "trips.manage",
  input: z
    .object({
      jobId: uuid,
      driverId: uuid.optional(),
      newDriverName: z.string().trim().min(1).optional(),
      truckPlate: z.string().trim().min(1),
      transporterId: uuid.nullish(),
      productId: uuid.nullish(),
      loadingLocation: z.string().nullish(),
      destination: z.string().nullish(),
      notes: z.string().nullish(),
    })
    .refine((v) => !!v.driverId !== !!v.newDriverName, "Give either an existing driver or a new driver name"),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (!(job.capabilities as Capability[]).includes("transportation"))
      throw new ValidationError("Transportation is not enabled for this job");
    if (!["open", "in_progress", "pending"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);

    let driverId = input.driverId;
    if (driverId) await partnerHasRole(tx, actor.companyId, driverId, "driver");
    else {
      const name = input.newDriverName!;
      const [p] = await tx
        .insert(businessPartners)
        .values({ companyId: actor.companyId, kind: "person", name, searchKey: normalizeName(name) })
        .returning();
      await tx.insert(partnerRoles).values({ partnerId: p.id, role: "driver" });
      await audit({ action: "partners.create", entityType: "partner", entityId: p.id, after: { name, roles: ["driver"], via: "trip" } });
      driverId = p.id;
    }
    if (input.transporterId) await partnerHasRole(tx, actor.companyId, input.transporterId, "transporter");
    if (input.productId) {
      const [item] = await tx.select().from(catalogItems).where(and(eq(catalogItems.id, input.productId), eq(catalogItems.companyId, actor.companyId)));
      if (!item) throw new NotFound("catalog_item", input.productId);
    }
    const { truck, created } = await findOrCreateTruck(tx, actor.companyId, input.truckPlate);
    if (created) await audit({ action: "trucks.create", entityType: "truck", entityId: truck.id, after: { plate: truck.plate, via: "trip" } });

    const tripNo = await nextNumber(tx, actor.companyId, "TRP", new Date().getUTCFullYear());
    const [trip] = await tx
      .insert(trips)
      .values({
        companyId: actor.companyId,
        tripNo,
        jobId: job.id,
        driverId,
        truckId: truck.id,
        transporterId: input.transporterId ?? null,
        productId: input.productId ?? null,
        loadingLocation: input.loadingLocation ?? null,
        destination: input.destination ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();
    await audit({
      action: "trips.create",
      entityType: "trip",
      entityId: trip.id,
      after: { tripNo, jobId: job.id, driverId, truckId: truck.id, transporterId: trip.transporterId },
    });
    return { id: trip.id, tripNo, driverId, truckId: truck.id };
  },
});

export async function getTrip(tx: Db, companyId: string, tripId: string) {
  const [trip] = await tx.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)));
  if (!trip) throw new NotFound("trip", tripId);
  return trip;
}

/** Record (or correct, with a reason) the loading. */
export const recordLoading = defineCommand({
  name: "trips.record_loading",
  permission: "trips.manage",
  input: z.object({ tripId: uuid, loadingDate: isoDate, loadedQty: positiveQty, loadedUnit: z.string(), reason: z.string().optional() }),
  async handler({ tx, actor, audit }, { tripId, loadingDate, loadedQty, loadedUnit, reason }) {
    const trip = await getTrip(tx, actor.companyId, tripId);
    if (trip.status === "cancelled" || trip.status === "discharged") throw new Conflict(`Trip is ${trip.status}`);
    if (trip.status === "loaded" && !reason) throw new ValidationError("A reason is required to correct loading");
    await getUnit(tx, loadedUnit);
    const before = { loadingDate: trip.loadingDate, loadedQty: trip.loadedQty, loadedUnit: trip.loadedUnit };
    await tx.update(trips).set({ loadingDate, loadedQty, loadedUnit, status: "loaded" }).where(eq(trips.id, tripId));
    await audit({ action: "trips.record_loading", entityType: "trip", entityId: tripId, before, after: { loadingDate, loadedQty, loadedUnit }, reason });
    return { tripId };
  },
});

export const recordDischarge = defineCommand({
  name: "trips.record_discharge",
  permission: "trips.manage",
  input: z.object({ tripId: uuid, dischargeDate: isoDate, dischargedQty: amountString, dischargedUnit: z.string(), reason: z.string().optional() }),
  async handler({ tx, actor, audit }, { tripId, dischargeDate, dischargedQty, dischargedUnit, reason }) {
    const trip = await getTrip(tx, actor.companyId, tripId);
    if (trip.status === "planned") throw new ValidationError("Record the loading before the discharge");
    if (trip.status === "cancelled") throw new Conflict("Trip is cancelled");
    if (trip.status === "discharged" && !reason) throw new ValidationError("A reason is required to correct the discharge");
    if (trip.loadingDate && dischargeDate < trip.loadingDate) throw new ValidationError("Discharge date cannot be before the loading date");
    await getUnit(tx, dischargedUnit);
    const before = { dischargeDate: trip.dischargeDate, dischargedQty: trip.dischargedQty, dischargedUnit: trip.dischargedUnit };
    await tx.update(trips).set({ dischargeDate, dischargedQty, dischargedUnit, status: "discharged" }).where(eq(trips.id, tripId));
    await audit({ action: "trips.record_discharge", entityType: "trip", entityId: tripId, before, after: { dischargeDate, dischargedQty, dischargedUnit }, reason });
    return { tripId };
  },
});

export const cancelTrip = defineCommand({
  name: "trips.cancel",
  permission: "trips.manage",
  input: z.object({ tripId: uuid, reason: z.string().min(1) }),
  async handler({ tx, actor, audit }, { tripId, reason }) {
    const trip = await getTrip(tx, actor.companyId, tripId);
    if (trip.status === "cancelled") return { tripId };
    if (trip.status === "discharged") throw new Conflict("A discharged trip cannot be cancelled");
    await tx.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    await audit({ action: "trips.cancel", entityType: "trip", entityId: tripId, before: { status: trip.status }, after: { status: "cancelled" }, reason });
    return { tripId };
  },
});

export type QuantityDifference =
  | { status: "known"; difference: string; unit: string }
  | { status: "missing"; missing: ("loaded" | "discharged")[] }
  | { status: "incomparable"; reason: string };

/** Loaded − discharged, in the loaded unit. Missing data is reported, never treated as zero. */
export async function quantityDifference(db: Db, trip: typeof trips.$inferSelect): Promise<QuantityDifference> {
  const missing = [
    ...(trip.loadedQty === null ? (["loaded"] as const) : []),
    ...(trip.dischargedQty === null ? (["discharged"] as const) : []),
  ];
  if (missing.length) return { status: "missing", missing };
  let discharged: Dec;
  try {
    discharged = await convertQuantity(db, trip.dischargedQty!, trip.dischargedUnit!, trip.loadedUnit!);
  } catch (e) {
    return { status: "incomparable", reason: (e as Error).message };
  }
  return { status: "known", difference: toStr(dec(trip.loadedQty!).minus(discharged)), unit: trip.loadedUnit! };
}

registerCapabilityModule({
  capability: "transportation",
  async blockers(tx: Db, job: Job) {
    const open = await tx
      .select({ tripNo: trips.tripNo, status: trips.status })
      .from(trips)
      .where(and(eq(trips.jobId, job.id), inArray(trips.status, ["planned", "loaded"])));
    return open.map((t) => ({
      code: t.status === "planned" ? "transport.awaiting_loading" : "transport.awaiting_discharge",
      action: t.status === "planned" ? `Waiting for loading of ${t.tripNo}` : `Waiting for discharge of ${t.tripNo}`,
      blocks: "completed" as const,
    }));
  },
  async inUse(tx: Db, job: Job) {
    const [t] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.jobId, job.id), ne(trips.status, "cancelled"))).limit(1);
    return !!t;
  },
});
