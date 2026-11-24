import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, submitForApproval } from "@/domain/approvals/approvals";
import { documentChecklist, recordDocument, waiveDocument } from "@/domain/documents/documents";
import { createJob, getJob, jobBlockers } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { previewClaim } from "@/domain/transport/claims";
import { setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { loadActor } from "@/server/actor";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown, actor = env.admin) => runCommand(env.db, actor, cmd as never, input) as Promise<T>;
const trip = (manifest: string) =>
  run(saveTrip, { jobId: ids.job, manifestNo: manifest, loadingDate: "2026-10-10", loadedQty: "30", driverName: "Hemin", plate: "22 C 1", dischargeDate: "2026-10-12", dischargedQty: "30" });

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  ids.manifest = starter.documentTypes.manifest;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  // The starter's Petroleum transportation type requires a manifest on every trip before completion.
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: starter.jobTypes.ptr, name: "Diesel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  await run(setTerms, { jobId: ids.job, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", carrierPrice: "70" });
  const u = await run(createUser, { email: "owner@test.local", displayName: "Owner" });
  const role = await run(defineRole, { code: "owner2", name: "Owner", permissions: ["approvals.decide", "documents.record"], reason: "setup" });
  await run(assignRole, { userId: u.id, roleId: role.id, grant: true, reason: "setup" });
  ids.owner = u.id;
});
afterAll(async () => env.close());

const blockers = async () => jobBlockers(env.db, await getJob(env.db, env.companyId, ids.job));
const state = async (tripId: string) => (await documentChecklist(env.db, await getJob(env.db, env.companyId, ids.job))).find((c) => c.target.id === tripId)!.state;

describe("papers that hold work back", () => {
  it("a received paper no longer holds the job back, even before it is checked", async () => {
    const t = await trip("M-1");
    expect((await blockers()).some((b) => b.code === "documents.missing")).toBe(true);
    await run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reference: "M-1" });
    expect(await state(t.id)).toBe("awaiting_verification");
    expect((await blockers()).filter((b) => b.code.startsWith("documents."))).toEqual([]);
  });

  it("a paper that will never come is excused only with approval, then counts as complete everywhere", async () => {
    const t = await trip("M-2");
    // Without the manifest the trip cannot be claimed.
    let p = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: ["M-2"] });
    expect(p.lines[0].status).toBe("papers_missing");
    // Asking directly always needs approval.
    await expect(run(waiveDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reason: "manifest lost at the border" })).rejects.toMatchObject({ code: "approval_required" });
    const req = await run(submitForApproval, { command: "documents.waive", input: { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reason: "manifest lost at the border" }, summary: "Manifest M-2" });
    // Nobody approves their own request.
    await expect(run(decideApproval, { requestId: req.id, decision: "approve" })).rejects.toThrow();
    await run(decideApproval, { requestId: req.id, decision: "approve" }, await loadActor(env.db, ids.owner));
    expect(await state(t.id)).toBe("waived");
    expect((await blockers()).filter((b) => b.code.startsWith("documents."))).toEqual([]);
    p = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: ["M-2"] });
    expect(p.lines[0].status).toBe("ok");
    expect(p.lines[0].amount).toBe("2100"); // 30 × 70: the money does not change
  });

  it("refuses to excuse a paper that is already there or not required", async () => {
    const t = await trip("M-3");
    await run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reference: "M-3" });
    await expect(run(waiveDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t.id, reason: "x lost" })).rejects.toThrow(/already there/);
    await expect(run(waiveDocument, { documentTypeId: ids.manifest, entityType: "job", entityId: ids.job, reason: "not needed" })).rejects.toThrow(/not required/);
  });
});
