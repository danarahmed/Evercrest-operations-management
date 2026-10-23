import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, documents } from "@/db/schema";
import { attachDocumentFile, defineDocumentType, recordDocument } from "@/domain/documents/documents";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  const type = (await run(defineJobType, { code: "GEN", name: "General", defaultCapabilities: ["documents"] })).id;
  ids.job = (await run(createJob, { customerId: customer, jobTypeId: type, name: "Job", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  ids.type = (await run(defineDocumentType, { code: "CERT", name: "Certificate" })).id;
});
afterAll(async () => env.close());

describe("scanned copies of documents", () => {
  it("records a document with its stored file, and attaching a replacement is audited", async () => {
    const key = `${env.companyId}/a.pdf`;
    const d = await run(recordDocument, { documentTypeId: ids.type, entityType: "job", entityId: ids.job, fileKey: key, fileName: "cert.pdf" });
    await run(attachDocumentFile, { documentId: d.id, fileKey: `${env.companyId}/b.pdf`, fileName: "cert-v2.pdf" });
    const [row] = await env.db.select().from(documents).where(eq(documents.id, d.id));
    expect([row.fileKey, row.fileName]).toEqual([`${env.companyId}/b.pdf`, "cert-v2.pdf"]);
    const [ev] = await env.db.select().from(auditEvents).where(eq(auditEvents.action, "documents.attach_file"));
    expect(ev.before).toEqual({ fileKey: key, fileName: "cert.pdf" });
  });

  it("refuses a file that belongs to another company's folder", async () => {
    await expect(run(recordDocument, { documentTypeId: ids.type, entityType: "job", entityId: ids.job, fileKey: "other-company/x.pdf", fileName: "x.pdf" })).rejects.toMatchObject({ code: "validation" });
    const d = await run(recordDocument, { documentTypeId: ids.type, entityType: "job", entityId: ids.job });
    await expect(run(attachDocumentFile, { documentId: d.id, fileKey: "other-company/x.pdf", fileName: "x.pdf" })).rejects.toMatchObject({ code: "validation" });
  });
});
