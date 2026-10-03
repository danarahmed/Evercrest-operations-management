import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignRole, createBranch, createUser, defineRole, setUserActive } from "@/domain/org/commands";
import { loadActor } from "@/server/actor";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => (env = await freshDb()));
afterAll(async () => env.close());

describe("users, roles and branches", () => {
  it("grants branch-scoped permissions only in that branch", async () => {
    const run = <I, O>(cmd: Parameters<typeof runCommand<I, O>>[2], input: unknown) => runCommand(env.db, env.admin, cmd, input);
    const erbil = await run(createBranch, { code: "EBL", name: "Erbil" });
    const basra = await run(createBranch, { code: "BSR", name: "Basra" });
    const u = await run(createUser, { email: "Accountant@Test.local", displayName: "Accountant" });
    const role = await run(defineRole, { code: "accountant", name: "Accountant", permissions: ["journal.post"], reason: "setup" });
    await run(assignRole, { userId: u.id, roleId: role.id, branchId: erbil.id, grant: true, reason: "hired" });

    expect((await loadActor(env.db, u.id, erbil.id)).permissions.has("journal.post")).toBe(true);
    expect((await loadActor(env.db, u.id, basra.id)).permissions.has("journal.post")).toBe(false);
    expect((await loadActor(env.db, u.id)).permissions.has("journal.post")).toBe(false);

    await run(assignRole, { userId: u.id, roleId: role.id, branchId: erbil.id, grant: false, reason: "moved" });
    expect((await loadActor(env.db, u.id, erbil.id)).permissions.size).toBe(0);
  });

  it("prevents granting permissions the grantor does not hold", async () => {
    const limited = { ...env.admin, permissions: new Set(["roles.manage", "journal.post"]) };
    await expect(
      runCommand(env.db, limited, defineRole, { code: "x", name: "X", permissions: ["periods.manage"], reason: "r" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("blocks deactivated users and self-deactivation", async () => {
    const u = await runCommand(env.db, env.admin, createUser, { email: "leaver@test.local", displayName: "Leaver" });
    await runCommand(env.db, env.admin, setUserActive, { userId: u.id, active: false, reason: "left company" });
    await expect(loadActor(env.db, u.id)).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      runCommand(env.db, env.admin, setUserActive, { userId: env.admin.userId, active: false, reason: "x" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("rejects a duplicate branch code", async () => {
    await expect(runCommand(env.db, env.admin, createBranch, { code: "EBL", name: "Again" })).rejects.toMatchObject({ code: "conflict" });
  });
});
