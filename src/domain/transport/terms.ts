import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { accounts, ALLOWANCE_BASES, DEMURRAGE_METHODS, FEE_BASES, feeTypes, jobFees, jobRoutes, jobTerms, PRICE_BASES, QUANTITY_BASES } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { NotFound, ValidationError } from "@/server/errors";
import { amountString, currencyCode } from "../currency";
import { dec } from "../money";
import { getJob } from "../jobs/commands";
import { getUnit } from "../masterdata/catalog";
import { normalizeName } from "../masterdata/partners";
import { nextCode } from "../sequences";
import type { FeeForCalc, TermsForCalc } from "./trip-calc";

/**
 * The job's rule card: routes, dated price/shortage/demurrage terms and dated
 * fees. Set by the manager; staff work inside it. Setting a version for a date
 * that already has one replaces it (audited with before/after).
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optAmount = amountString.nullish();

export type JobTerms = typeof jobTerms.$inferSelect;
export type JobFee = typeof jobFees.$inferSelect;
export type FeeType = typeof feeTypes.$inferSelect;

async function assertRoute(tx: Db, jobId: string, routeId: string | null | undefined) {
  if (!routeId) return;
  const [r] = await tx.select().from(jobRoutes).where(and(eq(jobRoutes.id, routeId), eq(jobRoutes.jobId, jobId)));
  if (!r) throw new NotFound("job_route", routeId);
}

/** Find a job's route by name (or create it). Used by the rule card and by imports. */
export async function routeByName(tx: Db, companyId: string, jobId: string, name: string, places: { loadingPlace?: string | null; dischargePlace?: string | null } = {}) {
  const nameKey = normalizeName(name);
  if (!nameKey) throw new ValidationError("Route name is required");
  const [existing] = await tx.select().from(jobRoutes).where(and(eq(jobRoutes.jobId, jobId), eq(jobRoutes.nameKey, nameKey)));
  if (existing) return { route: existing, created: false };
  const [route] = await tx
    .insert(jobRoutes)
    .values({ companyId, jobId, name: name.trim(), nameKey, loadingPlace: places.loadingPlace ?? null, dischargePlace: places.dischargePlace ?? null })
    .returning();
  return { route, created: true };
}

export const defineRoute = defineCommand({
  name: "job_routes.define",
  permission: "job_terms.manage",
  input: z.object({ jobId: uuid, name: z.string().trim().min(1), loadingPlace: z.string().trim().nullish(), dischargePlace: z.string().trim().nullish() }),
  async handler({ tx, actor, audit }, input) {
    await getJob(tx, actor.companyId, input.jobId);
    const { route, created } = await routeByName(tx, actor.companyId, input.jobId, input.name, input);
    if (!created) {
      await tx.update(jobRoutes).set({ loadingPlace: input.loadingPlace ?? route.loadingPlace, dischargePlace: input.dischargePlace ?? route.dischargePlace }).where(eq(jobRoutes.id, route.id));
    }
    await audit({ action: "job_routes.define", entityType: "job_route", entityId: route.id, before: created ? null : route, after: input });
    return { id: route.id };
  },
});

