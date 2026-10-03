import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { invoices, moneyAccounts, partnerRoles } from "@/db/schema";
import { createWorkOrder, setWorkOrderStatus } from "@/domain/field/work-orders";
import { billDeliveries, cancelDelivery, recordDelivery } from "@/domain/supply/deliveries";
import { decideApproval } from "@/domain/approvals/approvals";
import { defineDocumentType, recordDocument, reviewDocument } from "@/domain/documents/documents";
import { createInvoice } from "@/domain/finance/invoices";
import { recordPayment } from "@/domain/finance/payments";
import { changeJobStatus, createJob } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { cancelTrip, createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { createAccount, postJournalEntry, reverseJournalEntry, setPeriodStatus } from "@/domain/accounting/ledger";
import { exchangeCurrency, reverseExchange } from "@/domain/finance/exchange";
import { createMoneyAccount, transferMoney } from "@/domain/finance/payments";
import { createContract, createProject, defineJobType, setContractStatus, setJobCapabilities } from "@/domain/jobs/commands";
import { addActivity, setActivityStatus } from "@/domain/jobs/activities";
import { setDocumentRequirement } from "@/domain/documents/documents";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { billTrips } from "@/domain/transport/billing";
import { defineRate, endRate } from "@/domain/transport/rates";
import { reverseSettlement, settleTrip } from "@/domain/transport/settlement";
import { cancelPayStatement, collectStatementDebt, createPayStatement, payStatement, writeOffStatementDebt } from "@/domain/transport/statements";
import { recordArrival } from "@/domain/transport/trips";
import type { Actor } from "./authz";
import { setSetting } from "./settings";
import type { Command } from "./command";

type Prepare = (db: Db, actor: Actor, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Pay from a money account: the currency always comes from the account, never typed by hand. */
const currencyFromMoneyAccount: Prepare = async (db, actor, input) => {
  const [m] = await db
    .select({ currency: moneyAccounts.currency })
    .from(moneyAccounts)
    .where(and(eq(moneyAccounts.id, String(input.moneyAccountId ?? "")), eq(moneyAccounts.companyId, actor.companyId)));
  return { ...input, currency: m?.currency };
};

/** Invoice lines arrive as parallel arrays (l_description[], l_quantity[], ...); empty rows are dropped. */
const invoiceLines: Prepare = async (_db, _a, input) => {
  const col = (k: string) => (input[k] as string[] | undefined) ?? [];
  const desc = col("l_description");
  const lines = desc
    .map((description, i) => ({
      description,
      quantity: col("l_quantity")[i],
      unitPrice: col("l_unitPrice")[i],
      accountId: col("l_accountId")[i],
      jobId: col("l_jobId")[i] || undefined,
    }))
    .filter((l) => l.description && l.quantity && l.unitPrice);
  const rest = Object.fromEntries(Object.entries(input).filter(([k]) => !k.startsWith("l_")));
  return { ...rest, lines };
};

/** Paying/receiving against an invoice: direction, purpose and currency follow the invoice and the chosen account. */
const invoicePayment: Prepare = async (db, actor, input) => {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, String(input.invoiceId ?? "")), eq(invoices.companyId, actor.companyId)));
  const withCurrency = await currencyFromMoneyAccount(db, actor, input);
  return inv
    ? { ...withCurrency, direction: inv.kind === "sales" ? "in" : "out", purpose: inv.kind === "sales" ? "customer_receipt" : "supplier_payment" }
    : withCurrency;
};

/** Build a settings value from prefixed form fields, e.g. "v_advances" → { advances }. Empty fields are dropped. */
const settingFromFields =
  (key: string, map: (v: string) => unknown = (v) => v): Prepare =>
  async (_db, _actor, input) => {
    const value = Object.fromEntries(
      Object.entries(input)
        .filter(([k]) => k.startsWith("v_"))
        .map(([k, v]) => [k.slice(2), map(String(v))]),
    );
    return { key, value, reason: input.reason };
  };

