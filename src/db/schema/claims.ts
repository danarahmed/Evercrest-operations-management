import { sql } from "drizzle-orm";
import { boolean, char, check, date, index, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { journalEntries } from "./accounting";
import { companies, currencies, users } from "./core";
import { moneyAccounts } from "./finance";
import { jobs } from "./jobs";
import { businessPartners } from "./masterdata";
import { trips } from "./transport";

export const CLAIM_STATUSES = ["draft", "posted", "paid", "cancelled"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_SOURCES = ["manual", "remote"] as const;

/**
 * A claim (مطالەبە): the transporter, or an independent driver himself, brings
 * manifests and claims the trips. Money follows the papers: the trips' net
 * amounts go to the claimant's account, whoever the transporter at loading was.
 * One job, one currency, one claimant per claim. Posting books the trips'
 * earnings, fines, fee deductions and advances against the claimant's running
 * account (accounting method D: the first real event of the trip's money).
 */
export const claims = pgTable(
  "claims",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    claimNo: text("claim_no").notNull(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    /** Whoever brought the papers: a transporter or the driver himself. */
    claimantId: uuid("claimant_id").notNull().references(() => businessPartners.id),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    claimDate: date("claim_date", { mode: "string" }).notNull(),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("draft"),
    source: text("source", { enum: CLAIM_SOURCES }).notNull().default("manual"),
    /** Sum of the items' net amounts, before final rounding (negative = the claimant owes). */
    total: numeric("total", { precision: 20, scale: 4 }).notNull().default("0"),
    /** Final amount after rounding to the configured increment (rounded once, per claim). */
    totalFinal: numeric("total_final", { precision: 20, scale: 4 }).notNull().default("0"),
    notes: text("notes"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [unique().on(t.companyId, t.claimNo), index().on(t.jobId), index().on(t.companyId, t.claimantId), index().on(t.companyId, t.status)],
);

/**
 * One trip on a claim with the calculation as it stood when the claim was
 * posted (rule card version, quantities, every amount). A trip is on at most
 * one live claim — the database refuses a second one, so nothing is paid twice.
 */
export const claimItems = pgTable(
  "claim_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    calculation: jsonb("calculation").notNull(),
    /** The trip's net for the claimant: carrier total − advances already paid (may be negative). */
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    /** False once the claim is cancelled, freeing the trip for another claim. */
    active: boolean("active").notNull().default(true),
  },
  (t) => [index().on(t.claimId), uniqueIndex("claim_items_one_live_claim_per_trip").on(t.tripId).where(sql`${t.active}`)],
);

/**
 * An approved waiver of part or all of a trip's shortage fine (a driver's
 * excuse the owner accepted). Only approved waivers exist; the calculation
 * reads them. Never an edit of the fine itself.
 */
export const fineWaivers = pgTable(
  "fine_waivers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    waiverDate: date("waiver_date", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.tripId), check("waiver_positive", sql`${t.amount} > 0`)],
);

/**
 * A settlement made at a site with the site's own figures (our employee paid
 * the drivers from the site cash box and sent back a sheet). Imported as it
 * is, compared line by line with the system's calculation, then approved by
 * the owner: the trips are claimed by their drivers and the payments recorded
 * from the site's money account; only the differences need attention.
 */
export const remoteSettlements = pgTable(
  "remote_settlements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    fileName: text("file_name").notNull(),
    settlementDate: date("settlement_date", { mode: "string" }).notNull(),
    /** The site's money account the drivers were paid from. */
    moneyAccountId: uuid("money_account_id").notNull().references(() => moneyAccounts.id),
    rows: jsonb("rows").notNull(),
    columns: jsonb("columns").notNull(),
    status: text("status", { enum: ["staged", "approved", "discarded"] }).notNull().default("staged"),
    /** Outcome after approval: claims created, payments, differences per line. */
    result: jsonb("result"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [index().on(t.jobId, t.createdAt)],
);

/**
 * Money cut from a driver's pay on a trip and held for the transporter (owner's rule, 2026-11). The claim
 * books it to "Cuts held for transporters" against the trip; at that point nobody knows yet which transporter
 * will ask for it. A release closes trips' held cuts in one of two ways, always after approval:
 *  - give_back: a transporter asks; part or all of each trip's cut is given back (cash from a box, or added to
 *    his account) and the rest of that trip's cut becomes the company's income at once;
 *  - close: held cuts nobody asked for (e.g. after a year) become the company's income.
 * A reversed release puts the cuts back on hold.
 */
export const CUT_RELEASE_KINDS = ["give_back", "close"] as const;
export const CUT_RELEASE_METHODS = ["cash", "account"] as const;
export const cutReleases = pgTable(
  "cut_releases",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    releaseNo: text("release_no").notNull(),
    kind: text("kind", { enum: CUT_RELEASE_KINDS }).notNull(),
    /** The transporter the cuts were given back to (give_back only). */
    transporterId: uuid("transporter_id").references(() => businessPartners.id),
    method: text("method", { enum: CUT_RELEASE_METHODS }),
    moneyAccountId: uuid("money_account_id").references(() => moneyAccounts.id),
    /** The cash payment, when given back in cash. */
    paymentId: uuid("payment_id"),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    releaseDate: date("release_date").notNull(),
    givenTotal: numeric("given_total", { precision: 20, scale: 4 }).notNull(),
    keptTotal: numeric("kept_total", { precision: 20, scale: 4 }).notNull(),
    reason: text("reason"),
    status: text("status", { enum: ["posted", "reversed"] }).notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    approvedBy: uuid("approved_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.releaseNo), check("cut_release_totals", sql`${t.givenTotal} >= 0 and ${t.keptTotal} >= 0`)],
);

export const cutReleaseLines = pgTable(
  "cut_release_lines",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    releaseId: uuid("release_id").notNull().references(() => cutReleases.id),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    held: numeric("held", { precision: 20, scale: 4 }).notNull(),
    given: numeric("given", { precision: 20, scale: 4 }).notNull(),
    kept: numeric("kept", { precision: 20, scale: 4 }).notNull(),
    /** False once the release is reversed: the cut is held again. */
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index().on(t.releaseId),
    uniqueIndex("cut_release_lines_one_live_per_trip").on(t.tripId).where(sql`${t.active}`),
    check("cut_release_line_amounts", sql`${t.given} >= 0 and ${t.kept} >= 0 and ${t.given} + ${t.kept} = ${t.held}`),
  ],
);
