import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accounts, deductionTypes, tripDeductions, trips } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { NotFound, ValidationError } from "@/server/errors";
import { amountString, currencyCode } from "../currency";
import { dec, toStr } from "../money";
import { loadRuleCard, termsOn } from "./terms";

/**
 * Deductions the company keeps from the carrier as its own income (owner's rule, 2026-11), e.g. a claim
 * handling charge. The kinds are set up once in Setup with a usual amount; operations tick them per trip
 * (never added automatically). It comes off whoever brings the trip's papers, in a claim or a site settlement.
 */

const uuid = z.string().uuid();

export const defineDeductionType = defineCommand({
  name: "deduction_types.define",
  permission: "job_terms.manage",
  input: z.object({
    /** Given: update that kind; left out: a new one. */
    id: uuid.optional(),
    name: z.string().trim().min(1).max(80),
    defaultAmount: amountString.nullish(),
    defaultCurrency: currencyCode.nullish(),
    incomeAccountId: uuid.nullish(),
    active: z.boolean().default(true),
  }),
  async handler({ tx, actor, audit }, given) {
    const fields = { name: given.name, defaultAmount: given.defaultAmount || null, defaultCurrency: given.defaultCurrency || null, incomeAccountId: given.incomeAccountId || null, active: given.active };
    if (fields.defaultAmount && !fields.defaultCurrency) throw new ValidationError("Choose the currency of the usual amount");
    if (fields.incomeAccountId) {
      const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, fields.incomeAccountId), eq(accounts.companyId, actor.companyId)));
      if (!acc || acc.type !== "income" || !acc.postable) throw new ValidationError("Choose a postable income account");
    }
    const [same] = await tx.select({ id: deductionTypes.id }).from(deductionTypes).where(and(eq(deductionTypes.companyId, actor.companyId), eq(deductionTypes.name, fields.name)));
    if (same && same.id !== given.id) throw new ValidationError(`A kind of deduction named "${fields.name}" already exists`);
    if (given.id) {
      const [prev] = await tx.select().from(deductionTypes).where(and(eq(deductionTypes.id, given.id), eq(deductionTypes.companyId, actor.companyId)));
      if (!prev) throw new NotFound("deduction_type", given.id);
      await tx.update(deductionTypes).set(fields).where(eq(deductionTypes.id, given.id));
      await audit({ action: "deduction_types.define", entityType: "deduction_type", entityId: given.id, before: prev, after: fields });
      return { id: given.id };
    }
    const [row] = await tx.insert(deductionTypes).values({ ...fields, companyId: actor.companyId }).returning({ id: deductionTypes.id });
    await audit({ action: "deduction_types.define", entityType: "deduction_type", entityId: row.id, after: fields });
    return { id: row.id };
  },
});

export const deductionChoice = z.object({ deductionTypeId: uuid, amount: amountString.nullish() });
export type DeductionChoice = z.infer<typeof deductionChoice>;

/**
 * Set the deductions a trip has (the ticked ones; the rest are removed). Amount empty = the kind's usual amount.
 * The currency is the job's (from the rule card on the loading date), so the deduction comes off the carrier's pay.
 */
export async function setTripDeductionsTx(tx: Db, companyId: string, trip: typeof trips.$inferSelect, chosen: DeductionChoice[]) {
  const current = await tx.select().from(tripDeductions).where(eq(tripDeductions.tripId, trip.id));
  const types = new Map((await tx.select().from(deductionTypes).where(eq(deductionTypes.companyId, companyId))).map((t) => [t.id, t]));
  let currency: string | null = null;
  if (trip.loadingDate) currency = termsOn(await loadRuleCard(tx, companyId, trip.jobId), trip.routeId, trip.loadingDate)?.currency ?? null;
  const before: Record<string, string> = Object.fromEntries(current.map((d) => [types.get(d.deductionTypeId)?.name ?? d.deductionTypeId, toStr(dec(d.amount))]));
  const after: Record<string, string> = {};
  const wanted: { deductionTypeId: string; amount: string; currency: string }[] = [];
  for (const c of chosen) {
    const type = types.get(c.deductionTypeId);
    if (!type) throw new NotFound("deduction_type", c.deductionTypeId);
    const amount = c.amount || type.defaultAmount;
    if (!amount || !dec(amount).gt(0)) throw new ValidationError(`Type the amount of ${type.name}`);
    const cur = currency ?? type.defaultCurrency;
    if (!cur) throw new ValidationError(`${type.name}: the trip has no rule card yet, so its currency is not known`);
    if (!currency && type.defaultCurrency && type.defaultCurrency !== cur) throw new ValidationError(`${type.name} is in ${type.defaultCurrency}`);
    wanted.push({ deductionTypeId: type.id, amount: toStr(dec(amount)), currency: cur });
    after[type.name] = toStr(dec(amount));
  }
  const changed = JSON.stringify(Object.entries(before).sort()) !== JSON.stringify(Object.entries(after).sort());
  if (changed) {
    await tx.delete(tripDeductions).where(eq(tripDeductions.tripId, trip.id));
    if (wanted.length) await tx.insert(tripDeductions).values(wanted.map((w) => ({ ...w, companyId, tripId: trip.id })));
  }
  return { before, after, changed };
}

/** The kinds of deduction of the company (Setup, the trip form). */
export async function companyDeductionTypes(db: Db, companyId: string) {
  return db.select().from(deductionTypes).where(eq(deductionTypes.companyId, companyId)).orderBy(deductionTypes.name);
}
