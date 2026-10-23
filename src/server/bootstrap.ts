import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, companies, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { PERMISSIONS } from "./authz";
import { Conflict } from "./errors";

/**
 * One-time setup: the company, an Administrator role holding every permission,
 * and the first administrator user. All other users and roles are created
 * through audited commands afterwards.
 */
export async function setupCompany(
  db: Db,
  input: { companyName: string; adminEmail: string; adminName: string; locale?: "en" | "ar" | "ckb"; onlyIfEmpty?: boolean },
) {
  return db.transaction(async (tx) => {
    if (input.onlyIfEmpty) {
      // First-run setup: serialise concurrent attempts and refuse once any company exists.
      await tx.execute(sql`select pg_advisory_xact_lock(7340211)`);
      const [existing] = await tx.select({ id: companies.id }).from(companies).limit(1);
      if (existing) throw new Conflict("The system is already set up");
    }
    const [company] = await tx.insert(companies).values({ name: input.companyName }).returning();
    const [role] = await tx
      .insert(roles)
      .values({ companyId: company.id, code: "admin", name: "Administrator" })
      .returning();
    await tx.insert(rolePermissions).values(PERMISSIONS.map((permission) => ({ roleId: role.id, permission })));
    const [admin] = await tx
      .insert(users)
      .values({ companyId: company.id, email: input.adminEmail.trim().toLowerCase(), displayName: input.adminName.trim(), locale: input.locale ?? "en" })
      .returning();
    await tx.insert(userRoles).values({ userId: admin.id, roleId: role.id });
    await tx.insert(auditEvents).values({
      companyId: company.id,
      actorUserId: admin.id,
      action: "system.setup_company",
      entityType: "company",
      entityId: company.id,
      after: { companyName: company.name, adminEmail: admin.email },
    });
    return { companyId: company.id, adminUserId: admin.id };
  });
}
