import { and, eq, max } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { jobActivities, users } from "@/db/schema";
import { ACTIVITY_STATUSES } from "@/db/schema/jobs";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { type Job, registerCapabilityModule } from "./capabilities";
import { getJob } from "./commands";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LOCKED = ["financially_closed", "cancelled"];

/** Add a step to a job's checklist. */
export const addActivity = defineCommand({
  name: "activities.add",
  permission: "jobs.manage",
  input: z.object({
    jobId: uuid,
    title: z.string().trim().min(1),
    required: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()).default(false),
    assignedUserId: uuid.nullish(),
    dueDate: isoDate.nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    if (input.assignedUserId) {
      const [u] = await tx.select().from(users).where(and(eq(users.id, input.assignedUserId), eq(users.companyId, actor.companyId)));
      if (!u?.active) throw new ValidationError("Assign the step to an active user");
    }
    const [{ last }] = await tx.select({ last: max(jobActivities.position) }).from(jobActivities).where(eq(jobActivities.jobId, job.id));
    const [row] = await tx
      .insert(jobActivities)
      .values({ ...input, companyId: actor.companyId, position: (last ?? 0) + 1, createdBy: actor.userId })
      .returning();
    await audit({ action: "activities.add", entityType: "job_activity", entityId: row.id, after: { jobNo: job.jobNo, ...input } });
    return { id: row.id };
  },
});

/** Mark a step done, skipped (a required step needs a reason) or open again. */
export const setActivityStatus = defineCommand({
  name: "activities.set_status",
  permission: "jobs.manage",
  input: z.object({ activityId: uuid, status: z.enum(ACTIVITY_STATUSES), note: z.string().trim().nullish() }),
  async handler({ tx, actor, audit }, { activityId, status, note }) {
    const [a] = await tx.select().from(jobActivities).where(and(eq(jobActivities.id, activityId), eq(jobActivities.companyId, actor.companyId)));
    if (!a) throw new NotFound("job_activity", activityId);
    const job = await getJob(tx, actor.companyId, a.jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    if (status === "skipped" && a.required && !note) throw new ValidationError("Say why a required step is skipped");
    await tx
      .update(jobActivities)
      .set({ status, note: note ?? a.note, doneBy: status === "open" ? null : actor.userId, doneAt: status === "open" ? null : new Date() })
      .where(eq(jobActivities.id, activityId));
    await audit({ action: "activities.set_status", entityType: "job_activity", entityId: activityId, before: { status: a.status }, after: { status, note }, reason: note ?? undefined });
    return { id: activityId, status };
  },
});

export async function listActivities(db: Db, jobId: string) {
  return db
    .select({ a: jobActivities, assignee: users.displayName })
    .from(jobActivities)
    .leftJoin(users, eq(users.id, jobActivities.assignedUserId))
    .where(eq(jobActivities.jobId, jobId))
    .orderBy(jobActivities.position);
}

// Required steps that are still open stop the job from being completed.
registerCapabilityModule({
  capability: "core",
  alwaysCheck: true,
  async blockers(tx: Db, job: Job) {
    const open = await tx.select().from(jobActivities).where(and(eq(jobActivities.jobId, job.id), eq(jobActivities.status, "open"), eq(jobActivities.required, true))).orderBy(jobActivities.position);
    return open.map((a) => ({ code: "activity.required_open", action: `Finish step: ${a.title}`, params: { step: a.title }, blocks: "completed" as const }));
  },
  async inUse() {
    return false;
  },
});
