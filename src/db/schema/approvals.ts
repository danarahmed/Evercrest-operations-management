import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches, companies, users } from "./core";

/**
 * An operation held for approval: the exact command and input the requester
 * submitted. On approval the system runs it unchanged, recording the approver.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    branchId: uuid("branch_id").references(() => branches.id),
    command: text("command").notNull(),
    input: jsonb("input").notNull(),
    summary: text("summary").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected", "failed"] }).notNull().default("pending"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.companyId, t.status)],
);
