import { and, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { documentRequirements, documents, documentTypes, trips } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { type Blocker, type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { getTrip } from "../transport/trips";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const defineDocumentType = defineCommand({
  name: "documents.define_type",
  permission: "documents.configure",
  input: z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1) }),
  async handler({ tx, actor, audit }, input) {
    const [row] = await tx
      .insert(documentTypes)
      .values({ ...input, companyId: actor.companyId })
      .onConflictDoUpdate({ target: [documentTypes.companyId, documentTypes.code], set: { name: input.name } })
      .returning();
    await audit({ action: "documents.define_type", entityType: "document_type", entityId: row.id, after: input });
    return { id: row.id };
  },
});

export const setDocumentRequirement = defineCommand({
  name: "documents.set_requirement",
  permission: "documents.configure",
  input: z.object({
    documentTypeId: uuid,
    scope: z.enum(["job_type", "customer", "contract"]),
    scopeId: uuid,
    appliesTo: z.enum(["job", "trip"]),
    requiredBefore: z.enum(["completed", "financially_closed"]),
    active: z.boolean(),
    reason: z.string().min(1),
  }),
  async handler({ tx, actor, audit }, { active, reason, ...rule }) {
    const key = and(
      eq(documentRequirements.companyId, actor.companyId),
      eq(documentRequirements.documentTypeId, rule.documentTypeId),
      eq(documentRequirements.scope, rule.scope),
      eq(documentRequirements.scopeId, rule.scopeId),
      eq(documentRequirements.appliesTo, rule.appliesTo),
    );
    const [prev] = await tx.select().from(documentRequirements).where(key);
    if (active) {
      if (prev) await tx.update(documentRequirements).set({ requiredBefore: rule.requiredBefore }).where(key);
      else await tx.insert(documentRequirements).values({ ...rule, companyId: actor.companyId });
    } else if (prev) await tx.delete(documentRequirements).where(key);
    await audit({ action: "documents.set_requirement", entityType: "document_requirement", entityId: rule.documentTypeId, before: prev ?? null, after: active ? rule : null, reason });
    return { active };
  },
});

/** Register a document received for a job, trip or payment. */
export const recordDocument = defineCommand({
  name: "documents.record",
  permission: "documents.record",
  input: z.object({
    documentTypeId: uuid,
    entityType: z.enum(["job", "trip", "payment"]),
    entityId: uuid,
    reference: z.string().trim().nullish(),
    issuedDate: isoDate.nullish(),
    expiryDate: isoDate.nullish(),
    fileKey: z.string().nullish(),
    fileName: z.string().nullish(),
    notes: z.string().nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    const [type] = await tx.select().from(documentTypes).where(and(eq(documentTypes.id, input.documentTypeId), eq(documentTypes.companyId, actor.companyId)));
    if (!type) throw new NotFound("document_type", input.documentTypeId);
    let jobId: string | null = null;
    if (input.entityType === "job") jobId = (await getJob(tx, actor.companyId, input.entityId)).id;
    else if (input.entityType === "trip") jobId = (await getTrip(tx, actor.companyId, input.entityId)).jobId;
    if (input.expiryDate && input.issuedDate && input.expiryDate < input.issuedDate)
      throw new ValidationError("Expiry date cannot be before the issue date");
    if (input.reference) {
      // The same reference for the same document type is almost always a duplicate (e.g. one manifest used twice).
      const [dup] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.companyId, actor.companyId), eq(documents.documentTypeId, type.id), eq(documents.reference, input.reference), ne(documents.status, "rejected")));
      if (dup) throw new Conflict(`${type.name} ${input.reference} is already recorded`, { documentId: dup.id });
    }
    const [row] = await tx.insert(documents).values({ ...input, jobId, companyId: actor.companyId, receivedBy: actor.userId }).returning();
    await audit({ action: "documents.record", entityType: "document", entityId: row.id, after: { ...input, jobId } });
    return { id: row.id };
  },
});

export const reviewDocument = defineCommand({
  name: "documents.review",
  permission: "documents.verify",
  input: z.object({ documentId: uuid, decision: z.enum(["verified", "rejected"]), note: z.string().optional() }),
  async handler({ tx, actor, audit }, { documentId, decision, note }) {
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.companyId, actor.companyId)));
    if (!doc) throw new NotFound("document", documentId);
    if (doc.status !== "received") throw new Conflict(`Document is already ${doc.status}`);
    if (decision === "rejected" && !note) throw new ValidationError("Say why the document is rejected");
    await tx.update(documents).set({ status: decision, reviewedBy: actor.userId, reviewNote: note ?? null }).where(eq(documents.id, documentId));
    await audit({ action: "documents.review", entityType: "document", entityId: documentId, before: { status: doc.status }, after: { status: decision }, reason: note });
    return { documentId, status: decision };
  },
});

