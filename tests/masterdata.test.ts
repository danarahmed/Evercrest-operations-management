import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents } from "@/db/schema";
import { convertQuantity, createCatalogItem } from "@/domain/masterdata/catalog";
import { createPartner, normalizeName, searchPartners, updatePartner } from "@/domain/masterdata/partners";
import { toStr } from "@/domain/money";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => (env = await freshDb()));
afterAll(async () => env.close());

describe("business partners", () => {
  it("creates a driver from only a name", async () => {
    const r = await runCommand(env.db, env.admin, createPartner, { kind: "person", name: "Ahmed Karim", roles: ["driver"] });
    expect(r.id).toBeTruthy();
  });

  it("one partner can hold several roles; role changes are audited", async () => {
    const p = await runCommand(env.db, env.admin, createPartner, { kind: "organization", name: "Zagros Transport", roles: ["transporter"] });
    await runCommand(env.db, env.admin, updatePartner, { partnerId: p.id, roles: ["transporter", "supplier"], phone: "0750 000 0000", reason: "also sells parts" });
    const found = await searchPartners(env.db, env.companyId, "zagros", "supplier");
    expect(found.map((f) => f.roles.sort())).toEqual([["supplier", "transporter"]]);
    const [ev] = await env.db.select().from(auditEvents).where(eq(auditEvents.action, "partners.update"));
    expect(ev.before).toEqual({ phone: null, roles: ["transporter"] });
  });

  it("finds existing partners despite Arabic/Kurdish letter variants", async () => {
    await runCommand(env.db, env.admin, createPartner, { kind: "person", name: "علي كريم", roles: ["driver"] });
    expect(normalizeName("علی کریم")).toBe(normalizeName("علي كريم"));
    expect(await searchPartners(env.db, env.companyId, "علی کریم", "driver")).toHaveLength(1);
  });
});

describe("units and catalog", () => {
  it("converts within a dimension and refuses volume to mass", async () => {
    expect(toStr(await convertQuantity(env.db, "250", "KG", "MT"))).toBe("0.25");
    expect(toStr(await convertQuantity(env.db, "2.5", "M3", "L"))).toBe("2500");
    await expect(convertQuantity(env.db, "1000", "L", "KG")).rejects.toThrow(/measured factor/);
  });

  it("creates products and services with unique codes", async () => {
    await runCommand(env.db, env.admin, createCatalogItem, { kind: "product", code: "DSL", name: "Diesel", defaultUnit: "L" });
    await runCommand(env.db, env.admin, createCatalogItem, { kind: "service", code: "TRN", name: "Fuel transport", defaultUnit: "MT" });
    await expect(
      runCommand(env.db, env.admin, createCatalogItem, { kind: "product", code: "DSL", name: "Dup" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
