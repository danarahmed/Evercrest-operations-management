import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineDocumentType, recordDocument, reviewDocument, setDocumentRequirement } from "@/domain/documents/documents";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { documentLibrary, globalSearch } from "@/server/queries";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil Co", roles: ["customer"] })).id;
  ids.ptr = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation"] })).id;
  ids.manifest = (await run(defineDocumentType, { code: "MANIFEST", name: "Manifest" })).id;
  await run(setDocumentRequirement, { documentTypeId: ids.manifest, scope: "job_type", scopeId: ids.ptr, appliesTo: "trip", requiredBefore: "completed", active: true, reason: "policy" });
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.ptr, name: "Diesel to Field X", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  const t1 = await run<{ id: string; tripNo: string }>(createTrip, { jobId: ids.job, newDriverName: "Ahmed Karim", truckPlate: "12 B 34567" });
  const t2 = await run<{ id: string; tripNo: string }>(createTrip, { jobId: ids.job, newDriverName: "Karwan Ali", truckPlate: "21 A 99881" });
  ids.trip1 = t1.id;
  ids.trip1No = t1.tripNo;
  ids.trip2No = t2.tripNo;
  ids.doc = (await run(recordDocument, { documentTypeId: ids.manifest, entityType: "trip", entityId: t1.id, reference: "MF-7781" })).id;
});
afterAll(async () => env.close());

describe("document library", () => {
  it("lists held documents and the ones still missing on running jobs", async () => {
    const lib = await documentLibrary(env.db, env.admin, {});
    expect(lib.counts).toMatchObject({ all: 2, to_verify: 1, missing: 1, verified: 0 });
    expect(lib.documents.map((d) => [d.reference, d.target, d.customer])).toEqual([["MF-7781", ids.trip1No, "North Oil Co"]]);
    expect(lib.missing.map((m) => [m.type, m.target])).toEqual([["Manifest", ids.trip2No]]);
  });

  it("filters by status and by search text", async () => {
    expect((await documentLibrary(env.db, env.admin, { status: "missing" })).documents).toEqual([]);
    expect((await documentLibrary(env.db, env.admin, { status: "to_verify" })).missing).toEqual([]);
    const byRef = await documentLibrary(env.db, env.admin, { q: "mf-77" });
    expect(byRef.counts.all).toBe(1);
    await run(reviewDocument, { documentId: ids.doc, decision: "verified" });
    const after = await documentLibrary(env.db, env.admin, { status: "verified" });
    expect(after.documents.map((d) => d.reference)).toEqual(["MF-7781"]);
  });
});

describe("global search", () => {
  it("finds jobs, trips (by driver or plate), partners and documents", async () => {
    const r = (await globalSearch(env.db, env.admin, "north"))!;
    expect(r.jobs.map((j) => j.name)).toEqual(["Diesel to Field X"]);
    expect(r.partners.map((p) => p.name)).toEqual(["North Oil Co"]);
    expect((await globalSearch(env.db, env.admin, "karwan"))!.trips.map((t) => t.no)).toEqual([ids.trip2No]);
    expect((await globalSearch(env.db, env.admin, "34567"))!.trips.map((t) => t.no)).toEqual([ids.trip1No]);
    expect((await globalSearch(env.db, env.admin, "MF-7781"))!.documents.map((d) => d.reference)).toEqual(["MF-7781"]);
  });

  it("treats % and _ as plain characters and ignores one-letter searches", async () => {
    expect(await globalSearch(env.db, env.admin, "n")).toBeNull();
    const r = (await globalSearch(env.db, env.admin, "%%"))!;
    expect(r.jobs.length + r.partners.length + r.trips.length).toBe(0);
  });

  it("only searches what the user may see", async () => {
    const limited = { ...env.admin, permissions: new Set<string>(["jobs.view"]) } as typeof env.admin;
    const r = (await globalSearch(env.db, limited, "north"))!;
    expect(r.jobs.length).toBe(1);
    expect(r.partners).toEqual([]);
    expect(r.invoices).toEqual([]);
    const none = { ...env.admin, permissions: new Set<string>() } as typeof env.admin;
    await expect(documentLibrary(env.db, none, {})).rejects.toBeTruthy();
  });
});
