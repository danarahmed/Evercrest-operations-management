import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, approvalRequests, invoices, businessPartners, documentRequirements, documents, documentTypes, jobs, jobTypes, moneyAccounts, partnerRoles, trips, trucks, units, users } from "@/db/schema";
import { documentChecklist } from "@/domain/documents/documents";
import { jobProfitability } from "@/domain/finance/invoices";
import { tripAdvances } from "@/domain/finance/payments";
import { getJob, jobBlockers, nextActionInfo } from "@/domain/jobs/commands";
import { quantityDifference } from "@/domain/transport/trips";
import { type Actor, can, requirePermission } from "./authz";
import { getSetting } from "./settings";
import { balanceSheet, profitAndLoss } from "@/domain/accounting/statements";
import { dec, toStr } from "@/domain/money";

/** Read models for screens. Every read checks permission server-side, like commands. */

export async function activeJobs(db: Db, actor: Actor) {
  requirePermission(actor, "jobs.view");
  const rows = await db
    .select({ job: jobs, customer: businessPartners.name, type: jobTypes.name })
    .from(jobs)
    .innerJoin(businessPartners, eq(businessPartners.id, jobs.customerId))
    .innerJoin(jobTypes, eq(jobTypes.id, jobs.jobTypeId))
    .where(and(eq(jobs.companyId, actor.companyId), inArray(jobs.status, ["draft", "open", "in_progress", "pending", "completed"])))
    .orderBy(desc(jobs.createdAt))
    .limit(100);
  return Promise.all(rows.map(async (r) => ({ ...r, nextAction: await nextActionInfo(db, r.job) })));
}

export async function jobWorkspace(db: Db, actor: Actor, jobId: string) {
  requirePermission(actor, "jobs.view");
  const job = await getJob(db, actor.companyId, jobId);
  const [customer] = await db.select().from(businessPartners).where(eq(businessPartners.id, job.customerId));
  const tripRows = await db
    .select({ trip: trips, driver: businessPartners.name, plate: trucks.plate })
    .from(trips)
    .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .where(eq(trips.jobId, job.id))
    .orderBy(trips.tripNo);
  const tripsView = await Promise.all(
    tripRows.map(async (t) => ({
      ...t,
      difference: await quantityDifference(db, t.trip),
      advances: await tripAdvances(db, actor.companyId, t.trip.id),
    })),
  );
  return {
    job,
    customer: customer.name,
    nextAction: await nextActionInfo(db, job),
    blockers: await jobBlockers(db, job),
    trips: tripsView,
    documents: await documentChecklist(db, job),
    // Financial figures only for people allowed to see them.
    profitability: can(actor, "reports.financial.view") ? await jobProfitability(db, job.id) : null,
  };
}

/** Choices for forms. Only active records. */
export async function formOptions(db: Db, actor: Actor) {
  const partnersWith = async (role: "driver" | "transporter" | "customer") =>
    db
      .select({ id: businessPartners.id, name: businessPartners.name })
      .from(businessPartners)
      .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
      .where(and(eq(businessPartners.companyId, actor.companyId), eq(businessPartners.active, true)))
      .orderBy(businessPartners.name);
  return {
    drivers: await partnersWith("driver"),
    transporters: await partnersWith("transporter"),
    customers: await partnersWith("customer"),
    jobTypes: await db.select({ id: jobTypes.id, name: jobTypes.name }).from(jobTypes).where(eq(jobTypes.companyId, actor.companyId)).orderBy(jobTypes.name),
    moneyAccounts: await db.select({ id: moneyAccounts.id, name: moneyAccounts.name, currency: moneyAccounts.currency }).from(moneyAccounts).where(and(eq(moneyAccounts.companyId, actor.companyId), eq(moneyAccounts.active, true))).orderBy(moneyAccounts.name),
    documentTypes: await db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes).where(eq(documentTypes.companyId, actor.companyId)).orderBy(documentTypes.name),
    units: await db.select({ code: units.code, name: units.name }).from(units).orderBy(units.code),
    users: await db.select({ id: users.id, name: users.displayName }).from(users).where(and(eq(users.companyId, actor.companyId), eq(users.active, true))).orderBy(users.displayName),
  };
}
export type FormOptions = Awaited<ReturnType<typeof formOptions>>;

