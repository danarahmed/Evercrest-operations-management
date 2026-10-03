import type { Db } from "@/db/client";
import { auditEvents, companies, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { PERMISSIONS } from "./authz";

/**
 * One-time setup: the company, an Administrator role holding every permission,
 * and the first administrator user. All other users and roles are created
 * through audited commands afterwards.
 */
export async function setupCompany(
  db: Db,
  input: { companyName: string; adminEmail: string; adminName: string; locale?: "en" | "ar" | "ckb" },
) {
  return db.transaction(async (tx) => {
    const [company] = await tx.insert(companies).values({ name: input.companyName }).returning();
    const [role] = await tx
      .insert(roles)
      .values({ companyId: company.id, code: "admin", name: "Administrator" })
      .returning();
    await tx.insert(rolePermissions).values(PERMISSIONS.map((permission) => ({ roleId: role.id, permission })));
    const [admin] = await tx
      .insert(users)
      .values({ companyId: company.id, email: input.adminEmail, displayName: input.adminName, locale: input.locale ?? "en" })
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
