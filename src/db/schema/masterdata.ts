import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./core";

/**
 * One record per real-world party. The same organization or person can hold
 * several roles (customer, transporter, driver, ...) — never duplicate a partner
 * per role. Only a name is required: details are often learned later.
 */
export const businessPartners = pgTable(
  "business_partners",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    kind: text("kind", { enum: ["organization", "person"] }).notNull(),
    name: text("name").notNull(),
    /** normalizeName(name), maintained by the partners module for duplicate-safe search. */
    searchKey: text("search_key").notNull(),
    phone: text("phone"),
    address: text("address"),
    taxId: text("tax_id"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId, t.searchKey)],
);

export const PARTNER_ROLES = [
  "customer",
  "supplier",
  "transporter",
  "driver",
  "contractor",
  "service_provider",
  "other",
] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const partnerRoles = pgTable(
  "partner_roles",
  {
    partnerId: uuid("partner_id").notNull().references(() => businessPartners.id),
    role: text("role", { enum: PARTNER_ROLES }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.partnerId, t.role] })],
);

/**
 * Units of measure. Conversion is only defined within a dimension
 * (KG↔MT, L↔m³). Converting volume to mass needs a measured density and is
 * never done implicitly.
 */
export const units = pgTable(
  "units",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    dimension: text("dimension", { enum: ["mass", "volume", "count", "time", "length"] }).notNull(),
    /** How many of the dimension's base unit one of this unit equals (base: KG, L, EA, HR, M). */
    toBase: numeric("to_base", { precision: 24, scale: 10 }).notNull(),
  },
  (t) => [check("to_base_positive", sql`${t.toBase} > 0`)],
);

/** Products and services the company buys, sells or uses. */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    kind: text("kind", { enum: ["product", "service"] }).notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    defaultUnit: text("default_unit").references(() => units.code),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);
