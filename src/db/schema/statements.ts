import { sql } from "drizzle-orm";
import { boolean, char, date, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
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

export const payStatementItems = pgTable(
  "pay_statement_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    statementId: uuid("statement_id").notNull().references(() => payStatements.id),
    settlementId: uuid("settlement_id").notNull().references(() => tripSettlements.id),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    party: text("party", { enum: STATEMENT_PARTIES }).notNull(),
    /** The payee: the trip's driver, or its transporter. */
    partnerId: uuid("partner_id").notNull().references(() => businessPartners.id),
    /** Net final amount of this party's side of the settlement. */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** False once the statement is cancelled, freeing the settlement for another statement. */
    active: boolean("active").notNull().default(true),
  },
  (t) => [index().on(t.statementId), index().on(t.settlementId)],
);
