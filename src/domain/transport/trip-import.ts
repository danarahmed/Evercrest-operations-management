import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, moneyAccounts, partnerRoles, payments, tripFees, tripImports, trips } from "@/db/schema";
import { type CommandContext, defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { recordPayment } from "../finance/payments";
import { type Capability } from "../jobs/capabilities";
import { getJob } from "../jobs/commands";
import { normalizeName } from "../masterdata/partners";
import { dec } from "../money";
import { nextNumber } from "../sequences";
import { feesOn, loadRuleCard, routeByName, type RuleCard, termsOn } from "./terms";
import { findOrCreateTruck, plateKey } from "./trips";

/**
 * Import of a trip sheet (owner's working file): staged first, previewed, then
 * applied once. Rows are matched by manifest number — the trip's identity — so
 * the same sheet can be imported again later with discharge data filled in:
 * new manifests become trips, known ones get their missing discharge data, and
 * anything that would change recorded data is reported, never overwritten.
 */

const uuid = z.string().uuid();

export const SHEET_FEE_NAMES: Record<string, string> = {
  guarantee: "guarantee",
  insurance: "insurance",
  visa: "visa",
  entry_slip: "entry slip",
  declaration_fee: "declaration",
  border_commission: "border commission",
  customs_rate: "customs",
};

const rowSchema = z.object({
  rowNo: z.number().int(),
  values: z.record(z.string(), z.string()),
  fees: z.record(z.string(), z.string()),
});
export type ImportRow = z.infer<typeof rowSchema>;

export const manifestKey = (m: string) => plateKey(m);

/** The company fee type a sheet's fee column holds (by name), active ones only. */
function sheetFeeType(card: RuleCard, feeKey: string) {
  const word = SHEET_FEE_NAMES[feeKey] ?? feeKey;
  return card.allFeeTypes.find((t) => t.active && normalizeName(t.name).includes(word));
}
const partnerKey = (name: string) => normalizeName(name).replace(/[.\-–—_:()،,/\\]/g, "").replace(/\s+/g, "");

export type RowStatus = "new" | "update" | "same" | "error";
export interface RowPlan {
  rowNo: number;
  manifest: string | null;
  status: RowStatus;
  /** Message codes with parameters, translated on screen. */
  notes: { code: string; level: "error" | "warning" | "info"; params?: Record<string, string> }[];
  tripId?: string;
  fill?: { dischargeDate?: string; dischargedQty?: string };
}
export interface ImportPlan {
  rows: RowPlan[];
  counts: Record<RowStatus, number>;
  newDrivers: string[];
  newTransporters: string[];
  newRoutes: string[];
  advanceTotal: string;
  advanceRows: number;
}

async function partnersByRole(tx: Db, companyId: string, role: "driver" | "transporter") {
  const rows = await tx
    .select({ id: businessPartners.id, name: businessPartners.name, searchKey: businessPartners.searchKey })
    .from(businessPartners)
    .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
    .where(eq(businessPartners.companyId, companyId));
  return rows;
}

/** Work out what applying the rows would do. Read-only. */
export async function planImport(db: Db, companyId: string, jobId: string, rows: ImportRow[], card?: RuleCard): Promise<ImportPlan> {
  const job = await getJob(db, companyId, jobId);
  card ??= await loadRuleCard(db, companyId, jobId);
  const caps = job.capabilities as Capability[];
  const keys = rows.map((r) => (r.values.manifest ? manifestKey(r.values.manifest) : "")).filter(Boolean);
  const existing = keys.length
    ? await db.select().from(trips).where(and(eq(trips.jobId, jobId), inArray(trips.manifestKey, keys), ne(trips.status, "cancelled")))
    : [];
  const byKey = new Map(existing.map((t) => [t.manifestKey!, t]));
  const drivers = await partnersByRole(db, companyId, "driver");
  const transporters = await partnersByRole(db, companyId, "transporter");
  const knownDriver = new Set(drivers.map((p) => p.searchKey));
  const knownTransporter = new Map(transporters.map((p) => [p.searchKey, p.name]));
  const looseTransporter = new Map(transporters.map((p) => [partnerKey(p.name), p.name]));
  const routeKeys = new Set(card.routes.map((r) => r.nameKey));
  const limits = ((await getSetting(db, companyId, "approvals.payment_out_limits")) ?? {}) as Record<string, string | number>;

  const seen = new Set<string>();
  const newDrivers = new Set<string>();
  const newTransporters = new Set<string>();
  const newRoutes = new Set<string>();
  let advanceTotal = dec("0");
  let advanceRows = 0;
  const out: RowPlan[] = [];

  for (const r of rows) {
    const v = r.values;
    const plan: RowPlan = { rowNo: r.rowNo, manifest: v.manifest ?? null, status: "new", notes: [] };
    const err = (code: string, params?: Record<string, string>) => plan.notes.push({ code, level: "error", params });
    const warn = (code: string, params?: Record<string, string>) => plan.notes.push({ code, level: "warning", params });
    const info = (code: string, params?: Record<string, string>) => plan.notes.push({ code, level: "info", params });

    if (!v.manifest) err("manifest_missing");
    const key = v.manifest ? manifestKey(v.manifest) : "";
    if (key && seen.has(key)) err("manifest_twice_in_file");
    if (key) seen.add(key);
    const trip = key ? byKey.get(key) : undefined;

    if (trip) {
      plan.tripId = trip.id;
      const fill: RowPlan["fill"] = {};
      if (v.dischargedQty) {
        if (trip.dischargedQty === null) fill.dischargedQty = v.dischargedQty;
        else if (!dec(trip.dischargedQty).eq(dec(v.dischargedQty))) warn("differs_discharged", { recorded: trip.dischargedQty, sheet: v.dischargedQty });
      }
      if (v.dischargeDate) {
        if (trip.dischargeDate === null) fill.dischargeDate = v.dischargeDate;
        else if (trip.dischargeDate !== v.dischargeDate) warn("differs_discharge_date", { recorded: trip.dischargeDate, sheet: v.dischargeDate });
      }
      if (v.loadedQty && trip.loadedQty !== null && !dec(trip.loadedQty).eq(dec(v.loadedQty))) warn("differs_loaded", { recorded: trip.loadedQty, sheet: v.loadedQty });
      if (fill.dischargeDate && trip.loadingDate && fill.dischargeDate < trip.loadingDate) {
        err("discharge_before_loading");
        delete fill.dischargeDate;
      }
      plan.fill = fill;
      plan.status = plan.notes.some((n) => n.level === "error") ? "error" : Object.keys(fill).length ? "update" : "same";
      if (plan.status === "update") info(fill.dischargedQty ? "adds_discharge" : "adds_discharge_date");
      out.push(plan);
      continue;
    }

    if (!caps.includes("transportation")) err("transport_not_enabled");
    if (!v.driver) err("driver_missing");
    if (!v.plate) err("plate_missing");
    if (!v.loadedQty) err("loaded_missing");
    else if (!dec(v.loadedQty).gt(0)) err("loaded_not_positive");
    if (!v.loadingDate) err("loading_date_missing");
    if (v.dischargeDate && v.loadingDate && v.dischargeDate < v.loadingDate) err("discharge_before_loading");
    if (v.dischargedQty && !v.dischargeDate) warn("discharge_date_missing");

    if (v.driver && !knownDriver.has(normalizeName(v.driver))) newDrivers.add(v.driver);
    if (v.transporter) {
      const k = normalizeName(v.transporter);
      if (!knownTransporter.has(k)) {
        newTransporters.add(v.transporter);
        const similar = looseTransporter.get(partnerKey(v.transporter));
        if (similar) warn("transporter_similar", { name: v.transporter, existing: similar });
      }
    }
    const routeKey = v.route ? normalizeName(v.route) : null;
    if (v.route && routeKey && !routeKeys.has(routeKey)) newRoutes.add(v.route);

    const routeId = routeKey ? (card.routes.find((x) => x.nameKey === routeKey)?.id ?? null) : null;
    const terms = v.loadingDate ? termsOn(card, routeId, v.loadingDate) : null;
    if (!terms) warn("no_rule_card");
    else {
      if (v.carrierPrice && terms.carrierPrice !== null && !dec(v.carrierPrice).eq(dec(terms.carrierPrice))) warn("price_differs", { sheet: v.carrierPrice, rule: terms.carrierPrice });
      if (v.reward && !dec(v.reward).eq(dec(terms.rewardPerTrip))) warn("reward_differs", { sheet: v.reward, rule: terms.rewardPerTrip });
      if (v.transporterCommission && !dec(v.transporterCommission).eq(dec(terms.transporterCommission)))
        warn("commission_differs", { sheet: v.transporterCommission, rule: terms.transporterCommission });
      // Advances within the rule card's limit are paid without approval (owner's rule). Above it, or with no limit on the
      // card and above the company's payment limit, the row is not imported: raise the limit on the rule card or approve separately.
      if (v.advance && dec(v.advance).gt(0)) {
        if (terms.advanceMax !== null) {
          if (dec(v.advance).gt(dec(terms.advanceMax))) err("advance_above_max", { sheet: v.advance, max: terms.advanceMax });
        } else if (limits[terms.currency] !== undefined && dec(v.advance).gt(dec(String(limits[terms.currency])))) err("advance_needs_approval", { sheet: v.advance, limit: String(limits[terms.currency]) });
      }
      const ruleFees = feesOn(card, routeId, v.loadingDate!);
      for (const [feeKey, value] of Object.entries(r.fees)) {
        const ft = sheetFeeType(card, feeKey);
        const rule = ft ? ruleFees.find((f) => f.feeTypeId === ft.id) : undefined;
        if (!dec(value).isZero() && !rule) warn("fee_not_on_rule_card", { fee: feeKey, sheet: value });
        else if (rule && !dec(value).eq(dec(rule.amount))) warn("fee_differs", { fee: rule.name, sheet: value, rule: rule.amount });
      }
    }
    if (v.advance && dec(v.advance).gt(0) && !caps.includes("advances")) err("advances_not_enabled");
    plan.status = plan.notes.some((n) => n.level === "error") ? "error" : "new";
    if (plan.status === "new" && v.advance && dec(v.advance).gt(0)) {
      advanceTotal = advanceTotal.plus(dec(v.advance));
      advanceRows++;
    }
    out.push(plan);
  }

  const counts = { new: 0, update: 0, same: 0, error: 0 } as Record<RowStatus, number>;
  for (const p of out) counts[p.status]++;
  return { rows: out, counts, newDrivers: [...newDrivers], newTransporters: [...newTransporters], newRoutes: [...newRoutes], advanceTotal: advanceTotal.toFixed(), advanceRows };
}

export const stageTripImport = defineCommand({
  name: "trip_imports.stage",
  permission: "trips.manage",
  input: z.object({
    jobId: uuid,
    fileName: z.string().min(1).max(200),
    columns: z.array(z.object({ column: z.string(), header: z.string(), readAs: z.string().nullable() })),
    rows: z.array(rowSchema).min(1, "The sheet has no trip rows").max(20000),
  }),
  async handler({ tx, actor, audit }, input) {
    await getJob(tx, actor.companyId, input.jobId);
    const [row] = await tx.insert(tripImports).values({ ...input, companyId: actor.companyId, createdBy: actor.userId }).returning({ id: tripImports.id });
    await audit({ action: "trip_imports.stage", entityType: "trip_import", entityId: row.id, after: { jobId: input.jobId, fileName: input.fileName, rows: input.rows.length } });
    return { id: row.id };
  },
});

export async function getTripImport(db: Db, companyId: string, importId: string) {
  const [imp] = await db.select().from(tripImports).where(and(eq(tripImports.id, importId), eq(tripImports.companyId, companyId)));
  if (!imp) throw new NotFound("trip_import", importId);
  return imp;
}

async function partnerFor(tx: Db, companyId: string, name: string, role: "driver" | "transporter", audit: (e: { action: string; entityType: string; entityId: string; after: unknown }) => Promise<void>, cache: Map<string, string>) {
  const key = `${role}:${normalizeName(name)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [found] = await tx
    .select({ id: businessPartners.id })
    .from(businessPartners)
    .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, role)))
    .where(and(eq(businessPartners.companyId, companyId), eq(businessPartners.searchKey, normalizeName(name))))
    .limit(1);
  let id = found?.id;
  if (!id) {
    const [p] = await tx
      .insert(businessPartners)
      .values({ companyId, kind: role === "driver" ? "person" : "organization", name: name.trim(), searchKey: normalizeName(name) })
      .returning({ id: businessPartners.id });
    await tx.insert(partnerRoles).values({ partnerId: p.id, role });
    await audit({ action: "partners.create", entityType: "partner", entityId: p.id, after: { name, roles: [role], via: "trip_import" } });
    id = p.id;
  }
  cache.set(key, id);
  return id;
}

export const applyTripImport = defineCommand({
  name: "trip_imports.apply",
  permission: "trips.manage",
  input: z.object({ importId: uuid, moneyAccountId: uuid.nullish() }),
  async handler(ctx, { importId, moneyAccountId }) {
    const { tx, actor } = ctx;
    // Row lock: one batch is applied once, even with a double click.
    const [imp] = await tx.select().from(tripImports).where(and(eq(tripImports.id, importId), eq(tripImports.companyId, actor.companyId))).for("update");
    if (!imp) throw new NotFound("trip_import", importId);
    if (imp.status !== "staged") throw new Conflict(`This sheet was already ${imp.status}`);
    return applyImportRows(ctx, imp, moneyAccountId ?? null);
  },
});

/**
 * Rows typed into the trips grid: the same checks and the same creation as a
 * sheet import, in one step. Any row with an error stops the whole batch, so a
 * typed batch is saved completely or not at all.
 */
export const saveTripRows = defineCommand({
  name: "trips.save_many",
  permission: "trips.manage",
  input: z.object({ jobId: uuid, moneyAccountId: uuid.nullish(), rows: z.array(rowSchema).min(1).max(500) }),
  async handler(ctx, { jobId, moneyAccountId, rows }) {
    const { tx, actor, audit } = ctx;
    await getJob(tx, actor.companyId, jobId);
    const plan = await planImport(tx, actor.companyId, jobId, rows);
    const errors = plan.rows.filter((r) => r.status === "error");
    if (errors.length)
      throw new ValidationError(`${errors.length} row(s) cannot be saved`, {
        missing: errors.map((r) => `Row ${r.rowNo}${r.manifest ? ` (${r.manifest})` : ""}: ${r.notes.filter((n) => n.level === "error").map((n) => n.code).join(", ")}`),
      });
    const [imp] = await tx
      .insert(tripImports)
      .values({ companyId: actor.companyId, jobId, fileName: "grid", rows, columns: [], createdBy: actor.userId })
      .returning();
    await audit({ action: "trip_imports.stage", entityType: "trip_import", entityId: imp.id, after: { jobId, fileName: "grid", rows: rows.length } });
    const result = await applyImportRows(ctx, imp, moneyAccountId ?? null);
    return { ...result, id: jobId };
  },
});

/** Create and update trips from a staged batch (import or grid). Advances are paid from `moneyAccountId`. */
export async function applyImportRows(ctx: CommandContext, imp: typeof tripImports.$inferSelect, moneyAccountId: string | null) {
  {
    const { tx, actor, audit } = ctx;
    const job = await getJob(tx, actor.companyId, imp.jobId);
    if (!["open", "in_progress", "pending"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    const rows = imp.rows as ImportRow[];
    const card = await loadRuleCard(tx, actor.companyId, job.id);
    const plan = await planImport(tx, actor.companyId, job.id, rows, card);
    const money = moneyAccountId
      ? (await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, moneyAccountId), eq(moneyAccounts.companyId, actor.companyId))))[0]
      : undefined;
    if (moneyAccountId && !money) throw new NotFound("money_account", moneyAccountId);
    if (plan.advanceRows > 0 && !money) throw new ValidationError("Choose the cash box the advances were paid from");

    const cache = new Map<string, string>();
    const routeIds = new Map(card.routes.map((r) => [r.nameKey, r.id]));
    let created = 0;
    let updated = 0;
    for (const p of plan.rows) {
      if (p.status === "error" || p.status === "same") continue;
      const v = rows.find((r) => r.rowNo === p.rowNo)!;
      if (p.status === "update") {
        const set: Partial<typeof trips.$inferInsert> = {};
        if (p.fill?.dischargedQty) Object.assign(set, { dischargedQty: p.fill.dischargedQty, status: "discharged" as const });
        if (p.fill?.dischargeDate) set.dischargeDate = p.fill.dischargeDate;
        const [before] = await tx.select().from(trips).where(eq(trips.id, p.tripId!));
        if (set.dischargedQty) set.dischargedUnit = before.loadedUnit;
        await tx.update(trips).set(set).where(eq(trips.id, p.tripId!));
        await audit({ action: "trips.import_update", entityType: "trip", entityId: p.tripId!, before: { dischargeDate: before.dischargeDate, dischargedQty: before.dischargedQty }, after: set, reason: `import ${imp.fileName} row ${p.rowNo}` });
        updated++;
        continue;
      }
      const val = v.values;
      let routeId: string | null = null;
      if (val.route) {
        const k = normalizeName(val.route);
        routeId = routeIds.get(k) ?? null;
        if (!routeId) {
          const { route } = await routeByName(tx, actor.companyId, job.id, val.route, { loadingPlace: val.loadingPlace, dischargePlace: val.dischargePlace });
          routeId = route.id;
          routeIds.set(k, route.id);
          await audit({ action: "job_routes.define", entityType: "job_route", entityId: route.id, after: { name: val.route, via: "trip_import" } });
        }
      }
      const terms = termsOn(card, routeId, val.loadingDate!);
      const unit = terms?.unit ?? "MT";
      const driverId = await partnerFor(tx, actor.companyId, val.driver!, "driver", audit, cache);
      const transporterId = val.transporter ? await partnerFor(tx, actor.companyId, val.transporter, "transporter", audit, cache) : null;
      const { truck } = await findOrCreateTruck(tx, actor.companyId, val.plate!);
      const tripNo = await nextNumber(tx, actor.companyId, "TRP", Number(val.loadingDate!.slice(0, 4)));
      const differs = (sheet: string | undefined, rule: string | null | undefined) => (sheet !== undefined && rule !== undefined && rule !== null && !dec(sheet).eq(dec(rule)) ? sheet : null);
      const [trip] = await tx
        .insert(trips)
        .values({
          companyId: actor.companyId,
          tripNo,
          jobId: job.id,
          driverId,
          truckId: truck.id,
          transporterId,
          routeId,
          manifestNo: val.manifest!,
          manifestKey: manifestKey(val.manifest!),
          plateText: val.plate,
          loadingLocation: val.loadingPlace ?? null,
          destination: val.dischargePlace ?? null,
          loadingDate: val.loadingDate,
          loadedQty: val.loadedQty,
          loadedUnit: unit,
          dischargeDate: val.dischargeDate ?? null,
          dischargedQty: val.dischargedQty ?? null,
          dischargedUnit: val.dischargedQty ? unit : null,
          carrierPriceOverride: terms ? differs(val.carrierPrice, terms.carrierPrice) : (val.carrierPrice ?? null),
          rewardOverride: terms ? differs(val.reward, terms.rewardPerTrip) : (val.reward ?? null),
          transporterCut: val.transporterCut ?? "0",
          carrierDeduction: val.carrierDeduction ?? "0",
          status: val.dischargedQty ? "discharged" : "loaded",
          importId: imp.id,
          createdBy: actor.userId,
        })
        .returning();

      // Fees: the sheet's own figures where it has the column, otherwise the rule card's.
      const ruleFees = terms ? feesOn(card, routeId, val.loadingDate!) : [];
      const lines = new Map<string, typeof tripFees.$inferInsert>();
      for (const f of ruleFees)
        lines.set(f.feeTypeId, { companyId: actor.companyId, tripId: trip.id, feeTypeId: f.feeTypeId, rate: f.amount, basis: f.basis, currency: f.currency, deductFromCarrier: f.deductFromCarrier, billedToCustomer: f.billedToCustomer, source: "rule" });
      for (const [feeKey, value] of Object.entries(v.fees)) {
        const ft = sheetFeeType(card, feeKey);
        if (!ft) continue;
        if (dec(value).isZero()) {
          lines.delete(ft.id);
          continue;
        }
        const rule = lines.get(ft.id);
        lines.set(ft.id, {
          companyId: actor.companyId,
          tripId: trip.id,
          feeTypeId: ft.id,
          rate: value,
          basis: rule?.basis ?? ft.defaultBasis,
          currency: rule?.currency ?? terms?.currency ?? money?.currency ?? "USD",
          deductFromCarrier: rule?.deductFromCarrier ?? ft.deductFromCarrier,
          billedToCustomer: rule?.billedToCustomer ?? ft.billedToCustomer,
          source: "entered",
        });
      }
      if (lines.size) await tx.insert(tripFees).values([...lines.values()]);
      await audit({ action: "trips.import_create", entityType: "trip", entityId: trip.id, after: { tripNo, manifestNo: trip.manifestNo, jobId: job.id, fees: lines.size }, reason: `import ${imp.fileName} row ${p.rowNo}` });

      if (val.advance && dec(val.advance).gt(0)) {
        await recordPayment.handler(ctx, {
          direction: "out",
          purpose: "advance",
          moneyAccountId: money!.id,
          amount: val.advance,
          currency: money!.currency,
          paymentDate: val.loadingDate!,
          method: "cash",
          partnerId: driverId,
          tripId: trip.id,
          reference: val.manifest,
        });
      }
      created++;
    }
    const result = { ...plan.counts, created, updated };
    await tx.update(tripImports).set({ status: "applied", result, appliedBy: actor.userId, appliedAt: new Date() }).where(eq(tripImports.id, imp.id));
    await audit({ action: "trip_imports.apply", entityType: "trip_import", entityId: imp.id, after: result });
    // id: the form redirects to the job's trips after a successful apply.
    return { id: imp.id, ...result };
  }
}

export const discardTripImport = defineCommand({
  name: "trip_imports.discard",
  permission: "trips.manage",
  input: z.object({ importId: uuid }),
  async handler({ tx, actor, audit }, { importId }) {
    const imp = await getTripImport(tx, actor.companyId, importId);
    if (imp.status !== "staged") throw new Conflict(`This sheet was already ${imp.status}`);
    await tx.update(tripImports).set({ status: "discarded" }).where(eq(tripImports.id, importId));
    await audit({ action: "trip_imports.discard", entityType: "trip_import", entityId: importId, after: { status: "discarded" } });
    return { id: importId };
  },
});

/** Advances already paid on trips, per trip and currency (for the live calculation). */
export async function advancesByTrip(db: Db, tripIds: string[]) {
  const out = new Map<string, Record<string, string>>();
  if (!tripIds.length) return out;
  const rows = await db
    .select({ tripId: payments.tripId, currency: payments.currency, amount: payments.amount, direction: payments.direction })
    .from(payments)
    .where(and(inArray(payments.tripId, tripIds), eq(payments.purpose, "advance"), eq(payments.status, "posted")));
  for (const r of rows) {
    const m = out.get(r.tripId!) ?? {};
    m[r.currency] = dec(m[r.currency] ?? "0").plus(dec(r.amount)).toFixed();
    out.set(r.tripId!, m);
  }
  return out;
}
