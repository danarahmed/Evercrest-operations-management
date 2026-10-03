/**
 * Development data only. Creates a company, an administrator and a few realistic
 * jobs so the screens can be tried. Never run against a production database.
 *   DATABASE_URL=... npx tsx scripts/seed-dev.ts
 */
import { getDb } from "@/db/client";
import "@/domain/register";
import { createAccount, postJournalEntry } from "@/domain/accounting/ledger";
import { defineDocumentType, recordDocument, setDocumentRequirement } from "@/domain/documents/documents";
import { createInvoice } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment } from "@/domain/finance/payments";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { loadActor } from "@/server/actor";
import { setupCompany } from "@/server/bootstrap";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";

const db = getDb();
const { adminUserId } = await setupCompany(db, { companyName: "Evercrest (dev)", adminEmail: "admin@evercrest.local", adminName: "Admin" });
const admin = await loadActor(db, adminUserId);
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(db, admin, cmd as never, input) as Promise<T>;

const acc: Record<string, string> = {};
for (const [code, name, type, currency] of [
  ["1011", "Cash USD", "asset", "USD"], ["1012", "Cash IQD", "asset", "IQD"], ["1100", "Customer receivables", "asset"],
  ["1300", "Advances to drivers/transporters", "asset"], ["1900", "Currency exchange", "asset"], ["2100", "Supplier payables", "liability"],
  ["2200", "Payables to transporters", "liability"], ["3000", "Capital", "equity"], ["4000", "Transport revenue", "income"],
  ["5000", "Transport costs", "expense"], ["5100", "Field expenses", "expense"],
] as const) acc[code] = (await run(createAccount, { code, name, type, currency })).id;
await run(setSetting, { key: "accounting.posting_accounts", value: { advances: "1300", customer_receivables: "1100", supplier_payables: "2100", payables_to_transporters: "2200", currency_exchange: "1900" }, reason: "dev setup" });
await run(setSetting, { key: "alerts.trip_transit_days", value: 3, reason: "dev setup" });
const capitalDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
await run(postJournalEntry, { entryDate: capitalDate, description: "Opening capital", lines: [
  { accountId: acc["1011"], currency: "USD", debit: "20000" }, { accountId: acc["3000"], currency: "USD", credit: "20000" },
  { accountId: acc["1012"], currency: "IQD", debit: "30000000" }, { accountId: acc["3000"], currency: "IQD", credit: "30000000" },
] });
const usd = (await run(createMoneyAccount, { name: "Main safe USD", kind: "cash", currency: "USD", ledgerAccountId: acc["1011"] })).id;
const iqd = (await run(createMoneyAccount, { name: "Main safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: acc["1012"] })).id;

const northOil = (await run(createPartner, { kind: "organization", name: "North Oil Co", roles: ["customer"] })).id;
const zagros = (await run(createPartner, { kind: "organization", name: "Zagros Transport", roles: ["transporter"] })).id;
const ptr = (await run(defineJobType, { code: "PTR", name: "Petroleum transportation", defaultCapabilities: ["transportation", "advances", "documents", "billing"] })).id;
const manifest = (await run(defineDocumentType, { code: "MANIFEST", name: "Manifest" })).id;
await run(setDocumentRequirement, { documentTypeId: manifest, scope: "job_type", scopeId: ptr, appliesTo: "trip", requiredBefore: "completed", active: true, reason: "policy" });

const today = new Date();
const d = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
const job = await run<{ id: string }>(createJob, { customerId: northOil, jobTypeId: ptr, name: "Diesel to Field X", startDate: d(10), responsibleUserId: adminUserId });
const t1 = await run<{ id: string }>(createTrip, { jobId: job.id, newDriverName: "Ahmed Karim", truckPlate: "12 B 34567", transporterId: zagros });
await run(recordLoading, { tripId: t1.id, loadingDate: d(9), loadedQty: "30", loadedUnit: "MT" });
await run(recordDischarge, { tripId: t1.id, dischargeDate: d(7), dischargedQty: "29750", dischargedUnit: "KG" });
await run(recordDocument, { documentTypeId: manifest, entityType: "trip", entityId: t1.id, reference: "MF-1001" });
const t2 = await run<{ id: string }>(createTrip, { jobId: job.id, newDriverName: "Karwan Ali", truckPlate: "21 A 99881" });
await run(recordLoading, { tripId: t2.id, loadingDate: d(6), loadedQty: "36000", loadedUnit: "L" });
await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: usd, amount: "200", currency: "USD", paymentDate: d(9), method: "cash", tripId: t1.id });
await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: iqd, amount: "250000", currency: "IQD", paymentDate: d(6), method: "cash", tripId: t2.id });
await run(createInvoice, { kind: "sales", partnerId: northOil, currency: "USD", invoiceDate: d(7), dueDate: d(2), lines: [{ description: "Transport 30 MT", quantity: "30", unit: "MT", unitPrice: "100", accountId: acc["4000"], tripId: t1.id }] });
await run(createInvoice, { kind: "bill", billFrom: "transporter", partnerId: zagros, currency: "USD", invoiceDate: d(7), lines: [{ description: "Haulage 30 MT", quantity: "30", unit: "MT", unitPrice: "70", accountId: acc["5000"], tripId: t1.id }] });
// A second person so approvals (four-eyes) can be tried, and a payment limit that triggers them.
const finance = await run<{ id: string }>(createUser, { email: "finance@evercrest.local", displayName: "Finance Manager" });
const role = await run<{ id: string }>(defineRole, { code: "finance", name: "Finance", permissions: ["jobs.view", "approvals.decide", "documents.verify", "payments.create", "reports.financial.view"], reason: "dev setup" });
await run(assignRole, { userId: finance.id, roleId: role.id, grant: true, reason: "dev setup" });
await run(setSetting, { key: "approvals.payment_out_limits", value: { USD: "1000", IQD: "1500000" }, reason: "dev setup" });
console.log("dev data ready; admin user id:", adminUserId);
process.exit(0);
