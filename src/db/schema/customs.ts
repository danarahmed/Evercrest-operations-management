import { sql } from "drizzle-orm";
import { boolean, char, check, date, index, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { journalEntries } from "./accounting";
import { companies, currencies, users } from "./core";
import { jobs } from "./jobs";
import { businessPartners } from "./masterdata";
import { jobRoutes } from "./terms";
import { trips } from "./transport";

/**
 * Customs duty at the border (owner's rules, 2026-11). A government charge per loaded MT, kept apart from the
 * trip fees: its own rate on the job's rule card, its own quantity on each trip (customs may count a different
 * MT), its own account in the books, and the job's customs agent — the company's person at the border, paid in
 * lump sums for the job; the duty of the trucks is booked against those payments and the difference is his balance.
 */

/** The customs rate per unit for a job (or one of its routes), from a date. */
export const customsRates = pgTable(
  "customs_rates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    /** A route with its own rate (rare); empty = the whole job. */
    routeId: uuid("route_id").references(() => jobRoutes.id),
    effectiveFrom: date("effective_from").notNull(),
    rate: numeric("rate", { precision: 20, scale: 6 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    note: text("note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.jobId), check("customs_rate_non_negative", sql`${t.rate} >= 0`)],
);

/** A job's customs settings: who pays the duty at the border for the company, and whether the customer pays it back. */
export const jobCustoms = pgTable(
  "job_customs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    agentId: uuid("agent_id").references(() => businessPartners.id),
    /** Usually false: customs is a cost of the job. True when the contract makes the customer pay it back (pass-through). */
    billedToCustomer: boolean("billed_to_customer").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.jobId)],
);

/** "Book customs": the duty of a batch of trips posted to the books against the job's customs agent. */
export const customsBookings = pgTable(
  "customs_bookings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    bookingNo: text("booking_no").notNull(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    agentId: uuid("agent_id").notNull().references(() => businessPartners.id),
    bookingDate: date("booking_date").notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    total: numeric("total", { precision: 20, scale: 4 }).notNull(),
    status: text("status", { enum: ["posted", "reversed"] }).notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.bookingNo), index().on(t.jobId)],
);

export const customsBookingLines = pgTable(
  "customs_booking_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    bookingId: uuid("booking_id").notNull().references(() => customsBookings.id),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    quantity: numeric("quantity", { precision: 20, scale: 6 }).notNull(),
    rate: numeric("rate", { precision: 20, scale: 6 }).notNull(),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** False once the booking is reversed: the trip's customs can be booked again. */
    active: boolean("active").notNull().default(true),
  },
  (t) => [index().on(t.bookingId), uniqueIndex("customs_booking_lines_one_live_per_trip").on(t.tripId).where(sql`${t.active}`)],
);

/** The border person's own statement (trucks and MT he cleared), kept to compare with the system per truck. */
export const customsStatements = pgTable(
  "customs_statements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    fileName: text("file_name").notNull(),
    /** Rows as read: { rowNo, manifest, plate, quantity, amount }. */
    rows: jsonb("rows").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.jobId)],
);
