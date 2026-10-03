import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { branches, rolePermissions, roles, userRoles, users } from "@/db/schema";
import { PERMISSIONS, type Permission } from "@/server/authz";
import { defineCommand } from "@/server/command";
import { NotFound, PermissionDenied } from "@/server/errors";

const permissionList = z.array(z.enum(PERMISSIONS)).min(1);

export const createBranch = defineCommand({
  name: "org.create_branch",
  permission: "branches.manage",
  input: z.object({ code: z.string().min(1).max(20), name: z.string().min(1) }),
  async handler({ tx, actor, audit }, input) {
    const [row] = await tx.insert(branches).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "org.create_branch", entityType: "branch", entityId: row.id, after: row });
    return { id: row.id };
  },
});

export const createUser = defineCommand({
  name: "org.create_user",
  permission: "users.manage",
  input: z.object({
    email: z.string().email().transform((e) => e.toLowerCase()),
    displayName: z.string().min(1),
    locale: z.enum(["en", "ar", "ckb"]).default("en"),
  }),
  async handler({ tx, actor, audit }, input) {
    const [row] = await tx.insert(users).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "org.create_user", entityType: "user", entityId: row.id, after: input });
    return { id: row.id };
  },
});

export const setUserActive = defineCommand({
  name: "org.set_user_active",
  permission: "users.manage",
  input: z.object({ userId: z.string().uuid(), active: z.boolean(), reason: z.string().min(1) }),
  async handler({ tx, actor, audit }, { userId, active, reason }) {
    if (userId === actor.userId && !active) throw new PermissionDenied("deactivate_self");
    const [row] = await tx
      .update(users)
      .set({ active })
      .where(and(eq(users.id, userId), eq(users.companyId, actor.companyId)))
      .returning();
    if (!row) throw new NotFound("user", userId);
    await audit({ action: "org.set_user_active", entityType: "user", entityId: userId, after: { active }, reason });
    return { userId, active };
  },
});

/** Users may only grant permissions they hold themselves (no privilege escalation). */
function assertCanGrant(held: ReadonlySet<string>, wanted: readonly Permission[]) {
  const missing = wanted.filter((p) => !held.has(p));
  if (missing.length) throw new PermissionDenied(missing.join(","));
}

/** Create a role or replace its permission set. */
export const defineRole = defineCommand({
  name: "org.define_role",
  permission: "roles.manage",
  input: z.object({ code: z.string().min(1), name: z.string().min(1), permissions: permissionList, reason: z.string().min(1) }),
  async handler({ tx, actor, audit }, { code, name, permissions, reason }) {
    assertCanGrant(actor.permissions, permissions);
    const [existing] = await tx.select().from(roles).where(and(eq(roles.companyId, actor.companyId), eq(roles.code, code)));
    let roleId: string;
    let before: string[] | null = null;
    if (existing) {
      roleId = existing.id;
      before = (await tx.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId))).map((r) => r.permission).sort();
      await tx.update(roles).set({ name }).where(eq(roles.id, roleId));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    } else {
      [{ id: roleId }] = await tx.insert(roles).values({ companyId: actor.companyId, code, name }).returning({ id: roles.id });
    }
    const unique = [...new Set(permissions)].sort();
    await tx.insert(rolePermissions).values(unique.map((permission) => ({ roleId, permission })));
    await audit({ action: "org.define_role", entityType: "role", entityId: roleId, before, after: { code, name, permissions: unique }, reason });
    return { id: roleId };
  },
});

export const assignRole = defineCommand({
  name: "org.assign_role",
  permission: "roles.manage",
  input: z.object({
    userId: z.string().uuid(),
    roleId: z.string().uuid(),
    branchId: z.string().uuid().nullish(),
    grant: z.boolean(),
    reason: z.string().min(1),
  }),
  async handler({ tx, actor, audit }, { userId, roleId, branchId, grant, reason }) {
    const [user] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, actor.companyId)));
    if (!user) throw new NotFound("user", userId);
    const [role] = await tx.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.companyId, actor.companyId)));
    if (!role) throw new NotFound("role", roleId);
    if (branchId) {
      const [b] = await tx.select().from(branches).where(and(eq(branches.id, branchId), eq(branches.companyId, actor.companyId)));
      if (!b) throw new NotFound("branch", branchId);
    }
    const perms = await tx.select().from(rolePermissions).where(inArray(rolePermissions.roleId, [roleId]));
    assertCanGrant(actor.permissions, perms.map((p) => p.permission as Permission));
    if (grant) {
      await tx.insert(userRoles).values({ userId, roleId, branchId: branchId ?? null }).onConflictDoNothing();
    } else {
      const branchCond = branchId ? eq(userRoles.branchId, branchId) : undefined;
      const rows = await tx.select().from(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
      const target = rows.find((r) => (branchCond ? r.branchId === branchId : r.branchId === null));
      if (target) await tx.delete(userRoles).where(eq(userRoles.id, target.id));
    }
    await audit({
      action: grant ? "org.grant_role" : "org.revoke_role",
      entityType: "user",
      entityId: userId,
      after: { roleId, roleCode: role.code, branchId: branchId ?? null },
      reason,
    });
    return { userId, roleId, granted: grant };
  },
});
