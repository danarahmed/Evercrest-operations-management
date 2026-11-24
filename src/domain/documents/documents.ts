import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { approvalRequests, documentRequirements, documents, documentTypes, documentWaivers, trips } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { ApprovalRequired, Conflict, NotFound, ValidationError } from "@/server/errors";
import { registerApprovable } from "../approvals/approvals";
import { type Blocker, type Job, registerCapabilityModule } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { nextCode } from "../sequences";
import { getTrip } from "../transport/trips";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const defineDocumentType = defineCommand({
  name: "documents.define_type",
  permission: "documents.configure",
  /** No code: a new type with the next DT-001; with a code: create or rename that type. */
  input: z.object({ code: z.string().trim().min(1).optional(), name: z.string().trim().min(1) }),
  async handler({ tx, actor, audit }, given) {
    const taken = async (c: string) => (await tx.select({ id: documentTypes.id }).from(documentTypes).where(and(eq(documentTypes.companyId, actor.companyId), eq(documentTypes.code, c)))).length > 0;
    const input = { ...given, code: given.code ?? (await nextCode(tx, actor.companyId, "DT", 3, taken)) };
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
    if (input.fileKey && !input.fileKey.startsWith(`${actor.companyId}/`)) throw new ValidationError("Invalid file");
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

export type RequirementState = "verified" | "awaiting_verification" | "waived" | "rejected" | "expired" | "missing";
/** Received (even before it is checked), verified, or excused with approval: the paper no longer holds anything back. */
export const PAPER_SATISFIED: readonly RequirementState[] = ["verified", "awaiting_verification", "waived"];

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
  const waived = await tx.select().from(documentWaivers).where(eq(documentWaivers.jobId, job.id));

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
      const excused = waived.some((w) => w.documentTypeId === m.typeId && w.entityType === target.type && w.entityId === target.id);
      const state: RequirementState = mine.some((d) => d.status === "verified" && valid(d))
        ? "verified"
        : excused
          ? "waived"
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

const ACTION: Record<Exclude<RequirementState, "verified" | "waived">, string> = {
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
      // A received paper (even before it is checked) and an approved "paper not coming" no longer hold the job back.
      .filter((c) => !PAPER_SATISFIED.includes(c.state))
      .map((c) => ({
        code: `documents.${c.state}`,
        action: `${ACTION[c.state as Exclude<RequirementState, "verified" | "waived" | "awaiting_verification">]} ${c.documentType} for ${c.target.label}`,
        params: { doc: c.documentType, target: c.target.label },
        blocks: c.requiredBefore,
      }));
  },
  async inUse(tx: Db, job: Job) {
    const [d] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.jobId, job.id), inArray(documents.status, ["received", "verified"]))).limit(1);
    return !!d;
  },
});

/**
 * Attach (or replace) the scanned copy of a recorded document. The file itself
 * is already in storage; this records which file belongs to the document.
 * A replaced file is kept in storage, so the audit trail can still show it.
 */
export const attachDocumentFile = defineCommand({
  name: "documents.attach_file",
  permission: "documents.record",
  input: z.object({ documentId: uuid, fileKey: z.string().min(1), fileName: z.string().min(1) }),
  async handler({ tx, actor, audit }, input) {
    if (!input.fileKey.startsWith(`${actor.companyId}/`)) throw new ValidationError("Invalid file");
    const [doc] = await tx.select().from(documents).where(and(eq(documents.id, input.documentId), eq(documents.companyId, actor.companyId)));
    if (!doc) throw new NotFound("document", input.documentId);
    await tx.update(documents).set({ fileKey: input.fileKey, fileName: input.fileName }).where(eq(documents.id, doc.id));
    await audit({ action: "documents.attach_file", entityType: "document", entityId: doc.id, before: { fileKey: doc.fileKey, fileName: doc.fileName }, after: { fileKey: input.fileKey, fileName: input.fileName } });
    return { id: doc.id };
  },
});

/**
 * "Paper not coming": a required paper that will never arrive (lost manifest, a site that never sends it).
 * Always needs the owner's approval; once approved the requirement counts as met for claims, billing,
 * completion and financial close. The money is not touched.
 */
export const waiveDocument = defineCommand({
  name: "documents.waive",
  permission: "documents.record",
  input: z.object({ documentTypeId: uuid, entityType: z.enum(["job", "trip"]), entityId: uuid, reason: z.string().trim().min(3).max(500) }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const [type] = await tx.select().from(documentTypes).where(and(eq(documentTypes.id, input.documentTypeId), eq(documentTypes.companyId, actor.companyId)));
    if (!type) throw new NotFound("document_type", input.documentTypeId);
    let job: Job;
    let label: string;
    if (input.entityType === "trip") {
      const trip = await getTrip(tx, actor.companyId, input.entityId);
      job = await getJob(tx, actor.companyId, trip.jobId);
      label = trip.manifestNo ?? trip.tripNo;
    } else {
      job = await getJob(tx, actor.companyId, input.entityId);
      label = job.jobNo;
    }
    const check = (await documentChecklist(tx, job)).find((c) => c.documentTypeId === type.id && c.target.type === input.entityType && c.target.id === input.entityId);
    if (!check) throw new ValidationError(`${type.name} is not required for ${label}`);
    if (PAPER_SATISFIED.includes(check.state)) throw new Conflict(`${type.name} for ${label} is already there; nothing to excuse`);
    if (!ctx.approval) throw new ApprovalRequired(`${type.name} for ${label} will not come: this needs approval`, { paper: type.name, for: label, reason: input.reason });
    const [row] = await tx
      .insert(documentWaivers)
      .values({ companyId: actor.companyId, documentTypeId: type.id, entityType: input.entityType, entityId: input.entityId, jobId: job.id, reason: input.reason, requestedBy: actor.userId, approvedBy: ctx.approval.approvedBy })
      .returning();
    await audit({ action: "documents.waive", entityType: input.entityType, entityId: input.entityId, after: { waiverId: row.id, documentType: type.name, for: label }, reason: input.reason });
    return { id: row.id };
  },
});
registerApprovable(waiveDocument);

/** Papers with a "paper not coming" request still waiting in Approvals, keyed `${documentTypeId}:${entityId}`. */
export async function pendingPaperWaivers(db: Db, companyId: string): Promise<Set<string>> {
  const rows = await db
    .select({ type: sql<string>`${approvalRequests.input}->>'documentTypeId'`, entity: sql<string>`${approvalRequests.input}->>'entityId'` })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.command, "documents.waive"), eq(approvalRequests.status, "pending")));
  return new Set(rows.map((r) => `${r.type}:${r.entity}`));
}
