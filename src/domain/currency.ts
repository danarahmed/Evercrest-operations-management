import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { currencies, exchangeRates } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { NotFound, ValidationError } from "@/server/errors";

export const currencyCode = z.string().regex(/^[A-Z]{3}$/);
export const amountString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export async function getCurrency(db: Db, code: string) {
  const [c] = await db.select().from(currencies).where(eq(currencies.code, code));
  if (!c) throw new NotFound("currency", code);
  return c;
}

/** Record a new dated rate. History is immutable; a correction is another row. */
export const recordExchangeRate = defineCommand({
  name: "currency.record_rate",
  permission: "exchange_rates.manage",
  input: z.object({
    base: currencyCode,
    quote: currencyCode,
    rate: amountString,
    rateType: z.string().min(1).default("standard"),
    effectiveAt: z.coerce.date(),
    reason: z.string().optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    if (input.base === input.quote) throw new ValidationError("Base and quote currency must differ");
    if (Number(input.rate) <= 0) throw new ValidationError("Rate must be positive");
    await getCurrency(tx, input.base);
    await getCurrency(tx, input.quote);
    const previous = await findRate(tx, actor.companyId, input.base, input.quote, input.effectiveAt, input.rateType);
    const [row] = await tx
      .insert(exchangeRates)
      .values({ ...input, companyId: actor.companyId, enteredBy: actor.userId })
      .returning();
    await audit({
      action: "currency.record_rate",
      entityType: "exchange_rate",
      entityId: row.id,
      before: previous ? { rate: previous.rate, effectiveAt: previous.effectiveAt } : null,
      after: { base: row.base, quote: row.quote, rate: row.rate, rateType: row.rateType, effectiveAt: row.effectiveAt },
      reason: input.reason,
    });
    return { id: row.id, rate: row.rate };
  },
});

/** The rate in force at `at` (latest effective_at <= at), or undefined. Never guessed. */
export async function findRate(db: Db, companyId: string, base: string, quote: string, at: Date, rateType = "standard") {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.companyId, companyId),
        eq(exchangeRates.base, base),
        eq(exchangeRates.quote, quote),
        eq(exchangeRates.rateType, rateType),
        lte(exchangeRates.effectiveAt, at),
      ),
    )
    .orderBy(desc(exchangeRates.effectiveAt))
    .limit(1);
  return row;
}
