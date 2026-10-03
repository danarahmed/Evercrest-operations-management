import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { catalogItems, units } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { NotFound, ValidationError } from "@/server/errors";
import { type Dec, dec } from "../money";

export const createCatalogItem = defineCommand({
  name: "catalog.create_item",
  permission: "catalog.manage",
  input: z.object({
    kind: z.enum(["product", "service"]),
    code: z.string().trim().min(1),
    name: z.string().trim().min(1),
    defaultUnit: z.string().nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    if (input.defaultUnit) await getUnit(tx, input.defaultUnit);
    const [row] = await tx.insert(catalogItems).values({ ...input, companyId: actor.companyId }).returning();
    await audit({ action: "catalog.create_item", entityType: "catalog_item", entityId: row.id, after: input });
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
