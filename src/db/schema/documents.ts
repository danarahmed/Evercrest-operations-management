import { sql } from "drizzle-orm";
import { date, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies, users } from "./core";
import { jobs } from "./jobs";

/** Configurable document kinds: manifest, delivery note, completion certificate, ... */
export const documentTypes = pgTable(
  "document_types",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (t) => [unique().on(t.companyId, t.code)],
);

/**
 * "Jobs of this type / for this customer / under this contract need document X
 * (on the job itself or on every trip), verified before status S."
 * Nothing is mandatory globally; requirements are configuration.
 */
export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentTypeId: uuid("document_type_id").notNull().references(() => documentTypes.id),
    scope: text("scope", { enum: ["job_type", "customer", "contract"] }).notNull(),
    scopeId: uuid("scope_id").notNull(),
    appliesTo: text("applies_to", { enum: ["job", "trip"] }).notNull(),
    requiredBefore: text("required_before", { enum: ["completed", "financially_closed"] }).notNull(),
  },
  (t) => [unique().on(t.companyId, t.documentTypeId, t.scope, t.scopeId, t.appliesTo)],
);

/**
 * A document actually received. "Required" and "missing" are not stored — they
 * are computed from requirements. "Expired" is computed from expiryDate.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentTypeId: uuid("document_type_id").notNull().references(() => documentTypes.id),
    entityType: text("entity_type", { enum: ["job", "trip", "payment"] }).notNull(),
    entityId: uuid("entity_id").notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    status: text("status", { enum: ["received", "verified", "rejected"] }).notNull().default("received"),
    reference: text("reference"),
    issuedDate: date("issued_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    /** Object-storage key of the uploaded file, if any. */
    fileKey: text("file_key"),
    fileName: text("file_name"),
    notes: text("notes"),
    receivedBy: uuid("received_by").notNull().references(() => users.id),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId, t.entityType, t.entityId), index().on(t.jobId)],
);
