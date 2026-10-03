import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineDocumentType, documentChecklist, recordDocument, reviewDocument, setDocumentRequirement } from "@/domain/documents/documents";
import { changeJobStatus, createJob, defineJobType, getJob, nextAction } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.other = (await run(createPartner, { kind: "organization", name: "Small Client", roles: ["customer"] })).id;
  ids.ptr = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation"] })).id;
  ids.gen = (await run(defineJobType, { code: "GEN", name: "General", defaultCapabilities: [] })).id;
  ids.manifest = (await run(defineDocumentType, { code: "MANIFEST", name: "Manifest" })).id;
  ids.cert = (await run(defineDocumentType, { code: "DELCERT", name: "Delivery certificate" })).id;
  // Every transport trip needs a manifest before completion; North Oil wants a delivery certificate before financial close.
  await run(setDocumentRequirement, { documentTypeId: ids.manifest, scope: "job_type", scopeId: ids.ptr, appliesTo: "trip", requiredBefore: "completed", active: true, reason: "policy" });
  await run(setDocumentRequirement, { documentTypeId: ids.cert, scope: "customer", scopeId: ids.customer, appliesTo: "job", requiredBefore: "financially_closed", active: true, reason: "contract term" });
});
afterAll(async () => env.close());

const job = (customerId: string, jobTypeId: string) =>
  run(createJob, { customerId, jobTypeId, name: "Job", startDate: "2026-10-01", responsibleUserId: env.admin.userId });

async function dischargedTrip(jobId: string, plate: string) {
  const t = await run<{ id: string; tripNo: string }>(createTrip, { jobId, newDriverName: `Driver ${plate}`, truckPlate: plate });
  await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-02", loadedQty: "30", loadedUnit: "MT" });
  await run(recordDischarge, { tripId: t.id, dischargeDate: "2026-10-03", dischargedQty: "30", dischargedUnit: "MT" });
  return t;
}

describe("document requirements", () => {
  it("a simple job for a customer with no requirements needs no documents (scenario A)", async () => {
    const j = await job(ids.other, ids.gen);
    expect(await documentChecklist(env.db, await getJob(env.db, env.companyId, j.id))).toEqual([]);
    await run(changeJobStatus, { jobId: j.id, status: "completed" });
  });

  it("requires a verified manifest per trip before completion, and drives the next action", async () => {
    const j = await job(ids.customer, ids.ptr);
    const t = await dischargedTrip(j.id, "D1");
    const load = () => getJob(env.db, env.companyId, j.id);
    expect(await nextAction(env.db, await load())).toBe(`Waiting for Manifest for ${t.tripNo}`);
    await expect(run(changeJobStatus, { jobId: j.id, status: "completed" })).rejects.toMatchObject({ code: "validation" });

    const d = await run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reference: "MF-1001" });
    expect(await nextAction(env.db, await load())).toBe(`Verify Manifest for ${t.tripNo}`);
    await run(reviewDocument, { documentId: d.id, decision: "verified" });
    // Manifest done → can complete, but the customer's certificate still blocks financial close
    await run(changeJobStatus, { jobId: j.id, status: "completed" });
    const closeBlockers = async () => {
      try {
        await run(changeJobStatus, { jobId: j.id, status: "financially_closed" });
        return [];
      } catch (e) {
        return ((e as { details?: { blockers?: { code: string }[] } }).details?.blockers ?? []).map((b) => b.code);
      }
    };
    expect(await closeBlockers()).toEqual(expect.arrayContaining(["documents.missing", "transport.awaiting_settlement"]));
    const c = await run(recordDocument, { documentTypeId: ids.cert, entityType: "job", entityId: j.id });
    await run(reviewDocument, { documentId: c.id, decision: "verified" });
    // The certificate no longer blocks; the trip still has to be settled (see settlement tests).
    expect(await closeBlockers()).toEqual(["transport.awaiting_settlement"]);
  });

  it("applies customer requirements even if the job did not enable documents", async () => {
    const j = await job(ids.customer, ids.gen);
    const checks = await documentChecklist(env.db, await getJob(env.db, env.companyId, j.id));
    expect(checks.map((c) => [c.documentType, c.state])).toEqual([["Delivery certificate", "missing"]]);
  });

  it("rejects duplicate manifest numbers, and a rejected document must be replaced", async () => {
    const j = await job(ids.customer, ids.ptr);
    const t = await dischargedTrip(j.id, "D2");
    await expect(run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reference: "MF-1001" })).rejects.toMatchObject({ code: "conflict" });
    const d = await run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reference: "MF-2002" });
    await expect(run(reviewDocument, { documentId: d.id, decision: "rejected" })).rejects.toThrow(/why/);
    await run(reviewDocument, { documentId: d.id, decision: "rejected", note: "illegible" });
    const checks = await documentChecklist(env.db, await getJob(env.db, env.companyId, j.id));
    expect(checks.find((c) => c.target.id === t.id)?.state).toBe("rejected");
    // A rejected reference may be re-submitted
    await expect(run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reference: "MF-2002" })).resolves.toBeTruthy();
  });

  it("treats an expired document as not valid", async () => {
    const j = await job(ids.customer, ids.gen);
    const c = await run(recordDocument, { documentTypeId: ids.cert, entityType: "job", entityId: j.id, issuedDate: "2026-01-01", expiryDate: "2026-06-30" });
    await run(reviewDocument, { documentId: c.id, decision: "verified" });
    const checks = await documentChecklist(env.db, await getJob(env.db, env.companyId, j.id), "2026-10-03");
    expect(checks[0].state).toBe("expired");
  });

  it("separates recording from verifying", async () => {
    const j = await job(ids.customer, ids.gen);
    const clerk = { ...env.admin, permissions: new Set(["documents.record"]) };
    const d = (await runCommand(env.db, clerk, recordDocument, { documentTypeId: ids.cert, entityType: "job", entityId: j.id })) as { id: string };
    await expect(runCommand(env.db, clerk, reviewDocument, { documentId: d.id, decision: "verified" })).rejects.toMatchObject({ code: "permission_denied" });
  });
});
