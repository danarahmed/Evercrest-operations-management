import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "@/domain/accounting/ledger";
import { defineDocumentType } from "@/domain/documents/documents";
import { createProject, defineJobType } from "@/domain/jobs/commands";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { createPartner } from "@/domain/masterdata/partners";
import { defineRole } from "@/domain/org/commands";
import { accounts, catalogItems, documentTypes, jobTypes, projects, roles } from "@/db/schema";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
const codeOf = async (table: typeof catalogItems | typeof jobTypes | typeof documentTypes | typeof projects | typeof roles | typeof accounts, id: string) =>
  (await env.db.select().from(table)).find((r) => r.id === id)!.code;

beforeAll(async () => {
  env = await freshDb();
  await applyStarterConfiguration(env.db, env.admin);
});
afterAll(async () => env.close());

describe("codes are given automatically when left empty", () => {
  it("numbers products and services separately and skips codes typed in by hand", async () => {
    await run(createCatalogItem, { kind: "product", code: "PRD-0002", name: "Typed by hand", defaultUnit: "MT" });
    const a = await run(createCatalogItem, { kind: "product", name: "Diesel", defaultUnit: "MT" });
    const b = await run(createCatalogItem, { kind: "product", name: "Gasoline", defaultUnit: "MT" });
    const s = await run(createCatalogItem, { kind: "service", name: "Crane hire" });
    expect(await codeOf(catalogItems, a.id)).toBe("PRD-0001");
    expect(await codeOf(catalogItems, b.id)).toBe("PRD-0003");
    expect(await codeOf(catalogItems, s.id)).toBe("SVC-0001");
  });

  it("gives job types, document types, projects and roles their own series", async () => {
    const jt = await run(defineJobType, { name: "Equipment rental", defaultCapabilities: ["expenses"] });
    const dt = await run(defineDocumentType, { name: "Delivery note" });
    const customer = await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] });
    const pr = await run(createProject, { customerId: customer.id, name: "Field X support" });
    const role = await run(defineRole, { name: "Dispatch", permissions: ["jobs.view"], reason: "test" });
    expect(await codeOf(jobTypes, jt.id)).toBe("JT-001");
    expect(await codeOf(documentTypes, dt.id)).toBe("DT-001");
    expect(await codeOf(projects, pr.id)).toBe("PRJ-0001");
    expect(await codeOf(roles, role.id)).toBe("ROLE-01");
  });

  it("still updates an existing job type when its code is given", async () => {
    const again = await run(defineJobType, { code: "JT-001", name: "Equipment rental (daily)", defaultCapabilities: ["expenses", "billing"] });
    expect(await codeOf(jobTypes, again.id)).toBe("JT-001");
    expect((await env.db.select().from(jobTypes)).filter((j) => j.code.startsWith("JT-"))).toHaveLength(1);
  });

  it("numbers accounts inside their type's range", async () => {
    // Starter chart: highest asset 1900, highest expense 5950, no equity above 3000
    const asset = await run(createAccount, { name: "Bank USD", type: "asset", currency: "USD" });
    const expense = await run(createAccount, { name: "Office rent", type: "expense" });
    const equity = await run(createAccount, { name: "Retained earnings", type: "equity" });
    expect(await codeOf(accounts, asset.id)).toBe("1910");
    expect(await codeOf(accounts, expense.id)).toBe("5960");
    expect(await codeOf(accounts, equity.id)).toBe("3010");
  });
});
