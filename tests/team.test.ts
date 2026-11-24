import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJob, defineJobType, setJobTeam } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createUser } from "@/domain/org/commands";
import { loadActor } from "@/server/actor";
import { runCommand } from "@/server/command";
import { jobsList, jobWorkspace } from "@/server/queries";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.type = (await run(defineJobType, { name: "General", defaultCapabilities: ["expenses"] })).id;
  ids.rekan = (await run(createUser, { email: "rekan@test.local", displayName: "Rekan" })).id;
  ids.shilan = (await run(createUser, { email: "shilan@test.local", displayName: "Shilan" })).id;
});
afterAll(async () => env.close());

describe("people on a job", () => {
  it("a job has a main responsible person and a team; My jobs finds it for both", async () => {
    const job = await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Supply", startDate: "2026-11-01", responsibleUserId: env.admin.userId, memberUserIds: [ids.rekan, env.admin.userId] });
    let w = await jobWorkspace(env.db, env.admin, job.id);
    expect(w.team.map((x) => x.name)).toEqual(["Rekan"]); // the responsible person is not repeated in the team
    const rekan = { ...(await loadActor(env.db, ids.rekan)), permissions: new Set(["jobs.view"]) };
    expect((await jobsList(env.db, rekan, { mine: true })).map((r) => r.job.id)).toEqual([job.id]);
    await run(setJobTeam, { jobId: job.id, responsibleUserId: ids.shilan, memberUserIds: [env.admin.userId] });
    w = await jobWorkspace(env.db, env.admin, job.id);
    expect(w.meta.responsible).toBe("Shilan");
    expect(w.team.map((x) => x.name)).not.toContain("Rekan");
    expect(await jobsList(env.db, rekan, { mine: true })).toHaveLength(0);
  });
});
