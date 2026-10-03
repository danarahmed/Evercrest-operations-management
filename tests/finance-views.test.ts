import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, postJournalEntry } from "@/domain/accounting/ledger";
import { journalList, moneyAccountBalances, partnerBalancesList, partnerLedger, periodsOfYear } from "@/domain/accounting/views";
import { createInvoice } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment, transferMoney } from "@/domain/finance/payments";
import { createPartner } from "@/domain/masterdata/partners";
import { setPeriodStatus } from "@/domain/accounting/ledger";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  for (const [c, t, cur] of [["1011", "asset", "USD"], ["1012", "asset", "IQD"], ["1013", "asset", "IQD"], ["1100", "asset"], ["3000", "equity"], ["4000", "income"], ["4900", "income"], ["5800", "expense"]] as const)
    ids[c] = (await run(createAccount, { code: c, name: `A${c}`, type: t, currency: cur })).id;
  await run(setSetting, { key: "accounting.posting_accounts", reason: "setup", value: { customer_receivables: "1100" } });
  ids.safe = (await run(createMoneyAccount, { name: "Safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: ids["1012"] })).id;
  ids.bank = (await run(createMoneyAccount, { name: "Bank IQD", kind: "bank", currency: "IQD", ledgerAccountId: ids["1013"] })).id;
  ids.usd = (await run(createMoneyAccount, { name: "Safe USD", kind: "cash", currency: "USD", ledgerAccountId: ids["1011"] })).id;
  await run(postJournalEntry, { entryDate: "2026-09-01", description: "capital", lines: [{ accountId: ids["1013"], currency: "IQD", debit: "5000000" }, { accountId: ids["3000"], currency: "IQD", credit: "5000000" }] });
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
});
afterAll(async () => env.close());

describe("money movements", () => {
  it("moves money between own accounts of the same currency only", async () => {
    await run(transferMoney, { fromMoneyAccountId: ids.bank, toMoneyAccountId: ids.safe, amount: "1000000", transferDate: "2026-09-02" });
    await expect(run(transferMoney, { fromMoneyAccountId: ids.bank, toMoneyAccountId: ids.usd, amount: "10", transferDate: "2026-09-02" })).rejects.toThrow(/currency exchange/);
    const bal = Object.fromEntries((await moneyAccountBalances(env.db, env.companyId)).map((m) => [m.name, m.balance]));
    expect(bal).toMatchObject({ "Safe IQD": "1000000", "Bank IQD": "4000000" });
  });

  it("records other money in/out against a chosen account, never another cash account", async () => {
    await run(recordPayment, { direction: "in", purpose: "other", moneyAccountId: ids.safe, amount: "50000", currency: "IQD", paymentDate: "2026-09-03", method: "cash", counterAccountId: ids["4900"], notes: "scrap sold" });
    await run(recordPayment, { direction: "out", purpose: "other", moneyAccountId: ids.bank, amount: "5000", currency: "IQD", paymentDate: "2026-09-03", method: "bank_transfer", counterAccountId: ids["5800"], notes: "bank charges" });
    await expect(run(recordPayment, { direction: "out", purpose: "other", moneyAccountId: ids.bank, amount: "5", currency: "IQD", paymentDate: "2026-09-03", method: "cash", counterAccountId: ids["1012"] })).rejects.toThrow(/transfer/);
    const entries = await journalList(env.db, env.companyId, { from: "2026-09-01", to: "2026-09-30" });
    expect(entries.length).toBe(4);
    expect(entries[0].lines.length).toBe(2);
  });
});

describe("partner account and month locks", () => {
  it("shows a partner's history with a running balance per currency", async () => {
    const inv = await run(createInvoice, { kind: "sales", partnerId: ids.customer, currency: "IQD", invoiceDate: "2026-09-10", lines: [{ description: "Service", quantity: "1", unitPrice: "750000", accountId: ids["4000"] }] });
    await run(recordPayment, { direction: "in", purpose: "customer_receipt", moneyAccountId: ids.bank, amount: "500000", currency: "IQD", paymentDate: "2026-09-15", method: "bank_transfer", invoiceId: inv.id });
    const l = await partnerLedger(env.db, env.companyId, ids.customer);
    expect(l!.balances).toEqual({ IQD: "250000" });
    expect(l!.lines.map((x) => x.balance)).toEqual(["250000", "750000"]); // newest first
    expect((await partnerBalancesList(env.db, env.companyId)).find((p) => p.id === ids.customer)?.balances).toEqual({ IQD: "250000" });
  });

  it("lists month locks for a year", async () => {
    await run(setPeriodStatus, { year: 2026, month: 8, status: "locked", reason: "August checked" });
    const p = await periodsOfYear(env.db, env.companyId, 2026);
    expect(p.find((x) => x.month === 8)?.status).toBe("locked");
    expect(p.filter((x) => x.status === "open").length).toBe(11);
  });
});
