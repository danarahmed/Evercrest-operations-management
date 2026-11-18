import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, documentRequirements, moneyAccounts, remoteSettlements, trips, tripSettlements, trucks } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { ApprovalRequired, Conflict, NotFound, ValidationError } from "@/server/errors";
import { getJob } from "../jobs/commands";
import { D, type Dec, dec, toStr } from "../money";
import { registerApprovable } from "../approvals/approvals";
import { claimOpen, createClaim, payClaim, pendingWaivers } from "./claims";
import { liveTrips } from "./live-calc";
import { manifestKey } from "./trip-import";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Remote settlements (owner's biggest pain): at some sites our employee pays
 * the drivers with the site's own figures and sends back a sheet. The sheet is
 * imported as it is and compared line by line with what the system calculates
 * for each manifest. Only the differences need attention. When the owner
 * approves, every paid trip is claimed by its driver (the papers are at the
 * site) and the payment is recorded from the site's money account for what
 * the system says is owed; what the site paid on top (or short) is shown per
 * driver and shows up again in that cash box's count (step 3).
 */

export const remoteRow = z.object({
  rowNo: z.number().int(),
  values: z.object({
    manifest: z.string().min(1),
    driver: z.string().optional(),
    plate: z.string().optional(),
    paid: z.string().optional(),
    fine: z.string().optional(),
    advance: z.string().optional(),
    loadedQty: z.string().optional(),
    dischargedQty: z.string().optional(),
  }),
});
export type RemoteRow = z.infer<typeof remoteRow>;

export type RemoteLineStatus = "match" | "amount_differs" | "not_found" | "cancelled" | "not_discharged" | "no_rule" | "already_claimed" | "settled_old_way" | "waiver_pending" | "duplicate" | "no_amount";

export interface RemoteLine {
  rowNo: number;
  manifest: string;
  status: RemoteLineStatus;
  sheetDriver?: string;
  paid: string | null;
  tripId?: string;
  tripNo?: string;
  driver?: string;
  driverId?: string;
  plate?: string;
  claimNo?: string;
  /** What the system says the trip owes the carrier (net after advances). */
  system?: string;
  /** paid − system (positive = the site paid too much). */
  difference?: string;
  fine?: string;
  advance?: string;
}

export interface RemoteComparison {
  currency: string | null;
  lines: RemoteLine[];
  counts: Record<RemoteLineStatus, number>;
  /** Per driver: what the system owes vs what the site paid (only claimable lines). */
  byDriver: { driverId: string; driver: string; trips: number; system: string; paid: string; difference: string }[];
  totals: { system: string; paid: string; difference: string };
}

const transporters = alias(businessPartners, "transporter");

export const stageRemoteSettlement = defineCommand({
  name: "remote_settlements.stage",
  permission: "claims.manage",
  input: z.object({
    jobId: uuid,
    fileName: z.string().min(1).max(200),
    settlementDate: isoDate,
    moneyAccountId: uuid,
    columns: z.array(z.object({ column: z.string(), header: z.string(), readAs: z.string().nullable() })),
    rows: z.array(remoteRow).min(1, "The sheet has no settlement rows").max(5000),
    notes: z.string().max(2000).nullish(),
  }),
  async handler({ tx, actor, audit }, input) {
    await getJob(tx, actor.companyId, input.jobId);
    const [money] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, input.moneyAccountId), eq(moneyAccounts.companyId, actor.companyId)));
    if (!money?.active) throw new NotFound("money_account", input.moneyAccountId);
    const [row] = await tx.insert(remoteSettlements).values({ ...input, companyId: actor.companyId, createdBy: actor.userId }).returning({ id: remoteSettlements.id });
    await audit({ action: "remote_settlements.stage", entityType: "remote_settlement", entityId: row.id, after: { jobId: input.jobId, fileName: input.fileName, rows: input.rows.length, settlementDate: input.settlementDate } });
    return { id: row.id };
  },
});

export async function getRemoteSettlement(db: Db, companyId: string, id: string) {
  const [r] = await db.select().from(remoteSettlements).where(and(eq(remoteSettlements.id, id), eq(remoteSettlements.companyId, companyId)));
  if (!r) throw new NotFound("remote_settlement", id);
  return r;
}

