import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, users } from "@/db/schema";
import { createUser, setUserActive } from "@/domain/org/commands";
import { loadActor } from "@/server/actor";
import { runCommand } from "@/server/command";
import { linkAuthIdentity } from "@/server/identity";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  env = await freshDb();
});
afterAll(async () => env.close());

describe("Supabase sign-in identity", () => {
  it("links the first sign-in to the invited ERP user by e-mail, once, with an audit entry", async () => {
    const u = await runCommand(env.db, env.admin, createUser, { email: "Sara@Evercrest.co", displayName: "Sara" });
    expect(await linkAuthIdentity(env.db, "auth-sara", "sara@evercrest.co")).toBe(u.id);
    const [row] = await env.db.select().from(users).where(eq(users.id, u.id));
    expect(row.authUserId).toBe("auth-sara");
    const events = await env.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.link_identity"));
    expect(events).toHaveLength(1);
    // Later sign-ins use the stored link, even if the e-mail in Supabase changes
    expect(await linkAuthIdentity(env.db, "auth-sara", "new-address@elsewhere.com")).toBe(u.id);
  });

  it("an identity can never take over a user already linked to someone else", async () => {
    expect(await linkAuthIdentity(env.db, "auth-intruder", "sara@evercrest.co")).toBeNull();
  });

  it("a person who was never added in Users & roles has no access", async () => {
    expect(await linkAuthIdentity(env.db, "auth-stranger", "stranger@gmail.com")).toBeNull();
    expect(await linkAuthIdentity(env.db, "auth-noemail", null)).toBeNull();
  });

  it("a deactivated user is refused even with a valid sign-in", async () => {
    const u = await runCommand(env.db, env.admin, createUser, { email: "old@evercrest.co", displayName: "Old" });
    const id = await linkAuthIdentity(env.db, "auth-old", "old@evercrest.co");
    await runCommand(env.db, env.admin, setUserActive, { userId: u.id, active: false, reason: "left the company" });
    await expect(loadActor(env.db, id!)).rejects.toBeTruthy();
  });
});
