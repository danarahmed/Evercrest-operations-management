import { sql } from "drizzle-orm";
import { boolean, char, check, date, index, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies, currencies, users } from "./core";
import { jobs } from "./jobs";
import { businessPartners, catalogItems, units } from "./masterdata";
import { FEE_BASES, feeTypes, jobRoutes } from "./terms";

/**
 * A truck identified by its plate. Not a company asset: the owner may be a
 * transporter, the driver, a third party, or unknown (null).
 */
export const trucks = pgTable(
  "trucks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    plate: text("plate").notNull(),
    /** Plate normalized for matching (no spaces/dashes, upper case, Latin digits). */
    plateKey: text("plate_key").notNull(),
    ownerPartnerId: uuid("owner_partner_id").references(() => businessPartners.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.plateKey)],
);

export const TRIP_STATUSES = ["planned", "loaded", "discharged", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/**
 * One truck movement under a job. Driver, truck and transporter are recorded
 * per trip (the driver↔transporter relationship is historical, not permanent).
 * Transporter is null when the company works directly with the driver.
 * Missing quantities stay null — never zero.
 */
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    tripNo: text("trip_no").notNull(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    driverId: uuid("driver_id").notNull().references(() => businessPartners.id),
    truckId: uuid("truck_id").notNull().references(() => trucks.id),
    transporterId: uuid("transporter_id").references(() => businessPartners.id),
    productId: uuid("product_id").references(() => catalogItems.id),
    loadingLocation: text("loading_location"),
    destination: text("destination"),
    loadingDate: date("loading_date", { mode: "string" }),
    loadedQty: numeric("loaded_qty", { precision: 20, scale: 4 }),
    loadedUnit: text("loaded_unit").references(() => units.code),
    /** Arrival at destination/parking (some demurrage rules count from here). */
    arrivalDate: date("arrival_date", { mode: "string" }),
    dischargeDate: date("discharge_date", { mode: "string" }),
    dischargedQty: numeric("discharged_qty", { precision: 20, scale: 4 }),
    dischargedUnit: text("discharged_unit").references(() => units.code),
    /** The trip's identity in the business: the manifest number (unique within a job). */
    manifestNo: text("manifest_no"),
    /** manifestNo normalized for matching (upper case, no spaces, Latin digits). */
    manifestKey: text("manifest_key"),
    routeId: uuid("route_id").references(() => jobRoutes.id),
    /** Second plate (trailer), or the plate text exactly as written on the manifest. */
    plateText: text("plate_text"),
    /** Agreed differently from the rule card for this trip (null = use the rule card). */
    carrierPriceOverride: numeric("carrier_price_override", { precision: 20, scale: 6 }),
    rewardOverride: numeric("reward_override", { precision: 20, scale: 4 }),
    /** Deducted from the carrier's pay and credited to the transporter's account (not a saving for the company). */
    transporterCut: numeric("transporter_cut", { precision: 20, scale: 4 }).notNull().default("0"),
    /** Other amounts recovered from the carrier on this trip, e.g. visa/insurance paid for him. */
    carrierDeduction: numeric("carrier_deduction", { precision: 20, scale: 4 }).notNull().default("0"),
    status: text("status", { enum: TRIP_STATUSES }).notNull().default("planned"),
    /** The sheet this trip came from, when imported. */
    importId: uuid("import_id"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.tripNo),
    uniqueIndex("trips_job_manifest").on(t.jobId, t.manifestKey).where(sql`${t.manifestKey} is not null and ${t.status} <> 'cancelled'`),
    index().on(t.jobId),
    index().on(t.companyId, t.driverId),
    index().on(t.companyId, t.truckId),
    check("qty_with_unit", sql`(${t.loadedQty} is null) = (${t.loadedUnit} is null) and (${t.dischargedQty} is null) = (${t.dischargedUnit} is null)`),
    check("qty_positive", sql`coalesce(${t.loadedQty}, 1) > 0 and coalesce(${t.dischargedQty}, 0) >= 0`),
    check("discharge_after_loading", sql`${t.dischargeDate} is null or ${t.loadingDate} is null or ${t.dischargeDate} >= ${t.loadingDate}`),
  ],
);

/**
 * A fee on one trip (visa, insurance, guarantee, customs, …): copied from the
 * job's rule card when the trip is created, or entered from the trip's papers.
 * One line per fee type per trip, so the same fee can never be counted or paid twice.
 */
export const tripFees = pgTable(
  "trip_fees",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    tripId: uuid("trip_id").notNull().references(() => trips.id),
    feeTypeId: uuid("fee_type_id").notNull().references(() => feeTypes.id),
    /** Amount per trip, or per unit of loaded / net quantity (then the fee follows the quantities). */
    rate: numeric("rate", { precision: 20, scale: 6 }).notNull(),
    basis: text("basis", { enum: FEE_BASES }).notNull(),
    currency: char("currency", { length: 3 }).notNull().references(() => currencies.code),
    deductFromCarrier: boolean("deduct_from_carrier").notNull(),
    billedToCustomer: boolean("billed_to_customer").notNull(),
    /** rule = from the rule card; entered = typed/imported from the papers. */
    source: text("source", { enum: ["rule", "entered"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tripId, t.feeTypeId), check("trip_fee_non_negative", sql`${t.rate} >= 0`)],
);

/**
 * One uploaded trip sheet (e.g. the loading file from a site). The parsed rows
 * are kept as they were read, previewed, then applied once; the batch stays as
 * the record of which file created or updated which trips.
 */
export const tripImports = pgTable(
  "trip_imports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    fileName: text("file_name").notNull(),
    rows: jsonb("rows").notNull(),
    /** Column headers found and what each was read as. */
    columns: jsonb("columns").notNull(),
    status: text("status", { enum: ["staged", "applied", "discarded"] }).notNull().default("staged"),
    /** Counts after applying: created, updated, unchanged, skipped. */
    result: jsonb("result"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid("applied_by").references(() => users.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [index().on(t.jobId, t.createdAt)],
);
