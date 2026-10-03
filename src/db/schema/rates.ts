import { sql } from "drizzle-orm";
import { char, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { journalEntries } from "./accounting";
import { companies, currencies, users } from "./core";
import { contracts } from "./jobs";
import { businessPartners, catalogItems, units } from "./masterdata";
import { trips } from "./transport";

export const RATE_TYPES = [
  "driver_pay", // amount per unit of actual quantity (or per trip), paid to the driver
  "transporter_fee", // amount the company owes the transporter company
  "customer_price", // amount billed to the customer per unit of actual quantity (or per trip)
  "shortage_fine", // price per unit of chargeable shortage, deducted from the driver
  "allowance", // quantity of loss forgiven before a fine applies (no currency)
  "demurrage_pay", // per day, paid to the driver
  "demurrage_bill", // per day, billed to the customer
] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const RATE_BASES = [
  "actual_qty", // discharged quantity, capped at the loaded quantity
  "loaded_qty",
  "discharged_qty",
  "per_trip",
  "per_day",
  "quantity", // the rate itself is a quantity (allowance)
] as const;

/**
 * Commercial rules the company sets itself. Effective-dated: the rule in force
 * on a trip's loading date applies, and the values used are copied into the
 * settlement, so later changes never alter history. Optional dimensions
 * (product, customer, transporter, contract) make a rule more specific; the
 * most specific matching rule wins.
 */
export const rates = pgTable(
  "rates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    rateType: text("rate_type", { enum: RATE_TYPES }).notNull(),
    basis: text("basis", { enum: RATE_BASES }).notNull(),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    /** Required for money rates; null for allowance. */
    currency: char("currency", { length: 3 }).references(() => currencies.code),
    /** Unit the amount is "per" (money rates on quantity) or the unit of the allowance. */
    unit: text("unit").references(() => units.code),
    productId: uuid("product_id").references(() => catalogItems.id),
    customerId: uuid("customer_id").references(() => businessPartners.id),
    transporterId: uuid("transporter_id").references(() => businessPartners.id),
    contractId: uuid("contract_id").references(() => contracts.id),
    /** Demurrage only: days not charged, and which event starts the count. */
    freeDays: integer("free_days"),
    startEvent: text("start_event", { enum: ["loading", "arrival"] }),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.companyId, t.rateType, t.effectiveFrom),
    check("rate_amount_non_negative", sql`${t.amount} >= 0`),
    check("rate_period", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
  ],
);

/**
 * The calculated and posted settlement of one trip: driver side and transporter
 * side. Every input value is copied here (snapshot) so the result can be
 * explained later even if rates change. Corrections are reversals.
 */
export const tripSettlements = pgTable(
  "trip_settlements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    settlementNo: text("settlement_no").notNull(),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    /** Full calculation: quantities, rates (with ids), demurrage days, advances, rounding. */
    calculation: jsonb("calculation").notNull(),
    driverNet: numeric("driver_net", { precision: 20, scale: 4 }).notNull(),
    transporterNet: numeric("transporter_net", { precision: 20, scale: 4 }),
    status: text("status", { enum: ["posted", "reversed"] }).notNull().default("posted"),
    journalEntryId: uuid("journal_entry_id").notNull().references(() => journalEntries.id),
    reversalEntryId: uuid("reversal_entry_id").references(() => journalEntries.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.settlementNo), index().on(t.tripId)],
);

