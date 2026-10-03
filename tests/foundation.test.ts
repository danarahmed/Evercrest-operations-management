import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents } from "@/db/schema";
import { findRate, recordExchangeRate } from "@/domain/currency";
import { convert, toStr } from "@/domain/money";
import type { Actor } from "@/server/authz";
import { runCommand } from "@/server/command";
import { getSetting, setSetting } from "@/server/settings";
import { dbRejects, freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => (env = await freshDb()));
afterAll(async () => env.close());

const noPerms = (a: Actor): Actor => ({ ...a, permissions: new Set() });

describe("money", () => {
  it("converts with an explicit rate and currency rounding, no float error", () => {
    expect(toStr(convert("100", "1310", 3))).toBe("131000");
    expect(toStr(convert("0.1", "0.2", 2))).toBe("0.02");
    expect(toStr(convert("150000", "0.000763359", 2))).toBe("114.5");
  });
});

describe("command runner", () => {
  it("rejects a user without the permission", async () => {
    await expect(
      runCommand(env.db, noPerms(env.admin), setSetting, { key: "ui.default_currency", value: "USD", reason: "x" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("rejects invalid input and unknown settings", async () => {
    await expect(
      runCommand(env.db, env.admin, setSetting, { key: "nope", value: 1, reason: "x" }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      runCommand(env.db, env.admin, setSetting, { key: "ui.default_currency", value: "EUR", reason: "x" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("stores and audits a setting change", async () => {
    await runCommand(env.db, env.admin, setSetting, { key: "ui.default_currency", value: "USD", reason: "setup" });
    await runCommand(env.db, env.admin, setSetting, { key: "ui.default_currency", value: "IQD", reason: "change" });
    expect(await getSetting(env.db, env.companyId, "ui.default_currency")).toBe("IQD");
    const events = await env.db.select().from(auditEvents).where(eq(auditEvents.action, "settings.set"));
    expect(events.map((e) => [e.before, e.after])).toEqual([[null, "USD"], ["USD", "IQD"]]);
  });

  it("is idempotent: a retry with the same key returns the original result and writes nothing twice", async () => {
    const input = { base: "USD", quote: "IQD", rate: "1310", effectiveAt: "2026-09-01T00:00:00Z" };
    const a = await runCommand(env.db, env.admin, recordExchangeRate, input, { idempotencyKey: "k1" });
    const b = await runCommand(env.db, env.admin, recordExchangeRate, input, { idempotencyKey: "k1" });
    expect(b).toEqual(a);
    const audits = await env.db.select().from(auditEvents).where(eq(auditEvents.action, "currency.record_rate"));
    expect(audits).toHaveLength(1);
  });

  it("rejects reuse of a key for a different request", async () => {
    const input = { base: "USD", quote: "IQD", rate: "1310", effectiveAt: "2026-09-02T00:00:00Z" };
    await runCommand(env.db, env.admin, recordExchangeRate, input, { idempotencyKey: "k2" });
    await expect(
      runCommand(env.db, env.admin, recordExchangeRate, { ...input, rate: "1320" }, { idempotencyKey: "k2" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("releases the key when the command fails, so a corrected retry succeeds", async () => {
    const bad = { base: "USD", quote: "USD", rate: "1", effectiveAt: "2026-09-03T00:00:00Z" };
    await expect(runCommand(env.db, env.admin, recordExchangeRate, bad, { idempotencyKey: "k3" })).rejects.toThrow();
    const good = { ...bad, quote: "IQD", rate: "1310" };
    await expect(runCommand(env.db, env.admin, recordExchangeRate, good, { idempotencyKey: "k3" })).resolves.toBeTruthy();
  });
});

describe("audit trail", () => {
  it("cannot be changed or deleted", async () => {
    expect(await dbRejects(env.db.execute(sql`update audit_events set action = 'x'`))).toMatch(/append-only/);
    expect(await dbRejects(env.db.execute(sql`delete from audit_events`))).toMatch(/append-only/);
  });
});

describe("exchange rates", () => {
  it("keeps history and returns the rate in force at a given time", async () => {
    const rec = (rate: string, at: string) =>
      runCommand(env.db, env.admin, recordExchangeRate, { base: "USD", quote: "IQD", rate, effectiveAt: at, rateType: "history-test" });
    await rec("1300", "2026-09-01T00:00:00Z");
    await rec("1320", "2026-09-10T00:00:00Z");
    const r = (at: string) => findRate(env.db, env.companyId, "USD", "IQD", new Date(at), "history-test");
    expect((await r("2026-09-05T12:00:00Z"))?.rate).toBe("1300.0000000000");
    expect((await r("2026-09-11T00:00:00Z"))?.rate).toBe("1320.0000000000");
    expect(await r("2026-08-01T00:00:00Z")).toBeUndefined();
    expect(await dbRejects(env.db.execute(sql`update exchange_rates set rate = 1`))).toMatch(/append-only/);
  });
});

