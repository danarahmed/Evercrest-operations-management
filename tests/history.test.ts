import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addActivity, setActivityStatus } from "@/domain/jobs/activities";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { auditLog, jobHistory, summarize } from "@/domain/management/history";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => { env = await freshDb(); });
afterAll(async () => env.close());

describe("job history", () => {
  it("collects the job's own events and those of its trips and steps, newest first", async () => {
    const customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
    const type = (await run(defineJobType, { code: "T", name: "Transport", defaultCapabilities: ["transportation"] })).id;
    const job = (await run(createJob, { customerId: customer, jobTypeId: type, name: "Fuel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
    await run(createTrip, { jobId: job, newDriverName: "Ahmed", truckPlate: "12 B 1" });
    const step = await run(addActivity, { jobId: job, title: "Collect manifest" });
    await run(setActivityStatus, { activityId: step.id, status: "done" });
    const h = await jobHistory(env.db, env.companyId, job);
    expect(h.map((x) => x.e.action)).toEqual(["activities.set_status", "activities.add", "trips.create", "jobs.create"]);
    expect(h.every((x) => x.by === "Admin")).toBe(true);
    expect(summarize({ title: "Collect manifest", jobId: "x", required: false })).toBe("title: Collect manifest · required: false");
    const all = await auditLog(env.db, env.companyId, { from: "2000-01-01", to: "2100-01-01", action: "activities" });
    expect(all.length).toBe(2);
  });
});
