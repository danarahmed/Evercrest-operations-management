import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { approvalRequests, businessPartners, claimItems, claims, fineWaivers, jobs, partnerRoles, payments, trips, tripSettlements, trucks } from "@/db/schema";
import { defineCommand, type CommandContext } from "@/server/command";
import { ApprovalRequired, Conflict, NotFound, ValidationError } from "@/server/errors";
import { getSetting } from "@/server/settings";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { registerApprovable } from "../approvals/approvals";
import { amountString } from "../currency";
import { documentChecklist, recordDocument } from "../documents/documents";
import { recordPayment } from "../finance/payments";
import { getJob } from "../jobs/commands";
import { normalizeName } from "../masterdata/partners";
import { D, type Dec, dec, roundToIncrement, toStr } from "../money";
import { nextNumber } from "../sequences";
import { liveTrips, type LiveTrip } from "./live-calc";
import type { TripCalc } from "./trip-calc";
import { partnerByNameOrId } from "./trip-edit";
import { manifestKey } from "./trip-import";
import { getTrip } from "./trips";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
type Trip = typeof trips.$inferSelect;

/**
 * Claims (مطالەبە) — owner's rule: money follows the papers. Whoever brings a
 * trip's manifest (a transporter, or the driver himself) is paid that trip's
 * net: what the carrier earned under the rule card, minus the advances already
 * paid on the trip, minus fines, fees and deductions. A trip can be claimed
 * once; the second claim is refused by the database. Posting a claim is the
 * first entry of the trip's money in the books (method D).
 */

export type ClaimLineStatus = "ok" | "not_found" | "cancelled" | "not_discharged" | "no_rule" | "already_claimed" | "settled_old_way" | "waiver_pending" | "papers_missing" | "duplicate" | "other_currency";

export interface ClaimPreviewLine {
  manifest: string;
  status: ClaimLineStatus;
  tripId?: string;
  tripNo?: string;
  driver?: string;
  driverId?: string;
  plate?: string;
  transporter?: string | null;
  loadingDate?: string | null;
  dischargeDate?: string | null;
  claimNo?: string;
  missingPapers?: string[];
  /** Papers received but not yet verified (a warning, not a block). */
  unverifiedPapers?: string[];
  /** Required papers this claim brings with it (recorded on the trip when the claim is created). */
  broughtNow?: { documentTypeId: string; name: string }[];
  calc?: TripCalc;
  /** Net for the claimant (carrier total − advances). */
  amount?: string;
}

export interface ClaimPreview {
  currency: string | null;
  lines: ClaimPreviewLine[];
  ok: ClaimPreviewLine[];
  total: string;
  totalFinal: string;
  rounding: string;
}

const transporters = alias(businessPartners, "transporter");

async function finalRounding(db: Db, companyId: string, currency: string, precise: Dec) {
  const increments = (await getSetting(db, companyId, "rounding.final_increment")) ?? {};
  const final = increments[currency] ? roundToIncrement(precise, increments[currency]) : precise;
  return { final, rounding: precise.minus(final) };
}

/**
 * Check a list of manifest numbers against a job: pulls each trip with its
 * live calculation and says exactly why a trip cannot be claimed yet.
 */