/** Requests waiting for a decision. The requester's own requests are shown but cannot be approved by them. */
export async function pendingApprovals(db: Db, actor: Actor) {
  requirePermission(actor, "approvals.decide");
  const rows = await db
    .select({ req: approvalRequests, requester: users.displayName })
    .from(approvalRequests)
    .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
    .where(and(eq(approvalRequests.companyId, actor.companyId), eq(approvalRequests.status, "pending")))
    .orderBy(approvalRequests.createdAt);
  return rows.map(({ req, requester }) => {
    const input = req.input as Record<string, unknown>;
    return {
      id: req.id,
      command: req.command,
      summary: req.summary,
      requester,
      own: req.requestedBy === actor.userId,
      createdAt: req.createdAt,
      amount: typeof input.amount === "string" ? input.amount : null,
      currency: typeof input.currency === "string" ? input.currency : null,
    };
  });
}

/** Documents received and waiting for verification, with what they belong to. */
export async function documentsToVerify(db: Db, actor: Actor) {
  requirePermission(actor, "documents.verify");
  const rows = await db
    .select({ doc: documents, type: documentTypes.name, jobNo: jobs.jobNo, jobId: jobs.id, receivedBy: users.displayName })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
    .innerJoin(users, eq(users.id, documents.receivedBy))
    .leftJoin(jobs, eq(jobs.id, documents.jobId))
    .where(and(eq(documents.companyId, actor.companyId), eq(documents.status, "received")))
    .orderBy(documents.createdAt);
  const tripIds = rows.filter((r) => r.doc.entityType === "trip").map((r) => r.doc.entityId);
  const tripNos = tripIds.length ? await db.select({ id: trips.id, no: trips.tripNo }).from(trips).where(inArray(trips.id, tripIds)) : [];
  return rows.map((r) => ({
    id: r.doc.id,
    type: r.type,
    reference: r.doc.reference,
    jobId: r.jobId,
    target: r.doc.entityType === "trip" ? tripNos.find((x) => x.id === r.doc.entityId)?.no ?? "" : r.jobNo ?? "",
    receivedBy: r.receivedBy,
    receivedAt: r.doc.createdAt,
  }));
}

/** Everything the setup page shows. Each section is only loaded for users allowed to manage it. */
export async function setupData(db: Db, actor: Actor) {
  const c = actor.companyId;
  const has = (p: Parameters<typeof can>[1]) => can(actor, p);
  const partners = has("partners.manage")
    ? await db.select({ id: businessPartners.id, name: businessPartners.name, phone: businessPartners.phone, roles: sql<string[]>`array_agg(${partnerRoles.role} order by ${partnerRoles.role})` })
        .from(businessPartners).leftJoin(partnerRoles, eq(partnerRoles.partnerId, businessPartners.id))
        .where(eq(businessPartners.companyId, c)).groupBy(businessPartners.id).orderBy(businessPartners.name).limit(500)
    : null;
  const accountList = has("accounts.manage") || has("settings.manage") || has("money_accounts.manage")
    ? await db.select().from(accounts).where(eq(accounts.companyId, c)).orderBy(accounts.code)
    : [];
  return {
    partners,
    accounts: has("accounts.manage") ? accountList : null,
    moneyAccounts: has("money_accounts.manage") ? await db.select().from(moneyAccounts).where(eq(moneyAccounts.companyId, c)).orderBy(moneyAccounts.name) : null,
    /** Asset accounts restricted to one currency: the only valid backing for a cash box or bank account. */
    cashLedgerAccounts: accountList.filter((a) => a.type === "asset" && a.postable && a.currency),
    postableAccounts: accountList.filter((a) => a.postable && a.active),
    settings: has("settings.manage")
      ? {
          posting: (await getSetting(db, c, "accounting.posting_accounts")) ?? {},
          limits: (await getSetting(db, c, "approvals.payment_out_limits")) ?? {},
          transitDays: (await getSetting(db, c, "alerts.trip_transit_days")) ?? null,
        }
      : null,
    jobTypes: has("job_types.manage") ? await db.select().from(jobTypes).where(eq(jobTypes.companyId, c)).orderBy(jobTypes.name) : null,
    documentTypes: has("documents.configure") ? await db.select().from(documentTypes).where(eq(documentTypes.companyId, c)).orderBy(documentTypes.name) : null,
    documentRules: has("documents.configure")
      ? await db.select({ r: documentRequirements, type: documentTypes.name }).from(documentRequirements).innerJoin(documentTypes, eq(documentTypes.id, documentRequirements.documentTypeId)).where(eq(documentRequirements.companyId, c))
      : null,
  };
}