/** Compare the sheet's rows with the system, line by line. */
export async function compareRemoteSettlement(db: Db, companyId: string, jobId: string, rows: RemoteRow[]): Promise<RemoteComparison> {
  const keys = rows.map((r) => manifestKey(r.values.manifest));
  const found = keys.length
    ? await db
        .select({ trip: trips, driver: businessPartners.name, transporter: transporters.name, plate: trucks.plate })
        .from(trips)
        .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
        .leftJoin(transporters, eq(transporters.id, trips.transporterId))
        .innerJoin(trucks, eq(trucks.id, trips.truckId))
        .where(and(eq(trips.jobId, jobId), inArray(trips.manifestKey, [...new Set(keys)])))
    : [];
  const live = await liveTrips(db, companyId, found.filter((r) => r.trip.status !== "cancelled").map((r) => r.trip));
  const waiting = await pendingWaivers(db, companyId, found.map((r) => r.trip.id));
  const settledOld = new Map(
    found.length
      ? (await db.select({ tripId: tripSettlements.tripId, no: tripSettlements.settlementNo }).from(tripSettlements).where(and(inArray(tripSettlements.tripId, found.map((r) => r.trip.id)), eq(tripSettlements.status, "posted")))).map((r) => [r.tripId, r.no] as const)
      : [],
  );
  const seen = new Set<string>();
  let currency: string | null = null;
  const lines: RemoteLine[] = rows.map((r, i) => {
    const key = keys[i];
    const paid = r.values.paid ?? null;
    const base: RemoteLine = { rowNo: r.rowNo, manifest: r.values.manifest, status: "not_found", sheetDriver: r.values.driver, paid, fine: r.values.fine, advance: r.values.advance };
    if (seen.has(key)) return { ...base, status: "duplicate" };
    seen.add(key);
    const row = found.find((x) => x.trip.manifestKey === key && x.trip.status !== "cancelled") ?? found.find((x) => x.trip.manifestKey === key);
    if (!row) return base;
    const t = row.trip;
    const info = { tripId: t.id, tripNo: t.tripNo, driver: row.driver, driverId: t.driverId, plate: t.plateText ?? row.plate };
    if (t.status === "cancelled") return { ...base, ...info, status: "cancelled" };
    const l = live.get(t.id)!;
    if (l.claim) return { ...base, ...info, status: "already_claimed", claimNo: l.claim.claimNo };
    const old = settledOld.get(t.id);
    if (old) return { ...base, ...info, status: "settled_old_way", claimNo: old };
    if (waiting.has(t.id)) return { ...base, ...info, status: "waiver_pending" };
    if (!l.calc) return { ...base, ...info, status: "no_rule" };
    if (l.calc.state !== "confirmed") return { ...base, ...info, status: "not_discharged" };
    if (paid === null) return { ...base, ...info, status: "no_amount", system: l.calc.carrier.toPay };
    currency ??= l.calc.currency;
    const system = dec(l.calc.carrier.toPay);
    const difference = dec(paid).minus(system);
    return { ...base, ...info, status: difference.isZero() ? "match" : "amount_differs", system: toStr(system), difference: toStr(difference) };
  });
  const counts = Object.fromEntries((["match", "amount_differs", "not_found", "cancelled", "not_discharged", "no_rule", "already_claimed", "settled_old_way", "waiver_pending", "duplicate", "no_amount"] as RemoteLineStatus[]).map((s) => [s, lines.filter((l) => l.status === s).length])) as Record<RemoteLineStatus, number>;
  const claimable = lines.filter((l) => l.status === "match" || l.status === "amount_differs");
  const byDriverMap = new Map<string, { driverId: string; driver: string; trips: number; system: Dec; paid: Dec }>();
  for (const l of claimable) {
    const e = byDriverMap.get(l.driverId!) ?? { driverId: l.driverId!, driver: l.driver!, trips: 0, system: new D(0), paid: new D(0) };
    e.trips++;
    e.system = e.system.plus(dec(l.system!));
    e.paid = e.paid.plus(dec(l.paid!));
    byDriverMap.set(l.driverId!, e);
  }
  const byDriver = [...byDriverMap.values()].map((e) => ({ ...e, system: toStr(e.system), paid: toStr(e.paid), difference: toStr(e.paid.minus(e.system)) })).sort((a, b) => a.driver.localeCompare(b.driver));
  const sum = (k: "system" | "paid") => toStr(byDriver.reduce((a, d) => a.plus(dec(d[k])), new D(0)));
  return { currency, lines, counts, byDriver, totals: { system: sum("system"), paid: sum("paid"), difference: toStr(dec(sum("paid")).minus(dec(sum("system")))) } };
}

/**
 * The owner approves the comparison: each driver's paid trips become one
 * claim by that driver (the papers are at the site), paid from the site's
 * money account for what the system owes. Lines with problems are left for
 * later and listed in the result; a sheet with nothing claimable is refused.
 */
