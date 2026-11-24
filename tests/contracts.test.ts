import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { contractFiles, contracts } from "@/db/schema";
import { attachContractFile, createContract, updateContract } from "@/domain/jobs/commands";
import { exceptions } from "@/domain/management/exceptions";
import { createPartner } from "@/domain/masterdata/partners";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
let customer = "";

beforeAll(async () => {
  env = await freshDb();
  customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
});
afterAll(async () => env.close());

describe("contracts", () => {
  it("keeps payment terms, notes and the signed files, and can be corrected", async () => {
    const c = await run(createContract, { partnerId: customer, reference: "NOC-1", title: "Haulage", status: "active", paymentTermsDays: "30", notes: "fuel surcharge agreed" });
    let [row] = await env.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(row).toMatchObject({ paymentTermsDays: 30, notes: "fuel surcharge agreed" });
    await run(updateContract, { contractId: c.id, title: "Haulage 2026", validFrom: "2026-01-01", validTo: "2026-12-31", paymentTermsDays: "" });
    [row] = await env.db.select().from(contracts).where(eq(contracts.id, c.id));
    expect(row).toMatchObject({ title: "Haulage 2026", paymentTermsDays: null, validTo: "2026-12-31" });
    await expect(run(updateContract, { contractId: c.id, title: "x", validFrom: "2026-05-01", validTo: "2026-01-01" })).rejects.toThrow(/end date/);
    await run(attachContractFile, { contractId: c.id, kind: "signed", fileKey: `${env.companyId}/a.pdf`, fileName: "signed.pdf" });
    await expect(run(attachContractFile, { contractId: c.id, fileKey: "other-company/a.pdf", fileName: "x.pdf" })).rejects.toThrow(/Invalid file/);
    expect(await env.db.select().from(contractFiles).where(eq(contractFiles.contractId, c.id))).toHaveLength(1);
  });

  it("warns a month before an active contract ends", async () => {
    await run(createContract, { partnerId: customer, reference: "NOC-2", title: "Short", status: "active", validFrom: "2026-01-01", validTo: "2026-11-30" });
    const list = await exceptions(env.db, env.companyId, "2026-11-10");
    expect(list.find((e) => e.code === "contract.ending" && e.params.contract === "NOC-2")).toBeTruthy();
    expect((await exceptions(env.db, env.companyId, "2026-10-01")).some((e) => e.params.contract === "NOC-2")).toBe(false);
  });
});