/** Posted invoices/bills that still have an amount outstanding, with that amount. */
export async function openInvoices(db: Db, actor: Actor) {
  requirePermission(actor, "reports.financial.view");
  const rows = await db
    .select({
      id: invoices.id,
      no: invoices.invoiceNo,
      kind: invoices.kind,
      partner: businessPartners.name,
      currency: invoices.currency,
      total: invoices.total,
      dueDate: invoices.dueDate,
      paid: sql<string>`coalesce((select sum(p.amount) from payments p where p.invoice_id = ${invoices.id} and p.status = 'posted'), 0)`,
    })
    .from(invoices)
    .innerJoin(businessPartners, eq(businessPartners.id, invoices.partnerId))
    .where(and(eq(invoices.companyId, actor.companyId), eq(invoices.status, "posted")))
    .orderBy(invoices.invoiceDate);
  return rows
    .map((r) => ({ ...r, outstanding: toStr(dec(r.total).minus(dec(r.paid))) }))
    .filter((r) => dec(r.outstanding).gt(0));
}

export async function financeReports(db: Db, actor: Actor, from: string, to: string) {
  requirePermission(actor, "reports.financial.view");
  return {
    pl: await profitAndLoss(db, actor.companyId, from, to),
    bs: await balanceSheet(db, actor.companyId, to),
  };
}

export async function financeOptions(db: Db, actor: Actor) {
  requirePermission(actor, "invoices.create");
  const c = actor.companyId;
  return {
    partners: await db
      .select({ id: businessPartners.id, name: businessPartners.name, roles: sql<string[]>`array_agg(${partnerRoles.role})` })
      .from(businessPartners)
      .innerJoin(partnerRoles, eq(partnerRoles.partnerId, businessPartners.id))
      .where(and(eq(businessPartners.companyId, c), eq(businessPartners.active, true)))
      .groupBy(businessPartners.id)
      .orderBy(businessPartners.name),
    incomeAccounts: await db.select().from(accounts).where(and(eq(accounts.companyId, c), eq(accounts.type, "income"), eq(accounts.postable, true), eq(accounts.active, true))).orderBy(accounts.code),
    costAccounts: await db.select().from(accounts).where(and(eq(accounts.companyId, c), inArray(accounts.type, ["expense", "asset"]), eq(accounts.postable, true), eq(accounts.active, true))).orderBy(accounts.code),
    openJobs: await db.select({ id: jobs.id, jobNo: jobs.jobNo, name: jobs.name }).from(jobs).where(and(eq(jobs.companyId, c), inArray(jobs.status, ["open", "in_progress", "pending", "completed"]))).orderBy(desc(jobs.createdAt)).limit(200),
    moneyAccounts: await db.select({ id: moneyAccounts.id, name: moneyAccounts.name, currency: moneyAccounts.currency }).from(moneyAccounts).where(and(eq(moneyAccounts.companyId, c), eq(moneyAccounts.active, true))),
  };
}
