import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "@/db/client";
import { businessPartners, claimItems, claims, cutReleaseLines, cutReleases, jobs, moneyAccounts, payments, trips } from "@/db/schema";
import { defineCommand, type CommandContext } from "@/server/command";
import { ApprovalRequired, Conflict, NotFound, ValidationError } from "@/server/errors";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { registerApprovable } from "../approvals/approvals";
import { getJob } from "../jobs/commands";
import { D, type Dec, dec, toStr } from "../money";
import { nextNumber } from "../sequences";
import { partnerByNameOrId } from "./trip-edit";
import { manifestKey } from "./trip-import";

/**
 * Cuts held for transporters (owner's rule, 2026-11). A site cuts an amount from a driver's pay on a trip; the
 * claim books it to "Cuts held for transporters" against the trip, because nobody knows yet which transporter
 * will ask for it. When a transporter asks, operations choose the trips he asks for and how much of each cut
 * is given back — in cash from a box, or added to his account; whatever is not given back on a trip becomes
 * the company's income at once and the trip is closed. Cuts nobody asks for (e.g. after a year) can be closed
 * into income. Every release waits for approval. A release is corrected by reversing it: the cuts are held again.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Amount must be a positive number");

export interface HeldCut {
  tripId: string;
  manifest: string;
  tripNo: string;
  jobId: string;
  jobNo: string;
  driver: string | null;
  transporterAtLoading: string | null;
  claimNo: string;
  claimId: string;
  claimDate: string;
  currency: string;
  held: string;
  /** Days since the claim that put the cut on hold. */
  days: number;
}

/**
 * Trips whose cut is still held: on a live claim (posted or paid), with a cut in the claim's calculation,
 * and not released by a live give-back or close. The held amount is the one the claim booked.
 */
export async function heldCuts(db: Db, companyId: string, filter: { jobId?: string; manifests?: string[]; olderThanDays?: number; today?: string } = {}): Promise<HeldCut[]> {
  const driver = alias(businessPartners, "driver");
  const transporter = alias(businessPartners, "transporter");
  const keys = filter.manifests?.length ? [...new Set(filter.manifests.map(manifestKey))] : null;
  const rows = await db
    .select({
      tripId: trips.id,
      manifest: trips.manifestNo,
      tripNo: trips.tripNo,
      jobId: trips.jobId,
      jobNo: jobs.jobNo,
      driver: driver.name,
      transporter: transporter.name,
      claimId: claims.id,
      claimNo: claims.claimNo,
      claimDate: claims.claimDate,
      currency: claims.currency,
      calculation: claimItems.calculation,
    })
    .from(claimItems)
    .innerJoin(claims, eq(claims.id, claimItems.claimId))
    .innerJoin(trips, eq(trips.id, claimItems.tripId))
    .innerJoin(jobs, eq(jobs.id, trips.jobId))
    .leftJoin(driver, eq(driver.id, trips.driverId))
    .leftJoin(transporter, eq(transporter.id, trips.transporterId))
    .where(
      and(
        eq(claims.companyId, companyId),
        eq(claimItems.active, true),
        inArray(claims.status, ["posted", "paid"]),
        sql`coalesce((${claimItems.calculation} -> 'carrier' ->> 'transporterCut')::numeric, 0) > 0`,
        sql`not exists (select 1 from ${cutReleaseLines} l where l.trip_id = ${trips.id} and l.active)`,
        filter.jobId ? eq(trips.jobId, filter.jobId) : undefined,
        keys ? inArray(trips.manifestKey, keys) : undefined,
      ),
    )
    .orderBy(asc(claims.claimDate), asc(trips.manifestNo));
  const today = Date.parse(filter.today ?? new Date().toISOString().slice(0, 10));
  return rows
    .map((r) => ({
      tripId: r.tripId,
      manifest: r.manifest ?? r.tripNo,
      tripNo: r.tripNo,
      jobId: r.jobId,
      jobNo: r.jobNo,
      driver: r.driver,
      transporterAtLoading: r.transporter,
      claimNo: r.claimNo,
      claimId: r.claimId,
      claimDate: r.claimDate,
      currency: r.currency,
      held: dec((r.calculation as { carrier: { transporterCut: string } }).carrier.transporterCut).toFixed(),
      days: Math.floor((today - Date.parse(r.claimDate)) / 86400000),
    }))
    .filter((r) => filter.olderThanDays === undefined || r.days >= filter.olderThanDays);
}