export type RequirementState = "verified" | "awaiting_verification" | "rejected" | "expired" | "missing";

export interface RequirementCheck {
  documentType: string;
  documentTypeId: string;
  target: { type: "job" | "trip"; id: string; label: string };
  requiredBefore: "completed" | "financially_closed";
  state: RequirementState;
}

/** Every applicable requirement for a job (and its live trips) with its current state. */
export async function documentChecklist(tx: Db, job: Job, today = new Date().toISOString().slice(0, 10)): Promise<RequirementCheck[]> {
  const scopes = [
    and(eq(documentRequirements.scope, "job_type"), eq(documentRequirements.scopeId, job.jobTypeId)),
    and(eq(documentRequirements.scope, "customer"), eq(documentRequirements.scopeId, job.customerId)),
    ...(job.contractId ? [and(eq(documentRequirements.scope, "contract"), eq(documentRequirements.scopeId, job.contractId))] : []),
  ];
  const reqs = await tx
    .select({ r: documentRequirements, typeName: documentTypes.name })
    .from(documentRequirements)
    .innerJoin(documentTypes, eq(documentTypes.id, documentRequirements.documentTypeId))
    .where(and(eq(documentRequirements.companyId, job.companyId), or(...scopes)));
  if (!reqs.length) return [];

  const jobTrips = await tx.select({ id: trips.id, tripNo: trips.tripNo }).from(trips).where(and(eq(trips.jobId, job.id), ne(trips.status, "cancelled")));
  const docs = await tx.select().from(documents).where(eq(documents.jobId, job.id));

  // Merge duplicate rules for the same (type, target): the strictest stage wins.
  const merged = new Map<string, { typeId: string; typeName: string; appliesTo: "job" | "trip"; before: "completed" | "financially_closed" }>();
  for (const { r, typeName } of reqs) {
    const k = `${r.documentTypeId}:${r.appliesTo}`;
    const prev = merged.get(k);
    const before = prev?.before === "completed" || r.requiredBefore === "completed" ? "completed" : "financially_closed";
    merged.set(k, { typeId: r.documentTypeId, typeName, appliesTo: r.appliesTo, before });
  }

  const out: RequirementCheck[] = [];
  for (const m of merged.values()) {
    const targets = m.appliesTo === "job" ? [{ type: "job" as const, id: job.id, label: job.jobNo }] : jobTrips.map((t) => ({ type: "trip" as const, id: t.id, label: t.tripNo }));
    for (const target of targets) {
      const mine = docs.filter((d) => d.documentTypeId === m.typeId && d.entityType === target.type && d.entityId === target.id);
      const valid = (d: (typeof mine)[number]) => !d.expiryDate || d.expiryDate >= today;
      const state: RequirementState = mine.some((d) => d.status === "verified" && valid(d))
        ? "verified"
        : mine.some((d) => d.status === "received" && valid(d))
          ? "awaiting_verification"
          : mine.some((d) => d.status !== "rejected" && !valid(d))
            ? "expired"
            : mine.some((d) => d.status === "rejected")
              ? "rejected"
              : "missing";
      out.push({ documentType: m.typeName, documentTypeId: m.typeId, target, requiredBefore: m.before, state });
    }
  }
  return out;
}

const ACTION: Record<Exclude<RequirementState, "verified">, string> = {
  missing: "Waiting for",
  awaiting_verification: "Verify",
  rejected: "Replace rejected",
  expired: "Replace expired",
};

registerCapabilityModule({
  capability: "documents",
  // Configured document requirements are controls: they apply even if the job did not enable "documents".
  alwaysCheck: true,
  async blockers(tx: Db, job: Job): Promise<Blocker[]> {
    return (await documentChecklist(tx, job))
      .filter((c) => c.state !== "verified")
      .map((c) => ({
        code: `documents.${c.state}`,
        action: `${ACTION[c.state as Exclude<RequirementState, "verified">]} ${c.documentType} for ${c.target.label}`,
        blocks: c.requiredBefore,
      }));
  },
  async inUse(tx: Db, job: Job) {
    const [d] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.jobId, job.id), inArray(documents.status, ["received", "verified"]))).limit(1);
    return !!d;
  },
});
