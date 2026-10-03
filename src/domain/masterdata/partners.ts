import { and, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, PARTNER_ROLES, partnerRoles } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { NotFound } from "@/server/errors";

const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .nullish();

const partnerFields = {
  kind: z.enum(["organization", "person"]),
  name: z.string().trim().min(1),
  phone: optionalText,
  address: optionalText,
  taxId: optionalText,
  notes: optionalText,
};

export const createPartner = defineCommand({
  name: "partners.create",
  permission: "partners.manage",
  input: z.object({ ...partnerFields, roles: z.array(z.enum(PARTNER_ROLES)).min(1) }),
  async handler({ tx, actor, audit }, { roles, ...fields }) {
    const [row] = await tx.insert(businessPartners).values({ ...fields, searchKey: normalizeName(fields.name), companyId: actor.companyId }).returning();
    const unique = [...new Set(roles)];
    await tx.insert(partnerRoles).values(unique.map((role) => ({ partnerId: row.id, role })));
    await audit({ action: "partners.create", entityType: "partner", entityId: row.id, after: { ...fields, roles: unique } });
    return { id: row.id };
  },
});

/** Update details and/or roles. Only supplied fields change; before/after are audited. */
export const updatePartner = defineCommand({
  name: "partners.update",
  permission: "partners.manage",
  input: z.object({
    partnerId: z.string().uuid(),
    ...Object.fromEntries(Object.entries(partnerFields).map(([k, v]) => [k, v.optional()])),
    active: z.boolean().optional(),
    roles: z.array(z.enum(PARTNER_ROLES)).min(1).optional(),
    reason: z.string().optional(),
  }) as z.ZodType<
    { partnerId: string; roles?: (typeof PARTNER_ROLES)[number][]; reason?: string; active?: boolean } & Partial<
      Record<keyof typeof partnerFields, string | null>
    >
  >,
  async handler({ tx, actor, audit }, { partnerId, roles, reason, ...changes }) {
    const where = and(eq(businessPartners.id, partnerId), eq(businessPartners.companyId, actor.companyId));
    const [before] = await tx.select().from(businessPartners).where(where);
    if (!before) throw new NotFound("partner", partnerId);
    const set: Record<string, unknown> = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length)
      await tx
        .update(businessPartners)
        .set(typeof set.name === "string" ? { ...set, searchKey: normalizeName(set.name) } : set)
        .where(where);
    const beforeRoles = (await tx.select().from(partnerRoles).where(eq(partnerRoles.partnerId, partnerId))).map((r) => r.role).sort();
    if (roles) {
      await tx.delete(partnerRoles).where(eq(partnerRoles.partnerId, partnerId));
      await tx.insert(partnerRoles).values([...new Set(roles)].map((role) => ({ partnerId, role })));
    }
    await audit({
      action: "partners.update",
      entityType: "partner",
      entityId: partnerId,
      before: { ...Object.fromEntries(Object.keys(set).map((k) => [k, before[k as keyof typeof before]])), ...(roles ? { roles: beforeRoles } : {}) },
      after: { ...set, ...(roles ? { roles: [...new Set(roles)].sort() } : {}) },
      reason,
    });
    return { id: partnerId };
  },
});

/** Normalize for duplicate detection: case, spacing, Arabic/Kurdish letter variants. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Candidate existing partners for a typed name, so users pick the existing
 * record instead of creating duplicates. Optionally restricted to a role.
 */
export async function searchPartners(db: Db, companyId: string, query: string, role?: (typeof PARTNER_ROLES)[number]) {
  const q = normalizeName(query);
  if (!q) return [];
  const rows = await db
    .select()
    .from(businessPartners)
    .where(and(eq(businessPartners.companyId, companyId), ilike(businessPartners.searchKey, `%${q.replace(/[%_\\]/g, "")}%`)))
    .limit(50);
  const ids = rows.map((r) => r.id);
  const roleRows = ids.length ? await db.select().from(partnerRoles).where(inArray(partnerRoles.partnerId, ids)) : [];
  return rows
    .map((r) => ({ ...r, roles: roleRows.filter((x) => x.partnerId === r.id).map((x) => x.role) }))
    .filter((r) => !role || r.roles.includes(role))
    .slice(0, 20);
}