/** Lock the trips and check every one is still held; returns the held cuts in the order asked. */
async function lockHeld(tx: Db, companyId: string, tripIds: string[]) {
  const ids = [...new Set(tripIds)];
  if (ids.length !== tripIds.length) throw new ValidationError("A trip is listed twice");
  await tx.select({ id: trips.id }).from(trips).where(and(inArray(trips.id, ids), eq(trips.companyId, companyId))).for("update");
  const held = new Map((await heldCuts(tx, companyId)).filter((h) => ids.includes(h.tripId)).map((h) => [h.tripId, h]));
  const out: HeldCut[] = [];
  for (const id of ids) {
    const h = held.get(id);
    if (!h) {
      const [t] = await tx.select({ m: trips.manifestNo, no: trips.tripNo }).from(trips).where(eq(trips.id, id));
      throw new Conflict(`${t?.m ?? t?.no ?? id} has no cut held (not claimed, no cut, or already given back or closed)`);
    }
    out.push(h);
  }
  const currencies = new Set(out.map((h) => h.currency));
  if (currencies.size > 1) throw new ValidationError(`These trips are in different currencies (${[...currencies].join(", ")}); release each currency separately`);
  for (const jobId of new Set(out.map((h) => h.jobId))) {
    const job = await getJob(tx, companyId, jobId);
    if (["financially_closed", "cancelled"].includes(job.status)) throw new Conflict(`Job ${job.jobNo} is ${job.status}`);
  }
  return out;
}

/** Book a release: the held cuts leave "Cuts held for transporters"; given back to cash or the transporter, the rest to income. */
async function postRelease(
  ctx: CommandContext,
  input: { kind: "give_back" | "close"; date: string; transporterId: string | null; method: "cash" | "account" | null; moneyAccountId: string | null; reason: string | null },
  lines: { cut: HeldCut; given: Dec }[],
) {
  const { tx, actor, audit } = ctx;
  const currency = lines[0].cut.currency;
  const acct = (k: Parameters<typeof postingAccount>[2]) => postingAccount(tx, actor.companyId, k);
  const heldAccount = await acct("transporter_cuts_held");
  const keptAccount = await acct("kept_transporter_cuts");
  let given = new D(0);
  let kept = new D(0);
  const perJob = new Map<string, { held: Dec; kept: Dec; memo: string[] }>();
  for (const { cut, given: g } of lines) {
    const h = dec(cut.held);
    if (g.gt(h)) throw new ValidationError(`${cut.manifest}: ${toStr(g)} is more than the ${cut.held} held`);
    if (g.isNegative()) throw new ValidationError(`${cut.manifest}: the amount cannot be negative`);
    given = given.plus(g);
    kept = kept.plus(h.minus(g));
    const j = perJob.get(cut.jobId) ?? { held: new D(0), kept: new D(0), memo: [] };
    j.held = j.held.plus(h);
    j.kept = j.kept.plus(h.minus(g));
    j.memo.push(cut.manifest);
    perJob.set(cut.jobId, j);
  }
  let box: typeof moneyAccounts.$inferSelect | undefined;
  if (input.method === "cash" && given.gt(0)) {
    if (!input.moneyAccountId) throw new ValidationError("Choose the cash box the money is paid from");
    [box] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, input.moneyAccountId), eq(moneyAccounts.companyId, actor.companyId)));
    if (!box?.active) throw new NotFound("money_account", input.moneyAccountId);
    if (box.currency !== currency) throw new ValidationError(`The cuts are in ${currency}; ${box.name} holds ${box.currency}`);
  }
  const releaseNo = await nextNumber(tx, actor.companyId, "CUT", Number(input.date.slice(0, 4)));
  const [who] = input.transporterId ? await tx.select({ name: businessPartners.name }).from(businessPartners).where(eq(businessPartners.id, input.transporterId)) : [];
  const description =
    input.kind === "close"
      ? `${releaseNo} held cuts closed to income, ${lines.length} trips`
      : `${releaseNo} held cuts given back to ${who?.name ?? "?"}, ${lines.length} trips`;
  const entryLines: Parameters<typeof postEntry>[1]["lines"] = [
    ...[...perJob].map(([jobId, j]) => ({ accountId: heldAccount.id, currency, jobId, debit: toStr(j.held), memo: j.memo.join(", ").slice(0, 500) })),
    ...[...perJob].filter(([, j]) => j.kept.gt(0)).map(([jobId, j]) => ({ accountId: keptAccount.id, currency, jobId, credit: toStr(j.kept), memo: `${releaseNo} kept by the company` })),
  ];
  if (given.gt(0)) {
    if (input.method === "cash") entryLines.push({ accountId: box!.ledgerAccountId, currency, credit: toStr(given), memo: `${releaseNo} given back in cash` });
    else entryLines.push({ accountId: (await acct("payables_to_transporters")).id, currency, credit: toStr(given), partnerId: input.transporterId, memo: `${releaseNo} held cuts given back` });
  }
  const entry = await postEntry(ctx, { entryDate: input.date, description, sourceType: "cut_release", sourceId: releaseNo, lines: entryLines });
  let paymentId: string | null = null;
  if (box && given.gt(0)) {
    const paymentNo = await nextNumber(tx, actor.companyId, "PAY", Number(input.date.slice(0, 4)));
    const [pay] = await tx
      .insert(payments)
      .values({
        companyId: actor.companyId,
        paymentNo,
        direction: "out",
        purpose: "other",
        moneyAccountId: box.id,
        amount: toStr(given),
        currency,
        paymentDate: input.date,
        method: "cash",
        partnerId: input.transporterId,
        jobId: perJob.size === 1 ? [...perJob.keys()][0] : null,
        counterAccountId: heldAccount.id,
        reference: releaseNo,
        notes: `Held cuts given back: ${lines.length} trips`,
        journalEntryId: entry.id,
        createdBy: actor.userId,
      })
      .returning({ id: payments.id });
    paymentId = pay.id;
  }
  const [release] = await tx
    .insert(cutReleases)
    .values({
      companyId: actor.companyId,
      releaseNo,
      kind: input.kind,
      transporterId: input.transporterId,
      method: input.method,
      moneyAccountId: box?.id ?? null,
      paymentId,
      currency,
      releaseDate: input.date,
      givenTotal: toStr(given),
      keptTotal: toStr(kept),
      reason: input.reason,
      journalEntryId: entry.id,
      createdBy: actor.userId,
      approvedBy: ctx.approval?.approvedBy ?? null,
    })
    .returning();
  await tx.insert(cutReleaseLines).values(lines.map(({ cut, given: g }) => ({ releaseId: release.id, tripId: cut.tripId, jobId: cut.jobId, held: cut.held, given: toStr(g), kept: toStr(dec(cut.held).minus(g)) })));
  await audit({
    action: input.kind === "close" ? "held_cuts.close" : "held_cuts.give_back",
    entityType: "cut_release",
    entityId: release.id,
    after: { releaseNo, transporter: who?.name ?? null, method: input.method, given: toStr(given), kept: toStr(kept), currency, trips: lines.map((l) => `${l.cut.manifest} ${l.cut.held}→${toStr(l.given)}`) },
    reason: input.reason ?? undefined,
  });
  return { id: release.id, releaseNo, given: toStr(given), kept: toStr(kept), currency };
}

