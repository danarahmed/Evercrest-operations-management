import { PermissionDenied } from "./errors";

/**
 * The permission catalog. Roles are data (configurable); permissions are code,
 * because each one guards a specific server-side command.
 */
export const PERMISSIONS = [
  "users.manage",
  "roles.manage",
  "branches.manage",
  "settings.manage",
  "exchange_rates.manage",
  "accounts.manage",
  "journal.post",
  "journal.reverse",
  "periods.manage",
  "reports.financial.view",
  "audit.view",
  "partners.manage",
  "catalog.manage",
  "contracts.manage",
  "projects.manage",
  "job_types.manage",
  "jobs.create",
  "jobs.manage",
  "jobs.financial_close",
  "trips.manage",
  "money_accounts.manage",
  "payments.create",
  "payments.reverse",
  "documents.configure",
  "documents.record",
  "documents.verify",
  "invoices.create",
  "invoices.cancel",
  "exchanges.create",
  "approvals.decide",
  "jobs.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(p: string): p is Permission {
  return (PERMISSIONS as readonly string[]).includes(p);
}

export interface Actor {
  userId: string;
  companyId: string;
  /** Branch the user is acting in, if any. */
  branchId: string | null;
  permissions: ReadonlySet<string>;
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new PermissionDenied(permission);
}
