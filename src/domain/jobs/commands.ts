import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, contractFiles, contracts, jobActivities, jobMembers, jobs, jobTypes, partnerRoles, projects, users } from "@/db/schema";
import { type JobStatus } from "@/db/schema/jobs";
import { requirePermission } from "@/server/authz";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { nextCode, nextNumber } from "../sequences";
import { type Blocker, CAPABILITIES, type Capability, capabilityInUse, type Job, modulesFor } from "./capabilities";

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

/** Optional whole number of days (empty = not agreed). */
const paymentDays = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(365).nullable()).optional();

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
    notes: z.string().trim().nullish(),
    paymentTermsDays: paymentDays,
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
  input: z.object({ customerId: uuid, contractId: uuid.nullish(), code: z.string().trim().min(1).optional(), name: z.string().trim().min(1) }),
  async handler({ tx, actor, audit }, input) {
    await assertPartnerRole(tx, actor.companyId, input.customerId, "customer");
    if (input.contractId) await assertContractFor(tx, actor.companyId, input.contractId, input.customerId);
    const taken = async (c: string) => (await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.companyId, actor.companyId), eq(projects.code, c)))).length > 0;
    const code = input.code ?? (await nextCode(tx, actor.companyId, "PRJ", 4, taken));
    const [row] = await tx.insert(projects).values({ ...input, code, companyId: actor.companyId }).returning();
    await audit({ action: "projects.create", entityType: "project", entityId: row.id, after: { ...input, code } });
    return { id: row.id };
  },
});

/** Correct a contract's title, dates, payment terms and notes. The customer and reference stay. */
export const updateContract = defineCommand({
  name: "contracts.update",
  permission: "contracts.manage",
  input: z.object({ contractId: uuid, title: z.string().trim().min(1), validFrom: isoDate.nullish(), validTo: isoDate.nullish(), notes: z.string().trim().nullish(), paymentTermsDays: paymentDays }),
  async handler({ tx, actor, audit }, { contractId, ...input }) {
    const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.companyId, actor.companyId)));
    if (!c) throw new NotFound("contract", contractId);
    if (input.validFrom && input.validTo && input.validTo < input.validFrom) throw new ValidationError("The end date cannot be before the start date");
    const next = { title: input.title, validFrom: input.validFrom ?? null, validTo: input.validTo ?? null, notes: input.notes || null, paymentTermsDays: input.paymentTermsDays ?? null };
    await tx.update(contracts).set(next).where(eq(contracts.id, contractId));
    await audit({ action: "contracts.update", entityType: "contract", entityId: contractId, before: { title: c.title, validFrom: c.validFrom, validTo: c.validTo, notes: c.notes, paymentTermsDays: c.paymentTermsDays }, after: next });
    return { id: contractId };
  },
});

/** Keep the signed contract (or an amendment) with the contract: the file is already in private storage. */
export const attachContractFile = defineCommand({
  name: "contracts.attach_file",
  permission: "contracts.manage",
  input: z.object({ contractId: uuid, kind: z.enum(["signed", "amendment", "other"]).default("signed"), note: z.string().trim().nullish(), fileKey: z.string().min(1), fileName: z.string().min(1) }),
  async handler({ tx, actor, audit }, input) {
    if (!input.fileKey.startsWith(`${actor.companyId}/`)) throw new ValidationError("Invalid file");
    const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, input.contractId), eq(contracts.companyId, actor.companyId)));
    if (!c) throw new NotFound("contract", input.contractId);
    const [row] = await tx.insert(contractFiles).values({ ...input, note: input.note || null, companyId: actor.companyId, uploadedBy: actor.userId }).returning();
    await audit({ action: "contracts.attach_file", entityType: "contract", entityId: c.id, after: { fileId: row.id, kind: input.kind, fileName: input.fileName } });
    return { id: row.id };
  },
});

/** Contracts move draft → active → ended; an ended contract cannot be used for new jobs. */
export const setContractStatus = defineCommand({
  name: "contracts.set_status",
  permission: "contracts.manage",
  input: z.object({ contractId: uuid, status: z.enum(["draft", "active", "ended"]), reason: z.string().trim().min(1) }),
  async handler({ tx, actor, audit }, { contractId, status, reason }) {
    const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.companyId, actor.companyId)));
    if (!c) throw new NotFound("contract", contractId);
    await tx.update(contracts).set({ status }).where(eq(contracts.id, contractId));
    await audit({ action: "contracts.set_status", entityType: "contract", entityId: contractId, before: { status: c.status }, after: { status }, reason });
    return { id: contractId, status };
  },
});

async function assertContractFor(tx: Db, companyId: string, contractId: string, partnerId: string) {
  const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.companyId, companyId)));
  if (!c) throw new NotFound("contract", contractId);
  if (c.partnerId !== partnerId) throw new ValidationError("Contract belongs to a different partner", { contractId });
  return c;
}

