import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { accounts, businessPartners, invoiceLines, invoices, jobs, journalEntries, journalLines, payments, trips, tripSettlements } from "@/db/schema";
import { D, dec, toStr } from "../money";

/**
 * Management reports. Everything is read from the ledger (the single source of
 * truth for money) and kept per currency: IQD and USD are never added together.
 */

export interface JobProfitRow {
  jobId: string;
  jobNo: string;
  name: string;
  customer: string;
  status: string;
  currency: string;
  revenue: string;
  costs: string;
  profit: string;
  /** profit ÷ revenue × 100, one decimal; null when there is no revenue. */
  marginPct: string | null;
}

const margin = (revenue: InstanceType<typeof D>, profit: InstanceType<typeof D>) => (revenue.isZero() ? null : toStr(profit.div(revenue).times(100).toDecimalPlaces(1)));

/** Revenue, direct costs and profit of every job with money in the period, per currency. */
export async function jobProfitReport(db: Db, companyId: string, opts: { from: string; to: string; customerId?: string }): Promise<JobProfitRow[]> {
  const conds: SQL[] = [eq(jobs.companyId, companyId), inArray(accounts.type, ["income", "expense"]), gte(journalEntries.entryDate, opts.from), lte(journalEntries.entryDate, opts.to)];
  if (opts.customerId) conds.push(eq(jobs.customerId, opts.customerId));
  const rows = await db
    .select({
      jobId: jobs.id,
      jobNo: jobs.jobNo,
      name: jobs.name,
      customer: businessPartners.name,
      status: jobs.status,
      currency: journalLines.currency,
      revenue: sql<string>`coalesce(sum(case when ${accounts.type} = 'income' then ${journalLines.credit} - ${journalLines.debit} end), 0)`,
      costs: sql<string>`coalesce(sum(case when ${accounts.type} = 'expense' then ${journalLines.debit} - ${journalLines.credit} end), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .innerJoin(jobs, eq(jobs.id, journalLines.jobId))
    .innerJoin(businessPartners, eq(businessPartners.id, jobs.customerId))
    .where(and(...conds))
    .groupBy(jobs.id, jobs.jobNo, jobs.name, businessPartners.name, jobs.status, journalLines.currency)
    .orderBy(desc(jobs.jobNo), asc(journalLines.currency));
  return rows.map((r) => {
    const revenue = dec(r.revenue);
    const costs = dec(r.costs);
    const profit = revenue.minus(costs);
    return { ...r, revenue: toStr(revenue), costs: toStr(costs), profit: toStr(profit), marginPct: margin(revenue, profit) };
  });
}

/** Totals of the job report per currency. */
export function totalsByCurrency(rows: { currency: string; revenue: string; costs: string }[]) {
  const m = new Map<string, { revenue: InstanceType<typeof D>; costs: InstanceType<typeof D> }>();
  for (const r of rows) {
    const e = m.get(r.currency) ?? { revenue: new D(0), costs: new D(0) };
    e.revenue = e.revenue.plus(dec(r.revenue));
    e.costs = e.costs.plus(dec(r.costs));
    m.set(r.currency, e);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([currency, e]) => {
    const profit = e.revenue.minus(e.costs);
    return { currency, revenue: toStr(e.revenue), costs: toStr(e.costs), profit: toStr(profit), marginPct: margin(e.revenue, profit) };
  });
}

/** Where a job's revenue and costs come from (per account, per currency): driver, transporter, expenses, … */
export async function jobBreakdown(db: Db, jobId: string) {
  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      currency: journalLines.currency,
      net: sql<string>`sum(${journalLines.credit} - ${journalLines.debit})`,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.jobId, jobId), inArray(accounts.type, ["income", "expense"])))
    .groupBy(accounts.code, accounts.name, accounts.type, journalLines.currency)
    .orderBy(asc(journalLines.currency), asc(accounts.code));
  return rows
    .filter((r) => !dec(r.net).isZero())
    .map((r) => ({ ...r, amount: toStr(r.type === "income" ? dec(r.net) : dec(r.net).neg()) }));
}

/** Company revenue, costs and profit per month and currency (all work, with or without a job). */
export async function monthlySummary(db: Db, companyId: string, from: string, to: string) {
  const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      currency: journalLines.currency,
      revenue: sql<string>`coalesce(sum(case when ${accounts.type} = 'income' then ${journalLines.credit} - ${journalLines.debit} end), 0)`,
      costs: sql<string>`coalesce(sum(case when ${accounts.type} = 'expense' then ${journalLines.debit} - ${journalLines.credit} end), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalEntries.companyId, companyId), inArray(accounts.type, ["income", "expense"]), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .groupBy(month, journalLines.currency)
    .orderBy(desc(month), asc(journalLines.currency));
  return rows.map((r) => {
    const revenue = dec(r.revenue);
    const costs = dec(r.costs);
    const profit = revenue.minus(costs);
    return { month: r.month, currency: r.currency, revenue: toStr(revenue), costs: toStr(costs), profit: toStr(profit), marginPct: margin(revenue, profit) };
  });
}

const drivers = alias(businessPartners, "driver");

/**
 * Work that is waiting: discharged trips not yet settled, and discharged trips
 * of billing jobs not yet invoiced. Oldest first.
 */
export async function workQueues(db: Db, companyId: string) {
  const base = () =>
    db
      .select({ tripId: trips.id, tripNo: trips.tripNo, jobId: jobs.id, jobNo: jobs.jobNo, customer: businessPartners.name, driver: drivers.name, dischargeDate: trips.dischargeDate, capabilities: jobs.capabilities })
      .from(trips)
      .innerJoin(jobs, eq(jobs.id, trips.jobId))
      .innerJoin(businessPartners, eq(businessPartners.id, jobs.customerId))
      .innerJoin(drivers, eq(drivers.id, trips.driverId));
  const unsettled = await base()
    .leftJoin(tripSettlements, and(eq(tripSettlements.tripId, trips.id), eq(tripSettlements.status, "posted")))
    .where(and(eq(trips.companyId, companyId), eq(trips.status, "discharged"), isNull(tripSettlements.id)))
    .orderBy(asc(trips.dischargeDate));
  const billedLines = db
    .select({ tripId: invoiceLines.tripId })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(and(eq(invoices.kind, "sales"), eq(invoices.status, "posted")));
  const discharged = await base().where(and(eq(trips.companyId, companyId), eq(trips.status, "discharged"))).orderBy(asc(trips.dischargeDate));
  const billed = new Set((await billedLines).map((r) => r.tripId));
  const unbilled = discharged.filter((t) => (t.capabilities as string[]).includes("billing") && !billed.has(t.tripId));
  return { unsettled, unbilled };
}

/**
 * Money transactions attached to a job (aggregation, not a copy): expenses paid,
 * and invoices or bills with lines for this job (only those lines' amounts).
 */
export async function jobTransactions(db: Db, jobId: string) {
  const expenses = await db
    .select({ id: payments.id, no: payments.paymentNo, date: payments.paymentDate, amount: payments.amount, currency: payments.currency, status: payments.status, reference: payments.reference, notes: payments.notes, account: accounts.name, partner: businessPartners.name })
    .from(payments)
    .innerJoin(accounts, eq(accounts.id, payments.counterAccountId))
    .leftJoin(businessPartners, eq(businessPartners.id, payments.partnerId))
    .where(and(eq(payments.jobId, jobId), eq(payments.purpose, "expense")))
    .orderBy(desc(payments.paymentDate));
  const docs = await db
    .select({ id: invoices.id, no: invoices.invoiceNo, kind: invoices.kind, date: invoices.invoiceDate, currency: invoices.currency, status: invoices.status, partner: businessPartners.name, amount: sql<string>`sum(${invoiceLines.amount})` })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .innerJoin(businessPartners, eq(businessPartners.id, invoices.partnerId))
    .where(eq(invoiceLines.jobId, jobId))
    .groupBy(invoices.id, businessPartners.name)
    .orderBy(desc(invoices.invoiceDate));
  return {
    expenses: expenses.map((e) => ({ ...e, amount: toStr(dec(e.amount)) })),
    invoices: docs.filter((d) => d.kind === "sales").map((d) => ({ ...d, amount: toStr(dec(d.amount)) })),
    bills: docs.filter((d) => d.kind === "bill").map((d) => ({ ...d, amount: toStr(dec(d.amount)) })),
  };
}
