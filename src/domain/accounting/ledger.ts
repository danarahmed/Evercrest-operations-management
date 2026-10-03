import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accounts, currencies, fiscalPeriods, journalEntries, journalLines } from "@/db/schema";
import { ACCOUNT_TYPES } from "@/db/schema/accounting";
import { type CommandContext, defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { D, dec, toStr } from "../money";
import { amountString, currencyCode } from "../currency";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const lineInput = z
  .object({
    accountId: z.string().uuid(),
    currency: currencyCode,
    debit: amountString.optional(),
    credit: amountString.optional(),
    memo: z.string().optional(),
  })
  .refine((l) => (l.debit ? 1 : 0) + (l.credit ? 1 : 0) === 1, "each line has exactly one of debit or credit");

export const entryInput = z.object({
  entryDate: isoDate,
  description: z.string().min(1),
  branchId: z.string().uuid().nullish(),
  sourceType: z.string().nullish(),
  sourceId: z.string().nullish(),
  lines: z.array(lineInput).min(2),
});
export type EntryInput = z.infer<typeof entryInput>;

/**
 * The only way journal rows are written. Operational modules call this from
 * inside their own command so the operation and its accounting commit together.
 * The database independently enforces balance, immutability and period locks.
 */
export async function postEntry(ctx: CommandContext, input: EntryInput, opts: { reversesEntryId?: string } = {}) {
  const { tx, actor } = ctx;
  const lines = input.lines.map((l, i) => {
    const amount = dec(l.debit ?? l.credit!);
    if (amount.lte(0)) throw new ValidationError(`Line ${i + 1}: amount must be greater than zero`);
    return { ...l, amount, side: l.debit ? ("debit" as const) : ("credit" as const) };
  });

  const usedCurrencies = [...new Set(lines.map((l) => l.currency))];
  const curRows = await tx.select().from(currencies).where(inArray(currencies.code, usedCurrencies));
  const minor = new Map(curRows.map((c) => [c.code, c.minorUnits]));
  const totals = new Map<string, InstanceType<typeof D>>();
  lines.forEach((l, i) => {
    const mu = minor.get(l.currency);
    if (mu === undefined) throw new ValidationError(`Line ${i + 1}: unknown currency ${l.currency}`);
    if (l.amount.decimalPlaces() > mu)
      throw new ValidationError(`Line ${i + 1}: ${l.currency} allows at most ${mu} decimal places`);
    const signed = l.side === "debit" ? l.amount : l.amount.neg();
    totals.set(l.currency, (totals.get(l.currency) ?? new D(0)).plus(signed));
  });
  const unbalanced = [...totals].filter(([, t]) => !t.isZero());
  if (unbalanced.length)
    throw new ValidationError("Entry does not balance", {
      differences: Object.fromEntries(unbalanced.map(([c, t]) => [c, toStr(t)])),
    });

  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accRows = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.companyId, actor.companyId), inArray(accounts.id, accountIds)));
  const accById = new Map(accRows.map((a) => [a.id, a]));
  lines.forEach((l, i) => {
    const acc = accById.get(l.accountId);
    if (!acc) throw new ValidationError(`Line ${i + 1}: account not found`);
    if (!acc.active || !acc.postable) throw new ValidationError(`Line ${i + 1}: account ${acc.code} cannot be posted to`);
    if (acc.currency && acc.currency !== l.currency)
      throw new ValidationError(`Line ${i + 1}: account ${acc.code} only accepts ${acc.currency}`);
  });

  await assertPeriodOpen(tx, actor.companyId, input.entryDate);

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      companyId: actor.companyId,
      branchId: input.branchId ?? actor.branchId,
      entryDate: input.entryDate,
      description: input.description,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      reversesEntryId: opts.reversesEntryId ?? null,
      createdBy: actor.userId,
    })
    .returning();
  await tx.insert(journalLines).values(
    lines.map((l, i) => ({
      entryId: entry.id,
      lineNo: i + 1,
      accountId: l.accountId,
      currency: l.currency,
      debit: l.side === "debit" ? toStr(l.amount) : "0",
      credit: l.side === "credit" ? toStr(l.amount) : "0",
      memo: l.memo ?? null,
    })),
  );
  await ctx.audit({
    action: "ledger.post_entry",
    entityType: "journal_entry",
    entityId: entry.id,
    after: { entryNo: entry.entryNo, entryDate: entry.entryDate, totals: Object.fromEntries(
      usedCurrencies.map((c) => [c, toStr(lines.filter((l) => l.currency === c && l.side === "debit").reduce((s, l) => s.plus(l.amount), new D(0)))]),
    ) },
  });
  return { id: entry.id, entryNo: entry.entryNo };
}

