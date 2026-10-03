import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies, users } from "./core";
import { jobs } from "./jobs";
import { businessPartners, catalogItems, units } from "./masterdata";

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
    status: text("status", { enum: TRIP_STATUSES }).notNull().default("planned"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.tripNo),
    index().on(t.jobId),
    index().on(t.companyId, t.driverId),
    index().on(t.companyId, t.truckId),
    check("qty_with_unit", sql`(${t.loadedQty} is null) = (${t.loadedUnit} is null) and (${t.dischargedQty} is null) = (${t.dischargedUnit} is null)`),
    check("qty_positive", sql`coalesce(${t.loadedQty}, 1) > 0 and coalesce(${t.dischargedQty}, 0) >= 0`),
    check("discharge_after_loading", sql`${t.dischargeDate} is null or ${t.loadingDate} is null or ${t.dischargeDate} >= ${t.loadingDate}`),
  ],
);