export const approveRemoteSettlement = defineCommand({
  name: "remote_settlements.approve",
  permission: "remote_settlements.approve",
  input: z.object({ remoteSettlementId: uuid, notes: z.string().max(2000).nullish() }),
  async handler(ctx, { remoteSettlementId, notes }) {
    const { tx, actor, audit } = ctx;
    const rs = await getRemoteSettlement(tx, actor.companyId, remoteSettlementId);
    if (rs.status !== "staged") throw new Conflict(`This settlement is already ${rs.status}`);
    await tx.select({ id: remoteSettlements.id }).from(remoteSettlements).where(eq(remoteSettlements.id, rs.id)).for("update");
    const job = await getJob(tx, actor.companyId, rs.jobId);
    const cmp = await compareRemoteSettlement(tx, actor.companyId, rs.jobId, rs.rows as RemoteRow[]);
    if (!cmp.byDriver.length) throw new ValidationError("Nothing in this sheet can be claimed: no discharged, unclaimed trip with a paid amount", { counts: cmp.counts });
    const [money] = await tx.select().from(moneyAccounts).where(eq(moneyAccounts.id, rs.moneyAccountId));
    if (cmp.currency && money.currency !== cmp.currency) throw new ValidationError(`${money.name} holds ${money.currency}; this job pays carriers in ${cmp.currency}`);
    // The papers are with the site: every trip-level paper required by the job counts as brought.
    const bringing = (await tx.select({ id: documentRequirements.documentTypeId }).from(documentRequirements).where(and(eq(documentRequirements.companyId, actor.companyId), eq(documentRequirements.appliesTo, "trip")))).map((r) => r.id);
    const made = [];
    for (const d of cmp.byDriver) {
      const manifests = cmp.lines.filter((l) => l.driverId === d.driverId && (l.status === "match" || l.status === "amount_differs")).map((l) => l.manifest);
      const c = await createClaim.handler(ctx, { jobId: rs.jobId, claimantId: d.driverId, claimDate: rs.settlementDate, manifests, bringing: [...new Set(bringing)], notes: `Remote settlement ${rs.fileName}`, post: true, source: "remote" });
      const { open } = await claimOpen(tx, c.id);
      let paymentNo: string | null = null;
      let paidNow = "0";
      // Pay what the system owes, never more than the claim is open for; a short payment leaves the rest open.
      const toPay = D.min(dec(d.paid), open.gt(0) ? open : new D(0));
      if (toPay.gt(0)) {
        // The payments follow the normal payment limits: above them, the whole settlement waits for approval
        // in the Approvals screen (by a different person), exactly like any other large payment.
        let p: { paymentNo: string };
        try {
          p = await payClaim.handler(ctx, { claimId: c.id, moneyAccountId: rs.moneyAccountId, amount: toStr(toPay), paymentDate: rs.settlementDate, method: "cash", reference: `${c.claimNo} ${rs.fileName}` });
        } catch (e) {
          if (e instanceof ApprovalRequired) throw new ApprovalRequired("The site's payments are above the payment limit: the settlement needs approval", { ...(e.details as object), driver: d.driver, amount: toStr(toPay), currency: cmp.currency });
          throw e;
        }
        paymentNo = p.paymentNo;
        paidNow = toStr(toPay);
      }
      made.push({ driverId: d.driverId, driver: d.driver, claimId: c.id, claimNo: c.claimNo, trips: d.trips, system: d.system, sitePaid: d.paid, recorded: paidNow, difference: d.difference, paymentNo });
    }
    const skipped = cmp.lines.filter((l) => l.status !== "match" && l.status !== "amount_differs").map((l) => ({ rowNo: l.rowNo, manifest: l.manifest, status: l.status, claimNo: l.claimNo ?? null }));
    const result = { claims: made, skipped, totals: cmp.totals, currency: cmp.currency, notes: notes ?? null };
    await tx.update(remoteSettlements).set({ status: "approved", result: result as never, approvedBy: actor.userId, approvedAt: new Date(), notes: notes ?? rs.notes }).where(eq(remoteSettlements.id, rs.id));
    await audit({ action: "remote_settlements.approve", entityType: "remote_settlement", entityId: rs.id, after: { jobNo: job.jobNo, claims: made.map((m) => m.claimNo), skipped: skipped.length, totals: cmp.totals } });
    return { id: rs.id, claims: made, skipped };
  },
});

export const discardRemoteSettlement = defineCommand({
  name: "remote_settlements.discard",
  permission: "claims.manage",
  input: z.object({ remoteSettlementId: uuid, reason: z.string().trim().min(1).nullish() }),
  async handler({ tx, actor, audit }, { remoteSettlementId, reason }) {
    const rs = await getRemoteSettlement(tx, actor.companyId, remoteSettlementId);
    if (rs.status !== "staged") throw new Conflict(`This settlement is already ${rs.status}`);
    await tx.update(remoteSettlements).set({ status: "discarded" }).where(eq(remoteSettlements.id, rs.id));
    await audit({ action: "remote_settlements.discard", entityType: "remote_settlement", entityId: rs.id, before: { status: "staged" }, after: { status: "discarded" }, reason: reason ?? null });
    return { id: rs.id };
  },
});

export async function listRemoteSettlements(db: Db, companyId: string, jobId: string) {
  return db
    .select({ r: remoteSettlements, money: moneyAccounts.name })
    .from(remoteSettlements)
    .innerJoin(moneyAccounts, eq(moneyAccounts.id, remoteSettlements.moneyAccountId))
    .where(and(eq(remoteSettlements.companyId, companyId), eq(remoteSettlements.jobId, jobId)))
    .orderBy(desc(remoteSettlements.createdAt))
    .limit(50);
}

registerApprovable(approveRemoteSettlement);
