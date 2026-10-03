import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { businessPartners, jobs, jobTypes, trips, trucks } from "@/db/schema";
import { documentChecklist } from "@/domain/documents/documents";
import { jobProfitability } from "@/domain/finance/invoices";
import { tripAdvances } from "@/domain/finance/payments";
import { getJob, jobBlockers, nextActionInfo } from "@/domain/jobs/commands";
import { quantityDifference } from "@/domain/transport/trips";
import { type Actor, can, requirePermission } from "./authz";

/** Read models for screens. Every read checks permission server-side, like commands. */

export async function activeJobs(db: Db, actor: Actor) {
  requirePermission(actor, "jobs.view");
  const rows = await db
    .select({ job: jobs, customer: businessPartners.name, type: jobTypes.name })
    .from(jobs)
    .innerJoin(businessPartners, eq(businessPartners.id, jobs.customerId))
    .innerJoin(jobTypes, eq(jobTypes.id, jobs.jobTypeId))
    .where(and(eq(jobs.companyId, actor.companyId), inArray(jobs.status, ["draft", "open", "in_progress", "pending", "completed"])))
    .orderBy(desc(jobs.createdAt))
    .limit(100);
  return Promise.all(rows.map(async (r) => ({ ...r, nextAction: await nextActionInfo(db, r.job) })));
}

export async function jobWorkspace(db: Db, actor: Actor, jobId: string) {
  requirePermission(actor, "jobs.view");
  const job = await getJob(db, actor.companyId, jobId);
  const [customer] = await db.select().from(businessPartners).where(eq(businessPartners.id, job.customerId));
  const tripRows = await db
    .select({ trip: trips, driver: businessPartners.name, plate: trucks.plate })
    .from(trips)
    .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .where(eq(trips.jobId, job.id))
    .orderBy(trips.tripNo);
  const tripsView = await Promise.all(
    tripRows.map(async (t) => ({
      ...t,
      difference: await quantityDifference(db, t.trip),
      advances: await tripAdvances(db, actor.companyId, t.trip.id),
    })),
  );
  return {
    job,
    customer: customer.name,
    nextAction: await nextActionInfo(db, job),
    blockers: await jobBlockers(db, job),
    trips: tripsView,
    documents: await documentChecklist(db, job),
    // Financial figures only for people allowed to see them.
    profitability: can(actor, "reports.financial.view") ? await jobProfitability(db, job.id) : null,
  };
}