export async function previewClaim(db: Db, companyId: string, input: { jobId: string; manifests: string[]; bringing?: string[] }): Promise<ClaimPreview> {
  const job = await getJob(db, companyId, input.jobId);
  const wanted = input.manifests.map((m) => m.trim()).filter(Boolean);
  const keys = wanted.map(manifestKey);
  const rows = keys.length
    ? await db
        .select({ trip: trips, driver: businessPartners.name, transporter: transporters.name, plate: trucks.plate })
        .from(trips)
        .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
        .leftJoin(transporters, eq(transporters.id, trips.transporterId))
        .innerJoin(trucks, eq(trucks.id, trips.truckId))
        .where(and(eq(trips.jobId, job.id), inArray(trips.manifestKey, keys)))
    : [];
  const live = await liveTrips(db, companyId, rows.filter((r) => r.trip.status !== "cancelled").map((r) => r.trip));
  const papers = (await documentChecklist(db, job)).filter((c) => c.target.type === "trip");
  const settledOld = new Map(
    rows.length
      ? (await db.select({ tripId: tripSettlements.tripId, no: tripSettlements.settlementNo }).from(tripSettlements).where(and(inArray(tripSettlements.tripId, rows.map((r) => r.trip.id)), eq(tripSettlements.status, "posted")))).map((r) => [r.tripId, r.no] as const)
      : [],
  );
  const waiting = await pendingWaivers(db, companyId, rows.map((r) => r.trip.id));
  // Papers that arrive with the claim itself (the manifest, usually) count as present.
  const bringing = new Set(input.bringing ?? []);
  const seen = new Set<string>();
  let currency: string | null = null;
  const lines: ClaimPreviewLine[] = wanted.map((manifest, i) => {
    const key = keys[i];
    // The same manifest typed twice in one list.
    if (seen.has(key)) return { manifest, status: "duplicate" };
    seen.add(key);
    // Prefer the live trip when a cancelled one shares the manifest.
    const row = rows.find((r) => r.trip.manifestKey === key && r.trip.status !== "cancelled") ?? rows.find((r) => r.trip.manifestKey === key);
    if (!row) return { manifest, status: "not_found" };
    const t = row.trip;
    const base = { manifest, tripId: t.id, tripNo: t.tripNo, driver: row.driver, driverId: t.driverId, plate: t.plateText ?? row.plate, transporter: row.transporter, loadingDate: t.loadingDate, dischargeDate: t.dischargeDate };
    if (t.status === "cancelled") return { ...base, status: "cancelled" };
    const l = live.get(t.id)!;
    if (l.claim) return { ...base, status: "already_claimed", claimNo: l.claim.claimNo };
    // Paid through the older per-trip settlement: its money has already moved, it can never be claimed too.
    const old = settledOld.get(t.id);
    if (old) return { ...base, status: "settled_old_way", claimNo: old };
    // A fine waiver waiting for the owner's decision changes this trip's money: claim it after the decision.
    if (waiting.has(t.id)) return { ...base, status: "waiver_pending", calc: l.calc ?? undefined };
    if (!l.calc) return { ...base, status: "no_rule" };
    if (l.calc.state !== "confirmed") return { ...base, status: "not_discharged", calc: l.calc };
    const mine = papers.filter((p) => p.target.id === t.id);
    const absent = mine.filter((p) => p.state === "missing" || p.state === "rejected" || p.state === "expired");
    const broughtNow = absent.filter((p) => bringing.has(p.documentTypeId)).map((p) => ({ documentTypeId: p.documentTypeId, name: p.documentType }));
    const missing = absent.filter((p) => !bringing.has(p.documentTypeId)).map((p) => p.documentType);
    const unverified = mine.filter((p) => p.state === "awaiting_verification").map((p) => p.documentType);
    if (missing.length) return { ...base, status: "papers_missing", missingPapers: missing, calc: l.calc, broughtNow: broughtNow.length ? broughtNow : undefined };
    currency ??= l.calc.currency;
    if (l.calc.currency !== currency) return { ...base, status: "other_currency", calc: l.calc };
    return { ...base, status: "ok", calc: l.calc, amount: l.calc.carrier.toPay, unverifiedPapers: unverified.length ? unverified : undefined, broughtNow: broughtNow.length ? broughtNow : undefined };
  });
  const ok = lines.filter((l) => l.status === "ok");
  const total = ok.reduce((a, l) => a.plus(dec(l.amount!)), new D(0));
  const { final, rounding } = currency ? await finalRounding(db, companyId, currency, total) : { final: total, rounding: new D(0) };
  return { currency, lines, ok, total: toStr(total), totalFinal: toStr(final), rounding: toStr(rounding) };
}

