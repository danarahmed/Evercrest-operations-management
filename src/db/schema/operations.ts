import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies, users } from "./core";
import { jobs } from "./jobs";
import { businessPartners, catalogItems, units } from "./masterdata";

/**
 * Field work (CLAUDE.md §4, §32: Job → Field Service → Work Order). A work
 * order is one piece of work at a site, done by our people or a contractor.
 * Its costs (labour, materials, equipment) are ordinary job expenses and bills.
 */
export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    workOrderNo: text("work_order_no").notNull(),
    site: text("site").notNull(),
    description: text("description").notNull(),
    /** Contractor doing the work, when not our own team. */
    contractorId: uuid("contractor_id").references(() => businessPartners.id),
    plannedDate: date("planned_date", { mode: "string" }),
    status: text("status", { enum: ["open", "in_progress", "completed", "cancelled"] }).notNull().default("open"),
    completedDate: date("completed_date", { mode: "string" }),
    completionNote: text("completion_note"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.companyId, t.workOrderNo),
    index().on(t.jobId),
    check("completed_has_date", sql`${t.status} <> 'completed' or ${t.completedDate} is not null`),
  ],
);

/**
 * Product supply (Job → Product Supply → Delivery): what was handed to the
 * customer, how much, when. Invoicing a delivery links the invoice line to it,
 * so a delivery is never billed twice.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    deliveryNo: text("delivery_no").notNull(),
    productId: uuid("product_id").notNull().references(() => catalogItems.id),
    quantity: numeric("quantity", { precision: 20, scale: 4 }).notNull(),
    unit: text("unit").notNull().references(() => units.code),
    deliveryDate: date("delivery_date", { mode: "string" }).notNull(),
    deliveredTo: text("delivered_to"),
    /** Delivery note / waybill number. */
    reference: text("reference"),
    status: text("status", { enum: ["delivered", "cancelled"] }).notNull().default("delivered"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.companyId, t.deliveryNo), index().on(t.jobId), check("delivery_qty_positive", sql`${t.quantity} > 0`)],
);
