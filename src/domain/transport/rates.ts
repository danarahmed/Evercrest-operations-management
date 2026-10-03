import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { rates } from "@/db/schema";
import { RATE_BASES, RATE_TYPES, type RateType } from "@/db/schema/rates";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { amountString, currencyCode } from "../currency";
import { getUnit } from "../masterdata/catalog";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Which bases make sense for each rule type. */
const ALLOWED_BASES: Record<RateType, readonly string[]> = {
  driver_pay: ["actual_qty", "per_trip"],
  // Owner rule: transporter fee is price × actual MT, or a fixed amount per trip.
  transporter_fee: ["actual_qty", "per_trip"],
  customer_price: ["actual_qty", "per_trip"],
  shortage_fine: ["quantity"],
  allowance: ["quantity"],
  demurrage_pay: ["per_day"],
  demurrage_bill: ["per_day"],
  product_price: ["per_unit"],
};

const DIMENSIONS = ["productId", "customerId", "transporterId", "contractId"] as const;

export const rateInput = z.object({
  rateType: z.enum(RATE_TYPES),
  basis: z.enum(RATE_BASES),
  amount: amountString,
  currency: currencyCode.nullish(),
  unit: z.string().nullish(),
  productId: uuid.nullish(),
  customerId: uuid.nullish(),
  transporterId: uuid.nullish(),
  contractId: uuid.nullish(),
  freeDays: z.coerce.number().int().min(0).nullish(),
  startEvent: z.enum(["loading", "arrival"]).nullish(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullish(),
  reason: z.string().min(1),
});

/** Add a rule. Rules for the same scope may not overlap in time: end the old one first. */
export const defineRate = defineCommand({
  name: "rates.define",
  permission: "rates.manage",
  input: rateInput,
  async handler({ tx, actor, audit }, { reason, ...r }) {
    if (!ALLOWED_BASES[r.rateType].includes(r.basis))
      throw new ValidationError(`${r.rateType} cannot be charged ${r.basis.replace("_", " ")}`);
    const isQuantityRule = r.rateType === "allowance";
    if (isQuantityRule && r.currency) throw new ValidationError("An allowance is a quantity, not money");
    if (!isQuantityRule && !r.currency) throw new ValidationError("Choose the currency of this rate");
    const needsUnit = !["per_trip", "per_day"].includes(r.basis);
    if (needsUnit && !r.unit) throw new ValidationError("Choose the unit this rate is per (e.g. MT)");
    if (r.unit) await getUnit(tx, r.unit);
    const isDemurrage = r.rateType.startsWith("demurrage");
    if (isDemurrage && (r.freeDays === null || r.freeDays === undefined || !r.startEvent))
      throw new ValidationError("Demurrage needs the free days and whether counting starts at loading or arrival");
    if (r.effectiveTo && r.effectiveTo < r.effectiveFrom) throw new ValidationError("End date is before the start date");

    // Same scope = same type and same dimension values (null included).
    const sameScope = DIMENSIONS.map((d) => (r[d] ? eq(rates[d], r[d]!) : isNull(rates[d])));
    const overlapping = await tx
      .select({ id: rates.id, from: rates.effectiveFrom, to: rates.effectiveTo })
      .from(rates)
      .where(
        and(
          eq(rates.companyId, actor.companyId),
          eq(rates.rateType, r.rateType),
          ...sameScope,
          or(isNull(rates.effectiveTo), gte(rates.effectiveTo, r.effectiveFrom)),
          r.effectiveTo ? lte(rates.effectiveFrom, r.effectiveTo) : undefined,
        ),
      );
    if (overlapping.length)
      throw new Conflict("Another rule for the same scope is in force in this period; end it first", { rateIds: overlapping.map((o) => o.id) });

    const [row] = await tx.insert(rates).values({ ...r, companyId: actor.companyId, createdBy: actor.userId }).returning();
    await audit({ action: "rates.define", entityType: "rate", entityId: row.id, after: r, reason });
    return { id: row.id };
  },
});

/** Close a rule from a date (e.g. before a new price starts). History before that date is untouched. */
export const endRate = defineCommand({
  name: "rates.end",
  permission: "rates.manage",
  input: z.object({ rateId: uuid, effectiveTo: isoDate, reason: z.string().min(1) }),
  async handler({ tx, actor, audit }, { rateId, effectiveTo, reason }) {
    const [r] = await tx.select().from(rates).where(and(eq(rates.id, rateId), eq(rates.companyId, actor.companyId)));
    if (!r) throw new NotFound("rate", rateId);
    if (effectiveTo < r.effectiveFrom) throw new ValidationError("End date is before the rule's start date");
    if (r.effectiveTo && effectiveTo > r.effectiveTo) throw new ValidationError("A rule can only be shortened");
    await tx.update(rates).set({ effectiveTo }).where(eq(rates.id, rateId));
    await audit({ action: "rates.end", entityType: "rate", entityId: rateId, before: { effectiveTo: r.effectiveTo }, after: { effectiveTo }, reason });
    return { rateId };
  },
});

export type Rate = typeof rates.$inferSelect;

/**
 * The rule in force on `date` for this context. A rule matches when each of its
 * dimensions is empty or equal to the context; the most specific match wins.
 * Two equally specific matches are a configuration error, never a guess.
 */
export async function resolveRate(
  db: Db,
  companyId: string,
  rateType: RateType,
  date: string,
  ctx: { productId?: string | null; customerId?: string | null; transporterId?: string | null; contractId?: string | null },
): Promise<Rate | null> {
  const candidates = await db
    .select()
    .from(rates)
    .where(
      and(
        eq(rates.companyId, companyId),
        eq(rates.rateType, rateType),
        lte(rates.effectiveFrom, date),
        or(isNull(rates.effectiveTo), gte(rates.effectiveTo, date)),
      ),
    );
  const matching = candidates.filter((r) => DIMENSIONS.every((d) => r[d] === null || r[d] === (ctx[d] ?? null)));
  if (!matching.length) return null;
  const score = (r: Rate) => DIMENSIONS.filter((d) => r[d] !== null).length;
  const best = Math.max(...matching.map(score));
  const top = matching.filter((r) => score(r) === best);
  if (top.length > 1)
    throw new Conflict(`Two ${rateType.replace("_", " ")} rules apply equally on ${date}; make one more specific or end one`, { rateIds: top.map((r) => r.id) });
  return top[0];
}
