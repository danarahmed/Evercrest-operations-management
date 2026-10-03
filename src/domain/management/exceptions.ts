import { and, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvalRequests, documents, invoices, jobs, journalLines, moneyAccounts, payments, trips } from "@/db/schema";
import { postingAccount } from "../accounting/posting";
import { jobProfitability } from "../finance/invoices";
import { statementDebts } from "../transport/statement-debts";
import { dec, toStr } from "../money";
import { getSetting } from "@/server/settings";

export interface Exception {
  severity: "critical" | "warning" | "info";
  code: string;
  /** What is wrong, why it matters, what to do (English fallback). */
  message: string;
  /** Values for the translated message (keyed by `code`). */
  params: Record<string, string>;
  entity: { type: string; id: string; label: string };
}

/**
 * What needs management attention right now. Normal work stays quiet; only
 * deviations appear. Each check is independent and cheap (indexed queries).
 */
export async function exceptions(db: Db, companyId: string, today: string): Promise<Exception[]> {
  const out: Exception[] = [];

  // Cash or bank accounts below zero: physically impossible, so a recording error.
  const money = await db.select().from(moneyAccounts).where(eq(moneyAccounts.companyId, companyId));
  for (const m of money) {
    const [r] = await db.select({ bal: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` }).from(journalLines).where(eq(journalLines.accountId, m.ledgerAccountId));
    if (dec(r.bal).lt(0))
      out.push({ severity: "critical", code: "cash.negative", params: { account: m.name, amount: toStr(dec(r.bal)), currency: m.currency }, message: `${m.name} shows ${toStr(dec(r.bal))} ${m.currency}: more money was recorded as paid out than came in. Check recent payments.`, entity: { type: "money_account", id: m.id, label: m.name } });
  }

  // Overdue invoices and bills (outstanding > 0, past due date).
  const due = await db
    .select({ id: invoices.id, no: invoices.invoiceNo, kind: invoices.kind, total: invoices.total, currency: invoices.currency, dueDate: invoices.dueDate })
    .from(invoices)
    .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "posted"), lt(invoices.dueDate, today)));
  for (const inv of due) {
    const [p] = await db.select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(and(eq(payments.invoiceId, inv.id), eq(payments.status, "posted")));
    const outstanding = dec(inv.total).minus(dec(p.paid));
    if (outstanding.gt(0))
      out.push({
        severity: "warning",
        code: inv.kind === "sales" ? "receivable.overdue" : "payable.overdue",
        params: { invoice: inv.no, amount: toStr(outstanding), currency: inv.currency, since: inv.dueDate! },
        message: `${inv.no}: ${toStr(outstanding)} ${inv.currency} ${inv.kind === "sales" ? "not received" : "not paid"} since ${inv.dueDate}.`,
        entity: { type: "invoice", id: inv.id, label: inv.no },
      });
  }

  // Trips loaded too long ago without discharge (only if a threshold is configured).
  const transitDays = await getSetting(db, companyId, "alerts.trip_transit_days");
  if (transitDays) {
    const cutoff = new Date(Date.parse(today) - transitDays * 86400000).toISOString().slice(0, 10);
    const late = await db.select().from(trips).where(and(eq(trips.companyId, companyId), eq(trips.status, "loaded"), lte(trips.loadingDate, cutoff)));
    for (const t of late)
      out.push({ severity: "warning", code: "trip.delayed", params: { trip: t.tripNo, date: t.loadingDate!, days: String(transitDays) }, message: `${t.tripNo} was loaded on ${t.loadingDate} and has no discharge after ${transitDays} days.`, entity: { type: "trip", id: t.id, label: t.tripNo } });
  }

  // Advances still open on jobs that are already completed or closed.
  let advancesAcc: { id: string } | undefined;
  try {
    advancesAcc = await postingAccount(db, companyId, "advances");
  } catch {
    advancesAcc = undefined;
  }
  if (advancesAcc) {
    const open = await db
      .select({ jobId: jobs.id, jobNo: jobs.jobNo, currency: journalLines.currency, bal: sql<string>`sum(${journalLines.debit} - ${journalLines.credit})` })
      .from(journalLines)
      .innerJoin(jobs, eq(jobs.id, journalLines.jobId))
      .where(and(eq(journalLines.accountId, advancesAcc.id), eq(jobs.companyId, companyId), inArray(jobs.status, ["completed", "financially_closed"])))
      .groupBy(jobs.id, jobs.jobNo, journalLines.currency);
    for (const a of open.filter((a) => !dec(a.bal).isZero()))
      out.push({ severity: "warning", code: "advance.unreconciled", params: { job: a.jobNo, amount: toStr(dec(a.bal)), currency: a.currency }, message: `${a.jobNo} is completed but ${toStr(dec(a.bal))} ${a.currency} of advances is not settled.`, entity: { type: "job", id: a.jobId, label: a.jobNo } });
  }

  // Drivers or transporters whose advances were larger than their pay, and the debt is not yet recovered.
  for (const d of await statementDebts(db, companyId))
    if (dec(d.open).gt(0))
      out.push({
        severity: "warning",
        code: "payee.owes",
        params: { name: d.name, amount: d.open, currency: d.currency, statement: d.statementNo },
        message: `${d.name} owes the company ${d.open} ${d.currency} from ${d.statementNo}. It will be deducted from their next statement, or record a repayment.`,
        entity: { type: "pay_statement", id: d.statementId, label: d.statementNo },
      });

  // Jobs over their cost budget (budget currency only) and running jobs losing money.
  const running = await db.select().from(jobs).where(and(eq(jobs.companyId, companyId), inArray(jobs.status, ["open", "in_progress", "pending", "completed"])));
  for (const j of running) {
    const profit = await jobProfitability(db, j.id);
    if (j.budgetAmount && j.budgetCurrency) {
      const costs = dec(profit.find((p) => p.currency === j.budgetCurrency)?.costs ?? "0");
      if (costs.gt(dec(j.budgetAmount)))
        out.push({ severity: "warning", code: "job.over_budget", params: { job: j.jobNo, costs: toStr(costs), budget: toStr(dec(j.budgetAmount)), currency: j.budgetCurrency }, message: `${j.jobNo}: costs ${toStr(costs)} ${j.budgetCurrency} are above the budget of ${toStr(dec(j.budgetAmount))} ${j.budgetCurrency}.`, entity: { type: "job", id: j.id, label: j.jobNo } });
    }
    for (const p of profit)
      if (dec(p.revenue).gt(0) && dec(p.profit).lt(0))
        out.push({ severity: "warning", code: "job.negative_margin", params: { job: j.jobNo, amount: p.profit, currency: p.currency }, message: `${j.jobNo} is losing money: ${p.profit} ${p.currency} (costs are higher than revenue).`, entity: { type: "job", id: j.id, label: j.jobNo } });
  }

  // Work waiting on someone.
  const [pending] = await db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests).where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.status, "pending")));
  if (pending.n) out.push({ severity: "info", code: "approvals.pending", params: { count: String(pending.n) }, message: `${pending.n} request(s) waiting for approval.`, entity: { type: "approvals", id: companyId, label: "Approvals" } });
  const [unverified] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(eq(documents.companyId, companyId), eq(documents.status, "received")));
  if (unverified.n) out.push({ severity: "info", code: "documents.unverified", params: { count: String(unverified.n) }, message: `${unverified.n} document(s) received but not yet verified.`, entity: { type: "documents", id: companyId, label: "Documents" } });

  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

