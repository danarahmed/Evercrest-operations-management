import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { auditEvents, businessPartners, moneyAccounts, partnerRoles, payments, trips, users } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { registerApprovable } from "../approvals/approvals";
import { amountString } from "../currency";
import { recordPayment } from "../finance/payments";
import { type Capability } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { normalizeName } from "../masterdata/partners";
import { dec } from "../money";
import { nextNumber } from "../sequences";
import { loadRuleCard, routeByName, termsOn } from "./terms";
import { manifestKey } from "./trip-import";
import { findOrCreateTruck, isSettled } from "./trips";

/**
 * One screen for a trip (owner's request): everything known about a trip is
 * entered or corrected in one place. Staff may correct a saved trip directly —
 * mistakes are frequent and waiting for permission delays the work — and every
 * change is recorded with who, when, and the value before and after. A trip
 * whose money has moved (settled / claimed) is locked.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optAmount = amountString.nullish();

const tripInput = z.object({
  tripId: uuid.optional(),
  jobId: uuid.optional(),
  manifestNo: z.string().trim().max(60).nullish(),
  routeId: uuid.nullish(),
  routeName: z.string().trim().max(120).nullish(),
  loadingDate: isoDate.nullish(),
  loadedQty: optAmount,
  arrivalDate: isoDate.nullish(),
  dischargeDate: isoDate.nullish(),
  dischargedQty: optAmount,
  driverId: uuid.nullish(),
  driverName: z.string().trim().max(120).nullish(),
  transporterId: uuid.nullish(),
  transporterName: z.string().trim().max(120).nullish(),
  plate: z.string().trim().max(60).nullish(),
  carrierPriceOverride: optAmount,
  rewardOverride: optAmount,
  transporterCut: amountString.optional(),
  carrierDeduction: amountString.optional(),
  notes: z.string().trim().max(2000).nullish(),
  /** A new advance paid now (create or edit). */
  advanceAmount: optAmount,
  advanceMoneyAccountId: uuid.nullish(),
  reason: z.string().trim().max(500).nullish(),
});
export type TripInput = z.infer<typeof tripInput>;

async function partnerByNameOrId(tx: Db, companyId: string, role: "driver" | "transporter", id: string | null | undefined, name: string | null | undefined, audit: (e: { action: string; entityType: string; entityId: string; after: unknown }) => Promise<void>) {
  if (id) {
    const [row] = await tx
      .select({ id: businessPartners.id })
      .from(businessPartners)
      .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
      .where(and(eq(businessPartners.id, id), eq(businessPartners.companyId, companyId)));
    if (!row) throw new NotFound(role, id);
    return row.id;
  }
  if (!name) return null;
  const key = normalizeName(name);
  const [found] = await tx
    .select({ id: businessPartners.id })
    .from(businessPartners)
    .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
    .where(and(eq(businessPartners.companyId, companyId), eq(businessPartners.searchKey, key)))
    .limit(1);
  if (found) return found.id;
  const [p] = await tx.insert(businessPartners).values({ companyId, kind: role === "driver" ? "person" : "organization", name, searchKey: key }).returning({ id: businessPartners.id });
  await tx.insert(partnerRoles).values({ partnerId: p.id, role });
  await audit({ action: "partners.create", entityType: "partner", entityId: p.id, after: { name, roles: [role], via: "trip" } });
  return p.id;
}

const TRACKED = ["manifestNo", "routeId", "loadingDate", "loadedQty", "loadedUnit", "arrivalDate", "dischargeDate", "dischargedQty", "dischargedUnit", "driverId", "transporterId", "truckId", "plateText", "carrierPriceOverride", "rewardOverride", "transporterCut", "carrierDeduction", "notes", "status"] as const;
type Tracked = (typeof TRACKED)[number];

