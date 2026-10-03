import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, partnerRoles, workOrders } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { type Capability, type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { nextNumber } from "../sequences";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LOCKED = ["financially_closed", "cancelled"];

/** Open a work order on a field-work job. */
export const createWorkOrder = defineCommand({
  name: "work_orders.create",
  permission: "jobs.manage",
  input: z.object({
    jobId: uuid,
    site: z.string().trim().min(1),
    description: z.string().trim().min(1),
    contractorId: uuid.nullish(),
    plannedDate: isoDate.nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    if (!(job.capabilities as Capability[]).includes("field_work")) throw new ValidationError("Field work is not switched on for this job");
    if (input.contractorId) {
      const [c] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, "contractor")))
        .where(and(eq(businessPartners.id, input.contractorId), eq(businessPartners.companyId, actor.companyId)));
      if (!c) throw new ValidationError("Partner is not marked as a contractor");
    }
    const workOrderNo = await nextNumber(tx, actor.companyId, "WO", Number((input.plannedDate ?? new Date().toISOString()).slice(0, 4)));
    const [row] = await tx.insert(workOrders).values({ ...input, companyId: actor.companyId, workOrderNo, createdBy: actor.userId }).returning();
    await audit({ action: "work_orders.create", entityType: "work_order", entityId: row.id, after: { workOrderNo, jobNo: job.jobNo, ...input } });
    return { id: row.id, workOrderNo };
  },
});

/** Start, complete (with date and what was done) or cancel a work order. */
export const setWorkOrderStatus = defineCommand({
  name: "work_orders.set_status",
  permission: "jobs.manage",
  input: z.object({
    workOrderId: uuid,
    status: z.enum(["in_progress", "completed", "cancelled"]),
    completedDate: isoDate.nullish(),
    note: z.string().trim().nullish(),
  }),
  async handler({ tx, actor, audit }, { workOrderId, status, completedDate, note }) {
    const [wo] = await tx.select().from(workOrders).where(and(eq(workOrders.id, workOrderId), eq(workOrders.companyId, actor.companyId)));
    if (!wo) throw new NotFound("work_order", workOrderId);
    const job = await getJob(tx, actor.companyId, wo.jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    if (wo.status === "completed" || wo.status === "cancelled") throw new Conflict(`${wo.workOrderNo} is ${wo.status}`);
    if (status === "completed" && (!completedDate || !note)) throw new ValidationError("Give the completion date and say what was done");
    if (status === "cancelled" && !note) throw new ValidationError("Say why the work order is cancelled");
    await tx
      .update(workOrders)
      .set({ status, completedDate: status === "completed" ? completedDate : null, completionNote: note ?? wo.completionNote })
      .where(eq(workOrders.id, workOrderId));
    await audit({ action: "work_orders.set_status", entityType: "work_order", entityId: workOrderId, before: { status: wo.status }, after: { status, completedDate }, reason: note ?? undefined });
    return { id: workOrderId, status };
  },
});

export async function listWorkOrders(db: Db, jobId: string) {
  return db
    .select({ wo: workOrders, contractor: businessPartners.name })
    .from(workOrders)
    .leftJoin(businessPartners, eq(businessPartners.id, workOrders.contractorId))
    .where(eq(workOrders.jobId, jobId))
    .orderBy(desc(workOrders.createdAt));
}

// Field work: every work order must be completed (or cancelled) before the job is completed.
registerCapabilityModule({
  capability: "field_work",
  async blockers(tx: Db, job: Job) {
    const open = await tx.select().from(workOrders).where(and(eq(workOrders.jobId, job.id), inArray(workOrders.status, ["open", "in_progress"]))).orderBy(workOrders.workOrderNo);
    return open.map((w) => ({ code: "field.work_order_open", action: `Complete ${w.workOrderNo} at ${w.site}`, params: { workOrder: w.workOrderNo, site: w.site }, blocks: "completed" as const }));
  },
  async inUse(tx: Db, job: Job) {
    const [w] = await tx.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.jobId, job.id), inArray(workOrders.status, ["open", "in_progress", "completed"]))).limit(1);
    return !!w;
  },
});
