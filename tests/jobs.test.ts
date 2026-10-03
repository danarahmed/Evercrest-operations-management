import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerCapabilityModule } from "@/domain/jobs/capabilities";
import {
  changeJobStatus,
  createContract,
  createJob,
  createProject,
  defineJobType,
  getJob,
  nextAction,
  setJobCapabilities,
} from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = (cmd: Parameters<typeof runCommand>[2], input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<{ id: string; jobNo?: string }>;

// A stand-in specialized module: "approvals" blocks completion while a flag is set.
let approvalPending = true;
let approvalRecords = false;
registerCapabilityModule({
  capability: "approvals",
  blockers: async () => (approvalPending ? [{ code: "approval.pending", action: "Waiting for customer approval", blocks: "completed" }] : []),
  inUse: async () => approvalRecords,
});

beforeAll(async () => {
  env = await freshDb();
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil Co", roles: ["customer"] })).id;
  ids.otherCustomer = (await run(createPartner, { kind: "organization", name: "Gulf Fields", roles: ["customer"] })).id;
  ids.driver = (await run(createPartner, { kind: "person", name: "Ahmed", roles: ["driver"] })).id;
  ids.general = (await run(defineJobType, { code: "GEN", name: "General service", defaultCapabilities: [] })).id;
  ids.transport = (await run(defineJobType, { code: "PTR", name: "Petroleum transportation", defaultCapabilities: ["transportation", "advances", "documents", "billing"] })).id;
});
afterAll(async () => env.close());

const baseJob = () => ({ customerId: ids.customer, name: "Supply 20 generators", startDate: "2026-10-01", responsibleUserId: env.admin.userId });

describe("job creation", () => {
  it("creates a simple job with minimum fields and a yearly number (scenario A)", async () => {
    const a = await run(createJob, { ...baseJob(), jobTypeId: ids.general });
    const b = await run(createJob, { ...baseJob(), jobTypeId: ids.general });
    expect(a.jobNo).toBe("JOB-2026-00001");
    expect(b.jobNo).toBe("JOB-2026-00002");
    const job = await getJob(env.db, env.companyId, a.id);
    expect(job.capabilities).toEqual([]);
    expect(job.status).toBe("open");
  });

  it("takes default capabilities from the job type, and allows overriding them", async () => {
    const t = await run(createJob, { ...baseJob(), jobTypeId: ids.transport });
    expect((await getJob(env.db, env.companyId, t.id)).capabilities).toEqual(["advances", "billing", "documents", "transportation"]);
    const f = await run(createJob, { ...baseJob(), jobTypeId: ids.transport, capabilities: ["transportation", "products"] });
    expect((await getJob(env.db, env.companyId, f.id)).capabilities).toEqual(["products", "transportation"]);
  });

  it("requires the customer to be a customer and the project to belong to them", async () => {
    await expect(run(createJob, { ...baseJob(), customerId: ids.driver, jobTypeId: ids.general })).rejects.toThrow(/not marked as a customer/);
    const project = await run(createProject, { customerId: ids.otherCustomer, code: "P1", name: "Field X" });
    await expect(run(createJob, { ...baseJob(), jobTypeId: ids.general, projectId: project.id })).rejects.toThrow(/different customer/);
  });

  it("supports optional contract and project layers", async () => {
    const c = await run(createContract, { partnerId: ids.customer, reference: "C-2026-01", title: "Fuel transport 2026", status: "active" });
    const p = await run(createProject, { customerId: ids.customer, contractId: c.id, code: "P2", name: "Field Y" });
    await expect(run(createJob, { ...baseJob(), jobTypeId: ids.general, contractId: c.id, projectId: p.id })).resolves.toBeTruthy();
  });
});

describe("lifecycle, blockers and next action", () => {
  it("blocks completion while a capability reports a blocker, and shows it as the next action", async () => {
    const j = await run(createJob, { ...baseJob(), jobTypeId: ids.general, capabilities: ["approvals"] });
    const job = await getJob(env.db, env.companyId, j.id);
    expect(await nextAction(env.db, job)).toBe("Waiting for customer approval");
    await expect(run(changeJobStatus, { jobId: j.id, status: "completed" })).rejects.toMatchObject({
      code: "validation",
      details: { blockers: [{ code: "approval.pending" }] },
    });
    approvalPending = false;
    await run(changeJobStatus, { jobId: j.id, status: "completed" });
    await run(changeJobStatus, { jobId: j.id, status: "financially_closed" });
    await expect(run(changeJobStatus, { jobId: j.id, status: "in_progress", reason: "x" })).rejects.toThrow(/Cannot change job/);
    approvalPending = true;
  });

  it("needs the financial-close permission to close", async () => {
    const j = await run(createJob, { ...baseJob(), jobTypeId: ids.general });
    await run(changeJobStatus, { jobId: j.id, status: "completed" });
    const ops = { ...env.admin, permissions: new Set(["jobs.manage"]) };
    await expect(runCommand(env.db, ops, changeJobStatus, { jobId: j.id, status: "financially_closed" })).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("requires a reason to cancel, and refuses to cancel or drop a capability that has records", async () => {
    const j = await run(createJob, { ...baseJob(), jobTypeId: ids.general, capabilities: ["approvals"] });
    await expect(run(changeJobStatus, { jobId: j.id, status: "cancelled" })).rejects.toThrow(/reason/);
    approvalRecords = true;
    await expect(run(setJobCapabilities, { jobId: j.id, capabilities: [] })).rejects.toMatchObject({ code: "conflict" });
    await expect(run(changeJobStatus, { jobId: j.id, status: "cancelled", reason: "customer withdrew" })).rejects.toMatchObject({ code: "conflict" });
    approvalRecords = false;
    await run(setJobCapabilities, { jobId: j.id, capabilities: ["expenses"] });
    await run(changeJobStatus, { jobId: j.id, status: "cancelled", reason: "customer withdrew" });
  });
});
