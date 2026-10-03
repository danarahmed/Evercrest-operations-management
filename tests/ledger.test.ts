import { z } from "zod";
import { defineCommand } from "@/server/command";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { journalEntries, journalLines } from "@/db/schema";
import {
  postEntry,
  createAccount,
  postJournalEntry,
  reverseJournalEntry,
  setPeriodStatus,
  trialBalance,
} from "@/domain/accounting/ledger";
import { runCommand } from "@/server/command";
import { dbRejects, freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const acc: Record<string, string> = {};

beforeAll(async () => {
  env = await freshDb();
  const mk = async (code: string, name: string, type: string, currency?: string) =>
    (acc[code] = (await runCommand(env.db, env.admin, createAccount, { code, name, type, currency })).id);
  await mk("1010", "Cash IQD", "asset", "IQD");
  await mk("1020", "Cash USD", "asset", "USD");
  await mk("1200", "Receivables", "asset");
  await mk("1900", "Currency exchange", "asset");
  await mk("4000", "Transport revenue", "income");
});
afterAll(async () => env.close());

const post = (lines: object[], entryDate = "2026-09-15", description = "test") =>
  runCommand(env.db, env.admin, postJournalEntry, { entryDate, description, lines });
const line = (account: string, currency: string, side: "debit" | "credit", amount: string) => ({
  accountId: acc[account],
  currency,
  [side]: amount,
});

describe("posting", () => {
  it("posts a balanced entry", async () => {
    const r = await post([line("1200", "USD", "debit", "1000"), line("4000", "USD", "credit", "1000")]);
    const lines = await env.db.select().from(journalLines).where(eq(journalLines.entryId, r.id));
    expect(lines).toHaveLength(2);
  });

  it("rejects an unbalanced entry", async () => {
    await expect(post([line("1200", "USD", "debit", "1000"), line("4000", "USD", "credit", "999")])).rejects.toMatchObject({
      code: "validation",
      details: { differences: { USD: "1" } },
    });
  });

  it("requires balance within each currency, not across currencies", async () => {
    await expect(
      post([line("1200", "USD", "debit", "100"), line("4000", "IQD", "credit", "100")]),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("records a currency exchange through the exchange account, each currency balanced", async () => {
    // Sold 100 USD cash for 131,000 IQD cash
    await post([
      line("1010", "IQD", "debit", "131000"),
      line("1900", "IQD", "credit", "131000"),
      line("1900", "USD", "debit", "100"),
      line("1020", "USD", "credit", "100"),
    ]);
  });

  it("enforces account currency restrictions and currency decimal places", async () => {
    await expect(post([line("1020", "IQD", "debit", "5"), line("4000", "IQD", "credit", "5")])).rejects.toThrow(/only accepts USD/);
    await expect(post([line("1200", "USD", "debit", "1.005"), line("4000", "USD", "credit", "1.005")])).rejects.toThrow(
      /at most 2 decimal places/,
    );
  });

  it("rejects a line with both or neither side", async () => {
    await expect(
      post([{ accountId: acc["1200"], currency: "USD", debit: "1", credit: "1" }, line("4000", "USD", "credit", "1")]),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

describe("database guards (hold even if application code is bypassed)", () => {
  it("blocks an unbalanced entry written directly", async () => {
    const msg = await dbRejects(
      env.db.transaction(async (tx) => {
        const [e] = await tx
          .insert(journalEntries)
          .values({ companyId: env.companyId, entryDate: "2026-09-15", description: "raw", createdBy: env.admin.userId })
          .returning();
        await tx.insert(journalLines).values([
          { entryId: e.id, lineNo: 1, accountId: acc["1200"], currency: "USD", debit: "10" },
          { entryId: e.id, lineNo: 2, accountId: acc["4000"], currency: "USD", credit: "9" },
        ]);
      }),
    );
    expect(msg).toMatch(/does not balance in USD/);
  });

  it("blocks edits and deletes of posted entries and lines", async () => {
    const r = await post([line("1200", "USD", "debit", "5"), line("4000", "USD", "credit", "5")]);
    expect(await dbRejects(env.db.execute(sql`update journal_lines set debit = 6 where entry_id = ${r.id}`))).toMatch(/append-only/);
    expect(await dbRejects(env.db.execute(sql`update journal_entries set description = 'x' where id = ${r.id}`))).toMatch(/immutable/);
    expect(await dbRejects(env.db.execute(sql`delete from journal_entries where id = ${r.id}`))).toMatch(/reverse them/);
  });
});

describe("reversal", () => {
  it("corrects an entry by posting its mirror; the original is untouched", async () => {
    const r = await post([line("1200", "USD", "debit", "250"), line("4000", "USD", "credit", "250")], "2026-09-20");
    const rev = await runCommand(env.db, env.admin, reverseJournalEntry, { entryId: r.id, entryDate: "2026-09-21", reason: "wrong customer" });
    const [orig] = await env.db.select().from(journalEntries).where(eq(journalEntries.id, r.id));
    expect(orig.reversedByEntryId).toBe(rev.id);
    const revLines = await env.db.select().from(journalLines).where(eq(journalLines.entryId, rev.id));
    expect(revLines.find((l) => l.accountId === acc["1200"])?.credit).toBe("250.0000");
  });

  it("cannot reverse twice", async () => {
    const r = await post([line("1200", "USD", "debit", "7"), line("4000", "USD", "credit", "7")]);
    await runCommand(env.db, env.admin, reverseJournalEntry, { entryId: r.id, entryDate: "2026-09-15", reason: "x" });
    await expect(
      runCommand(env.db, env.admin, reverseJournalEntry, { entryId: r.id, entryDate: "2026-09-15", reason: "x" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("manual reversal guard", () => {
  it("does not reverse entries that belong to an operation", async () => {
    const op = defineCommand({ name: "test.operation", permission: null, input: z.any(), handler: (ctx) => postEntry(ctx, { entryDate: "2026-09-20", description: "op", sourceType: "invoice", sourceId: "INV-X", lines: [line("1200", "USD", "debit", "3"), line("4000", "USD", "credit", "3")] }) });
    const r = (await runCommand(env.db, env.admin, op, {})) as { id: string };
    const m = (await runCommand(env.db, env.admin, postJournalEntry, { entryDate: "2026-09-20", description: "fake", sourceType: "invoice", lines: [line("1200", "USD", "debit", "1"), line("4000", "USD", "credit", "1")] })) as { id: string };
    const [fake] = await env.db.select().from(journalEntries).where(eq(journalEntries.id, m.id));
    expect(fake.sourceType).toBe("manual");
    await expect(runCommand(env.db, env.admin, reverseJournalEntry, { entryId: r.id, entryDate: "2026-09-21", reason: "x" })).rejects.toThrow(/correct it there/);
  });
});

describe("period lock", () => {
  it("rejects postings into a locked month until it is reopened", async () => {
    await runCommand(env.db, env.admin, setPeriodStatus, { year: 2026, month: 8, status: "locked", reason: "August closed" });
    const lines = [line("1200", "IQD", "debit", "1000"), line("4000", "IQD", "credit", "1000")];
    await expect(post(lines, "2026-08-31")).rejects.toThrow(/2026-08 is locked/);
    await runCommand(env.db, env.admin, setPeriodStatus, { year: 2026, month: 8, status: "open", reason: "late invoice approved" });
    await expect(post(lines, "2026-08-31")).resolves.toBeTruthy();
  });
});

describe("trial balance", () => {
  it("reports each currency separately and every currency nets to zero", async () => {
    const tb = await trialBalance(env.db, env.companyId, "2026-12-31");
    const byCurrency = new Map<string, number>();
    for (const r of tb) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + Number(r.balance));
    expect([...byCurrency.keys()].sort()).toEqual(["IQD", "USD"]);
    for (const total of byCurrency.values()) expect(total).toBe(0);
    expect(tb.find((r) => r.code === "1020" && r.currency === "USD")?.balance).toBe("-100");
  });
});