async function assertPeriodOpen(tx: Db, companyId: string, entryDate: string) {
  const [year, month] = entryDate.split("-").map(Number);
  const [p] = await tx
    .select()
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.companyId, companyId), eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, month)));
  if (p?.status === "locked") throw new ValidationError(`Period ${entryDate.slice(0, 7)} is locked`);
}

/** Manual journal entry (accountant use). Operational modules call postEntry directly. */
export const postJournalEntry = defineCommand({
  name: "ledger.post_entry",
  permission: "journal.post",
  input: entryInput,
  handler: (ctx, input) => postEntry(ctx, { ...input, sourceType: input.sourceType ?? "manual" }),
});

/** Correct a posted entry by posting its mirror image. The original is never changed. */
export const reverseJournalEntry = defineCommand({
  name: "ledger.reverse_entry",
  permission: "journal.reverse",
  input: z.object({ entryId: z.string().uuid(), entryDate: isoDate, reason: z.string().min(1) }),
  async handler(ctx, { entryId, entryDate, reason }) {
    const { tx, actor } = ctx;
    const [orig] = await tx
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, actor.companyId)));
    if (!orig) throw new NotFound("journal_entry", entryId);
    if (orig.reversedByEntryId || orig.reversesEntryId)
      throw new Conflict("Entry is already reversed or is itself a reversal", { entryId });
    if (entryDate < orig.entryDate) throw new ValidationError("Reversal date cannot be before the original entry date");
    const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId)).orderBy(asc(journalLines.lineNo));
    const rev = await postEntry(ctx, {
      entryDate,
      description: `Reversal of #${orig.entryNo}: ${reason}`,
      branchId: orig.branchId,
      sourceType: orig.sourceType,
      sourceId: orig.sourceId,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        currency: l.currency,
        ...(dec(l.debit).isZero() ? { debit: toStr(dec(l.credit)) } : { credit: toStr(dec(l.debit)) }),
        memo: l.memo ?? undefined,
      })),
    }, { reversesEntryId: entryId });
    await tx.update(journalEntries).set({ reversedByEntryId: rev.id }).where(eq(journalEntries.id, entryId));
    await ctx.audit({ action: "ledger.reverse_entry", entityType: "journal_entry", entityId: entryId, after: { reversalId: rev.id }, reason });
    return rev;
  },
});

export const createAccount = defineCommand({
  name: "ledger.create_account",
  permission: "accounts.manage",
  input: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(ACCOUNT_TYPES),
    currency: currencyCode.nullish(),
    parentId: z.string().uuid().nullish(),
    postable: z.boolean().default(true),
  }),
  async handler({ tx, actor, audit }, input) {
    const [row] = await tx.insert(accounts).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "ledger.create_account", entityType: "account", entityId: row.id, after: row });
    return { id: row.id };
  },
});

export const setPeriodStatus = defineCommand({
  name: "ledger.set_period_status",
  permission: "periods.manage",
  input: z.object({
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    status: z.enum(["open", "locked"]),
    reason: z.string().min(1),
  }),
  async handler({ tx, actor, audit }, { year, month, status, reason }) {
    const where = and(eq(fiscalPeriods.companyId, actor.companyId), eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, month));
    const [prev] = await tx.select().from(fiscalPeriods).where(where);
    await tx
      .insert(fiscalPeriods)
      .values({ companyId: actor.companyId, year, month, status, changedBy: actor.userId })
      .onConflictDoUpdate({
        target: [fiscalPeriods.companyId, fiscalPeriods.year, fiscalPeriods.month],
        set: { status, changedBy: actor.userId, changedAt: new Date() },
      });
    await audit({
      action: "ledger.set_period_status",
      entityType: "fiscal_period",
      entityId: `${year}-${String(month).padStart(2, "0")}`,
      before: { status: prev?.status ?? "open" },
      after: { status },
      reason,
    });
    return { year, month, status };
  },
});

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  debit: string;
  credit: string;
  /** debit − credit */
  balance: string;
}

/** Trial balance as of a date, one row per account per currency. Currencies are never mixed. */
export async function trialBalance(db: Db, companyId: string, asOf: string): Promise<TrialBalanceRow[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      currency: journalLines.currency,
      debit: sql<string>`sum(${journalLines.debit})`,
      credit: sql<string>`sum(${journalLines.credit})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.companyId, companyId), lte(journalEntries.entryDate, asOf)))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.type, journalLines.currency)
    .orderBy(asc(accounts.code), asc(journalLines.currency));
  return rows.map((r) => ({
    ...r,
    debit: toStr(dec(r.debit)),
    credit: toStr(dec(r.credit)),
    balance: toStr(dec(r.debit).minus(dec(r.credit))),
  }));
}

