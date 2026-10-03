import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, trialBalance } from "@/domain/accounting/ledger";
import { exchangeCurrency, reverseExchange } from "@/domain/finance/exchange";
import { createMoneyAccount, moneyAccountBalance } from "@/domain/finance/payments";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const acc = async (code: string, currency?: string) => (await run(createAccount, { code, name: code, type: "asset", currency })).id;
  ids.usd = (await run(createMoneyAccount, { name: "Safe USD", kind: "cash", currency: "USD", ledgerAccountId: await acc("1011", "USD") })).id;
  ids.iqd = (await run(createMoneyAccount, { name: "Safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: await acc("1012", "IQD") })).id;
  ids.iqd2 = (await run(createMoneyAccount, { name: "Bank IQD", kind: "bank", currency: "IQD", ledgerAccountId: await acc("1013", "IQD") })).id;
  await acc("1900");
  await run(setSetting, { key: "accounting.posting_accounts", value: { currency_exchange: "1900" }, reason: "setup" });
});
afterAll(async () => env.close());

const fx = (fromAmount: string, toAmount: string, from = ids.usd, to = ids.iqd) =>
  run<{ id: string; rate: string }>(exchangeCurrency, { fromMoneyAccountId: from, toMoneyAccountId: to, fromAmount, toAmount, exchangeDate: "2026-10-03" });

describe("currency exchange", () => {
  it("records both real amounts and the rate obtained; each currency balances", async () => {
    const r = await fx("100", "131500");
    expect(r.rate).toBe("1315");
    expect(await moneyAccountBalance(env.db, ids.usd)).toBe("-100");
    expect(await moneyAccountBalance(env.db, ids.iqd)).toBe("131500");
    const tb = await trialBalance(env.db, env.companyId, "2026-12-31");
    for (const cur of ["USD", "IQD"]) expect(tb.filter((t) => t.currency === cur).reduce((s, t) => s + Number(t.balance), 0)).toBe(0);
  });

  it("keeps each exchange's own rate (history is never recomputed)", async () => {
    const a = await fx("10", "13100");
    const b = await fx("10", "13250");
    expect([a.rate, b.rate]).toEqual(["1310", "1325"]);
  });

  it("refuses same-currency exchanges and too many decimals", async () => {
    await expect(fx("100", "100", ids.iqd, ids.iqd2)).rejects.toThrow(/same currency/);
    await expect(fx("1.005", "1300")).rejects.toThrow(/at most 2 decimal/);
  });

  it("can be reversed once", async () => {
    const before = await moneyAccountBalance(env.db, ids.usd);
    const r = await fx("50", "65500");
    await run(reverseExchange, { exchangeId: r.id, reversalDate: "2026-10-04", reason: "entered twice" });
    expect(await moneyAccountBalance(env.db, ids.usd)).toBe(before);
    await expect(run(reverseExchange, { exchangeId: r.id, reversalDate: "2026-10-04", reason: "x" })).rejects.toMatchObject({ code: "conflict" });
  });
});
