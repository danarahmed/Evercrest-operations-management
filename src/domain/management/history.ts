import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, deliveries, documents, jobActivities, payments, trips, tripSettlements, users, workOrders } from "@/db/schema";

/**
 * Everything that happened to a job and the records that belong to it (trips,
 * steps, work orders, deliveries, settlements, documents, payments), newest
 * first, from the append-only audit trail.
 */
export async function jobHistory(db: Db, companyId: string, jobId: string, limit = 200) {
  const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id);
  const tripIds = await ids(db.select({ id: trips.id }).from(trips).where(eq(trips.jobId, jobId)));
  const groups: [string, string[]][] = [
    ["job", [jobId]],
    ["trip", tripIds],
    ["job_activity", await ids(db.select({ id: jobActivities.id }).from(jobActivities).where(eq(jobActivities.jobId, jobId)))],
    ["work_order", await ids(db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.jobId, jobId)))],
    ["delivery", await ids(db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.jobId, jobId)))],
    ["document", await ids(db.select({ id: documents.id }).from(documents).where(eq(documents.jobId, jobId)))],
    ["payment", await ids(db.select({ id: payments.id }).from(payments).where(eq(payments.jobId, jobId)))],
    ["trip_settlement", tripIds.length ? await ids(db.select({ id: tripSettlements.id }).from(tripSettlements).where(inArray(tripSettlements.tripId, tripIds))) : []],
  ];
  const conds = groups.filter(([, xs]) => xs.length).map(([type, xs]) => and(eq(auditEvents.entityType, type), inArray(auditEvents.entityId, xs))!);
  return db
    .select({ e: auditEvents, by: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.companyId, companyId), or(...conds)))
    .orderBy(desc(auditEvents.id))
    .limit(limit);
}

/** The company audit log with simple filters. */
export async function auditLog(db: Db, companyId: string, f: { from: string; to: string; action?: string; userId?: string; limit?: number }) {
  const conds: SQL[] = [eq(auditEvents.companyId, companyId), gte(sql`${auditEvents.createdAt}::date`, f.from), lte(sql`${auditEvents.createdAt}::date`, f.to)];
  if (f.action) conds.push(sql`${auditEvents.action} ilike ${`%${f.action}%`}`);
  if (f.userId) conds.push(eq(auditEvents.actorUserId, f.userId));
  return db
    .select({ e: auditEvents, by: users.displayName })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(...conds))
    .orderBy(desc(auditEvents.id))
    .limit(f.limit ?? 300);
}

/** Short readable summary of what changed, for screens (keys of `after`, values shortened). */
export function summarize(after: unknown): string {
  if (!after || typeof after !== "object") return "";
  return Object.entries(after as Record<string, unknown>)
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && !k.endsWith("Id") && k !== "id")
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)}`)
    .join(" · ");
}
