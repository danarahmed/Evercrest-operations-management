import { createAccount } from "@/domain/accounting/ledger";
import { defineDocumentType, setDocumentRequirement } from "@/domain/documents/documents";
import { createMoneyAccount } from "@/domain/finance/payments";
import { defineJobType } from "@/domain/jobs/commands";
import { defineRole } from "@/domain/org/commands";
import type { Db } from "@/db/client";
import type { Actor } from "./authz";
import { runCommand } from "./command";
import { setSetting } from "./settings";

/**
 * The company's starting configuration: chart of accounts, posting accounts,
 * the four job templates, the manifest rule, two cash boxes and three suggested
 * roles. Everything goes through the normal audited commands and can be changed
 * afterwards in Setup and Users & roles. Used by the production setup and by the
 * development seed, so both start from the same configuration.
 */
export const STARTER_ACCOUNTS = [
  ["1011", "Cash USD", "asset", "USD"], ["1012", "Cash IQD", "asset", "IQD"], ["1100", "Customer receivables", "asset"],
  ["1300", "Advances to drivers/transporters", "asset"], ["1900", "Currency exchange", "asset"], ["2100", "Supplier payables", "liability"],
  ["2200", "Payables to transporters", "liability"], ["2300", "Payables to drivers", "liability"], ["3000", "Capital", "equity"],
  ["4000", "Transport revenue", "income"], ["4100", "Shortage fines", "income"], ["4200", "Demurrage revenue", "income"], ["4300", "Product sales", "income"],
  ["5000", "Transport costs", "expense"], ["5010", "Transporter costs", "expense"], ["5100", "Field expenses", "expense"], ["5200", "Fuel and vehicle costs", "expense"],
  ["5300", "Permits and fees", "expense"], ["5400", "Cost of goods purchased", "expense"], ["5500", "Labour and contractors", "expense"],
  ["5900", "Rounding differences", "expense"], ["5950", "Bad debts written off", "expense"],
] as const;

export const STARTER_POSTING_ACCOUNTS = {
  advances: "1300", customer_receivables: "1100", supplier_payables: "2100", payables_to_transporters: "2200", payables_to_drivers: "2300",
  currency_exchange: "1900", driver_costs: "5000", transporter_costs: "5010", shortage_fines: "4100", transport_revenue: "4000",
  demurrage_revenue: "4200", rounding_differences: "5900", bad_debts: "5950", product_sales: "4300",
};

/** Suggested roles; the owner adjusts them in Users & roles. */
export const STARTER_ROLES = [
  {
    code: "operations",
    name: "Operations",
    permissions: ["jobs.view", "jobs.create", "jobs.manage", "trips.manage", "documents.record", "partners.manage", "catalog.manage"],
  },
  {
    code: "finance",
    name: "Finance",
    permissions: [
      "jobs.view", "documents.verify", "approvals.decide", "payments.create", "settlements.create", "billing.create",
      "invoices.create", "exchanges.create", "reports.financial.view",
    ],
  },
  {
    code: "accountant",
    name: "Accountant",
    permissions: ["jobs.view", "reports.financial.view", "journal.post", "journal.reverse", "periods.manage", "accounts.manage", "money_accounts.manage", "audit.view"],
  },
] as const;

export async function applyStarterConfiguration(db: Db, admin: Actor, reason = "initial setup") {
  const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(db, admin, cmd as never, input) as Promise<T>;

  const accounts: Record<string, string> = {};
  for (const [code, name, type, currency] of STARTER_ACCOUNTS) accounts[code] = (await run(createAccount, { code, name, type, currency })).id;
  await run(setSetting, { key: "accounting.posting_accounts", value: STARTER_POSTING_ACCOUNTS, reason });
  await run(setSetting, { key: "rounding.final_increment", value: { IQD: "250" }, reason });
  await run(setSetting, { key: "alerts.trip_transit_days", value: 3, reason });

  const moneyAccounts = {
    usd: (await run(createMoneyAccount, { name: "Main safe USD", kind: "cash", currency: "USD", ledgerAccountId: accounts["1011"] })).id,
    iqd: (await run(createMoneyAccount, { name: "Main safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: accounts["1012"] })).id,
  };

  const jobTypes = {
    ptr: (await run(defineJobType, { code: "PTR", name: "Petroleum transportation", defaultCapabilities: ["transportation", "advances", "documents", "billing", "expenses"], defaultActivities: ["Arrange trucks", "Load at depot", "Deliver to field", "Collect manifests", "Invoice customer"] })).id,
    gen: (await run(defineJobType, { code: "GEN", name: "General service", defaultCapabilities: ["expenses", "billing", "documents"] })).id,
    sup: (await run(defineJobType, { code: "SUP", name: "Product supply", defaultCapabilities: ["products", "expenses", "billing"], defaultActivities: ["Confirm order", "Buy from supplier", "Deliver", "Invoice customer"] })).id,
    fld: (await run(defineJobType, { code: "FLD", name: "Field service", defaultCapabilities: ["field_work", "expenses", "billing", "documents"], defaultActivities: ["Mobilize team", "Buy materials", "Perform work", "Inspect", "Invoice customer"] })).id,
  };

  const manifest = (await run(defineDocumentType, { code: "MANIFEST", name: "Manifest" })).id;
  await run(setDocumentRequirement, { documentTypeId: manifest, scope: "job_type", scopeId: jobTypes.ptr, appliesTo: "trip", requiredBefore: "completed", active: true, reason });

  const roles: Record<string, string> = {};
  for (const r of STARTER_ROLES) roles[r.code] = (await run(defineRole, { code: r.code, name: r.name, permissions: [...r.permissions], reason })).id;

  return { accounts, moneyAccounts, jobTypes, documentTypes: { manifest }, roles };
}
