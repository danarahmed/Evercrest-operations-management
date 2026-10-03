import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, char, check, date, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { journalEntries } from "./accounting";
import { companies, currencies, users } from "./core";
import { businessPartners } from "./masterdata";
import { tripSettlements } from "./rates";
import { trips } from "./transport";

export const STATEMENT_PARTIES = ["driver", "transporter"] as const;
export type StatementParty = (typeof STATEMENT_PARTIES)[number];

/**
 * A pay statement groups settled trips so several drivers (or one transporter's
 * trips with all its drivers) are paid and shown together. It only references
 * settlements; the amounts come from the settlement snapshots. One currency.
 * Paid = every payee with a positive total has a posted payment for it.
 */
export const payStatements = pgTable(
  "pay_statements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    statementNo: text("statement_no").notNull(),
    party: text("party", { enum: STATEMENT_PARTIES }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    statementDate: date("statement_date", { mode: "string" }).notNull(),
    /** Sum of the items' net amounts (may include negative items where a payee owes). */
    total: numeric("total", { precision: 20, scale: 4 }).notNull(),
    status: text("status", { enum: ["open", "paid", "cancelled"] }).notNull().default("open"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.statementNo), index().on(t.companyId, t.status)],
);

/**
 * "trip": one settled trip's side (driver or transporter).
 * "brought_forward": what the payee still owed the company on an earlier
 * statement (advances larger than pay), deducted here. Always negative.
 */
export const STATEMENT_ITEM_KINDS = ["trip", "brought_forward"] as const;

export const payStatementItems = pgTable(
  "pay_statement_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    statementId: uuid("statement_id").notNull().references(() => payStatements.id),
    kind: text("kind", { enum: STATEMENT_ITEM_KINDS }).notNull().default("trip"),
    settlementId: uuid("settlement_id").references(() => tripSettlements.id),
    tripId: uuid("trip_id").references(() => trips.id),
    /** brought_forward only: the statement on which the debt arose. */
    fromStatementId: uuid("from_statement_id").references((): AnyPgColumn => payStatements.id),
    party: text("party", { enum: STATEMENT_PARTIES }).notNull(),
    /** The payee: the trip's driver, or its transporter. */
    partnerId: uuid("partner_id").notNull().references(() => businessPartners.id),
    /** Net final amount of this party's side of the settlement. */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** False once the statement is cancelled, freeing the settlement for another statement. */
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index().on(t.statementId),
    index().on(t.settlementId),
    index().on(t.fromStatementId, t.partnerId),
    check(
      "item_kind_shape",
      sql`(${t.kind} = 'trip' and ${t.settlementId} is not null and ${t.tripId} is not null and ${t.fromStatementId} is null)
        or (${t.kind} = 'brought_forward' and ${t.settlementId} is null and ${t.tripId} is null and ${t.fromStatementId} is not null and ${t.amount} < 0)`,
    ),
  ],
);

/**
 * A payee's debt on a statement written off as uncollectable (approved).
 * Posted: cost (bad debts) against the payee's balance.
 */
export const statementDebtWriteOffs = pgTable(
  "statement_debt_write_offs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    statementId: uuid("statement_id").notNull().references(() => payStatements.id),
    partnerId: uuid("partner_id").notNull().references(() => businessPartners.id),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    writeOffDate: date("write_off_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.statementId, t.partnerId), check("write_off_positive", sql`${t.amount} > 0`)],
);