/** Trips with a fine waiver request still waiting in Approvals. */
export async function pendingWaivers(db: Db, companyId: string, tripIds: string[]): Promise<Set<string>> {
  if (!tripIds.length) return new Set();
  const rows = await db
    .select({ tripId: sql<string>`${approvalRequests.input}->>'tripId'` })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.companyId, companyId), eq(approvalRequests.command, "fines.waive"), eq(approvalRequests.status, "pending"), inArray(sql`${approvalRequests.input}->>'tripId'`, tripIds)));
  return new Set(rows.map((r) => r.tripId));
}

/** Plain-language reasons for the lines that cannot be claimed (for errors). */
export function claimProblems(p: ClaimPreview): string[] {
  const why: Record<Exclude<ClaimLineStatus, "ok">, (l: ClaimPreviewLine) => string> = {
    not_found: (l) => `${l.manifest}: no trip with this manifest in the job`,
    cancelled: (l) => `${l.manifest}: the trip is cancelled`,
    not_discharged: (l) => `${l.manifest}: discharge data is missing`,
    no_rule: (l) => `${l.manifest}: no rule card version covers its loading date`,
    already_claimed: (l) => `${l.manifest}: already claimed on ${l.claimNo}`,
    settled_old_way: (l) => `${l.manifest}: already paid by settlement ${l.claimNo}`,
    waiver_pending: (l) => `${l.manifest}: a fine waiver is waiting for approval`,
    papers_missing: (l) => `${l.manifest}: waiting for ${l.missingPapers!.join(", ")}`,
    duplicate: (l) => `${l.manifest}: listed twice`,
    other_currency: (l) => `${l.manifest}: its rule card is in ${l.calc!.currency}; claim it separately`,
  };
  return p.lines.filter((l) => l.status !== "ok").map((l) => why[l.status as Exclude<ClaimLineStatus, "ok">](l));
}

async function claimantRole(tx: Db, companyId: string, partnerId: string): Promise<"transporter" | "driver"> {
  const roles = await tx
    .select({ role: partnerRoles.role })
    .from(businessPartners)
    .innerJoin(partnerRoles, eq(partnerRoles.partnerId, businessPartners.id))
    .where(and(eq(businessPartners.id, partnerId), eq(businessPartners.companyId, companyId)));
  if (!roles.length) throw new NotFound("partner", partnerId);
  if (roles.some((r) => r.role === "transporter")) return "transporter";
  if (roles.some((r) => r.role === "driver")) return "driver";
  throw new ValidationError("A claim is paid to a transporter or a driver", { partnerId });
}

/** Signed amount helper: positive = debit, negative = credit. Zero lines are skipped. */
function lineFor(accountId: string, currency: string, signed: Dec, extra: { partnerId?: string | null; jobId?: string | null; memo?: string }) {
  if (signed.isZero()) return [];
  return [{ accountId, currency, ...extra, ...(signed.gt(0) ? { debit: toStr(signed) } : { credit: toStr(signed.neg()) }) }];
}

/**
 * Book a posted claim: the trips' gross earnings as job cost, fines and
 * recoveries against it, the transporter's cut to the transporter at loading,
 * the advances cleared from whoever received them, and the net to the
 * claimant's account. Rounding differences go to their own account.
 */
