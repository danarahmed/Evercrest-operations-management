import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, contracts, jobs, jobTypes, partnerRoles, projects, users } from "@/db/schema";
import { type JobStatus } from "@/db/schema/jobs";
import { requirePermission } from "@/server/authz";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { nextNumber } from "../sequences";
import { type Blocker, CAPABILITIES, type Capability, capabilityModule, type Job, modulesFor } from "./capabilities";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
const capabilityList = z.array(z.enum(CAPABILITIES)).transform((c) => [...new Set(c)].sort());

async function assertPartnerRole(tx: Db, companyId: string, partnerId: string, role: "customer") {
  const [p] = await tx
    .select({ id: businessPartners.id, role: partnerRoles.role })
    .from(businessPartners)
    .leftJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
    .where(and(eq(businessPartners.id, partnerId), eq(businessPartners.companyId, companyId)));
  if (!p) throw new NotFound("partner", partnerId);
  if (!p.role) throw new ValidationError(`Partner is not marked as a ${role}`, { partnerId });
}

export const createContract = defineCommand({
  name: "contracts.create",
  permission: "contracts.manage",
  input: z.object({
    partnerId: uuid,
    reference: z.string().trim().min(1),
    title: z.string().trim().min(1),
    validFrom: isoDate.nullish(),
    validTo: isoDate.nullish(),
    status: z.enum(["draft", "active", "ended"]).default("draft"),
    notes: z.string().nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    const [p] = await tx.select().from(businessPartners).where(and(eq(businessPartners.id, input.partnerId), eq(businessPartners.companyId, actor.companyId)));
    if (!p) throw new NotFound("partner", input.partnerId);
    const [row] = await tx.insert(contracts).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "contracts.create", entityType: "contract", entityId: row.id, after: input });
    return { id: row.id };
  },
});

export const createProject = defineCommand({
  name: "projects.create",
  permission: "projects.manage",
  input: z.object({ customerId: uuid, contractId: uuid.nullish(), code: z.string().trim().min(1), name: z.string().trim().min(1) }),
  async handler({ tx, actor, audit }, input) {
    await assertPartnerRole(tx, actor.companyId, input.customerId, "customer");
    if (input.contractId) await assertContractFor(tx, actor.companyId, input.contractId, input.customerId);
    const [row] = await tx.insert(projects).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "projects.create", entityType: "project", entityId: row.id, after: input });
    return { id: row.id };
  },
});

async function assertContractFor(tx: Db, companyId: string, contractId: string, partnerId: string) {
  const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.companyId, companyId)));
  if (!c) throw new NotFound("contract", contractId);
  if (c.partnerId !== partnerId) throw new ValidationError("Contract belongs to a different partner", { contractId });
  return c;
}

/** Create or update a job type (template). Changing defaults never alters existing jobs. */
export const defineJobType = defineCommand({
  name: "job_types.define",
  permission: "job_types.manage",
  input: z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), defaultCapabilities: capabilityList }),
  async handler({ tx, actor, audit }, input) {
    const [prev] = await tx.select().from(jobTypes).where(and(eq(jobTypes.companyId, actor.companyId), eq(jobTypes.code, input.code)));
    const [row] = await tx
      .insert(jobTypes)
      .values({ ...input, companyId: actor.companyId })
      .onConflictDoUpdate({ target: [jobTypes.companyId, jobTypes.code], set: { name: input.name, defaultCapabilities: input.defaultCapabilities } })
      .returning();
    await audit({ action: "job_types.define", entityType: "job_type", entityId: row.id, before: prev ?? null, after: input });
    return { id: row.id };
  },
});

/** Minimum fields only (CLAUDE.md §5). Capabilities default from the job type and can be overridden. */
export const createJob = defineCommand({
  name: "jobs.create",
  permission: "jobs.create",
  input: z.object({
    customerId: uuid,
    jobTypeId: uuid,
    name: z.string().trim().min(1),
    startDate: isoDate,
    responsibleUserId: uuid,
    description: z.string().nullish(),
    projectId: uuid.nullish(),
    contractId: uuid.nullish(),
    branchId: uuid.nullish(),
    capabilities: capabilityList.optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    await assertPartnerRole(tx, actor.companyId, input.customerId, "customer");
    const [type] = await tx.select().from(jobTypes).where(and(eq(jobTypes.id, input.jobTypeId), eq(jobTypes.companyId, actor.companyId)));
    if (!type) throw new NotFound("job_type", input.jobTypeId);
    const [resp] = await tx.select().from(users).where(and(eq(users.id, input.responsibleUserId), eq(users.companyId, actor.companyId)));
    if (!resp?.active) throw new ValidationError("Responsible person must be an active user");
    if (input.projectId) {
      const [p] = await tx.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.companyId, actor.companyId)));
      if (!p) throw new NotFound("project", input.projectId);
      if (p.customerId !== input.customerId) throw new ValidationError("Project belongs to a different customer");
      if (p.status !== "open") throw new ValidationError("Project is closed");
    }
    if (input.contractId) await assertContractFor(tx, actor.companyId, input.contractId, input.customerId);

    const jobNo = await nextNumber(tx, actor.companyId, "JOB", Number(input.startDate.slice(0, 4)));
    const capabilities = input.capabilities ?? (type.defaultCapabilities as Capability[]);
    const [row] = await tx
      .insert(jobs)
      .values({ ...input, capabilities, jobNo, branchId: input.branchId ?? actor.branchId, companyId: actor.companyId, createdBy: actor.userId })
      .returning();
    await audit({ action: "jobs.create", entityType: "job", entityId: row.id, after: { jobNo, ...input, capabilities } });
    return { id: row.id, jobNo };
  },
});

