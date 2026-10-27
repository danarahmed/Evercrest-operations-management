import { sql } from "drizzle-orm";
import { boolean, char, check, date, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { accounts } from "./accounting";
import { companies, currencies, users } from "./core";
import { jobs } from "./jobs";
import { units } from "./masterdata";

/**
 * The job's rule card (owner-confirmed, docs/business/design-proposal.md §3):
 * everything agreed for a job, set by the manager and applied by staff. Rules
 * are dated: a change is a new version from a date, and each trip uses the
 * version in force on its loading date. A route-specific version beats the
 * job-wide one.
 */

/** A route of a job, e.g. "Erbil – Latakia": where trucks load and discharge. */
export const jobRoutes = pgTable(
  "job_routes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    name: text("name").notNull(),
    /** normalizeName(name), for matching imported rows. */
    nameKey: text("name_key").notNull(),
    loadingPlace: text("loading_place"),
    dischargePlace: text("discharge_place"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.jobId, t.nameKey)],
);

export const PRICE_BASES = ["per_unit", "per_trip"] as const;
export const ALLOWANCE_BASES = ["per_trip", "per_unit"] as const;
export const QUANTITY_BASES = ["net", "loaded"] as const;
export const DEMURRAGE_METHODS = ["none", "arrival_to_discharge"] as const;

/**
 * One dated version of a job's prices and shortage/demurrage rules.
 * Null customer price = "to be decided" (the price is agreed after the costs are known).
 */
export const jobTerms = pgTable(
  "job_terms",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    /** Null = applies to every route of the job without its own version. */
    routeId: uuid("route_id").references(() => jobRoutes.id),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    unit: text("unit").notNull().references(() => units.code),

    // Customer side (what the customer pays us)
    customerPrice: numeric("customer_price", { precision: 20, scale: 6 }),
    customerPriceBasis: text("customer_price_basis", { enum: PRICE_BASES }).notNull().default("per_unit"),
    /** Quantity the customer is billed on: net (min of loaded and discharged) or loaded. */
    customerQtyBasis: text("customer_qty_basis", { enum: QUANTITY_BASES }).notNull().default("net"),
    /** The customer's shortage allowance: a quantity per trip, or a quantity per unit loaded (e.g. 0.002 = 0.2 %). */
    customerAllowance: numeric("customer_allowance", { precision: 20, scale: 6 }),
    customerAllowanceBasis: text("customer_allowance_basis", { enum: ALLOWANCE_BASES }).notNull().default("per_trip"),
    customerFinePrice: numeric("customer_fine_price", { precision: 20, scale: 6 }),

    // Carrier side (what we pay the driver / transporter)
    carrierPrice: numeric("carrier_price", { precision: 20, scale: 6 }),
    carrierPriceBasis: text("carrier_price_basis", { enum: PRICE_BASES }).notNull().default("per_unit"),
    rewardPerTrip: numeric("reward_per_trip", { precision: 20, scale: 4 }).notNull().default("0"),
    /** Transporter commission per unit of net quantity, added to the carrier's pay. */
    transporterCommission: numeric("transporter_commission", { precision: 20, scale: 6 }).notNull().default("0"),
    /** Shortage allowed per trip before a fine (quantity, positive). */
    carrierAllowance: numeric("carrier_allowance", { precision: 20, scale: 6 }).notNull().default("0"),
    carrierFinePrice: numeric("carrier_fine_price", { precision: 20, scale: 6 }).notNull().default("0"),

    // Demurrage
    demurrageMethod: text("demurrage_method", { enum: DEMURRAGE_METHODS }).notNull().default("none"),
    demurrageFreeDays: integer("demurrage_free_days").notNull().default(0),
    carrierDemurrageRate: numeric("carrier_demurrage_rate", { precision: 20, scale: 4 }).notNull().default("0"),
    customerDemurrageRate: numeric("customer_demurrage_rate", { precision: 20, scale: 4 }).notNull().default("0"),

    // Advances
    advanceNormal: numeric("advance_normal", { precision: 20, scale: 4 }),
    /** Advances above this need the owner's approval (null = no limit set). */
    advanceMax: numeric("advance_max", { precision: 20, scale: 4 }),

    note: text("note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("job_terms_version").on(t.jobId, t.routeId, t.effectiveFrom).nullsNotDistinct(),
    check(
      "terms_non_negative",
      sql`coalesce(${t.customerPrice}, 0) >= 0 and coalesce(${t.carrierPrice}, 0) >= 0 and ${t.rewardPerTrip} >= 0 and ${t.transporterCommission} >= 0
        and ${t.carrierAllowance} >= 0 and ${t.carrierFinePrice} >= 0 and coalesce(${t.customerAllowance}, 0) >= 0 and coalesce(${t.customerFinePrice}, 0) >= 0
        and ${t.demurrageFreeDays} >= 0 and ${t.carrierDemurrageRate} >= 0 and ${t.customerDemurrageRate} >= 0
        and coalesce(${t.advanceNormal}, 0) >= 0 and coalesce(${t.advanceMax}, 0) >= 0`,
    ),
  ],
);

export const FEE_BASES = ["per_trip", "per_loaded_unit", "per_net_unit"] as const;

/**
 * A kind of fee the company deals with (visa, insurance, guarantee, customs,
 * border commission, exchanger financing fee …). The owner adds new ones at any
 * time; each carries its accounting: the expense account it is booked to, and
 * by default whether it is recovered from the carrier and whether the customer
 * pays it on top of the price.
 */
export const feeTypes = pgTable(
  "fee_types",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    defaultBasis: text("default_basis", { enum: FEE_BASES }).notNull().default("per_trip"),
    deductFromCarrier: boolean("deduct_from_carrier").notNull().default(false),
    billedToCustomer: boolean("billed_to_customer").notNull().default(false),
    expenseAccountId: uuid("expense_account_id").references(() => accounts.id),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

/** A fee on a job's rule card, dated like the prices; route-specific beats job-wide. */
export const jobFees = pgTable(
  "job_fees",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    routeId: uuid("route_id").references(() => jobRoutes.id),
    feeTypeId: uuid("fee_type_id").notNull().references(() => feeTypes.id),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** 0 ends a fee from this date. */
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    basis: text("basis", { enum: FEE_BASES }).notNull(),
    deductFromCarrier: boolean("deduct_from_carrier").notNull(),
    billedToCustomer: boolean("billed_to_customer").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("job_fees_version").on(t.jobId, t.routeId, t.feeTypeId, t.effectiveFrom).nullsNotDistinct(),
    check("job_fee_non_negative", sql`${t.amount} >= 0`),
  ],
);
