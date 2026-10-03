import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { branches, companies, currencies, users } from "./core";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    /** Restrict postings to one currency (e.g. a USD bank account). Null = any currency. */
    currency: char("currency", { length: 3 }).references(() => currencies.code),
    parentId: uuid("parent_id").references((): AnyPgColumn => accounts.id),
    /** Header accounts group others and cannot be posted to. */
    postable: boolean("postable").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

/** A month is open unless a row says it is locked. */
export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    year: integer("year").notNull(),
    month: smallint("month").notNull(),
    status: text("status", { enum: ["open", "locked"] }).notNull(),
    changedBy: uuid("changed_by").references(() => users.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.year, t.month), check("month_range", sql`${t.month} between 1 and 12`)],
);

/**
 * Posted journal entries only. Immutable except for the reversal link
 * (enforced by trigger). Must balance per currency (deferred constraint trigger).
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    entryNo: bigserial("entry_no", { mode: "number" }).notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    description: text("description").notNull(),
    /** Operational record that produced this entry, e.g. ("settlement", id). */
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    reversesEntryId: uuid("reverses_entry_id").references((): AnyPgColumn => journalEntries.id),
    reversedByEntryId: uuid("reversed_by_entry_id").references((): AnyPgColumn => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.entryNo),
    unique("journal_entries_reverses_once").on(t.reversesEntryId),
    index().on(t.companyId, t.entryDate),
    index().on(t.companyId, t.sourceType, t.sourceId),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    entryId: uuid("entry_id").notNull().references(() => journalEntries.id),
    lineNo: smallint("line_no").notNull(),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    debit: numeric("debit", { precision: 20, scale: 4 }).notNull().default("0"),
    credit: numeric("credit", { precision: 20, scale: 4 }).notNull().default("0"),
    memo: text("memo"),
    /** Sub-ledger dimension: who the amount is owed by/to (receivables, payables, advances). */
    partnerId: uuid("partner_id"),
    /** Profitability dimension. */
    jobId: uuid("job_id"),
  },
  (t) => [
    unique().on(t.entryId, t.lineNo),
    index().on(t.accountId, t.currency),
    index().on(t.partnerId),
    index().on(t.jobId),
    check("one_sided_positive", sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} = 0) <> (${t.credit} = 0)`),
  ],
);