export const saveTrip = defineCommand({
  name: "trips.save",
  permission: "trips.manage",
  input: tripInput,
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const existing = input.tripId ? (await tx.select().from(trips).where(and(eq(trips.id, input.tripId), eq(trips.companyId, actor.companyId))))[0] : null;
    if (input.tripId && !existing) throw new NotFound("trip", input.tripId);
    const jobId = existing?.jobId ?? input.jobId;
    if (!jobId) throw new ValidationError("Choose the job");
    const job = await getJob(tx, actor.companyId, jobId);
    const caps = job.capabilities as Capability[];
    if (!existing) {
      if (!caps.includes("transportation")) throw new ValidationError("Transportation is not enabled for this job");
      if (!["open", "in_progress", "pending"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    } else {
      if (existing.status === "cancelled") throw new Conflict("Trip is cancelled");
      if (await isSettled(tx, existing.id)) throw new Conflict("This trip is settled; its money has moved. Reverse the settlement before changing it.");
    }
    if (input.dischargedQty && !input.dischargeDate && !existing?.dischargeDate) throw new ValidationError("A discharged quantity needs a discharge date");
    const loadingDate = input.loadingDate ?? existing?.loadingDate ?? null;
    const dischargeDate = input.dischargeDate ?? existing?.dischargeDate ?? null;
    const arrivalDate = input.arrivalDate ?? existing?.arrivalDate ?? null;
    if (loadingDate && dischargeDate && dischargeDate < loadingDate) throw new ValidationError("Discharge date cannot be before the loading date");
    if (loadingDate && arrivalDate && arrivalDate < loadingDate) throw new ValidationError("Arrival date cannot be before the loading date");
    if (arrivalDate && dischargeDate && dischargeDate < arrivalDate) throw new ValidationError("Discharge date cannot be before the arrival date");

    // Route: an existing one, or a new name.
    let routeId = input.routeId ?? existing?.routeId ?? null;
    if (!input.routeId && input.routeName) {
      const { route, created } = await routeByName(tx, actor.companyId, jobId, input.routeName);
      routeId = route.id;
      if (created) await audit({ action: "job_routes.define", entityType: "job_route", entityId: route.id, after: { name: input.routeName, via: "trip" } });
    }
    const card = await loadRuleCard(tx, actor.companyId, jobId);
    const terms = loadingDate ? termsOn(card, routeId, loadingDate) : null;
    const unit = terms?.unit ?? existing?.loadedUnit ?? "MT";

    const driverId = (await partnerByNameOrId(tx, actor.companyId, "driver", input.driverId, input.driverName, audit)) ?? existing?.driverId ?? null;
    if (!driverId) throw new ValidationError("A trip needs a driver");
    const transporterId = input.transporterId === null ? null : ((await partnerByNameOrId(tx, actor.companyId, "transporter", input.transporterId, input.transporterName, audit)) ?? existing?.transporterId ?? null);
    let truckId = existing?.truckId ?? null;
    let plateText = existing?.plateText ?? null;
    if (input.plate) {
      const { truck, created } = await findOrCreateTruck(tx, actor.companyId, input.plate);
      if (created) await audit({ action: "trucks.create", entityType: "truck", entityId: truck.id, after: { plate: truck.plate, via: "trip" } });
      truckId = truck.id;
      plateText = input.plate;
    }
    if (!truckId) throw new ValidationError("A trip needs a truck plate");

    const loadedQty = input.loadedQty ?? existing?.loadedQty ?? null;
    const dischargedQty = input.dischargedQty ?? existing?.dischargedQty ?? null;
    if (loadedQty !== null && !dec(loadedQty).gt(0)) throw new ValidationError("Loaded quantity must be above zero");
    const manifestNo = input.manifestNo === undefined ? (existing?.manifestNo ?? null) : input.manifestNo;
    if (manifestNo) {
      const [dup] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.jobId, jobId), eq(trips.manifestKey, manifestKey(manifestNo)), inArray(trips.status, ["planned", "loaded", "discharged"])));
      if (dup && dup.id !== existing?.id) throw new Conflict(`Manifest ${manifestNo} is already recorded on this job`);
    }
    // Overrides equal to the rule card are not stored as overrides.
    const same = (a: string | null | undefined, b: string | null | undefined) => a != null && b != null && dec(a).eq(dec(b));
    const priceOverride = input.carrierPriceOverride === undefined ? (existing?.carrierPriceOverride ?? null) : same(input.carrierPriceOverride, terms?.carrierPrice) ? null : input.carrierPriceOverride;
    const rewardOverride = input.rewardOverride === undefined ? (existing?.rewardOverride ?? null) : same(input.rewardOverride, terms?.rewardPerTrip) ? null : input.rewardOverride;

    const status: (typeof trips.$inferSelect)["status"] = dischargedQty !== null ? "discharged" : loadedQty !== null && loadingDate ? "loaded" : "planned";
    const values = {
      manifestNo,
      manifestKey: manifestNo ? manifestKey(manifestNo) : null,
      routeId,
      loadingDate,
      loadedQty,
      loadedUnit: loadedQty !== null ? unit : null,
      arrivalDate,
      dischargeDate,
      dischargedQty,
      dischargedUnit: dischargedQty !== null ? unit : null,
      driverId,
      transporterId,
      truckId,
      plateText,
      carrierPriceOverride: priceOverride,
      rewardOverride,
      transporterCut: input.transporterCut ?? existing?.transporterCut ?? "0",
      carrierDeduction: input.carrierDeduction ?? existing?.carrierDeduction ?? "0",
      notes: input.notes === undefined ? (existing?.notes ?? null) : input.notes,
      status,
    };

    let tripId: string;
    if (existing) {
      const before: Partial<Record<Tracked, unknown>> = {};
      const after: Partial<Record<Tracked, unknown>> = {};
      for (const k of TRACKED) {
        const a = existing[k] === null || existing[k] === undefined ? null : String(existing[k]);
        const b = values[k] === null || values[k] === undefined ? null : String(values[k]);
        const numeric = ["loadedQty", "dischargedQty", "carrierPriceOverride", "rewardOverride", "transporterCut", "carrierDeduction"].includes(k);
        const equal = a === b || (numeric && a !== null && b !== null && dec(a).eq(dec(b)));
        if (!equal) {
          before[k] = a;
          after[k] = b;
        }
      }
      if (Object.keys(after).length) {
        await tx.update(trips).set(values).where(eq(trips.id, existing.id));
        await audit({ action: "trips.save", entityType: "trip", entityId: existing.id, before, after, reason: input.reason ?? null });
      } else {
        // Nothing changed: recorded as such (every command leaves a trace), hidden from the trip's history.
        await audit({ action: "trips.save_unchanged", entityType: "trip", entityId: existing.id });
      }
      tripId = existing.id;
    } else {
      const tripNo = await nextNumber(tx, actor.companyId, "TRP", Number((loadingDate ?? new Date().toISOString()).slice(0, 4)));
      const [row] = await tx.insert(trips).values({ ...values, companyId: actor.companyId, tripNo, jobId, createdBy: actor.userId }).returning({ id: trips.id });
      tripId = row.id;
      await audit({ action: "trips.save", entityType: "trip", entityId: tripId, after: { tripNo, ...values } });
    }

    if (input.advanceAmount && dec(input.advanceAmount).gt(0)) {
      if (!caps.includes("advances")) throw new ValidationError("Advances are not enabled for this job");
      if (!input.advanceMoneyAccountId) throw new ValidationError("Choose the cash box the advance is paid from");
      const [money] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, input.advanceMoneyAccountId), eq(moneyAccounts.companyId, actor.companyId)));
      if (!money) throw new NotFound("money_account", input.advanceMoneyAccountId);
      await recordPayment.handler(ctx, {
        direction: "out",
        purpose: "advance",
        moneyAccountId: money.id,
        amount: input.advanceAmount,
        currency: money.currency,
        paymentDate: loadingDate ?? new Date().toISOString().slice(0, 10),
        method: "cash",
        partnerId: driverId,
        tripId,
        reference: manifestNo ?? undefined,
      });
    }
    return { id: tripId };
  },
});

/** What happened to a trip: every change with who, when, before and after; and its advances. */
export async function tripHistory(db: Db, companyId: string, tripId: string) {
  const changes = await db
    .select({ e: auditEvents, by: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.companyId, companyId), eq(auditEvents.entityType, "trip"), eq(auditEvents.entityId, tripId), ne(auditEvents.action, "trips.save_unchanged")))
    .orderBy(desc(auditEvents.id))
    .limit(100);
  const advances = await db
    .select({ p: payments, by: users.displayName })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(and(eq(payments.companyId, companyId), eq(payments.tripId, tripId), eq(payments.purpose, "advance")))
    .orderBy(desc(payments.createdAt));
  return { changes, advances };
}

// An advance above the limit, entered on the trip screen, can be held for approval like any payment.
registerApprovable(saveTrip);