async function postClaimEntry(ctx: CommandContext, claim: typeof claims.$inferSelect, items: { trip: Trip; live: LiveTrip }[]) {
  const { tx, actor } = ctx;
  const C = claim.currency;
  const acct = (k: Parameters<typeof postingAccount>[2]) => postingAccount(tx, actor.companyId, k);
  const role = await claimantRole(tx, actor.companyId, claim.claimantId);
  const payable = await acct(role === "transporter" ? "payables_to_transporters" : "payables_to_drivers");
  const costs = await acct("driver_costs");
  const fines = await acct("shortage_fines");
  const advances = await acct("advances");
  const transporterPayable = await acct("payables_to_transporters");
  const jobId = claim.jobId;

  let gross = new D(0);
  let fine = new D(0);
  let recovered = new D(0);
  const cuts = new Map<string, Dec>();
  const clearedAdvances = new Map<string, Dec>();
  for (const { trip, live } of items) {
    const c = live.calc!.carrier;
    gross = gross.plus(dec(c.freight)).plus(dec(c.reward)).plus(dec(c.commission)).plus(dec(c.demurrage));
    fine = fine.plus(dec(c.fine)); // ≤ 0
    recovered = recovered.plus(dec(c.feeDeductions)).plus(dec(c.otherDeduction));
    const cut = dec(c.transporterCut);
    if (cut.gt(0)) {
      if (trip.transporterId) cuts.set(trip.transporterId, (cuts.get(trip.transporterId) ?? new D(0)).plus(cut));
      else recovered = recovered.plus(cut);
    }
    for (const [payee, amt] of Object.entries(live.advancesByPayee)) clearedAdvances.set(payee, (clearedAdvances.get(payee) ?? new D(0)).plus(dec(amt)));
  }
  const total = dec(claim.total);
  const final = dec(claim.totalFinal);
  const lines = [
    ...lineFor(costs.id, C, gross, { jobId, memo: `${claim.claimNo} trips earned` }),
    ...lineFor(fines.id, C, fine, { jobId, memo: `${claim.claimNo} shortage fines` }),
    ...lineFor(costs.id, C, recovered.neg(), { jobId, memo: `${claim.claimNo} fees and deductions recovered` }),
    ...[...cuts].flatMap(([partnerId, amt]) => lineFor(transporterPayable.id, C, amt.neg(), { partnerId, jobId, memo: `${claim.claimNo} transporter's cut` })),
    ...[...clearedAdvances].flatMap(([partnerId, amt]) => lineFor(advances.id, C, amt.neg(), { partnerId: partnerId || null, jobId, memo: `${claim.claimNo} advances cleared` })),
    ...lineFor(payable.id, C, final.neg(), { partnerId: claim.claimantId, jobId, memo: `${claim.claimNo} net to claimant` }),
    ...lineFor((await acct("rounding_differences")).id, C, total.minus(final).neg(), { jobId, memo: "rounding" }),
  ];
  return postEntry(ctx, { entryDate: claim.claimDate, description: `${claim.claimNo} claim, ${items.length} trips`, sourceType: "claim", sourceId: claim.claimNo, lines });
}

/**
 * Open a claim from a list of manifests and (normally) post it in the same
 * step. All or nothing: one manifest that cannot be claimed stops the claim,
 * with the reason per line — the screen shows the check first.
 */