export const setTerms = defineCommand({
  name: "job_terms.set",
  permission: "job_terms.manage",
  input: z.object({
    jobId: uuid,
    routeId: uuid.nullish(),
    effectiveFrom: isoDate,
    currency: currencyCode,
    unit: z.string().min(1),
    customerPrice: optAmount,
    customerPriceBasis: z.enum(PRICE_BASES).default("per_unit"),
    customerQtyBasis: z.enum(QUANTITY_BASES).default("net"),
    customerAllowance: optAmount,
    customerAllowanceBasis: z.enum(ALLOWANCE_BASES).default("per_trip"),
    customerFinePrice: optAmount,
    carrierPrice: optAmount,
    carrierPriceBasis: z.enum(PRICE_BASES).default("per_unit"),
    rewardPerTrip: amountString.default("0"),
    transporterCommission: amountString.default("0"),
    carrierAllowance: amountString.default("0"),
    carrierFinePrice: amountString.default("0"),
    demurrageMethod: z.enum(DEMURRAGE_METHODS).default("none"),
    demurrageFreeDays: z.coerce.number().int().min(0).default(0),
    carrierDemurrageRate: amountString.default("0"),
    customerDemurrageRate: amountString.default("0"),
    advanceNormal: optAmount,
    advanceMax: optAmount,
    note: z.string().trim().nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    await getJob(tx, actor.companyId, input.jobId);
    await assertRoute(tx, input.jobId, input.routeId);
    await getUnit(tx, input.unit);
    const values = { ...input, routeId: input.routeId ?? null, companyId: actor.companyId, createdBy: actor.userId };
    const [prev] = await tx
      .select()
      .from(jobTerms)
      .where(and(eq(jobTerms.jobId, input.jobId), input.routeId ? eq(jobTerms.routeId, input.routeId) : isNull(jobTerms.routeId), eq(jobTerms.effectiveFrom, input.effectiveFrom)));
    const [row] = prev
      ? await tx.update(jobTerms).set(values).where(eq(jobTerms.id, prev.id)).returning()
      : await tx.insert(jobTerms).values(values).returning();
    await audit({ action: "job_terms.set", entityType: "job_terms", entityId: row.id, before: prev ?? null, after: input });
    return { id: row.id };
  },
});

export const defineFeeType = defineCommand({
  name: "fee_types.define",
  permission: "job_terms.manage",
  input: z.object({
    /** Given: update that fee type; left out: a new one (FEE-001, …). */
    id: uuid.optional(),
    name: z.string().trim().min(1),
    defaultBasis: z.enum(FEE_BASES).default("per_trip"),
    deductFromCarrier: z.boolean().default(false),
    billedToCustomer: z.boolean().default(false),
    expenseAccountId: uuid.nullish(),
    active: z.boolean().default(true),
  }),
  async handler({ tx, actor, audit }, input) {
    if (input.expenseAccountId) {
      const [acc] = await tx.select().from(accounts).where(and(eq(accounts.id, input.expenseAccountId), eq(accounts.companyId, actor.companyId)));
      if (!acc || acc.type !== "expense" || !acc.postable) throw new ValidationError("Choose a postable expense account");
    }
    const { id, ...fields } = input;
    if (id) {
      const [prev] = await tx.select().from(feeTypes).where(and(eq(feeTypes.id, id), eq(feeTypes.companyId, actor.companyId)));
      if (!prev) throw new NotFound("fee_type", id);
      await tx.update(feeTypes).set(fields).where(eq(feeTypes.id, id));
      await audit({ action: "fee_types.define", entityType: "fee_type", entityId: id, before: prev, after: fields });
      return { id, code: prev.code };
    }
    const taken = async (c: string) => (await tx.select({ id: feeTypes.id }).from(feeTypes).where(and(eq(feeTypes.companyId, actor.companyId), eq(feeTypes.code, c)))).length > 0;
    const code = await nextCode(tx, actor.companyId, "FEE", 3, taken);
    const [row] = await tx.insert(feeTypes).values({ ...fields, code, companyId: actor.companyId }).returning();
    await audit({ action: "fee_types.define", entityType: "fee_type", entityId: row.id, after: { ...fields, code } });
    return { id: row.id, code };
  },
});

export const setJobFee = defineCommand({
  name: "job_fees.set",
  permission: "job_terms.manage",
  input: z.object({
    jobId: uuid,
    routeId: uuid.nullish(),
    feeTypeId: uuid,
    effectiveFrom: isoDate,
    /** 0 ends the fee from this date. */
    amount: amountString,
    currency: currencyCode,
    basis: z.enum(FEE_BASES).optional(),
    deductFromCarrier: z.boolean().optional(),
    billedToCustomer: z.boolean().optional(),
  }),
  async handler({ tx, actor, audit }, input) {
    await getJob(tx, actor.companyId, input.jobId);
    await assertRoute(tx, input.jobId, input.routeId);
    const [ft] = await tx.select().from(feeTypes).where(and(eq(feeTypes.id, input.feeTypeId), eq(feeTypes.companyId, actor.companyId)));
    if (!ft) throw new NotFound("fee_type", input.feeTypeId);
    const values = {
      companyId: actor.companyId,
      jobId: input.jobId,
      routeId: input.routeId ?? null,
      feeTypeId: ft.id,
      effectiveFrom: input.effectiveFrom,
      amount: input.amount,
      currency: input.currency,
      basis: input.basis ?? ft.defaultBasis,
      deductFromCarrier: input.deductFromCarrier ?? ft.deductFromCarrier,
      billedToCustomer: input.billedToCustomer ?? ft.billedToCustomer,
      createdBy: actor.userId,
    };
    const [prev] = await tx
      .select()
      .from(jobFees)
      .where(and(eq(jobFees.jobId, input.jobId), input.routeId ? eq(jobFees.routeId, input.routeId) : isNull(jobFees.routeId), eq(jobFees.feeTypeId, ft.id), eq(jobFees.effectiveFrom, input.effectiveFrom)));
    const [row] = prev ? await tx.update(jobFees).set(values).where(eq(jobFees.id, prev.id)).returning() : await tx.insert(jobFees).values(values).returning();
    await audit({ action: "job_fees.set", entityType: "job_fee", entityId: row.id, before: prev ?? null, after: values });
    return { id: row.id };
  },
});

/** Everything on a job's rule card, loaded once (then resolved in memory for many trips). */
export async function loadRuleCard(db: Db, companyId: string, jobId: string) {
  const [terms, fees, types, routes] = await Promise.all([
    db.select().from(jobTerms).where(eq(jobTerms.jobId, jobId)).orderBy(asc(jobTerms.effectiveFrom)),
    db.select().from(jobFees).where(eq(jobFees.jobId, jobId)).orderBy(asc(jobFees.effectiveFrom)),
    db.select().from(feeTypes).where(eq(feeTypes.companyId, companyId)).orderBy(asc(feeTypes.code)),
    db.select().from(jobRoutes).where(eq(jobRoutes.jobId, jobId)).orderBy(asc(jobRoutes.name)),
  ]);
  return { terms, fees, feeTypes: types.filter((t) => fees.some((f) => f.feeTypeId === t.id)), allFeeTypes: types, routes };
}
export type RuleCard = Awaited<ReturnType<typeof loadRuleCard>>;

/** Latest version on or before `date`: the route's own version first, else the job-wide one. */
function pick<T extends { routeId: string | null; effectiveFrom: string }>(rows: T[], routeId: string | null, date: string): T | null {
  const upTo = (r: T) => r.effectiveFrom <= date;
  const latest = (xs: T[]) => xs.filter(upTo).reduce<T | null>((a, r) => (!a || r.effectiveFrom >= a.effectiveFrom ? r : a), null);
  return (routeId && latest(rows.filter((r) => r.routeId === routeId))) || latest(rows.filter((r) => r.routeId === null));
}

export function termsOn(card: RuleCard, routeId: string | null, date: string): JobTerms | null {
  return pick(card.terms, routeId, date);
}

/** Fees in force on a date for a route: per fee type, the route's version first, else the job-wide one; zero amounts end a fee. */
export function feesOn(card: RuleCard, routeId: string | null, date: string): (JobFee & { name: string })[] {
  const out: (JobFee & { name: string })[] = [];
  for (const ft of card.feeTypes) {
    const f = pick(card.fees.filter((x) => x.feeTypeId === ft.id), routeId, date);
    if (f && !dec(f.amount).isZero()) out.push({ ...f, name: ft.name });
  }
  return out;
}

export const toCalcTerms = (t: JobTerms): TermsForCalc => t;

export const toCalcFee = (f: JobFee & { name: string }): FeeForCalc => ({
  feeTypeId: f.feeTypeId,
  name: f.name,
  rate: f.amount,
  basis: f.basis,
  currency: f.currency,
  deductFromCarrier: f.deductFromCarrier,
  billedToCustomer: f.billedToCustomer,
});
