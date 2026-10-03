import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, trialBalance } from "@/domain/accounting/ledger";
import { cancelInvoice, createInvoice, invoiceOutstanding, jobProfitability, partnerBalances } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment, reversePayment } from "@/domain/finance/payments";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const acc = async (code: string, type: string, currency?: string) => (ids[code] = (await run(createAccount, { code, name: code, type, currency })).id);
  await acc("1011", "asset", "USD");
  await acc("1012", "asset", "IQD");
  await acc("1100", "asset"); // receivables
  await acc("1300", "asset"); // advances
  await acc("1400", "asset"); // recoverable from customers
  await acc("2100", "liability"); // supplier payables
  await acc("2200", "liability"); // payables to transporters
  await acc("4000", "income");
  await acc("5000", "expense"); // transport cost
  await acc("5100", "expense"); // site expenses
  await run(setSetting, {
    key: "accounting.posting_accounts",
    value: { advances: "1300", customer_receivables: "1100", supplier_payables: "2100", payables_to_transporters: "2200" },
    reason: "setup",
  });
  ids.usd = (await run(createMoneyAccount, { name: "Bank USD", kind: "bank", currency: "USD", ledgerAccountId: ids["1011"] })).id;
  ids.iqd = (await run(createMoneyAccount, { name: "Safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: ids["1012"] })).id;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.otherCustomer = (await run(createPartner, { kind: "organization", name: "Gulf", roles: ["customer"] })).id;
  ids.transporter = (await run(createPartner, { kind: "organization", name: "Company A", roles: ["transporter", "supplier"] })).id;
  const type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: type, name: "Fuel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  ids.trip = (await run(createTrip, { jobId: ids.job, newDriverName: "Ahmed", truckPlate: "P1", transporterId: ids.transporter })).id;
});
afterAll(async () => env.close());

describe("invoices and bills", () => {
  it("invoices a customer, bills from a transporter, and reports job profit per currency", async () => {
    const inv = await run<{ id: string; total: string }>(createInvoice, {
      kind: "sales", partnerId: ids.customer, currency: "USD", invoiceDate: "2026-10-05",
      lines: [{ description: "Transport 30 MT", quantity: "30", unit: "MT", unitPrice: "100", accountId: ids["4000"], tripId: ids.trip }],
    });
    expect(inv.total).toBe("3000");
    await run(createInvoice, {
      kind: "bill", billFrom: "transporter", partnerId: ids.transporter, currency: "USD", invoiceDate: "2026-10-05", externalRef: "CA-77",
      lines: [{ description: "Haulage", quantity: "30", unit: "MT", unitPrice: "70", accountId: ids["5000"], tripId: ids.trip }],
    });
    await run(createInvoice, {
      kind: "bill", billFrom: "supplier", partnerId: ids.transporter, currency: "IQD", invoiceDate: "2026-10-05",
      lines: [{ description: "Site fees", quantity: "1", unitPrice: "150000", accountId: ids["5100"], jobId: ids.job }],
    });
    expect(await jobProfitability(env.db, ids.job)).toEqual([
      { currency: "IQD", revenue: "0", costs: "150000", profit: "-150000" },
      { currency: "USD", revenue: "3000", costs: "2100", profit: "900" },
    ]);
    expect(await partnerBalances(env.db, env.companyId, ids.customer)).toEqual({ USD: "3000" });
    expect(await partnerBalances(env.db, env.companyId, ids.transporter)).toEqual({ USD: "-2100", IQD: "-150000" });
    ids.inv = inv.id;
  });

  it("refuses a duplicate supplier bill number and wrong account types", async () => {
    await expect(run(createInvoice, {
      kind: "bill", billFrom: "transporter", partnerId: ids.transporter, currency: "USD", invoiceDate: "2026-10-06", externalRef: "CA-77",
      lines: [{ description: "x", quantity: "1", unitPrice: "1", accountId: ids["5000"] }],
    })).rejects.toMatchObject({ code: "conflict" });
    await expect(run(createInvoice, {
      kind: "sales", partnerId: ids.customer, currency: "USD", invoiceDate: "2026-10-06",
      lines: [{ description: "x", quantity: "1", unitPrice: "1", accountId: ids["5000"] }],
    })).rejects.toThrow(/income account/);
  });

  it("refuses to invoice another customer's job", async () => {
    await expect(run(createInvoice, {
      kind: "sales", partnerId: ids.otherCustomer, currency: "USD", invoiceDate: "2026-10-06",
      lines: [{ description: "x", quantity: "1", unitPrice: "1", accountId: ids["4000"], jobId: ids.job }],
    })).rejects.toThrow(/different customer/);
  });

  it("customer-recoverable costs do not reduce profit", async () => {
    await run(createInvoice, {
      kind: "bill", billFrom: "supplier", partnerId: ids.transporter, currency: "USD", invoiceDate: "2026-10-06",
      lines: [{ description: "Demurrage paid on customer's behalf", quantity: "1", unitPrice: "500", accountId: ids["1400"], jobId: ids.job }],
    });
    expect((await jobProfitability(env.db, ids.job)).find((p) => p.currency === "USD")?.profit).toBe("900");
  });
});

describe("payments against invoices", () => {
  const receipt = (amount: string, extra: object = {}) => ({
    direction: "in", purpose: "customer_receipt", moneyAccountId: ids.usd, amount, currency: "USD",
    paymentDate: "2026-10-10", method: "bank_transfer", invoiceId: ids.inv, ...extra,
  });

  it("allows partial payment, tracks outstanding, refuses overpayment", async () => {
    await run(recordPayment, receipt("1000"));
    expect(await invoiceOutstanding(env.db, ids.inv)).toBe("2000");
    await expect(run(recordPayment, receipt("2500"))).rejects.toThrow(/exceeds the outstanding 2000/);
    expect(await partnerBalances(env.db, env.companyId, ids.customer)).toEqual({ USD: "2000" });
  });

  it("refuses paying a USD invoice in IQD (exchange must be recorded separately)", async () => {
    await expect(run(recordPayment, receipt("100", { moneyAccountId: ids.iqd, currency: "IQD" }))).rejects.toThrow(/is in USD/);
  });

  it("cannot cancel a paid invoice until the payment is reversed", async () => {
    await expect(run(cancelInvoice, { invoiceId: ids.inv, cancelDate: "2026-10-11", reason: "x" })).rejects.toMatchObject({ code: "conflict" });
    const p = await run(recordPayment, receipt("2000"));
    expect(await invoiceOutstanding(env.db, ids.inv)).toBe("0");
    await run(reversePayment, { paymentId: p.id, reversalDate: "2026-10-11", reason: "bounced transfer" });
    expect(await invoiceOutstanding(env.db, ids.inv)).toBe("2000");
  });

  it("records a direct expense against a job", async () => {
    await run(recordPayment, {
      direction: "out", purpose: "expense", moneyAccountId: ids.iqd, amount: "25000", currency: "IQD",
      paymentDate: "2026-10-10", method: "cash", counterAccountId: ids["5100"], jobId: ids.job,
    });
    expect((await jobProfitability(env.db, ids.job)).find((p) => p.currency === "IQD")?.costs).toBe("175000");
  });

  it("keeps the ledger balanced per currency", async () => {
    const tb = await trialBalance(env.db, env.companyId, "2026-12-31");
    for (const cur of ["USD", "IQD"]) {
      const sum = tb.filter((r) => r.currency === cur).reduce((s, r) => s + Number(r.balance), 0);
      expect(sum).toBe(0);
    }
  });
});
