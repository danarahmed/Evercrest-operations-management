import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { customFields, jobs } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, ValidationError } from "@/server/errors";
import { amountString, currencyCode } from "../currency";
import { dec, toStr } from "../money";
import { type Job, registerCapabilityModule } from "./capabilities";
import { getJob } from "./commands";

const uuid = z.string().uuid();
const LOCKED = ["financially_closed", "cancelled"];
const bool = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());

/** Create or change a custom field (matched by key). */
export const defineCustomField = defineCommand({
  name: "custom_fields.define",
  permission: "job_types.manage",
  input: z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "use lowercase letters, digits and _ (e.g. permit_no)"),
    label: z.string().trim().min(1),
    scope: z.enum(["all", "job_type", "customer"]),
    scopeId: uuid.nullish(),
    required: bool.default(false),
    requiredBefore: z.enum(["completed", "financially_closed"]).default("completed"),
    active: bool.default(true),
  }),
  async handler({ tx, actor, audit }, input) {
    const scopeId = input.scope === "all" ? null : input.scopeId;
    if (input.scope !== "all" && !scopeId) throw new ValidationError("Choose the job type or customer");
    const [prev] = await tx.select().from(customFields).where(and(eq(customFields.companyId, actor.companyId), eq(customFields.key, input.key)));
    const values = { ...input, scopeId: scopeId ?? null, companyId: actor.companyId };
    const [row] = await tx
      .insert(customFields)
      .values(values)
      .onConflictDoUpdate({ target: [customFields.companyId, customFields.key], set: { label: input.label, scope: input.scope, scopeId: scopeId ?? null, required: input.required, requiredBefore: input.requiredBefore, active: input.active } })
      .returning();
    await audit({ action: "custom_fields.define", entityType: "custom_field", entityId: row.id, before: prev ?? null, after: input });
    return { id: row.id };
  },
});

/** Active fields that apply to this job (all jobs, its job type, or its customer). */
export async function applicableFields(db: Db, job: Job) {
  return db
    .select()
    .from(customFields)
    .where(
      and(
        eq(customFields.companyId, job.companyId),
        eq(customFields.active, true),
        or(
          and(eq(customFields.scope, "all"), isNull(customFields.scopeId)),
          and(eq(customFields.scope, "job_type"), eq(customFields.scopeId, job.jobTypeId)),
          and(eq(customFields.scope, "customer"), eq(customFields.scopeId, job.customerId)),
        ),
      ),
    )
    .orderBy(customFields.label);
}

/** Fill in a job's extra information. Only fields that apply to the job are accepted; an empty value clears it. */
export const setJobCustomValues = defineCommand({
  name: "jobs.set_custom_values",
  permission: "jobs.manage",
  input: z.object({ jobId: uuid, values: z.record(z.string(), z.string()) }),
  async handler({ tx, actor, audit }, { jobId, values }) {
    const job = await getJob(tx, actor.companyId, jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    const keys = new Set((await applicableFields(tx, job)).map((f) => f.key));
    const unknown = Object.keys(values).filter((k) => !keys.has(k));
    if (unknown.length) throw new ValidationError(`Not a field of this job: ${unknown.join(", ")}`);
    const next: Record<string, string> = { ...(job.customValues as Record<string, string>) };
    for (const [k, v] of Object.entries(values)) {
      if (v.trim()) next[k] = v.trim();
      else delete next[k];
    }
    await tx.update(jobs).set({ customValues: next }).where(eq(jobs.id, jobId));
    await audit({ action: "jobs.set_custom_values", entityType: "job", entityId: jobId, before: job.customValues, after: next });
    return { jobId, values: next };
  },
});

/** Set or clear the job's cost budget (one currency). */
export const setJobBudget = defineCommand({
  name: "jobs.set_budget",
  permission: "jobs.manage",
  input: z.object({ jobId: uuid, amount: amountString.nullish(), currency: currencyCode.nullish(), reason: z.string().nullish() }),
  async handler({ tx, actor, audit }, { jobId, amount, currency, reason }) {
    const job = await getJob(tx, actor.companyId, jobId);
    if (LOCKED.includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    if (amount && !currency) throw new ValidationError("Choose the budget currency");
    if (amount && dec(amount).lt(0)) throw new ValidationError("Budget cannot be negative");
    const after = amount ? { budgetAmount: toStr(dec(amount)), budgetCurrency: currency! } : { budgetAmount: null, budgetCurrency: null };
    await tx.update(jobs).set(after).where(eq(jobs.id, jobId));
    await audit({ action: "jobs.set_budget", entityType: "job", entityId: jobId, before: { budgetAmount: job.budgetAmount, budgetCurrency: job.budgetCurrency }, after, reason: reason ?? undefined });
    return { jobId, ...after };
  },
});

// Required extra information must be filled in before the job can be completed (or closed).
registerCapabilityModule({
  capability: "core",
  alwaysCheck: true,
  async blockers(tx: Db, job: Job) {
    const values = job.customValues as Record<string, string>;
    return (await applicableFields(tx, job))
      .filter((f) => f.required && !values[f.key])
      .map((f) => ({ code: "job.custom_field_missing", action: `Fill in ${f.label}`, params: { field: f.label }, blocks: f.requiredBefore }));
  },
  async inUse() {
    return false;
  },
});