export const createClaim = defineCommand({
  name: "claims.create",
  permission: "claims.manage",
  input: z.object({
    jobId: uuid,
    claimantId: uuid.nullish(),
    /** A transporter's or driver's name; an unknown name becomes a new transporter. */
    claimantName: z.string().trim().max(120).nullish(),
    claimDate: isoDate,
    manifests: z.array(z.string().trim().min(1)).min(1).max(500),
    /** Document types brought with the claim for every trip on it (the manifests themselves, discharge papers …). */
    bringing: z.array(uuid).max(20).nullish(),
    notes: z.string().max(2000).nullish(),
    post: z.boolean().default(true),
    source: z.enum(["manual", "remote"]).default("manual"),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const job = await getJob(tx, actor.companyId, input.jobId);
    if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Job is ${job.status}`);
    let claimantId = input.claimantId ?? null;
    if (!claimantId && input.claimantName) {
      // An existing driver by name first (he claims his own trips), otherwise a transporter (created if new).
      const key = input.claimantName;
      const [driver] = await tx
        .select({ id: businessPartners.id })
        .from(businessPartners)
        .innerJoin(partnerRoles, and(eq(partnerRoles.partnerId, businessPartners.id), eq(partnerRoles.role, "driver")))
        .where(and(eq(businessPartners.companyId, actor.companyId), eq(businessPartners.searchKey, normalizeName(key))))
        .limit(1);
      claimantId = driver?.id ?? (await partnerByNameOrId(tx, actor.companyId, "transporter", null, key, audit));
    }
    if (!claimantId) throw new ValidationError("Say who brought the papers (the claimant)");
    await claimantRole(tx, actor.companyId, claimantId);

    // Serialize claims on the same trips: lock the job's trips with these manifests.
    const keys = [...new Set(input.manifests.map(manifestKey))];
    const locked = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.jobId, job.id), inArray(trips.manifestKey, keys))).for("update");
    const preview = await previewClaim(tx, actor.companyId, { jobId: job.id, manifests: input.manifests, bringing: input.bringing ?? [] });
    const problems = claimProblems(preview);
    if (problems.length) throw new ValidationError("These manifests cannot be claimed yet", { missing: problems });
    if (!preview.ok.length) throw new ValidationError("No trips to claim");
    const currency = preview.currency!;

    const claimNo = await nextNumber(tx, actor.companyId, "CLM", Number(input.claimDate.slice(0, 4)));
    const [claim] = await tx
      .insert(claims)
      .values({
        companyId: actor.companyId,
        claimNo,
        jobId: job.id,
        claimantId,
        currency,
        claimDate: input.claimDate,
        status: "draft",
        source: input.source,
        total: preview.total,
        totalFinal: preview.totalFinal,
        notes: input.notes ?? null,
        createdBy: actor.userId,
      })
      .returning();
    const tripRows = await tx.select().from(trips).where(inArray(trips.id, preview.ok.map((l) => l.tripId!)));
    const live = await liveTrips(tx, actor.companyId, tripRows);
    try {
      await tx.insert(claimItems).values(
        preview.ok.map((l) => ({ claimId: claim.id, tripId: l.tripId!, calculation: { ...l.calc!, termsId: live.get(l.tripId!)!.termsId, manifest: l.manifest, driver: l.driver, plate: l.plate } as never, amount: l.amount! })),
      );
    } catch (e) {
      if ((e as { cause?: { code?: string } }).cause?.code === "23505" || /claim_items_one_live_claim_per_trip/.test(String(e))) throw new Conflict("One of these trips was just claimed by someone else");
      throw e;
    }
    void locked;
    // The papers that came with the claim are recorded on each trip, referenced to the claim.
    for (const l of preview.ok) for (const b of l.broughtNow ?? []) await recordDocument.handler(ctx, { documentTypeId: b.documentTypeId, entityType: "trip", entityId: l.tripId!, reference: `${claimNo} ${l.manifest}`, issuedDate: null, expiryDate: null, fileKey: null, fileName: null, notes: null });
    await audit({
      action: "claims.create",
      entityType: "claim",
      entityId: claim.id,
      after: { claimNo, jobNo: job.jobNo, claimantId, currency, trips: preview.ok.map((l) => l.manifest), total: preview.total, totalFinal: preview.totalFinal },
    });
    if (input.post) await postClaimTx(ctx, claim.id);
    return { id: claim.id, claimNo, total: preview.total, totalFinal: preview.totalFinal, currency, trips: preview.ok.length };
  },
});

async function postClaimTx(ctx: CommandContext, claimId: string) {
  const { tx, actor, audit } = ctx;
  const [claim] = await tx.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.companyId, actor.companyId))).for("update");
  if (!claim) throw new NotFound("claim", claimId);
  if (claim.status !== "draft") throw new Conflict(`${claim.claimNo} is ${claim.status}`);
  const items = await tx.select().from(claimItems).where(and(eq(claimItems.claimId, claim.id), eq(claimItems.active, true)));
  const tripRows = await tx.select().from(trips).where(inArray(trips.id, items.map((i) => i.tripId)));
  const live = await liveTrips(tx, actor.companyId, tripRows);
  // Recalculate at posting: the snapshot must equal the live figures (a correction since the draft changes the claim).
  const changed = items.filter((i) => !dec(live.get(i.tripId)?.calc?.carrier.toPay ?? "NaN").eq(dec(i.amount)));
  if (changed.length) throw new Conflict(`${claim.claimNo}: trips changed since the draft; cancel and claim again`);
  const entry = await postClaimEntry(ctx, claim, tripRows.map((trip) => ({ trip, live: live.get(trip.id)! })));
  await tx.update(claims).set({ status: "posted", journalEntryId: entry.id, postedBy: actor.userId, postedAt: new Date() }).where(eq(claims.id, claim.id));
  await audit({ action: "claims.post", entityType: "claim", entityId: claim.id, before: { status: "draft" }, after: { status: "posted", journalEntryId: entry.id, totalFinal: claim.totalFinal } });
  return entry;
}

export const postClaim = defineCommand({
  name: "claims.post",
  permission: "claims.manage",
  input: z.object({ claimId: uuid }),
  async handler(ctx, { claimId }) {
    await postClaimTx(ctx, claimId);
    return { id: claimId };
  },
});

/** Withdraw a claim: its trips can be claimed again. A posted claim is reversed in the books; a paid one cannot be cancelled. */
export const cancelClaim = defineCommand({
  name: "claims.cancel",
  permission: "claims.manage",
  input: z.object({ claimId: uuid, reason: z.string().trim().min(1), cancelDate: isoDate.nullish() }),
  async handler(ctx, { claimId, reason, cancelDate }) {
    const { tx, actor, audit } = ctx;
    const [claim] = await tx.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.companyId, actor.companyId))).for("update");
    if (!claim) throw new NotFound("claim", claimId);
    if (claim.status === "cancelled") throw new Conflict(`${claim.claimNo} is already cancelled`);
    const [paid] = await tx.select({ no: payments.paymentNo }).from(payments).where(and(eq(payments.claimId, claimId), eq(payments.status, "posted"))).limit(1);
    if (paid) throw new Conflict(`${claim.claimNo} has payment ${paid.no}; reverse the payments first`);
    let reversalEntryId: string | null = null;
    if (claim.journalEntryId) reversalEntryId = (await reverseEntry(ctx, claim.journalEntryId, cancelDate ?? new Date().toISOString().slice(0, 10), `${claim.claimNo}: ${reason}`)).id;
    await tx.update(claims).set({ status: "cancelled", reversalEntryId }).where(eq(claims.id, claimId));
    await tx.update(claimItems).set({ active: false }).where(eq(claimItems.claimId, claimId));
    await audit({ action: "claims.cancel", entityType: "claim", entityId: claimId, before: { status: claim.status }, after: { status: "cancelled", reversalEntryId }, reason });
    return { id: claimId };
  },
});

/** What is still to pay (positive) or to collect (negative) on a claim. */
export async function claimOpen(db: Db, claimId: string): Promise<{ final: Dec; paid: Dec; open: Dec }> {
  const [claim] = await db.select({ totalFinal: claims.totalFinal }).from(claims).where(eq(claims.id, claimId));
  const [p] = await db
    .select({ paid: sql<string>`coalesce(sum(case when ${payments.direction} = 'out' then ${payments.amount} else -${payments.amount} end), 0)` })
    .from(payments)
    .where(and(eq(payments.claimId, claimId), eq(payments.status, "posted")));
  const final = dec(claim.totalFinal);
  const paid = dec(p.paid);
  return { final, paid, open: final.minus(paid) };
}

/** Paid when nothing is open any more; posted otherwise. */
export async function refreshClaimStatus(tx: Db, claimId: string) {
  const [claim] = await tx.select().from(claims).where(eq(claims.id, claimId));
  if (!claim || claim.status === "cancelled" || claim.status === "draft") return claim?.status;
  const { open } = await claimOpen(tx, claimId);
  const status = open.isZero() ? "paid" : "posted";
  if (status !== claim.status) await tx.update(claims).set({ status }).where(eq(claims.id, claimId));
  return status;
}

/**
 * Pay the claimant (all or part of what the claim owes), or collect from him
 * when the claim is negative. Payments go through the one payment engine.
 */
export const payClaim = defineCommand({
  name: "claims.pay",
  permission: "payments.create",
  input: z.object({
    claimId: uuid,
    moneyAccountId: uuid,
    /** Default: everything still open. */
    amount: amountString.nullish(),
    paymentDate: isoDate,
    method: z.enum(["cash", "bank_transfer", "cheque", "other"]),
    reference: z.string().nullish(),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const [claim] = await tx.select().from(claims).where(and(eq(claims.id, input.claimId), eq(claims.companyId, actor.companyId)));
    if (!claim) throw new NotFound("claim", input.claimId);
    if (claim.status !== "posted") throw new Conflict(`${claim.claimNo} is ${claim.status}`);
    const { open } = await claimOpen(tx, claim.id);
    if (open.isZero()) throw new ValidationError(`Nothing is open on ${claim.claimNo}`);
    const amount = input.amount ?? toStr(open.abs());
    const r = await recordPayment.handler(ctx, {
      direction: open.gt(0) ? "out" : "in",
      purpose: "settlement",
      moneyAccountId: input.moneyAccountId,
      amount,
      currency: claim.currency,
      paymentDate: input.paymentDate,
      method: input.method,
      partnerId: claim.claimantId,
      claimId: claim.id,
      reference: input.reference ?? claim.claimNo,
    });
    const status = await refreshClaimStatus(tx, claim.id);
    await audit({ action: "claims.pay", entityType: "claim", entityId: claim.id, after: { status, paymentNo: r.paymentNo, amount, direction: open.gt(0) ? "out" : "in" } });
    return { id: claim.id, status, paymentNo: r.paymentNo };
  },
});

/**
 * Waive part or all of a trip's shortage fine (the driver's excuse the owner
 * accepts). Always goes through approval; the result is a record the
 * calculation reads — never an edit of the fine.
 */
export const waiveFine = defineCommand({
  name: "fines.waive",
  permission: "fines.waive",
  input: z.object({ tripId: uuid, amount: amountString.nullish(), reason: z.string().trim().min(1).max(500), waiverDate: isoDate }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const trip = await getTrip(tx, actor.companyId, input.tripId);
    const live = (await liveTrips(tx, actor.companyId, [trip])).get(trip.id)!;
    if (live.claim) throw new Conflict(`${trip.tripNo} is already claimed on ${live.claim.claimNo}; the fine cannot change`);
    if (!live.calc || live.calc.state !== "confirmed") throw new ValidationError(`${trip.tripNo} is not discharged yet; there is no fine to waive`);
    const remaining = dec(live.calc.carrier.fine).abs();
    if (remaining.isZero()) throw new ValidationError(`${trip.tripNo} has no fine left to waive`);
    const amount = input.amount ? dec(input.amount) : remaining;
    if (amount.lte(0) || amount.gt(remaining)) throw new ValidationError(`The waiver must be between 0 and the remaining fine (${toStr(remaining)} ${live.calc.currency})`);
    if (!ctx.approval) throw new ApprovalRequired("A fine waiver needs approval", { amount: toStr(amount), currency: live.calc.currency, tripNo: trip.tripNo });
    const [row] = await tx
      .insert(fineWaivers)
      .values({ companyId: actor.companyId, tripId: trip.id, amount: toStr(amount), currency: live.calc.currency, waiverDate: input.waiverDate, reason: input.reason, requestedBy: actor.userId, approvedBy: ctx.approval.approvedBy })
      .returning();
    await audit({ action: "fines.waive", entityType: "trip", entityId: trip.id, after: { waiverId: row.id, amount: toStr(amount), currency: live.calc.currency, fineBefore: live.calc.carrier.fine }, reason: input.reason });
    return { id: row.id, amount: toStr(amount) };
  },
});

/** Waivers on a trip, newest first (for the trip's history). */
export async function tripWaivers(db: Db, tripId: string) {
  return db.select().from(fineWaivers).where(eq(fineWaivers.tripId, tripId)).orderBy(desc(fineWaivers.createdAt));
}

export async function listClaims(db: Db, companyId: string, f: { jobId?: string; claimantId?: string; status?: string[] } = {}) {
  const conds = [eq(claims.companyId, companyId)];
  if (f.jobId) conds.push(eq(claims.jobId, f.jobId));
  if (f.claimantId) conds.push(eq(claims.claimantId, f.claimantId));
  if (f.status?.length) conds.push(inArray(claims.status, f.status as never));
  const rows = await db
    .select({ claim: claims, claimant: businessPartners.name, jobNo: jobs.jobNo, jobName: jobs.name, tripCount: sql<number>`(select count(*)::int from ${claimItems} where ${claimItems.claimId} = ${claims.id} and ${claimItems.active})` })
    .from(claims)
    .innerJoin(businessPartners, eq(businessPartners.id, claims.claimantId))
    .innerJoin(jobs, eq(jobs.id, claims.jobId))
    .where(and(...conds))
    .orderBy(desc(claims.claimDate), desc(claims.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r.claim, total: toStr(dec(r.claim.total)), totalFinal: toStr(dec(r.claim.totalFinal)), claimant: r.claimant, jobNo: r.jobNo, jobName: r.jobName, tripCount: r.tripCount }));
}

/** Everything to print the claim like the owner's settlement form. */
export async function claimDetail(db: Db, companyId: string, claimId: string) {
  const [row] = await db
    .select({ claim: claims, claimant: businessPartners.name, jobNo: jobs.jobNo, jobName: jobs.name })
    .from(claims)
    .innerJoin(businessPartners, eq(businessPartners.id, claims.claimantId))
    .innerJoin(jobs, eq(jobs.id, claims.jobId))
    .where(and(eq(claims.id, claimId), eq(claims.companyId, companyId)));
  if (!row) throw new NotFound("claim", claimId);
  const items = await db
    .select({ item: claimItems, trip: trips, driver: businessPartners.name, transporter: transporters.name, plate: trucks.plate })
    .from(claimItems)
    .innerJoin(trips, eq(trips.id, claimItems.tripId))
    .innerJoin(businessPartners, eq(businessPartners.id, trips.driverId))
    .leftJoin(transporters, eq(transporters.id, trips.transporterId))
    .innerJoin(trucks, eq(trucks.id, trips.truckId))
    .where(eq(claimItems.claimId, claimId))
    .orderBy(asc(trips.loadingDate), asc(trips.manifestNo));
  const pays = await db.select().from(payments).where(and(eq(payments.claimId, claimId), ne(payments.status, "reversed"))).orderBy(asc(payments.paymentDate));
  const { open, paid } = await claimOpen(db, claimId);
  return {
    claim: { ...row.claim, total: toStr(dec(row.claim.total)), totalFinal: toStr(dec(row.claim.totalFinal)), claimant: row.claimant, jobNo: row.jobNo, jobName: row.jobName },
    lines: items.map((i) => ({
      tripId: i.trip.id,
      tripNo: i.trip.tripNo,
      manifestNo: i.trip.manifestNo,
      driver: i.driver,
      transporter: i.transporter,
      plate: i.trip.plateText ?? i.plate,
      loadingDate: i.trip.loadingDate,
      dischargeDate: i.trip.dischargeDate,
      calc: i.item.calculation as TripCalc & { termsId: string | null },
      amount: toStr(dec(i.item.amount)),
      active: i.item.active,
    })),
    payments: pays.map((p) => ({ id: p.id, paymentNo: p.paymentNo, date: p.paymentDate, direction: p.direction, amount: toStr(dec(p.amount)), method: p.method })),
    paid: toStr(paid),
    open: toStr(open),
  };
}

/** A carrier's claims and what is still open, for the partner account page. */
export async function carrierClaims(db: Db, companyId: string, partnerId: string) {
  const rows = await listClaims(db, companyId, { claimantId: partnerId });
  const out = [];
  for (const c of rows) out.push({ ...c, open: c.status === "posted" ? toStr((await claimOpen(db, c.id)).open) : "0" });
  return out;
}

registerApprovable(waiveFine);
registerApprovable(payClaim);
