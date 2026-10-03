import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, postJournalEntry } from "@/domain/accounting/ledger";
import { balanceSheet, profitAndLoss } from "@/domain/accounting/statements";
import { submitForApproval } from "@/domain/approvals/approvals";
import { createInvoice } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment } from "@/domain/finance/payments";
import { changeJobStatus, createJob, defineJobType } from "@/domain/jobs/commands";
import { exceptions } from "@/domain/management/exceptions";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const acc = async (code: string, type: string, currency?: string) => (ids[code] = (await run(createAccount, { code, name: `Acct ${code}`, type, currency })).id);
  await acc("1011", "asset", "USD");
  await acc("1100", "asset");
  await acc("1300", "asset");
  await acc("2100", "liability");
  await acc("3000", "equity");
  await acc("4000", "income");
  await acc("5000", "expense");
  await run(setSetting, { key: "accounting.posting_accounts", value: { advances: "1300", customer_receivables: "1100", supplier_payables: "2100" }, reason: "setup" });
  await run(setSetting, { key: "alerts.trip_transit_days", value: 3, reason: "policy" });
  ids.cash = (await run(createMoneyAccount, { name: "Safe USD", kind: "cash", currency: "USD", ledgerAccountId: ids["1011"] })).id;
  // Owner puts in 10,000 USD capital
  await run(postJournalEntry, { entryDate: "2026-09-01", description: "Capital", lines: [{ accountId: ids["1011"], currency: "USD", debit: "10000" }, { accountId: ids["3000"], currency: "USD", credit: "10000" }] });

  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.supplier = (await run(createPartner, { kind: "organization", name: "Garage", roles: ["supplier"] })).id;
  const type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: type, name: "Fuel", startDate: "2026-09-10", responsibleUserId: env.admin.userId })).id;
  ids.trip = (await run(createTrip, { jobId: ids.job, newDriverName: "Ahmed", truckPlate: "P1" })).id;
  await run(recordLoading, { tripId: ids.trip, loadingDate: "2026-09-10", loadedQty: "30", loadedUnit: "MT" });
  await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.cash, amount: "300", currency: "USD", paymentDate: "2026-09-10", method: "cash", tripId: ids.trip });
  await run(createInvoice, { kind: "sales", partnerId: ids.customer, currency: "USD", invoiceDate: "2026-09-15", dueDate: "2026-09-30", lines: [{ description: "Transport", quantity: "30", unitPrice: "100", accountId: ids["4000"], jobId: ids.job }] });
  await run(createInvoice, { kind: "bill", billFrom: "supplier", partnerId: ids.supplier, currency: "USD", invoiceDate: "2026-09-16", lines: [{ description: "Repairs", quantity: "1", unitPrice: "800", accountId: ids["5000"], jobId: ids.job }] });
});
afterAll(async () => env.close());

describe("financial statements", () => {
  it("profit and loss for the period", async () => {
    const [pl] = await profitAndLoss(env.db, env.companyId, "2026-09-01", "2026-09-30");
    expect(pl).toMatchObject({ currency: "USD", totalIncome: "3000", totalExpenses: "800", netProfit: "2200" });
  });

  it("balance sheet balances (assets = liabilities + equity + earnings)", async () => {
    const [bs] = await balanceSheet(env.db, env.companyId, "2026-09-30");
    expect(bs).toMatchObject({ currency: "USD", totalAssets: "13000", totalLiabilitiesAndEquity: "13000", retainedEarnings: "2200", balanced: true });
    expect(bs.assets.map((a) => [a.code, a.amount])).toEqual([["1011", "9700"], ["1100", "3000"], ["1300", "300"]]);
    expect(bs.liabilities.map((a) => [a.code, a.amount])).toEqual([["2100", "800"]]);
  });
});

describe("exceptions", () => {
  it("lists only what needs attention, most serious first", async () => {
    await run(recordDischarge, { tripId: ids.trip, dischargeDate: "2026-09-12", dischargedQty: "30", dischargedUnit: "MT" });
    await run(changeJobStatus, { jobId: ids.job, status: "completed" });
    const t2 = await run(createTrip, { jobId: ids.job, newDriverName: "Karwan", truckPlate: "P2" }).catch(() => null);
    expect(t2).toBeNull(); // completed job takes no new trips
    await run(submitForApproval, { command: "payments.record", input: { direction: "out", purpose: "advance", moneyAccountId: ids.cash, amount: "50", currency: "USD", paymentDate: "2026-10-01", method: "cash", tripId: ids.trip }, summary: "Extra advance" });

    const list = await exceptions(env.db, env.companyId, "2026-10-05");
    expect(list.map((e) => e.code)).toEqual(["receivable.overdue", "advance.unreconciled", "approvals.pending"]);
    expect(list[0].message).toContain("3000 USD not received since 2026-09-30");
  });

  it("flags delayed trips and negative cash", async () => {
    const job2 = (await run(createJob, { customerId: ids.customer, jobTypeId: (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances"] })).id, name: "Fuel 2", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
    const t = await run(createTrip, { jobId: job2, newDriverName: "Saman", truckPlate: "P3" });
    await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-01", loadedQty: "30", loadedUnit: "MT" });
    await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.cash, amount: "20000", currency: "USD", paymentDate: "2026-10-02", method: "cash", tripId: t.id });
    const codes = (await exceptions(env.db, env.companyId, "2026-10-05")).map((e) => e.code);
    expect(codes[0]).toBe("cash.negative");
    expect(codes).toContain("trip.delayed");
  });
});
