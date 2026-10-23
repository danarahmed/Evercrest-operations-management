import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, jobTypes, moneyAccounts, roles } from "@/db/schema";
import { getSetting } from "@/server/settings";
import { applyStarterConfiguration, STARTER_ACCOUNTS, STARTER_POSTING_ACCOUNTS } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  env = await freshDb();
});
afterAll(async () => env.close());

describe("starter configuration for a new company", () => {
  it("creates a complete, consistent setup through the normal commands", async () => {
    await applyStarterConfiguration(env.db, env.admin);
    expect(await env.db.select().from(accounts)).toHaveLength(STARTER_ACCOUNTS.length);
    // Every posting account points at an account that exists
    const codes = new Set(STARTER_ACCOUNTS.map((a) => a[0]));
    expect(Object.values(STARTER_POSTING_ACCOUNTS).every((c) => codes.has(c as never))).toBe(true);
    expect(await getSetting(env.db, env.companyId, "accounting.posting_accounts")).toEqual(STARTER_POSTING_ACCOUNTS);
    expect((await env.db.select().from(jobTypes)).map((j) => j.code).sort()).toEqual(["FLD", "GEN", "PTR", "SUP"]);
    expect((await env.db.select().from(moneyAccounts)).map((m) => m.currency).sort()).toEqual(["IQD", "USD"]);
    expect((await env.db.select().from(roles)).map((r) => r.code).sort()).toEqual(["accountant", "admin", "finance", "operations"]);
  });
});
