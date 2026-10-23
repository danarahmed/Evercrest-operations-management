import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companies } from "@/db/schema";
import { setupCompany } from "@/server/bootstrap";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  env = await freshDb();
});
afterAll(async () => env.close());

describe("first-run setup", () => {
  it("creates a company only while none exists", async () => {
    // freshDb already created one company, so a first-run setup must be refused.
    await expect(setupCompany(env.db, { companyName: "Second", adminEmail: "x@y.co", adminName: "X", onlyIfEmpty: true })).rejects.toMatchObject({ code: "conflict" });
    expect(await env.db.select().from(companies)).toHaveLength(1);
  });
});
