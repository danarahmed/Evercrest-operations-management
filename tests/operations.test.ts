import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "@/domain/accounting/ledger";
import { createInvoice, invoiceDetail } from "@/domain/finance/invoices";
import { createWorkOrder, setWorkOrderStatus } from "@/domain/field/work-orders";
import { changeJobStatus, createJob, defineJobType, getJob, nextActionInfo } from "@/domain/jobs/commands";
import { jobProfitReport } from "@/domain/management/reports";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { createPartner } from "@/domain/masterdata/partners";
import { billDeliveries, cancelDelivery, listDeliveries, recordDelivery } from "@/domain/supply/deliveries";
import { defineRate } from "@/domain/transport/rates";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
const job = async (type: string, name: string) => (await run(createJob, { customerId: ids.customer, jobTypeId: type, name, startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;

beforeAll(async () => {
  env = await freshDb();
  for (const [c, t] of [["1100", "asset"], ["2100", "liability"], ["4300", "income"], ["5100", "expense"], ["5900", "expense"]] as const)
    ids[c] = (await run(createAccount, { code: c, name: `A${c}`, type: t })).id;
  await run(setSetting, { key: "accounting.posting_accounts", reason: "setup", value: { customer_receivables: "1100", supplier_payables: "2100", product_sales: "4300", rounding_differences: "5900" } });
  await run(setSetting, { key: "rounding.final_increment", value: { IQD: "250" }, reason: "policy" });
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.contractor = (await run(createPartner, { kind: "organization", name: "Zagros Maintenance", roles: ["contractor"] })).id;
  ids.generator = (await run(createCatalogItem, { kind: "product", code: "GEN100", name: "Generator 100 kVA", defaultUnit: "EA" })).id;
  ids.field = (await run(defineJobType, { code: "FLD", name: "Field service", defaultCapabilities: ["field_work", "expenses", "billing"] })).id;
  ids.supply = (await run(defineJobType, { code: "SUP", name: "Product supply", defaultCapabilities: ["products", "expenses", "billing"] })).id;
  await run(defineRate, { rateType: "product_price", basis: "per_unit", amount: "4500", currency: "USD", unit: "EA", productId: ids.generator, effectiveFrom: "2026-01-01", reason: "price list" });
});
afterAll(async () => env.close());

describe("field service (scenario E: no truck, driver or MT)", () => {
  it("work orders gate completion; contractor bills count as job cost", async () => {
    const j = await job(ids.field, "Pump maintenance in Field Y");
    const wo = await run<{ id: string; workOrderNo: string }>(createWorkOrder, { jobId: j, site: "Field Y, well 7", description: "Replace pump seals", contractorId: ids.contractor, plannedDate: "2026-10-05" });
    expect(wo.workOrderNo).toMatch(/^WO-2026-/);
    expect(await nextActionInfo(env.db, await getJob(env.db, env.companyId, j))).toMatchObject({ code: "field.work_order_open" });
    await expect(run(changeJobStatus, { jobId: j, status: "completed" })).rejects.toThrow(/cannot be completed/);
    await expect(run(setWorkOrderStatus, { workOrderId: wo.id, status: "completed" })).rejects.toThrow(/completion date/);
    await run(setWorkOrderStatus, { workOrderId: wo.id, status: "completed", completedDate: "2026-10-06", note: "Seals replaced, pump tested" });
    await run(createInvoice, { kind: "bill", billFrom: "contractor", partnerId: ids.contractor, currency: "IQD", invoiceDate: "2026-10-06", lines: [{ description: "Labour WO", quantity: "1", unitPrice: "900000", accountId: ids["5100"], jobId: j }] });
    await expect(run(changeJobStatus, { jobId: j, status: "completed" })).resolves.toBeTruthy();
    const rows = await jobProfitReport(env.db, env.companyId, { from: "2026-01-01", to: "2026-12-31" });
    expect(rows.find((r) => r.jobId === j)).toMatchObject({ costs: "900000" });
  });
});

describe("product supply (scenario A: stays simple)", () => {
  it("records deliveries and invoices them at the configured price, never twice", async () => {
    const j = await job(ids.supply, "Supply 20 generators");
    const d1 = await run(recordDelivery, { jobId: j, productId: ids.generator, quantity: "12", unit: "EA", deliveryDate: "2026-10-03", reference: "DN-1" });
    const d2 = await run(recordDelivery, { jobId: j, productId: ids.generator, quantity: "8", unit: "EA", deliveryDate: "2026-10-04", reference: "DN-2" });
    await run(changeJobStatus, { jobId: j, status: "completed" });
    await expect(run(changeJobStatus, { jobId: j, status: "financially_closed" })).rejects.toMatchObject({ details: { blockers: [expect.objectContaining({ code: "supply.awaiting_billing" }), expect.anything()] } });
    const inv = await run<{ id: string; total: string }>(billDeliveries, { jobId: j, deliveryIds: [d1.id, d2.id], invoiceDate: "2026-10-05" });
    expect(inv.total).toBe("90000"); // 20 × 4,500 USD
    const detail = await invoiceDetail(env.db, env.companyId, inv.id);
    expect(detail.lines.map((l) => [l.line.quantity, l.line.unitPrice, l.line.amount])).toEqual([["12", "4500", "54000"], ["8", "4500", "36000"]]);
    await expect(run(billDeliveries, { jobId: j, deliveryIds: [d1.id], invoiceDate: "2026-10-05" })).rejects.toThrow(/Already invoiced/);
    await expect(run(cancelDelivery, { deliveryId: d1.id, reason: "x" })).rejects.toThrow(/invoiced/);
    expect((await listDeliveries(env.db, j)).every((d) => d.invoiced)).toBe(true);
    await expect(run(changeJobStatus, { jobId: j, status: "financially_closed" })).resolves.toBeTruthy();
  });

  it("asks for a price when no rule exists", async () => {
    const other = (await run(createCatalogItem, { kind: "product", code: "CBL", name: "Cable", defaultUnit: "EA" })).id;
    const j = await job(ids.supply, "Cables");
    const d = await run(recordDelivery, { jobId: j, productId: other, quantity: "3", unit: "EA", deliveryDate: "2026-10-03" });
    await expect(run(billDeliveries, { jobId: j, deliveryIds: [d.id], invoiceDate: "2026-10-05" })).rejects.toMatchObject({ details: { missing: [expect.stringMatching(/no price rule/)] } });
    const inv = await run<{ total: string }>(billDeliveries, { jobId: j, deliveryIds: [d.id], invoiceDate: "2026-10-05", currency: "IQD", unitPrice: "33400" });
    expect(inv.total).toBe("100250"); // 100,200 rounded to 250
  });
});
