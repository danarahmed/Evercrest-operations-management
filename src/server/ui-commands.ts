import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { invoices, moneyAccounts, partnerRoles } from "@/db/schema";
import { createWorkOrder, setWorkOrderStatus } from "@/domain/field/work-orders";
import { billDeliveries, cancelDelivery, recordDelivery } from "@/domain/supply/deliveries";
import { decideApproval } from "@/domain/approvals/approvals";
import { attachDocumentFile, defineDocumentType, recordDocument, reviewDocument, waiveDocument } from "@/domain/documents/documents";
import { createInvoice } from "@/domain/finance/invoices";
import { recordPayment, reversePayment } from "@/domain/finance/payments";
import { changeJobStatus, createJob } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { cancelTrip, createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { assignRole, createUser, defineRole, inviteUser, setUserActive } from "@/domain/org/commands";
import { sendInvitation } from "./invites";
import { createAccount, deleteAccount, postJournalEntry, reverseJournalEntry, setPeriodStatus, updateAccount } from "@/domain/accounting/ledger";
import { exchangeCurrency, reverseExchange } from "@/domain/finance/exchange";
import { createMoneyAccount, transferMoney } from "@/domain/finance/payments";
import { createContract, createProject, defineJobType, setContractStatus, setJobCapabilities, updateContract, attachContractFile, setJobTeam } from "@/domain/jobs/commands";
import { addActivity, setActivityStatus } from "@/domain/jobs/activities";
import { defineCustomField, setJobBudget, setJobCustomValues } from "@/domain/jobs/custom-fields";
import { setDocumentRequirement } from "@/domain/documents/documents";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { billTrips } from "@/domain/transport/billing";
import { addFeeToTrips, payFees, waiveFeeReceipt } from "@/domain/transport/fees";
import { defineRate, endRate } from "@/domain/transport/rates";
import { reverseSettlement, settleTrip } from "@/domain/transport/settlement";
import { cancelPayStatement, collectStatementDebt, createPayStatement, payStatement, writeOffStatementDebt } from "@/domain/transport/statements";
import { recordArrival } from "@/domain/transport/trips";
import { defineFeeType, defineRoute, setJobBilledFees, setJobFee, setTerms, setRoutePrice } from "@/domain/transport/terms";
import { applyTripImport, discardTripImport, saveTripRows } from "@/domain/transport/trip-import";
import { saveTrip } from "@/domain/transport/trip-edit";
import { cancelClaim, createClaim, payClaim, waiveFine } from "@/domain/transport/claims";
import { approveRemoteSettlement, discardRemoteSettlement } from "@/domain/transport/remote";
import { defineDeductionType } from "@/domain/transport/deductions";
import { bookCustoms, payCustomsAgent, reverseCustomsBooking, setCustomsRate, setJobCustoms, useStatementQuantities } from "@/domain/transport/customs";
import { closeHeldCuts, giveBackCuts, reverseCutRelease } from "@/domain/transport/held-cuts";
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
/** Runs after the command committed (e.g. sending an e-mail); a failure here never undoes the saved record. */
type After = (input: Record<string, unknown>, result: unknown) => Promise<void>;

/**
 * file: the form may carry a scanned copy in "__file". It is stored first (Supabase
 * Storage) and the command records it; if the command fails, the upload is removed.
 */
export const UI_COMMANDS: Record<string, { command: Command<any, any>; prepare?: Prepare; after?: After; file?: boolean }> = {
  "jobs.create": { command: createJob, prepare: async (_d, _a, i) => ({ ...i, memberUserIds: i.memberUserIds ?? [] }) },
  "jobs.set_team": { command: setJobTeam, prepare: async (_d, _a, i) => ({ ...i, memberUserIds: i.memberUserIds ?? [] }) },
  "jobs.change_status": { command: changeJobStatus },
  "partners.create": { command: createPartner },
  "trips.create": { command: createTrip },
  "trips.record_loading": { command: recordLoading },
  "trips.record_discharge": { command: recordDischarge },
  "trips.cancel": { command: cancelTrip },
  // The job's rule card. Checkboxes arrive as "on"; absent means false.
  "job_routes.define": { command: defineRoute },
  "route_prices.set": { command: setRoutePrice, prepare: async (_d, _a, i) => ({ ...i, routeId: i.routeId || null, routeName: i.routeId ? null : i.routeName || null }) },
  "job_terms.set": { command: setTerms },
  "fee_types.define": { command: defineFeeType, prepare: async (_d, _a, i) => ({ ...i, id: i.id || undefined, deductFromCarrier: i.deductFromCarrier === "on", billedToCustomer: i.billedToCustomer === "on", active: i.active !== "off" }) },
  "job_fees.set": { command: setJobFee, prepare: async (_d, _a, i) => ({ ...i, deductFromCarrier: i.deductFromCarrier === "on", billedToCustomer: i.billedToCustomer === "on" }) },
  "trip_imports.apply": { command: applyTripImport },
  // One screen per trip; an empty transporter field means "direct with the driver".
  // Fees arrive as fee_<feeTypeId>=on with feeAmount_<feeTypeId>; the form marks feesShown=1 so an empty list means "no fees".
  "trips.save": {
    command: saveTrip,
    prepare: async (_d, _a, i) => {
      // Each ticked fee: its amount, who paid it on this trip, and (when the driver paid it) whether the receipt came.
      const fees = Object.keys(i)
        .filter((k) => k.startsWith("fee_") && i[k] === "on")
        .map((k) => {
          const id = k.slice(4);
          const paidBy = (i[`feePaidBy_${id}`] as string) || null;
          return { feeTypeId: id, amount: (i[`feeAmount_${id}`] as string) || null, paidBy: paidBy as "company" | "customer" | "carrier" | null, receipt: i[`feeReceipt_${id}`] === "on" };
        });
      // Deductions the company keeps: ded_<deductionTypeId>=on with dedAmount_<id>; dedShown=1 marks the fieldset was on the form.
      const deductions = Object.keys(i).filter((k) => k.startsWith("ded_") && i[k] === "on").map((k) => ({ deductionTypeId: k.slice(4), amount: (i[`dedAmount_${k.slice(4)}`] as string) || null }));
      const rest = Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith("fee_") && !k.startsWith("feeAmount_") && !k.startsWith("feePaidBy_") && !k.startsWith("feeReceipt_") && k !== "feesShown" && !k.startsWith("ded_") && !k.startsWith("dedAmount_") && k !== "dedShown"));
      return { ...rest, ...(i.feesShown === "1" ? { fees } : {}), ...(i.dedShown === "1" ? { deductions } : {}), ...(i.transporterId === undefined && i.transporterName === undefined && i.transporterClear === "1" ? { transporterId: null } : {}) };
    },
  },
  "trip_fees.add_many": {
    command: addFeeToTrips,
    prepare: async (_d, _a, i) => ({ ...i, amount: i.amount || null, manifests: String(i.manifests ?? "").split(/[\n,;،]+/).map((x) => x.trim()).filter(Boolean) }),
  },
  "customs_rates.set": { command: setCustomsRate, prepare: async (_d, _a, i) => ({ ...i, routeId: i.routeId || null, note: i.note || null }) },
  "job_customs.set": { command: setJobCustoms, prepare: async (_d, _a, i) => ({ jobId: i.jobId, agentId: i.agentId || null, agentName: i.agentName || null, billedToCustomer: i.billedToCustomer === "on" }) },
  "customs.pay_agent": { command: payCustomsAgent, prepare: async (_d, _a, i) => ({ ...i, reference: i.reference || null }) },
  "customs.book": { command: bookCustoms },
  "customs.reverse_booking": { command: reverseCustomsBooking },
  "customs_statements.use_quantities": { command: useStatementQuantities, prepare: async (_d, _a, i) => ({ statementId: i.statementId, tripIds: (i.tripIds as string[] | undefined) ?? [] }) },
  "job_billed_fees.set": { command: setJobBilledFees, prepare: async (_d, _a, i) => ({ ...i, feeTypeIds: (i.feeTypeIds as string[] | undefined) ?? [], note: i.note || null }) },
  "trip_fees.receipt_waive": { command: waiveFeeReceipt },
  "deduction_types.define": { command: defineDeductionType, prepare: async (_d, _a, i) => ({ ...i, id: i.id || undefined, active: i.active === "on" }) },
  // Held cuts: the ticked trips (tripIds[]) with the amount given back on each (give_<tripId>).
  "held_cuts.give_back": {
    command: giveBackCuts,
    prepare: async (_d, _a, i) => {
      const picked = (i.tripIds as string[] | undefined) ?? [];
      return { transporterId: i.transporterId || null, transporterName: i.transporterName || null, releaseDate: i.releaseDate, method: i.method, moneyAccountId: i.moneyAccountId || null, reason: i.reason || null, lines: picked.map((id) => ({ tripId: id, given: String(i[`give_${id}`] ?? "").trim() || "0" })) };
    },
  },
  "held_cuts.close": { command: closeHeldCuts, prepare: async (_d, _a, i) => ({ ...i, tripIds: (i.tripIds as string[] | undefined) ?? [] }) },
  "held_cuts.reverse": { command: reverseCutRelease },
  "fees.pay": { command: payFees, prepare: async (_d, _a, i) => ({ ...i, tripFeeIds: (i.tripFeeIds as string[] | undefined) ?? [] }) },
  // Grid rows arrive as parallel arrays (r_manifest[], r_driver[], …); empty rows are dropped; fee columns as f_<key>[].
  "trips.save_many": {
    command: saveTripRows,
    prepare: async (_d, _a, input) => {
      const col = (k: string) => (input[k] as string[] | undefined) ?? [];
      const n = Math.max(...Object.keys(input).filter((k) => k.startsWith("r_")).map((k) => col(k).length), 0);
      const fields = ["manifest", "loadingDate", "route", "carrierPrice", "reward", "advance", "transporter", "driver", "plate", "loadedQty", "dischargeDate", "dischargedQty", "transporterCut", "carrierDeduction"];
      const rows = [];
      for (let i = 0; i < n; i++) {
        const values: Record<string, string> = {};
        for (const f of fields) if (col(`r_${f}`)[i]) values[f] = col(`r_${f}`)[i];
        if (!values.manifest && !values.driver && !values.loadedQty) continue;
        rows.push({ rowNo: i + 1, values, fees: {} });
      }
      const rest = Object.fromEntries(Object.entries(input).filter(([k]) => !k.startsWith("r_")));
      return { ...rest, rows };
    },
  },
  "trip_imports.discard": { command: discardTripImport },
  // Claims: manifests come as a textarea (one per line or comma-separated) or as a list; papers brought as bringing[].
  "claims.create": {
    command: createClaim,
    prepare: async (_d, _a, i) => {
      const raw = i.manifests;
      const manifests = Array.isArray(raw) ? (raw as string[]) : String(raw ?? "").split(/[\n,;،]+/).map((x) => x.trim()).filter(Boolean);
      const bringing = Array.isArray(i.bringing) ? (i.bringing as string[]) : i.bringing ? [String(i.bringing)] : [];
      return { ...i, manifests, bringing, feeReceipts: i.feeReceipts === "on", post: i.post !== "0", claimantId: i.claimantId || undefined, claimantName: i.claimantName || undefined };
    },
  },
  "claims.cancel": { command: cancelClaim },
  // Reversing a payment (an advance, a claim payment): the money comes back to the box; the original stays in the books.
  "payments.reverse": { command: reversePayment },
  "claims.pay": { command: payClaim, prepare: async (_d, _a, i) => ({ ...i, amount: i.amount || undefined }) },
  "fines.waive": { command: waiveFine, prepare: async (_d, _a, i) => ({ ...i, amount: i.amount || undefined }) },
  "remote_settlements.approve": { command: approveRemoteSettlement },
  "remote_settlements.discard": { command: discardRemoteSettlement },
  "payments.record": { command: recordPayment, prepare: currencyFromMoneyAccount },
  "documents.record": { command: recordDocument, file: true },
  "documents.waive": { command: waiveDocument },
  "documents.attach_file": { command: attachDocumentFile, file: true },
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
  "ledger.update_account": { command: updateAccount },
  "ledger.delete_account": { command: deleteAccount },
  // Adding a user also e-mails the sign-in invitation (Supabase Auth); it can be re-sent from Users & roles.
  "org.create_user": { command: createUser, after: async (input) => sendInvitation(String(input.email).toLowerCase(), String(input.locale ?? "en")) },
  "org.invite_user": { command: inviteUser, after: async (_input, result) => { const r = result as { email: string; locale: string }; await sendInvitation(r.email, r.locale); } },
  "org.set_user_active": { command: setUserActive, prepare: async (_db, _a, i) => ({ ...i, active: i.active === "true" }) },
  "org.define_role": { command: defineRole, prepare: async (_db, _a, i) => ({ ...i, permissions: i.permissions ?? [] }) },
  "org.assign_role": { command: assignRole, prepare: async (_db, _a, i) => ({ ...i, grant: i.grant !== "false" }) },
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
  // An empty account choice means "a new account in the books for this box".
  "money_accounts.create": { command: createMoneyAccount, prepare: async (_d, _a, i) => ({ ...i, ledgerAccountId: i.ledgerAccountId || undefined }) },
  "job_types.define": {
    command: defineJobType,
    // Checklist steps are typed one per line.
    prepare: async (_db, _a, { activitiesText, ...i }) => ({ ...i, defaultCapabilities: i.defaultCapabilities ?? [], defaultActivities: String(activitiesText ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean) }),
  },
  "jobs.set_capabilities": { command: setJobCapabilities, prepare: async (_db, _a, i) => ({ ...i, capabilities: i.capabilities ?? [] }) },
  "activities.add": { command: addActivity },
  "activities.set_status": { command: setActivityStatus },
  "contracts.create": { command: createContract },
  "contracts.update": { command: updateContract },
  "contracts.attach_file": { command: attachContractFile, file: true },
  "contracts.set_status": { command: setContractStatus },
  "projects.create": { command: createProject },
  "documents.set_requirement": {
    command: setDocumentRequirement,
    // One select chooses what the rule is for: "job_type:<id>", "customer:<id>" or "contract:<id>".
    prepare: async (_db, _a, { target, ...i }) => {
      const [scope, scopeId] = String(target ?? "").split(":");
      return { ...i, ...(target ? { scope, scopeId } : {}), active: i.active !== "false" };
    },
  },
  "custom_fields.define": {
    command: defineCustomField,
    prepare: async (_db, _a, { target, ...i }) => {
      const [scope, scopeId] = String(target ?? "all").split(":");
      return { ...i, scope, scopeId: scopeId || null };
    },
  },
  // Custom values arrive as cf_<key> fields.
  "jobs.set_custom_values": {
    command: setJobCustomValues,
    prepare: async (_db, _a, i) => ({ jobId: i.jobId, values: Object.fromEntries(Object.entries(i).filter(([k]) => k.startsWith("cf_")).map(([k, v]) => [k.slice(3), String(v)])) }),
  },
  "jobs.set_budget": { command: setJobBudget },
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
