import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { catalogItems, units } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { NotFound, ValidationError } from "@/server/errors";
import { type Dec, dec } from "../money";
import { nextCode } from "../sequences";

export const createCatalogItem = defineCommand({
  name: "catalog.create_item",
  permission: "catalog.manage",
  input: z.object({
    kind: z.enum(["product", "service"]),
    /** Left out: the next free PRD-0001 / SVC-0001. */
    code: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1),
    defaultUnit: z.string().nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    if (input.defaultUnit) await getUnit(tx, input.defaultUnit);
    const taken = async (c: string) => (await tx.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.companyId, actor.companyId), eq(catalogItems.code, c)))).length > 0;
    const code = input.code ?? (await nextCode(tx, actor.companyId, input.kind === "product" ? "PRD" : "SVC", 4, taken));
    const [row] = await tx.insert(catalogItems).values({ ...input, code, companyId: actor.companyId }).returning();
    await audit({ action: "catalog.create_item", entityType: "catalog_item", entityId: row.id, after: { ...input, code } });
    return { id: row.id };
  },
});

export async function getUnit(db: Db, code: string) {
  const [u] = await db.select().from(units).where(eq(units.code, code));
  if (!u) throw new NotFound("unit", code);
  return u;
}

/** Convert a quantity between units of the same dimension. Mass↔volume is refused. */
export async function convertQuantity(db: Db, quantity: string | Dec, from: string, to: string): Promise<Dec> {
  if (from === to) return dec(quantity);
  const [a, b] = await Promise.all([getUnit(db, from), getUnit(db, to)]);
  if (a.dimension !== b.dimension)
    throw new ValidationError(`Cannot convert ${a.dimension} (${from}) to ${b.dimension} (${to}) without a measured factor`);
  return dec(quantity).times(dec(a.toBase)).dividedBy(dec(b.toBase));
}

export async function getCatalogItem(db: Db, companyId: string, id: string) {
  const [row] = await db.select().from(catalogItems).where(and(eq(catalogItems.id, id), eq(catalogItems.companyId, companyId)));
  if (!row) throw new NotFound("catalog_item", id);
  return row;
}
