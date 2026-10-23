import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";

/**
 * Find the ERP user behind a signed-in Supabase Auth identity.
 *
 * Users are created in the ERP first (Users & roles), which also sends the
 * invitation. On the first sign-in the identity is linked to that user by email,
 * once, and the link is audited. After that only the stored identity id counts,
 * so changing an email in Supabase can never take over another user.
 * Returns null when no ERP user exists for this identity (no access).
 */
export async function linkAuthIdentity(db: Db, authUserId: string, email: string | null | undefined): Promise<string | null> {
  const [linked] = await db.select({ id: users.id }).from(users).where(eq(users.authUserId, authUserId));
  if (linked) return linked.id;
  if (!email) return null;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: users.id, companyId: users.companyId })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.authUserId)));
    // One email in several companies would be ambiguous: refuse rather than guess.
    if (candidates.length !== 1) return null;
    const [u] = candidates;
    await tx.update(users).set({ authUserId }).where(and(eq(users.id, u.id), isNull(users.authUserId)));
    await tx.insert(auditEvents).values({
      companyId: u.companyId,
      actorUserId: u.id,
      action: "auth.link_identity",
      entityType: "user",
      entityId: u.id,
      after: { authUserId },
      reason: "first sign-in",
    });
    return u.id;
  });
}
