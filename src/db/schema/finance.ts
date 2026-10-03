import { sql } from "drizzle-orm";
import { boolean, char, check, date, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts, journalEntries } from "./accounting";
import { branches, companies, currencies, users } from "./core";
import { jobs } from "./jobs";
import { businessPartners } from "./masterdata";
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
    check("amount_positive", sql`${t.amount} > 0`),
  ],
);
