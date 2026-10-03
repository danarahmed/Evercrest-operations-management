import { sql } from "drizzle-orm";
import { boolean, char, check, jsonb, numeric, date, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { branches, companies, users } from "./core";
import { businessPartners } from "./masterdata";

/** Gap-free, per-company, per-year document numbers (JOB-2026-00001, TRP-2026-00001, ...). */
export const documentSequences = pgTable(
  "document_sequences",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id),
    prefix: text("prefix").notNull(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.prefix, t.year] })],
);

/** A commercial agreement with one partner. Commercial rules/rates attach to it later. */
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    partnerId: uuid("partner_id").notNull().references(() => businessPartners.id),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    status: text("status", { enum: ["draft", "active", "ended"] }).notNull().default("draft"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.reference),
    check("valid_range", sql`${t.validTo} is null or ${t.validFrom} is null or ${t.validTo} >= ${t.validFrom}`),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    customerId: uuid("customer_id").notNull().references(() => businessPartners.id),
    contractId: uuid("contract_id").references(() => contracts.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

/** Job type = template: supplies default capabilities; never a rigid restriction. */
export const jobTypes = pgTable(
  "job_types",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    defaultCapabilities: text("default_capabilities").array().notNull().default(sql`'{}'::text[]`),
    /** Activity checklist copied onto each new job of this type (users can add or skip steps). */
    defaultActivities: text("default_activities").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

export const JOB_STATUSES = [
  "draft",
  "open",
  "in_progress",
  "pending",
  "completed",
  "financially_closed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** The central operational object. Specialized records (trips, work orders, ...) reference it. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    jobNo: text("job_no").notNull(),
    jobTypeId: uuid("job_type_id").notNull().references(() => jobTypes.id),
    customerId: uuid("customer_id").notNull().references(() => businessPartners.id),
    projectId: uuid("project_id").references(() => projects.id),
    contractId: uuid("contract_id").references(() => contracts.id),
    name: text("name").notNull(),
    description: text("description"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    responsibleUserId: uuid("responsible_user_id").notNull().references(() => users.id),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("open"),
    capabilities: text("capabilities").array().notNull().default(sql`'{}'::text[]`),
    /** Values of configured custom fields (CLAUDE.md §8), keyed by field key. */
    customValues: jsonb("custom_values").notNull().default(sql`'{}'::jsonb`),
    /** Optional cost budget in one currency; costs above it raise an exception. */
    budgetAmount: numeric("budget_amount", { precision: 20, scale: 4 }),
    budgetCurrency: char("budget_currency", { length: 3 }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.jobNo),
    index().on(t.companyId, t.status),
    index().on(t.companyId, t.customerId),
    check("job_dates", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("job_budget", sql`(${t.budgetAmount} is null) = (${t.budgetCurrency} is null) and coalesce(${t.budgetAmount}, 0) >= 0`),
  ],
);

export const ACTIVITY_STATUSES = ["open", "done", "skipped"] as const;

/**
 * Lightweight steps of a job (CLAUDE.md §9), e.g. arrange truck → load → deliver
 * → collect document → invoice. Not a project-management system: a title, an
 * optional owner and due date, and a status. A "required" step must be done
 * (or skipped with a reason) before the job can be completed.
 */
export const jobActivities = pgTable(
  "job_activities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    required: boolean("required").notNull().default(false),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    dueDate: date("due_date", { mode: "string" }),
    status: text("status", { enum: ACTIVITY_STATUSES }).notNull().default("open"),
    note: text("note"),
    doneBy: uuid("done_by").references(() => users.id),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.jobId, t.position)],
);

/**
 * Extra information a job may need for a customer or a kind of work
 * (customer reference, field permit number, site code …). Only for simple
 * facts: anything used in calculations or reports becomes a real field.
 */
export const customFields = pgTable(
  "custom_fields",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** Which jobs show the field: every job, one job type, or one customer's jobs. */
    scope: text("scope", { enum: ["all", "job_type", "customer"] }).notNull(),
    scopeId: uuid("scope_id"),
    required: boolean("required").notNull().default(false),
    requiredBefore: text("required_before", { enum: ["completed", "financially_closed"] }).notNull().default("completed"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.key), check("scope_target", sql`(${t.scope} = 'all') = (${t.scopeId} is null)`)],
);