/**
 * A transporter asks for cuts: operations choose the trips and how much of each is given back. Cash from a box,
 * or added to his account (then paid with his claims or set against what he owes). The rest of each trip's
 * cut becomes the company's income at once. Always waits for approval (owner's rule).
 */
export const giveBackCuts = defineCommand({
  name: "held_cuts.give_back",
  permission: "claims.manage",
  input: z.object({
    transporterId: uuid.nullish(),
    transporterName: z.string().trim().max(120).nullish(),
    releaseDate: isoDate,
    method: z.enum(["cash", "account"]),
    moneyAccountId: uuid.nullish(),
    lines: z.array(z.object({ tripId: uuid, given: money })).min(1).max(1000),
    reason: z.string().trim().max(500).nullish(),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const transporterId = await partnerByNameOrId(tx, actor.companyId, "transporter", input.transporterId ?? null, input.transporterName ?? null, audit);
    if (!transporterId) throw new ValidationError("Say which transporter the cuts are given back to");
    const cuts = await lockHeld(tx, actor.companyId, input.lines.map((l) => l.tripId));
    const lines = cuts.map((cut) => ({ cut, given: dec(input.lines.find((l) => l.tripId === cut.tripId)!.given) }));
    for (const l of lines) if (l.given.gt(dec(l.cut.held))) throw new ValidationError(`${l.cut.manifest}: ${toStr(l.given)} is more than the ${l.cut.held} held`);
    const given = lines.reduce((a, l) => a.plus(l.given), new D(0));
    const kept = lines.reduce((a, l) => a.plus(dec(l.cut.held)).minus(l.given), new D(0));
    if (input.method === "cash" && given.gt(0) && !input.moneyAccountId) throw new ValidationError("Choose the cash box the money is paid from");
    if (!ctx.approval)
      throw new ApprovalRequired(`Give back ${toStr(given)} ${cuts[0].currency} of held cuts on ${cuts.length} trips (${toStr(kept)} kept): this needs approval`, {
        trips: cuts.map((c) => c.manifest),
        given: toStr(given),
        kept: toStr(kept),
      });
    return postRelease(ctx, { kind: "give_back", date: input.releaseDate, transporterId, method: input.method, moneyAccountId: input.moneyAccountId ?? null, reason: input.reason ?? null }, lines);
  },
});
registerApprovable(giveBackCuts);

/** Cuts nobody asked for (e.g. after a year) become the company's income. Always waits for approval, with a reason. */
export const closeHeldCuts = defineCommand({
  name: "held_cuts.close",
  permission: "claims.manage",
  input: z.object({ tripIds: z.array(uuid).min(1).max(1000), releaseDate: isoDate, reason: z.string().trim().min(1, "Say why these cuts are closed").max(500) }),
  async handler(ctx, input) {
    const { tx, actor } = ctx;
    const cuts = await lockHeld(tx, actor.companyId, input.tripIds);
    const total = cuts.reduce((a, c) => a.plus(dec(c.held)), new D(0));
    if (!ctx.approval) throw new ApprovalRequired(`Close ${toStr(total)} ${cuts[0].currency} of held cuts on ${cuts.length} trips into income: this needs approval`, { trips: cuts.map((c) => c.manifest), total: toStr(total), reason: input.reason });
    return postRelease(ctx, { kind: "close", date: input.releaseDate, transporterId: null, method: null, moneyAccountId: null, reason: input.reason }, cuts.map((cut) => ({ cut, given: new D(0) })));
  },
});
registerApprovable(closeHeldCuts);

/** Undo a release (wrong trips, wrong amount, wrong box): its booking is reversed and the cuts are held again. */
export async function reverseRelease(ctx: CommandContext, release: typeof cutReleases.$inferSelect, date: string, reason: string, reversalEntryId?: string) {
  const { tx, audit } = ctx;
  const revId = reversalEntryId ?? (await reverseEntry(ctx, release.journalEntryId, date, `${release.releaseNo}: ${reason}`)).id;
  await tx.update(cutReleases).set({ status: "reversed", reversalEntryId: revId }).where(eq(cutReleases.id, release.id));
  await tx.update(cutReleaseLines).set({ active: false }).where(eq(cutReleaseLines.releaseId, release.id));
  if (release.paymentId) await tx.update(payments).set({ status: "reversed", reversalEntryId: revId }).where(eq(payments.id, release.paymentId));
  await audit({ action: "held_cuts.reverse", entityType: "cut_release", entityId: release.id, before: { status: "posted" }, after: { status: "reversed", reversalEntryId: revId }, reason });
  return { id: release.id, reversalEntryId: revId };
}

export const reverseCutRelease = defineCommand({
  name: "held_cuts.reverse",
  permission: "payments.reverse",
  input: z.object({ releaseId: uuid, reversalDate: isoDate, reason: z.string().trim().min(1) }),
  async handler(ctx, input) {
    const { tx, actor } = ctx;
    const [release] = await tx.select().from(cutReleases).where(and(eq(cutReleases.id, input.releaseId), eq(cutReleases.companyId, actor.companyId))).for("update");
    if (!release) throw new NotFound("cut_release", input.releaseId);
    if (release.status === "reversed") throw new Conflict(`${release.releaseNo} is already reversed`);
    return reverseRelease(ctx, release, input.reversalDate, input.reason);
  },
});

/** Releases, newest first, with their lines (for the held cuts page). */
export async function cutReleaseList(db: Db, companyId: string, limit = 50) {
  const transporter = alias(businessPartners, "transporter");
  const rows = await db
    .select({ release: cutReleases, transporter: transporter.name, box: moneyAccounts.name })
    .from(cutReleases)
    .leftJoin(transporter, eq(transporter.id, cutReleases.transporterId))
    .leftJoin(moneyAccounts, eq(moneyAccounts.id, cutReleases.moneyAccountId))
    .where(eq(cutReleases.companyId, companyId))
    .orderBy(sql`${cutReleases.createdAt} desc`)
    .limit(limit);
  const ids = rows.map((r) => r.release.id);
  const lines = ids.length
    ? await db.select({ line: cutReleaseLines, manifest: trips.manifestNo, tripNo: trips.tripNo }).from(cutReleaseLines).innerJoin(trips, eq(trips.id, cutReleaseLines.tripId)).where(inArray(cutReleaseLines.releaseId, ids))
    : [];
  return rows.map((r) => ({ ...r.release, transporter: r.transporter, box: r.box, lines: lines.filter((l) => l.line.releaseId === r.release.id).map((l) => ({ ...l.line, manifest: l.manifest ?? l.tripNo })) }));
}

/** Trips of a claim whose cut was already given back or closed: the claim cannot be cancelled until that is reversed. */
export async function releasedOnClaim(db: Db, claimId: string) {
  return db
    .select({ releaseNo: cutReleases.releaseNo, manifest: trips.manifestNo })
    .from(cutReleaseLines)
    .innerJoin(cutReleases, eq(cutReleases.id, cutReleaseLines.releaseId))
    .innerJoin(claimItems, and(eq(claimItems.tripId, cutReleaseLines.tripId), eq(claimItems.claimId, claimId), eq(claimItems.active, true)))
    .innerJoin(trips, eq(trips.id, cutReleaseLines.tripId))
    .where(eq(cutReleaseLines.active, true));
}