/** Commands that screens may submit. Anything not listed here cannot be called from a form. */
export const UI_COMMANDS: Record<string, { command: Command<any, any>; prepare?: Prepare }> = {
  "jobs.create": { command: createJob },
  "jobs.change_status": { command: changeJobStatus },
  "partners.create": { command: createPartner },
  "trips.create": { command: createTrip },
  "trips.record_loading": { command: recordLoading },
  "trips.record_discharge": { command: recordDischarge },
  "trips.cancel": { command: cancelTrip },
  "payments.record": { command: recordPayment, prepare: currencyFromMoneyAccount },
  "documents.record": { command: recordDocument },
  "documents.review": { command: reviewDocument },
  "documents.define_type": { command: defineDocumentType },
  "approvals.decide": { command: decideApproval },
  "invoices.create": { command: createInvoice, prepare: invoiceLines },
  // A bill entered on a job: bills from a supplier, or from a contractor (field work).
  "invoices.job_bill": {
    command: createInvoice,
    prepare: async (db, actor, input) => {
      const roles = await db.select({ role: partnerRoles.role }).from(partnerRoles).where(eq(partnerRoles.partnerId, String(input.partnerId ?? "")));
      const billFrom = roles.some((r) => r.role === "supplier") ? "supplier" : roles.some((r) => r.role === "contractor") ? "contractor" : undefined;
      return invoiceLines(db, actor, { ...input, billFrom });
    },
  },
  "work_orders.create": { command: createWorkOrder },
  "work_orders.set_status": { command: setWorkOrderStatus },
  "deliveries.record": { command: recordDelivery },
  "deliveries.cancel": { command: cancelDelivery },
  "deliveries.bill": { command: billDeliveries },
  "payments.invoice": { command: recordPayment, prepare: invoicePayment },
  "ledger.create_account": { command: createAccount },
  // Manual journal entry: lines arrive as parallel arrays; empty rows are dropped.
  "ledger.manual_entry": {
    command: postJournalEntry,
    prepare: async (_db, _a, input) => {
      const col = (k: string) => (input[k] as string[] | undefined) ?? [];
      const lines = col("l_accountId")
        .map((accountId, i) => ({ accountId, currency: col("l_currency")[i], debit: col("l_debit")[i] || undefined, credit: col("l_credit")[i] || undefined, memo: col("l_memo")[i] || undefined }))
        .filter((l) => l.accountId && (l.debit || l.credit));
      return { entryDate: input.entryDate, description: input.description, lines };
    },
  },
  "ledger.reverse_entry": { command: reverseJournalEntry },
  "ledger.set_period_status": { command: setPeriodStatus, prepare: async (_db, _a, i) => ({ ...i, year: Number(i.year), month: Number(i.month) }) },
  "transfers.create": { command: transferMoney },
  "exchanges.create": { command: exchangeCurrency },
  "exchanges.reverse": { command: reverseExchange },
  "money_accounts.create": { command: createMoneyAccount },
  "job_types.define": {
    command: defineJobType,
    // Checklist steps are typed one per line.
    prepare: async (_db, _a, { activitiesText, ...i }) => ({ ...i, defaultCapabilities: i.defaultCapabilities ?? [], defaultActivities: String(activitiesText ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }),
  },
  "jobs.set_capabilities": { command: setJobCapabilities, prepare: async (_db, _a, i) => ({ ...i, capabilities: i.capabilities ?? [] }) },
  "activities.add": { command: addActivity },
  "activities.set_status": { command: setActivityStatus },
  "contracts.create": { command: createContract },
  "contracts.set_status": { command: setContractStatus },
  "projects.create": { command: createProject },
  "documents.set_requirement": {
    command: setDocumentRequirement,
    prepare: async (_db, _a, i) => ({ ...i, active: i.active !== "false" }),
  },
  "settings.posting_accounts": { command: setSetting, prepare: settingFromFields("accounting.posting_accounts") },
  "settings.payment_limits": { command: setSetting, prepare: settingFromFields("approvals.payment_out_limits") },
  "settings.rounding": { command: setSetting, prepare: settingFromFields("rounding.final_increment") },
  "catalog.create_item": { command: createCatalogItem },
  "rates.define": { command: defineRate },
  "rates.end": { command: endRate },
  "trips.record_arrival": { command: recordArrival },
  "settlements.create": { command: settleTrip },
  "settlements.reverse": { command: reverseSettlement },
  "billing.bill_trips": { command: billTrips },
  "statements.create": { command: createPayStatement },
  "statements.pay": { command: payStatement },
  "statements.cancel": { command: cancelPayStatement },
  "statements.collect_debt": { command: collectStatementDebt },
  "statements.write_off_debt": { command: writeOffStatementDebt },
  "settings.trip_transit_days": {
    command: setSetting,
    prepare: async (_db, _a, i) => ({ key: "alerts.trip_transit_days", value: Number(i.days), reason: i.reason }),
  },
};
