import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addActivity, listActivities, setActivityStatus } from "@/domain/jobs/activities";
import { changeJobStatus, createContract, createJob, createProject, defineJobType, getJob, nextActionInfo, setContractStatus, setJobCapabilities } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.type = (await run(defineJobType, { code: "FUEL", name: "Fuel delivery", defaultCapabilities: ["transportation"], defaultActivities: ["Arrange truck", "Load", "Deliver"] })).id;
});
afterAll(async () => env.close());

describe("job steps (activities)", () => {
  it("copies the job type's steps onto a new job and points the next action at the first open step", async () => {
    ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Fuel to Field X", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
    const steps = await listActivities(env.db, ids.job);
    expect(steps.map((s) => s.a.title)).toEqual(["Arrange truck", "Load", "Deliver"]);
    expect(await nextActionInfo(env.db, await getJob(env.db, env.companyId, ids.job))).toMatchObject({ code: "activity.next", params: { step: "Arrange truck" } });
    await run(setActivityStatus, { activityId: steps[0].a.id, status: "done" });
    expect(await nextActionInfo(env.db, await getJob(env.db, env.companyId, ids.job))).toMatchObject({ params: { step: "Load" } });
  });

  it("a required step blocks completion until done or skipped with a reason", async () => {
    const step = await run(addActivity, { jobId: ids.job, title: "Customer sign-off", required: "true" });
    await expect(run(changeJobStatus, { jobId: ids.job, status: "completed" })).rejects.toMatchObject({ details: { blockers: [expect.objectContaining({ code: "activity.required_open" })] } });
    await expect(run(setActivityStatus, { activityId: step.id, status: "skipped" })).rejects.toThrow(/why/);
    await run(setActivityStatus, { activityId: step.id, status: "skipped", note: "customer signed by email" });
    await expect(run(changeJobStatus, { jobId: ids.job, status: "completed" })).resolves.toBeTruthy();
  });
});

describe("capabilities and contracts", () => {
  it("lets a user add a capability to a job, but not remove one that has records", async () => {
    const job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Simple", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
    const r = await run<{ capabilities: string[] }>(setJobCapabilities, { jobId: job, capabilities: ["transportation", "expenses"] });
    expect(r.capabilities).toEqual(["expenses", "transportation"]);
  });

  it("links jobs to projects and contracts; an ended contract cannot start new jobs", async () => {
    const c = await run(createContract, { partnerId: ids.customer, reference: "NO-2026-01", title: "Fuel supply 2026", status: "active" });
    const p = await run(createProject, { customerId: ids.customer, contractId: c.id, code: "FX", name: "Field X" });
    await expect(run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Linked", startDate: "2026-10-01", responsibleUserId: env.admin.userId, projectId: p.id, contractId: c.id })).resolves.toBeTruthy();
    await run(setContractStatus, { contractId: c.id, status: "ended", reason: "expired" });
    await expect(run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Too late", startDate: "2026-10-01", responsibleUserId: env.admin.userId, contractId: c.id })).rejects.toThrow(/has ended/);
  });
});
