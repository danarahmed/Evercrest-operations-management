import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, char, check, date, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts, journalEntries } from "./accounting";
import { branches, companies, currencies, users } from "./core";
import { jobs } from "./jobs";
import { businessPartners, catalogItems, units } from "./masterdata";
import { trips } from "./transport";

/** A cash box, safe or bank account. Exactly one currency; backed by one ledger account. */
export const moneyAccounts = pgTable(
  "money_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["cash", "bank"] }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    ledgerAccountId: uuid("ledger_account_id").notNull().references(() => accounts.id),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.name), unique().on(t.ledgerAccountId)],
);

export const PAYMENT_PURPOSES = ["advance", "settlement", "customer_receipt", "supplier_payment", "expense", "other"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/**
 * Every movement of money in or out goes through here (one payment engine).
 * A payment is posted to the ledger when created; corrections are reversals.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    paymentNo: text("payment_no").notNull(),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    purpose: text("purpose", { enum: PAYMENT_PURPOSES }).notNull(),
    partnerId: uuid("partner_id").references(() => businessPartners.id),
    moneyAccountId: uuid("money_account_id").notNull().references(() => moneyAccounts.id),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    paymentDate: date("payment_date", { mode: "string" }).notNull(),
    method: text("method", { enum: ["cash", "bank_transfer", "cheque", "other"] }).notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    tripId: uuid("trip_id").references(() => trips.id),
    /** Invoice this payment settles (receipt or bill payment). */
    invoiceId: uuid("invoice_id").references((): AnyPgColumn => invoices.id),
    /** Counter-account for direct expenses / other payments. */
    counterAccountId: uuid("counter_account_id").references(() => accounts.id),
    reference: text("reference"),
    notes: text("notes"),
    status: text("status", { enum: ["posted", "reversed"] }).notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.paymentNo),
    index().on(t.companyId, t.partnerId),
    index().on(t.jobId),
    index().on(t.tripId),
    index().on(t.invoiceId),
    check("amount_positive", sql`${t.amount} > 0`),
  ],
);

/**
 * Customer invoices (revenue, receivable) and bills from suppliers, transporters
 * or drivers (cost, payable). One currency per invoice. Posted on creation;
 * cancellation is a reversal.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    invoiceNo: text("invoice_no").notNull(),
    kind: text("kind", { enum: ["sales", "bill"] }).notNull(),
    partnerId: uuid("partner_id").notNull().references(() => businessPartners.id),
    /** Receivable or payable account the balance sits on. */
    balanceAccountId: uuid("balance_account_id").notNull().references(() => accounts.id),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    /** The partner's own number (supplier bill number). */
    externalRef: text("external_ref"),
    total: numeric("total", { precision: 20, scale: 4 }).notNull(),
    status: text("status", { enum: ["posted", "cancelled"] }).notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.invoiceNo),
    index().on(t.companyId, t.partnerId),
    check("total_positive", sql`${t.total} > 0`),
    check("due_after_invoice", sql`${t.dueDate} is null or ${t.dueDate} >= ${t.invoiceDate}`),
  ],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    lineNo: integer("line_no").notNull(),
    description: text("description").notNull(),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
    quantity: numeric("quantity", { precision: 20, scale: 4 }).notNull(),
    unit: text("unit").references(() => units.code),
    unitPrice: numeric("unit_price", { precision: 20, scale: 6 }).notNull(),
    /** quantity × unitPrice, rounded to the currency; the amount actually posted. */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** Income account (sales) or expense/asset account (bills). */
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    jobId: uuid("job_id").references(() => jobs.id),
    tripId: uuid("trip_id").references(() => trips.id),
  },
  (t) => [unique().on(t.invoiceId, t.lineNo), index().on(t.jobId), index().on(t.tripId)],
);

/**
 * Money converted between currencies (e.g. USD cash sold for IQD cash).
 * Stores both real amounts and the rate actually obtained; never recomputed.
 */
export const currencyExchanges = pgTable(
  "currency_exchanges",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    exchangeNo: text("exchange_no").notNull(),
    fromMoneyAccountId: uuid("from_money_account_id").notNull().references(() => moneyAccounts.id),
    toMoneyAccountId: uuid("to_money_account_id").notNull().references(() => moneyAccounts.id),
    fromAmount: numeric("from_amount", { precision: 20, scale: 4 }).notNull(),
    fromCurrency: char("from_currency", { length: 3 }).notNull().references(() => currencies.code),
    toAmount: numeric("to_amount", { precision: 20, scale: 4 }).notNull(),
    toCurrency: char("to_currency", { length: 3 }).notNull().references(() => currencies.code),
    /** Units of toCurrency received per 1 unit of fromCurrency. */
    rate: numeric("rate", { precision: 24, scale: 10 }).notNull(),
    exchangeDate: date("exchange_date", { mode: "string" }).notNull(),
    counterpartyId: uuid("counterparty_id").references(() => businessPartners.id),
    reference: text("reference"),
    status: text("status", { enum: ["posted", "reversed"] }).notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.exchangeNo),
    check("fx_amounts_positive", sql`${t.fromAmount} > 0 and ${t.toAmount} > 0`),
    check("fx_currencies_differ", sql`${t.fromCurrency} <> ${t.toCurrency}`),
  ],
);
