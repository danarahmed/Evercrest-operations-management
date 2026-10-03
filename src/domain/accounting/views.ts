import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, businessPartners, currencyExchanges, fiscalPeriods, jobs, journalEntries, journalLines, moneyAccounts, partnerRoles, users } from "@/db/schema";
import { D, dec, toStr } from "../money";

/** Journal entries in a period, newest first, each with its lines (read-only view of the books). */
export async function journalList(db: Db, companyId: string, opts: { from: string; to: string; limit?: number }) {
  const entries = await db
    .select({ e: journalEntries, by: users.displayName })
    .from(journalEntries)
    .innerJoin(users, eq(users.id, journalEntries.createdBy))
    .where(and(eq(journalEntries.companyId, companyId), gte(journalEntries.entryDate, opts.from), lte(journalEntries.entryDate, opts.to)))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.entryNo))
    .limit(opts.limit ?? 200);
  if (!entries.length) return [];
  const lines = await db
    .select({ l: journalLines, code: accounts.code, account: accounts.name, partner: businessPartners.name, jobNo: jobs.jobNo })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(businessPartners, eq(businessPartners.id, journalLines.partnerId))
    .leftJoin(jobs, eq(jobs.id, journalLines.jobId))
    .where(inArray(journalLines.entryId, entries.map((x) => x.e.id)))
    .orderBy(asc(journalLines.lineNo));
  return entries.map(({ e, by }) => ({
    ...e,
    by,
    lines: lines
      .filter((x) => x.l.entryId === e.id)
      .map((x) => ({ ...x.l, debit: toStr(dec(x.l.debit)), credit: toStr(dec(x.l.credit)), code: x.code, account: x.account, partner: x.partner, jobNo: x.jobNo })),
  }));
}

/** Every cash/bank account with its balance from the books. */
export async function moneyAccountBalances(db: Db, companyId: string) {
  const rows = await db
    .select({
      m: moneyAccounts,
      bal: sql<string>`coalesce((select sum(${journalLines.debit} - ${journalLines.credit}) from ${journalLines} where ${journalLines.accountId} = ${moneyAccounts.ledgerAccountId}), 0)`,
    })
    .from(moneyAccounts)
    .where(eq(moneyAccounts.companyId, companyId))
    .orderBy(moneyAccounts.currency, moneyAccounts.name);
  return rows.map((r) => ({ ...r.m, balance: toStr(dec(r.bal)) }));
}

/** Month locks for one year (a month with no row is open). */
export async function periodsOfYear(db: Db, companyId: string, year: number) {
  const rows = await db.select().from(fiscalPeriods).where(and(eq(fiscalPeriods.companyId, companyId), eq(fiscalPeriods.year, year)));
  return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, status: rows.find((r) => r.month === i + 1)?.status ?? "open" }));
}

export async function exchangeList(db: Db, companyId: string) {
  const rows = await db.select().from(currencyExchanges).where(eq(currencyExchanges.companyId, companyId)).orderBy(desc(currencyExchanges.exchangeDate), desc(currencyExchanges.createdAt)).limit(100);
  return rows.map((r) => ({ ...r, fromAmount: toStr(dec(r.fromAmount)), toAmount: toStr(dec(r.toAmount)), rate: toStr(dec(r.rate)) }));
}

/** Every partner with an open balance (what they owe us, positive; what we owe them, negative), per currency. */
export async function partnerBalancesList(db: Db, companyId: string) {
  const rows = await db
    .select({ id: businessPartners.id, name: businessPartners.name, currency: journalLines.currency, bal: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .innerJoin(businessPartners, eq(businessPartners.id, journalLines.partnerId))
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.type, ["asset", "liability"])))
    .groupBy(businessPartners.id, businessPartners.name, journalLines.currency)
    .orderBy(businessPartners.name, journalLines.currency);
  const roles = await db.select().from(partnerRoles);
  const out = new Map<string, { id: string; name: string; roles: string[]; balances: Record<string, string> }>();
  for (const r of rows) {
    if (dec(r.bal).isZero()) continue;
    const e = out.get(r.id) ?? { id: r.id, name: r.name, roles: roles.filter((x) => x.partnerId === r.id).map((x) => x.role), balances: {} };
    e.balances[r.currency] = toStr(dec(r.bal));
    out.set(r.id, e);
  }
  return [...out.values()];
}

/**
 * A partner's account history (customer, supplier, driver, transporter …):
 * every receivable, payable and advance movement with a running balance per
 * currency. Positive = they owe the company; negative = the company owes them.
 */
export async function partnerLedger(db: Db, companyId: string, partnerId: string) {
  const [partner] = await db.select().from(businessPartners).where(and(eq(businessPartners.id, partnerId), eq(businessPartners.companyId, companyId)));
  if (!partner) return null;
  const rows = await db
    .select({ l: journalLines, date: journalEntries.entryDate, no: journalEntries.entryNo, description: journalEntries.description, sourceType: journalEntries.sourceType, sourceId: journalEntries.sourceId, account: accounts.name, code: accounts.code, jobNo: jobs.jobNo })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(jobs, eq(jobs.id, journalLines.jobId))
    .where(and(eq(journalLines.partnerId, partnerId), eq(journalEntries.companyId, companyId), inArray(accounts.type, ["asset", "liability"])))
    .orderBy(asc(journalEntries.entryDate), asc(journalEntries.entryNo), asc(journalLines.lineNo));
  const running = new Map<string, InstanceType<typeof D>>();
  const lines = rows.map((r) => {
    const amount = dec(r.l.debit).minus(dec(r.l.credit));
    const bal = (running.get(r.l.currency) ?? new D(0)).plus(amount);
    running.set(r.l.currency, bal);
    return { id: r.l.id, date: r.date, entryNo: r.no, description: r.description, source: r.sourceId, account: `${r.code} · ${r.account}`, jobNo: r.jobNo, currency: r.l.currency, debit: toStr(dec(r.l.debit)), credit: toStr(dec(r.l.credit)), balance: toStr(bal) };
  });
  const roles = await db.select({ role: partnerRoles.role }).from(partnerRoles).where(eq(partnerRoles.partnerId, partnerId));
  return {
    partner,
    roles: roles.map((r) => r.role),
    lines: lines.reverse(),
    balances: Object.fromEntries([...running].map(([c, b]) => [c, toStr(b)])),
  };
}