export async function getJob(tx: Db, companyId: string, jobId: string): Promise<Job> {
  const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.companyId, companyId)));
  if (!job) throw new NotFound("job", jobId);
  return job;
}

const LOCKED: JobStatus[] = ["financially_closed", "cancelled"];

export const setJobCapabilities = defineCommand({
  name: "jobs.set_capabilities",
  permission: "jobs.manage",
  input: z.object({ jobId: uuid, capabilities: capabilityList, reason: z.string().optional() }),
  async handler({ tx, actor, audit }, { jobId, capabilities, reason }) {
    const job = await getJob(tx, actor.companyId, jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    const removed = (job.capabilities as Capability[]).filter((c) => !capabilities.includes(c));
    for (const c of removed) {
      if (await capabilityModule(c)?.inUse(tx, job))
        throw new Conflict(`Cannot remove "${c}": the job already has ${c} records`, { capability: c });
    }
    await tx.update(jobs).set({ capabilities }).where(eq(jobs.id, jobId));
    await audit({ action: "jobs.set_capabilities", entityType: "job", entityId: jobId, before: { capabilities: job.capabilities }, after: { capabilities }, reason });
    return { jobId, capabilities };
  },
});

/** Allowed manual transitions. Completion and financial close are additionally gated by blockers. */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["in_progress", "pending", "completed", "cancelled"],
  in_progress: ["pending", "completed", "cancelled"],
  pending: ["in_progress", "completed", "cancelled"],
  completed: ["in_progress", "financially_closed"],
  financially_closed: [],
  cancelled: [],
};

export async function jobBlockers(tx: Db, job: Job): Promise<Blocker[]> {
  const out: Blocker[] = [];
  for (const m of modulesFor(job)) out.push(...(await m.blockers(tx, job)));
  return out;
}

export const changeJobStatus = defineCommand({
  name: "jobs.change_status",
  permission: "jobs.manage",
  input: z.object({ jobId: uuid, status: z.enum(["open", "in_progress", "pending", "completed", "financially_closed", "cancelled"]), reason: z.string().optional() }),
  async handler({ tx, actor, audit }, { jobId, status, reason }) {
    if (status === "financially_closed") requirePermission(actor, "jobs.financial_close");
    const job = await getJob(tx, actor.companyId, jobId);
    if (!TRANSITIONS[job.status].includes(status))
      throw new ValidationError(`Cannot change job from ${job.status} to ${status}`);
    // Cancelling and reopening a completed job need a reason.
    if ((status === "cancelled" || (job.status === "completed" && status === "in_progress")) && !reason)
      throw new ValidationError("A reason is required");
    if (status === "completed" || status === "financially_closed") {
      const blocking = (await jobBlockers(tx, job)).filter(
        (b) => b.blocks === "completed" || status === "financially_closed",
      );
      if (blocking.length)
        throw new ValidationError(`Job cannot be ${status.replace("_", " ")} yet`, { blockers: blocking });
    }
    if (status === "cancelled") {
      for (const c of job.capabilities as Capability[])
        if (await capabilityModule(c)?.inUse(tx, job))
          throw new Conflict(`Job has ${c} records; cancel or reverse them first`, { capability: c });
    }
    await tx.update(jobs).set({ status }).where(eq(jobs.id, jobId));
    await audit({ action: "jobs.change_status", entityType: "job", entityId: jobId, before: { status: job.status }, after: { status }, reason });
    return { jobId, status };
  },
});

export interface NextAction {
  code: string;
  params: Record<string, string>;
  /** English fallback. */
  text: string;
}

/** The single most useful thing to tell a user about an active job (translatable). */
export async function nextActionInfo(tx: Db, job: Job): Promise<NextAction | null> {
  if (LOCKED.includes(job.status)) return null;
  const blockers = await jobBlockers(tx, job);
  if (blockers.length) return { code: blockers[0].code, params: blockers[0].params ?? {}, text: blockers[0].action };
  if (job.status === "completed") return { code: "job.ready_to_close", params: {}, text: "Ready to close financially" };
  return job.status === "draft"
    ? { code: "job.open_it", params: {}, text: "Open the job" }
    : { code: "job.ready_to_complete", params: {}, text: "Ready to complete" };
}

/** English text of the next action. */
export async function nextAction(tx: Db, job: Job): Promise<string | null> {
  return (await nextActionInfo(tx, job))?.text ?? null;
}
