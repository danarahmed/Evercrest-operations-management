import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, postJournalEntry } from "@/domain/accounting/ledger";
import { createInvoice } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment } from "@/domain/finance/payments";
import { capabilityInUse } from "@/domain/jobs/capabilities";
import { createJob, defineJobType, getJob } from "@/domain/jobs/commands";
import { jobBreakdown, jobProfitReport, jobTransactions, monthlySummary, totalsByCurrency } from "@/domain/management/reports";
import { createPartner } from "@/domain/masterdata/partners";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  for (const [c, t, cur] of [["1011", "asset", "USD"], ["1012", "asset", "IQD"], ["1100", "asset"], ["2100", "liability"], ["3000", "equity"], ["4000", "income"], ["5200", "expense"], ["5300", "expense"]] as const)
    ids[c] = (await run(createAccount, { code: c, name: `A${c}`, type: t, currency: cur })).id;
  await run(setSetting, { key: "accounting.posting_accounts", reason: "setup", value: { customer_receivables: "1100", supplier_payables: "2100" } });
  ids.iqd = (await run(createMoneyAccount, { name: "Safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: ids["1012"] })).id;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.supplier = (await run(createPartner, { kind: "organization", name: "Kurd Supply", roles: ["supplier"] })).id;
  ids.type = (await run(defineJobType, { code: "GEN", name: "General service", defaultCapabilities: ["expenses", "billing"] })).id;
  await run(postJournalEntry, { entryDate: "2026-08-01", description: "capital", lines: [{ accountId: ids["1012"], currency: "IQD", debit: "10000000" }, { accountId: ids["3000"], currency: "IQD", credit: "10000000" }] });
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Generator supply", startDate: "2026-09-01", responsibleUserId: env.admin.userId })).id;
  // September: revenue 1,000,000 IQD and 500 USD; costs 150,000 paid + 250,000 on credit
  await run(createInvoice, { kind: "sales", partnerId: ids.customer, currency: "IQD", invoiceDate: "2026-09-20", lines: [{ description: "Service", quantity: "1", unitPrice: "1000000", accountId: ids["4000"], jobId: ids.job }] });
  await run(createInvoice, { kind: "sales", partnerId: ids.customer, currency: "USD", invoiceDate: "2026-09-21", lines: [{ description: "Parts", quantity: "1", unitPrice: "500", accountId: ids["4000"], jobId: ids.job }] });
  await run(recordPayment, { direction: "out", purpose: "expense", moneyAccountId: ids.iqd, amount: "150000", currency: "IQD", paymentDate: "2026-09-10", method: "cash", jobId: ids.job, counterAccountId: ids["5300"], notes: "Permit", partnerId: ids.supplier });
  await run(createInvoice, { kind: "bill", billFrom: "supplier", partnerId: ids.supplier, currency: "IQD", invoiceDate: "2026-10-02", lines: [{ description: "Tyres", quantity: "2", unitPrice: "125000", accountId: ids["5200"], jobId: ids.job }] });
});
afterAll(async () => env.close());

describe("job profitability report", () => {
  it("shows revenue, costs, profit and margin per job and currency, never mixing currencies", async () => {
    const rows = await jobProfitReport(env.db, env.companyId, { from: "2026-01-01", to: "2026-12-31" });
    expect(rows.map((r) => [r.currency, r.revenue, r.costs, r.profit, r.marginPct])).toEqual([
      ["IQD", "1000000", "400000", "600000", "60"],
      ["USD", "500", "0", "500", "100"],
    ]);
    expect(totalsByCurrency(rows).map((t) => t.currency)).toEqual(["IQD", "USD"]);
  });

  it("respects the period and the customer filter", async () => {
    const sept = await jobProfitReport(env.db, env.companyId, { from: "2026-09-01", to: "2026-09-30" });
    expect(sept.find((r) => r.currency === "IQD")).toMatchObject({ costs: "150000", profit: "850000" });
    const other = (await run(createPartner, { kind: "organization", name: "Other", roles: ["customer"] })).id;
    expect(await jobProfitReport(env.db, env.companyId, { from: "2026-01-01", to: "2026-12-31", customerId: other })).toEqual([]);
  });

  it("monthly summary splits by month and currency", async () => {
    const rows = await monthlySummary(env.db, env.companyId, "2026-01-01", "2026-12-31");
    expect(rows.map((r) => [r.month, r.currency, r.profit])).toEqual([["2026-10", "IQD", "-250000"], ["2026-09", "IQD", "850000"], ["2026-09", "USD", "500"]]);
  });
});

describe("job costs", () => {
  it("lists the job's expenses, bills and invoices and breaks costs down by account", async () => {
    const tx = await jobTransactions(env.db, ids.job);
    expect(tx.expenses).toMatchObject([{ amount: "150000", notes: "Permit", partner: "Kurd Supply" }]);
    expect(tx.bills).toMatchObject([{ amount: "250000" }]);
    expect(tx.invoices.map((i) => i.currency).sort()).toEqual(["IQD", "USD"]);
    const b = await jobBreakdown(env.db, ids.job);
    expect(b.filter((x) => x.type === "expense").map((x) => [x.code, x.amount])).toEqual([["5200", "250000"], ["5300", "150000"]]);
    expect(await capabilityInUse(env.db, "expenses", await getJob(env.db, env.companyId, ids.job))).toBe(true);
  });
});
