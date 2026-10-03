import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, journalEntries, journalLines } from "@/db/schema";
import { D, type Dec, dec, toStr } from "../money";

interface Row {
  code: string;
  name: string;
  type: string;
  currency: string;
  /** debit − credit */
  net: string;
}

async function balances(db: Db, companyId: string, to: string, from?: string): Promise<Row[]> {
  return db
    .select({
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      currency: journalLines.currency,
      net: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.companyId, companyId), lte(journalEntries.entryDate, to), from ? gte(journalEntries.entryDate, from) : undefined))
    .groupBy(accounts.code, accounts.name, accounts.type, journalLines.currency)
    .orderBy(asc(accounts.code));
}

export interface StatementLine {
  code: string;
  name: string;
  amount: string;
}

const sum = (xs: StatementLine[]) => xs.reduce((s, x) => s.plus(dec(x.amount)), new D(0));
const line = (r: Row, sign: 1 | -1): StatementLine => ({ code: r.code, name: r.name, amount: toStr(dec(r.net).times(sign)) });
const nonZero = (r: Row) => !dec(r.net).isZero();
const currenciesOf = (rows: Row[]) => [...new Set(rows.map((r) => r.currency))].sort();

export interface ProfitAndLoss {
  currency: string;
  income: StatementLine[];
  expenses: StatementLine[];
  totalIncome: string;
  totalExpenses: string;
  netProfit: string;
}

/** Profit and loss for a period, one statement per currency (never converted). */
export async function profitAndLoss(db: Db, companyId: string, from: string, to: string): Promise<ProfitAndLoss[]> {
  const rows = (await balances(db, companyId, to, from)).filter(nonZero);
  return currenciesOf(rows.filter((r) => r.type === "income" || r.type === "expense")).map((currency) => {
    const income = rows.filter((r) => r.currency === currency && r.type === "income").map((r) => line(r, -1));
    const expenses = rows.filter((r) => r.currency === currency && r.type === "expense").map((r) => line(r, 1));
    const ti = sum(income);
    const te = sum(expenses);
    return { currency, income, expenses, totalIncome: toStr(ti), totalExpenses: toStr(te), netProfit: toStr(ti.minus(te)) };
  });
}

export interface BalanceSheet {
  currency: string;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  /** Cumulative income − expenses not yet closed to equity. */
  retainedEarnings: string;
  totalAssets: string;
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
}

/** Balance sheet as of a date, one per currency. Assets = Liabilities + Equity + retained earnings. */
export async function balanceSheet(db: Db, companyId: string, asOf: string): Promise<BalanceSheet[]> {
  const rows = (await balances(db, companyId, asOf)).filter(nonZero);
  return currenciesOf(rows).map((currency) => {
    const of = (type: string) => rows.filter((r) => r.currency === currency && r.type === type);
    const assets = of("asset").map((r) => line(r, 1));
    const liabilities = of("liability").map((r) => line(r, -1));
    const equity = of("equity").map((r) => line(r, -1));
    const earnings: Dec = [...of("income"), ...of("expense")].reduce((s, r) => s.minus(dec(r.net)), new D(0));
    const ta = sum(assets);
    const tle = sum(liabilities).plus(sum(equity)).plus(earnings);
    return {
      currency,
      assets,
      liabilities,
      equity,
      retainedEarnings: toStr(earnings),
      totalAssets: toStr(ta),
      totalLiabilitiesAndEquity: toStr(tle),
      balanced: ta.eq(tle),
    };
  });
}
