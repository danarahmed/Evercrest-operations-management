import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "@/domain/accounting/ledger";
import { setDocumentRequirement, defineDocumentType, documentChecklist } from "@/domain/documents/documents";
import { createInvoice } from "@/domain/finance/invoices";
import { changeJobStatus, createJob, defineJobType, getJob } from "@/domain/jobs/commands";
import { defineCustomField, setJobBudget, setJobCustomValues } from "@/domain/jobs/custom-fields";
import { exceptions } from "@/domain/management/exceptions";
import { createPartner } from "@/domain/masterdata/partners";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
const job = async (customer: string, name: string) => (await run(createJob, { customerId: customer, jobTypeId: ids.type, name, startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;

beforeAll(async () => {
  env = await freshDb();
  for (const [c, t] of [["1100", "asset"], ["2100", "liability"], ["4000", "income"], ["5100", "expense"]] as const) ids[c] = (await run(createAccount, { code: c, name: c, type: t })).id;
  await run(setSetting, { key: "accounting.posting_accounts", reason: "setup", value: { customer_receivables: "1100", supplier_payables: "2100" } });
  ids.a = (await run(createPartner, { kind: "organization", name: "Customer A", roles: ["customer"] })).id;
  ids.b = (await run(createPartner, { kind: "organization", name: "Customer B", roles: ["customer"] })).id;
  ids.supplier = (await run(createPartner, { kind: "organization", name: "Supplier", roles: ["supplier"] })).id;
  ids.type = (await run(defineJobType, { code: "GEN", name: "General", defaultCapabilities: ["expenses", "billing", "documents"] })).id;
});
afterAll(async () => env.close());

describe("scenario G: a customer-specific document and field, by configuration only", () => {
  it("customer A needs a permit number and a delivery certificate; customer B needs neither", async () => {
    await run(defineCustomField, { key: "permit_no", label: "Field permit no.", scope: "customer", scopeId: ids.a, required: true });
    const cert = (await run(defineDocumentType, { code: "CERT", name: "Delivery certificate" })).id;
    await run(setDocumentRequirement, { documentTypeId: cert, scope: "customer", scopeId: ids.a, appliesTo: "job", requiredBefore: "completed", active: true, reason: "customer A contract" });

    const ja = await job(ids.a, "Work for A");
    const jb = await job(ids.b, "Work for B");
    await expect(run(changeJobStatus, { jobId: jb, status: "completed" })).resolves.toBeTruthy();
    await expect(run(changeJobStatus, { jobId: ja, status: "completed" })).rejects.toMatchObject({
      details: { blockers: expect.arrayContaining([expect.objectContaining({ code: "job.custom_field_missing" })]) },
    });
    expect((await documentChecklist(env.db, await getJob(env.db, env.companyId, ja))).map((d) => d.documentType)).toEqual(["Delivery certificate"]);
    await expect(run(setJobCustomValues, { jobId: jb, values: { permit_no: "X" } })).rejects.toThrow(/Not a field/);
    await run(setJobCustomValues, { jobId: ja, values: { permit_no: "FP-7781" } });
    expect((await getJob(env.db, env.companyId, ja)).customValues).toEqual({ permit_no: "FP-7781" });
  });
});

describe("budget and margin exceptions", () => {
  it("warns when costs exceed the budget and when a job loses money", async () => {
    const j = await job(ids.b, "Small job");
    await run(setJobBudget, { jobId: j, amount: "500000", currency: "IQD" });
    await run(createInvoice, { kind: "bill", billFrom: "supplier", partnerId: ids.supplier, currency: "IQD", invoiceDate: "2026-10-02", lines: [{ description: "Parts", quantity: "1", unitPrice: "700000", accountId: ids["5100"], jobId: j }] });
    await run(createInvoice, { kind: "sales", partnerId: ids.b, currency: "IQD", invoiceDate: "2026-10-03", lines: [{ description: "Service", quantity: "1", unitPrice: "600000", accountId: ids["4000"], jobId: j }] });
    const ex = await exceptions(env.db, env.companyId, "2026-10-04");
    expect(ex.find((e) => e.code === "job.over_budget")).toMatchObject({ params: { costs: "700000", budget: "500000", currency: "IQD" } });
    expect(ex.find((e) => e.code === "job.negative_margin")).toMatchObject({ params: { amount: "-100000" } });
  });
});