/** Create (no code: the next JT-001) or update (by code) a job type (template). Changing defaults never alters existing jobs. */
export const defineJobType = defineCommand({
  name: "job_types.define",
  permission: "job_types.manage",
  input: z.object({
    code: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    defaultCapabilities: capabilityList,
    /** Checklist steps copied onto new jobs of this type. */
    defaultActivities: z.array(z.string().trim()).transform((xs) => xs.filter(Boolean)).optional(),
  }),
  async handler({ tx, actor, audit }, given) {
    const taken = async (c: string) => (await tx.select({ id: jobTypes.id }).from(jobTypes).where(and(eq(jobTypes.companyId, actor.companyId), eq(jobTypes.code, c)))).length > 0;
    const input = { ...given, code: given.code ?? (await nextCode(tx, actor.companyId, "JT", 3, taken)) };
    const [prev] = await tx.select().from(jobTypes).where(and(eq(jobTypes.companyId, actor.companyId), eq(jobTypes.code, input.code)));
    const defaultActivities = input.defaultActivities ?? prev?.defaultActivities ?? [];
    const [row] = await tx
      .insert(jobTypes)
      .values({ ...input, defaultActivities, companyId: actor.companyId })
      .onConflictDoUpdate({ target: [jobTypes.companyId, jobTypes.code], set: { name: input.name, defaultCapabilities: input.defaultCapabilities, defaultActivities } })
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
    /** The people working on the job besides the main responsible person. */
    memberUserIds: z.array(uuid).optional(),
  }),
  async handler({ tx, actor, audit }, { memberUserIds, ...input }) {
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
    if (input.contractId) {
      const c = await assertContractFor(tx, actor.companyId, input.contractId, input.customerId);
      if (c.status === "ended") throw new ValidationError(`Contract ${c.reference} has ended`);
    }

    const jobNo = await nextNumber(tx, actor.companyId, "JOB", Number(input.startDate.slice(0, 4)));
    const capabilities = input.capabilities ?? (type.defaultCapabilities as Capability[]);
    const [row] = await tx
      .insert(jobs)
      .values({ ...input, capabilities, jobNo, branchId: input.branchId ?? actor.branchId, companyId: actor.companyId, createdBy: actor.userId })
      .returning();
    const steps = type.defaultActivities as string[];
    if (steps.length)
      await tx.insert(jobActivities).values(steps.map((title, i) => ({ companyId: actor.companyId, jobId: row.id, position: i + 1, title, createdBy: actor.userId })));
    const team = await checkTeam(tx, actor.companyId, input.responsibleUserId, memberUserIds ?? []);
    if (team.length) await tx.insert(jobMembers).values(team.map((userId) => ({ companyId: actor.companyId, jobId: row.id, userId, addedBy: actor.userId })));
    await audit({ action: "jobs.create", entityType: "job", entityId: row.id, after: { jobNo, ...input, capabilities, team } });
    return { id: row.id, jobNo };
  },
});

/** Active users of the company, without the main responsible person and without repeats. */
async function checkTeam(tx: Db, companyId: string, responsibleUserId: string, memberUserIds: string[]) {
  const wanted = [...new Set(memberUserIds)].filter((x) => x !== responsibleUserId);
  if (!wanted.length) return [];
  const found = await tx.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.companyId, companyId), inArray(users.id, wanted)));
  if (found.length !== wanted.length || found.some((u) => !u.active)) throw new ValidationError("Every team member must be an active user");
  return wanted;
}

/**
 * Who works on a job: the main responsible person and the team. Being on a job gives no rights;
 * what each person may do still comes from their role's permissions.
 */
export const setJobTeam = defineCommand({
  name: "jobs.set_team",
  permission: "jobs.manage",
  input: z.object({ jobId: uuid, responsibleUserId: uuid, memberUserIds: z.array(uuid).default([]) }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    const [resp] = await tx.select().from(users).where(and(eq(users.id, input.responsibleUserId), eq(users.companyId, actor.companyId)));
    if (!resp?.active) throw new ValidationError("Responsible person must be an active user");
    const team = await checkTeam(tx, actor.companyId, input.responsibleUserId, input.memberUserIds);
    const before = (await tx.select({ userId: jobMembers.userId }).from(jobMembers).where(eq(jobMembers.jobId, job.id))).map((r) => r.userId);
    await tx.update(jobs).set({ responsibleUserId: input.responsibleUserId }).where(eq(jobs.id, job.id));
    await tx.delete(jobMembers).where(eq(jobMembers.jobId, job.id));
    if (team.length) await tx.insert(jobMembers).values(team.map((userId) => ({ companyId: actor.companyId, jobId: job.id, userId, addedBy: actor.userId })));
    await audit({ action: "jobs.set_team", entityType: "job", entityId: job.id, before: { responsibleUserId: job.responsibleUserId, team: before }, after: { responsibleUserId: input.responsibleUserId, team } });
    return { id: job.id };
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
      if (await capabilityInUse(tx, c, job))
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
        if (await capabilityInUse(tx, c, job))
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
  // What stops completion comes before what only stops financial close.
  const blockers = (await jobBlockers(tx, job)).sort((a, b) => (a.blocks === b.blocks ? 0 : a.blocks === "completed" ? -1 : 1));
  if (blockers.length) return { code: blockers[0].code, params: blockers[0].params ?? {}, text: blockers[0].action };
  if (job.status === "completed") return { code: "job.ready_to_close", params: {}, text: "Ready to close financially" };
  // Nothing blocking: point to the next open step of the job's checklist, if any.
  const [step] = await tx
    .select({ title: jobActivities.title })
    .from(jobActivities)
    .where(and(eq(jobActivities.jobId, job.id), eq(jobActivities.status, "open")))
    .orderBy(asc(jobActivities.position))
    .limit(1);
  if (step && job.status !== "draft") return { code: "activity.next", params: { step: step.title }, text: `Next step: ${step.title}` };
  return job.status === "draft"
    ? { code: "job.open_it", params: {}, text: "Open the job" }
    : { code: "job.ready_to_complete", params: {}, text: "Ready to complete" };
}

/** English text of the next action. */
export async function nextAction(tx: Db, job: Job): Promise<string | null> {
  return (await nextActionInfo(tx, job))?.text ?? null;
}
