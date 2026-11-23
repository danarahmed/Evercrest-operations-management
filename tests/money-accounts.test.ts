import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount, deleteAccount, postJournalEntry, updateAccount } from "@/domain/accounting/ledger";
import { createMoneyAccount } from "@/domain/finance/payments";
import { accounts, moneyAccounts } from "@/db/schema";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  await applyStarterConfiguration(env.db, env.admin); // Main safe USD on 1011, Main safe IQD on 1012
});
afterAll(async () => env.close());

const ledgerOf = async (id: string) => {
  const [m] = await env.db.select().from(moneyAccounts).where(eq(moneyAccounts.id, id));
  const [a] = await env.db.select().from(accounts).where(eq(accounts.id, m.ledgerAccountId));
  return a;
};

describe("cash boxes get their own account in the books", () => {
  it("creates the account automatically, named after the box, with the next free cash number", async () => {
    const box = await run(createMoneyAccount, { name: "Rekan Fars diesel", kind: "cash", currency: "USD" });
    expect(await ledgerOf(box.id)).toMatchObject({ code: "1013", name: "Rekan Fars diesel", type: "asset", currency: "USD", postable: true });
    const box2 = await run(createMoneyAccount, { name: "Site safe IQD", kind: "cash", currency: "IQD" });
    expect((await ledgerOf(box2.id)).code).toBe("1014");
  });

  it("bank accounts are numbered from 1051", async () => {
    const bank = await run(createMoneyAccount, { name: "RT Bank USD", kind: "bank", currency: "USD" });
    expect((await ledgerOf(bank.id)).code).toBe("1051");
  });

  it("an account already used by another box is refused with a plain reason", async () => {
    const [used] = await env.db.select().from(accounts).where(and(eq(accounts.companyId, env.companyId), eq(accounts.code, "1011")));
    await expect(run(createMoneyAccount, { name: "Second box", kind: "cash", currency: "USD", ledgerAccountId: used.id })).rejects.toThrow(/already belongs to "Main safe USD"/);
  });
});

describe("editing and deleting accounts in the chart", () => {
  const code = async (c: string) => (await env.db.select().from(accounts).where(and(eq(accounts.companyId, env.companyId), eq(accounts.code, c))))[0];

  it("renames an account; number, type and currency stay", async () => {
    const a = await run(createAccount, { code: "1011-1", name: "Cash USD – Rekan Fars diesel", type: "asset", currency: "USD" });
    await run(updateAccount, { accountId: a.id, name: "Rekan Fars (old)" });
    expect(await code("1011-1")).toMatchObject({ name: "Rekan Fars (old)", type: "asset", currency: "USD" });
  });

  it("deletes an account nothing uses", async () => {
    const a = await code("1011-1");
    await run(deleteAccount, { accountId: a.id });
    expect(await code("1011-1")).toBeUndefined();
  });

  it("refuses to delete an account in use, and says why", async () => {
    await expect(run(deleteAccount, { accountId: (await code("1011")).id })).rejects.toThrow(/belongs to the cash box "Main safe USD"/);
    const posting = await code("1300"); // advances, in the posting map
    await expect(run(deleteAccount, { accountId: posting.id })).rejects.toThrow(/automatic postings use it/);
    const x = await run(createAccount, { name: "Misc income", type: "income" });
    const y = await run(createAccount, { name: "Misc cost", type: "expense" });
    await run(postJournalEntry, { entryDate: "2026-11-20", description: "test", lines: [{ accountId: y.id, currency: "USD", debit: "10" }, { accountId: x.id, currency: "USD", credit: "10" }] });
    await expect(run(deleteAccount, { accountId: x.id })).rejects.toThrow(/has postings in the books/);
  });
});
