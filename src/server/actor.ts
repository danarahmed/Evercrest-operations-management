import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rolePermissions, userRoles, users } from "@/db/schema";
import type { Actor } from "./authz";
import { NotFound, PermissionDenied } from "./errors";

/** Resolve a user's effective permissions: company-wide roles plus roles for the chosen branch. */
export async function loadActor(db: Db, userId: string, branchId: string | null = null): Promise<Actor> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new NotFound("user", userId);
  if (!user.active) throw new PermissionDenied("active_user");
  const branchMatch = branchId
    ? or(isNull(userRoles.branchId), eq(userRoles.branchId, branchId))
    : isNull(userRoles.branchId);
  const rows = await db
    .selectDistinct({ permission: rolePermissions.permission })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), branchMatch));
  return {
    userId,
    companyId: user.companyId,
    branchId,
    permissions: new Set(rows.map((r) => r.permission)),
  };
}
