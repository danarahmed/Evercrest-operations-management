import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const branches = pgTable(
  "branches",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    locale: text("locale", { enum: ["en", "ar", "ckb"] }).notNull().default("en"),
    /** Identity in the external auth provider (Supabase Auth). Null until linked. */
    authUserId: text("auth_user_id").unique(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.companyId, t.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

/** A role granted company-wide (branchId null) or for one branch. */
export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id),
  },
  (t) => [unique().on(t.userId, t.roleId, t.branchId).nullsNotDistinct()],
);

/** Configurable business rules. Changes go through server/settings.ts (audited). */
export const settings = pgTable(
  "settings",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

/** Append-only. Update/delete blocked by trigger (see custom migration). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    approvedBy: uuid("approved_by").references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.companyId, t.entityType, t.entityId), index().on(t.companyId, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    command: text("command").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

export const currencies = pgTable("currencies", {
  code: char("code", { length: 3 }).primaryKey(),
  name: text("name").notNull(),
  /** Decimal places used when rounding amounts in this currency. */
  minorUnits: smallint("minor_units").notNull(),
});

/**
 * Immutable, dated rate history: 1 unit of `base` = `rate` units of `quote`.
 * A correction is a new row; transactions store the rate they actually used.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: id(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    base: char("base", { length: 3 }).notNull().references(() => currencies.code),
    quote: char("quote", { length: 3 }).notNull().references(() => currencies.code),
    rateType: text("rate_type").notNull().default("standard"),
    rate: numeric("rate", { precision: 24, scale: 10 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    enteredBy: uuid("entered_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique().on(t.companyId, t.base, t.quote, t.rateType, t.effectiveAt),
    index().on(t.companyId, t.base, t.quote, t.rateType, t.effectiveAt),
  ],
);
