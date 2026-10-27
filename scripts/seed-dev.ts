/**
 * Development data only. Creates a company, an administrator and a few realistic
 * jobs so the screens can be tried. Never run against a production database.
 *   DATABASE_URL=... npx tsx scripts/seed-dev.ts
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { feeTypes } from "@/db/schema";
import "@/domain/register";
import { postJournalEntry } from "@/domain/accounting/ledger";
import { recordDocument } from "@/domain/documents/documents";
import { createInvoice } from "@/domain/finance/invoices";
import { recordPayment } from "@/domain/finance/payments";
import { createContract, createJob, createProject } from "@/domain/jobs/commands";
import { defineCustomField, setJobBudget, setJobCustomValues } from "@/domain/jobs/custom-fields";
import { createPartner } from "@/domain/masterdata/partners";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { defineRate } from "@/domain/transport/rates";
import { setJobFee, setTerms } from "@/domain/transport/terms";
import { createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { createWorkOrder } from "@/domain/field/work-orders";
import { recordDelivery } from "@/domain/supply/deliveries";
import { assignRole, createUser } from "@/domain/org/commands";
import { loadActor } from "@/server/actor";
import { setupCompany } from "@/server/bootstrap";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { applyStarterConfiguration } from "@/server/starter";

const db = getDb();
const { adminUserId, companyId } = await setupCompany(db, { companyName: "Evercrest (dev)", adminEmail: "admin@evercrest.local", adminName: "Admin" });
const admin = await loadActor(db, adminUserId);
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(db, admin, cmd as never, input) as Promise<T>;

// The same starting configuration as production (accounts, posting accounts, job types, manifest rule, cash boxes, roles).
const starter = await applyStarterConfiguration(db, admin, "dev setup");
const acc = starter.accounts;
const capitalDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
await run(postJournalEntry, { entryDate: capitalDate, description: "Opening capital", lines: [
  { accountId: acc["1011"], currency: "USD", debit: "20000" }, { accountId: acc["3000"], currency: "USD", credit: "20000" },
  { accountId: acc["1012"], currency: "IQD", debit: "30000000" }, { accountId: acc["3000"], currency: "IQD", credit: "30000000" },
] });
const usd = starter.moneyAccounts.usd;
const iqd = starter.moneyAccounts.iqd;

const diesel = (await run(createCatalogItem, { kind: "product", code: "DSL", name: "Diesel", defaultUnit: "MT" })).id;
const northOil = (await run(createPartner, { kind: "organization", name: "North Oil Co", roles: ["customer"] })).id;
const zagros = (await run(createPartner, { kind: "organization", name: "Zagros Transport", roles: ["transporter"] })).id;
const rate = (r: Record<string, unknown>) => run(defineRate, { effectiveFrom: "2026-01-01", reason: "dev price list", productId: diesel, ...r });
await rate({ rateType: "driver_pay", basis: "actual_qty", amount: "40000", currency: "IQD", unit: "MT" });
await rate({ rateType: "allowance", basis: "quantity", amount: "0.20", unit: "MT" });
await rate({ rateType: "shortage_fine", basis: "quantity", amount: "600000", currency: "IQD", unit: "MT" });
await rate({ rateType: "customer_price", basis: "actual_qty", amount: "55000", currency: "IQD", unit: "MT", customerId: northOil });
await rate({ rateType: "transporter_fee", basis: "per_trip", amount: "100000", currency: "IQD", transporterId: zagros });
const { ptr, sup, fld } = starter.jobTypes;
const generator = (await run(createCatalogItem, { kind: "product", code: "GEN100", name: "Generator 100 kVA", defaultUnit: "EA" })).id;
const zagrosMaint = (await run(createPartner, { kind: "organization", name: "Zagros Maintenance", roles: ["contractor"] })).id;
const kurdSupply = (await run(createPartner, { kind: "organization", name: "Kurd Supply Co", roles: ["supplier"] })).id;
const manifest = starter.documentTypes.manifest;
const today = new Date();
const d = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
const contract = (await run(createContract, { partnerId: northOil, reference: "NO-2026-01", title: "Diesel supply and transport 2026", status: "active", validFrom: "2026-01-01", validTo: "2026-12-31" })).id;
const project = (await run(createProject, { customerId: northOil, contractId: contract, code: "FX", name: "Field X operations" })).id;
const job = await run<{ id: string }>(createJob, { customerId: northOil, jobTypeId: ptr, name: "Diesel to Field X", startDate: d(10), responsibleUserId: adminUserId, projectId: project, contractId: contract });
const genJob = (await run(createJob, { customerId: northOil, jobTypeId: sup, name: "Supply 10 generators", startDate: d(2), responsibleUserId: adminUserId, description: "Customer asked for 10 x 100 kVA generators" })).id;
await run(defineRate, { rateType: "product_price", basis: "per_unit", amount: "4500", currency: "USD", unit: "EA", productId: generator, effectiveFrom: "2026-01-01", reason: "dev price list" });
await run(recordDelivery, { jobId: genJob, productId: generator, quantity: "6", unit: "EA", deliveryDate: d(1), deliveredTo: "North Oil warehouse, Kirkuk", reference: "DN-301" });
const fieldJob = (await run(createJob, { customerId: northOil, jobTypeId: fld, name: "Pump maintenance, Field Y", startDate: d(3), responsibleUserId: adminUserId })).id;
await run(createWorkOrder, { jobId: fieldJob, site: "Field Y, well 7", description: "Replace pump seals and test", contractorId: zagrosMaint, plannedDate: d(-2) });
await run(createWorkOrder, { jobId: fieldJob, site: "Field Y, well 9", description: "Inspect valves", plannedDate: d(-4) });
// The job's rule card (owner's diesel terms): customer 120 USD/MT, driver 70 USD/MT, allowance 0.15 t, fine 1,200 USD/t, border fees, customs 30 USD per loaded ton.
await run(setTerms, { jobId: job.id, effectiveFrom: "2026-01-01", currency: "USD", unit: "MT", customerPrice: "120", carrierPrice: "70", carrierAllowance: "0.15", carrierFinePrice: "1200", advanceNormal: "900", advanceMax: "900" });
for (const [name, amount, basis] of [["Visa", "50", "per_trip"], ["Insurance", "75", "per_trip"], ["Customs", "30", "per_loaded_unit"]] as const) {
  const ft = (await db.select().from(feeTypes).where(and(eq(feeTypes.companyId, companyId), eq(feeTypes.name, name))))[0];
  if (ft) await run(setJobFee, { jobId: job.id, feeTypeId: ft.id, effectiveFrom: "2026-01-01", amount, currency: "USD", basis });
}
const t1 = await run<{ id: string }>(createTrip, { jobId: job.id, newDriverName: "Ahmed Karim", truckPlate: "12 B 34567", transporterId: zagros, productId: diesel });
await run(recordLoading, { tripId: t1.id, loadingDate: d(9), loadedQty: "30", loadedUnit: "MT" });
await run(recordDischarge, { tripId: t1.id, dischargeDate: d(7), dischargedQty: "29750", dischargedUnit: "KG" });
await run(recordDocument, { documentTypeId: manifest, entityType: "trip", entityId: t1.id, reference: "MF-1001" });
const t2 = await run<{ id: string }>(createTrip, { jobId: job.id, newDriverName: "Karwan Ali", truckPlate: "21 A 99881", productId: diesel });
await run(recordLoading, { tripId: t2.id, loadingDate: d(6), loadedQty: "36000", loadedUnit: "L" });
await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: usd, amount: "200", currency: "USD", paymentDate: d(9), method: "cash", tripId: t1.id });
await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: iqd, amount: "250000", currency: "IQD", paymentDate: d(6), method: "cash", tripId: t2.id });
await run(createInvoice, { kind: "sales", partnerId: northOil, currency: "USD", invoiceDate: d(7), dueDate: d(2), lines: [{ description: "Site support", quantity: "1", unitPrice: "3000", accountId: acc["4000"], jobId: job.id }] });
await run(recordPayment, { direction: "out", purpose: "expense", moneyAccountId: iqd, amount: "175000", currency: "IQD", paymentDate: d(8), method: "cash", jobId: job.id, counterAccountId: acc["5300"], notes: "Field entry permit", reference: "R-554" });
await run(createInvoice, { kind: "bill", billFrom: "supplier", partnerId: kurdSupply, currency: "IQD", invoiceDate: d(5), dueDate: d(-25), externalRef: "KS-88", lines: [{ description: "Truck tyre repair", quantity: "1", unitPrice: "120000", accountId: acc["5200"], jobId: job.id }] });
await run(defineCustomField, { key: "customer_ref", label: "Customer PO / reference", scope: "customer", scopeId: northOil, required: true, requiredBefore: "financially_closed" });
await run(setJobCustomValues, { jobId: job.id, values: { customer_ref: "NOC-PO-2026-118" } });
await run(setJobBudget, { jobId: job.id, amount: "2500000", currency: "IQD" });
// A second person so approvals (four-eyes) can be tried, and a payment limit that triggers them.
const finance = await run<{ id: string }>(createUser, { email: "finance@evercrest.local", displayName: "Finance Manager" });
await run(assignRole, { userId: finance.id, roleId: starter.roles.finance, grant: true, reason: "dev setup" });
await run(setSetting, { key: "approvals.payment_out_limits", value: { USD: "1000", IQD: "1500000" }, reason: "dev setup" });
console.log("dev data ready; admin user id:", adminUserId);
process.exit(0);
