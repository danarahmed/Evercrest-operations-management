import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, submitForApproval } from "@/domain/approvals/approvals";
import { defineDocumentType, recordDocument, setDocumentRequirement } from "@/domain/documents/documents";
import { partnerBalances } from "@/domain/finance/invoices";
import { recordPayment, reversePayment } from "@/domain/finance/payments";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { cancelClaim, carrierClaims, claimDetail, createClaim, payClaim, previewClaim, waiveFine } from "@/domain/transport/claims";
import { defineFeeType, setJobFee, setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { tripLines } from "@/domain/transport/trip-view";
import { journalEntries, journalLines } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown, actor = env.admin) => runCommand(env.db, actor, cmd as never, input) as Promise<T>;
/** The claimant brings the manifests themselves, so the manifest paper is always "bringing". */
const claim = (input: Record<string, unknown>) => ({ bringing: [ids.manifestType], ...input });

let n = 0;
/** A discharged trip under the rule card: 30 MT loaded, discharged as given, with an optional advance. */
async function trip(opts: { driver: string; transporter?: string | null; discharged?: string; advance?: string; manifest?: string; cut?: string }) {
  const manifest = opts.manifest ?? `H-${++n}`;
  const r = await run(saveTrip, {
    jobId: ids.job,
    manifestNo: manifest,
    loadingDate: "2026-10-10",
    loadedQty: "30",
    driverName: opts.driver,
    transporterName: opts.transporter ?? undefined,
    ...(opts.transporter === null ? { transporterId: null } : {}),
    plate: `22 C ${1000 + n}`,
    dischargeDate: opts.discharged ? "2026-10-13" : undefined,
    dischargedQty: opts.discharged,
    transporterCut: opts.cut,
    advanceAmount: opts.advance,
    advanceMoneyAccountId: opts.advance ? ids.cash : undefined,
  });
  return { id: r.id, manifest };
}

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  ids.cash = starter.moneyAccounts.usd;
  ids.manifestType = starter.documentTypes.manifest;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Diesel to Syria", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  // Owner's diesel card: 70 $/MT, reward 0 here, allowance 0.15 MT, fine 1,200 $/MT, advance up to 900.
  await run(setTerms, { jobId: ids.job, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", customerPrice: "120", carrierPrice: "70", carrierAllowance: "0.15", carrierFinePrice: "1200", advanceMax: "900" });
  // A visa fee the company pays and takes back from the carrier.
  const visa = await run(defineFeeType, { name: "Visa", defaultBasis: "per_trip", deductFromCarrier: true, billedToCustomer: false });
  await run(setJobFee, { jobId: ids.job, feeTypeId: visa.id, effectiveFrom: "2026-10-01", amount: "50", currency: "USD", basis: "per_trip", deductFromCarrier: true, billedToCustomer: false });
  ids.masoud = (await run(createPartner, { kind: "organization", name: "Masoud", roles: ["transporter"] })).id;
  ids.zagros = (await run(createPartner, { kind: "organization", name: "Zagros", roles: ["transporter"] })).id;
  // A second person who can approve (the requester may not approve his own request).
  const u = await run(createUser, { email: "owner2@test.local", displayName: "Owner Two" });
  const role = await run(defineRole, { code: "approver", name: "Approver", permissions: ["approvals.decide", "fines.waive", "claims.manage", "payments.create"], reason: "setup" });
  await run(assignRole, { userId: u.id, roleId: role.id, grant: true, reason: "setup" });
  ids.approver = u.id;
});
afterAll(async () => env.close());

describe("a claim follows the papers", () => {
  const t: Record<string, { id: string; manifest: string }> = {};

  it("checks every manifest and says why a trip cannot be claimed yet", async () => {
    t.a = await trip({ driver: "Hemin", transporter: "Masoud", discharged: "30", advance: "900" }); // 2100 − 50 visa − 900 = 1150
    t.b = await trip({ driver: "Karwan", transporter: "Masoud", discharged: "29.7" }); // net 29.7 → 2079; shortage 0.3 − 0.15 = 0.15 × 1200 = 180 fine; − 50 visa = 1849
    t.c = await trip({ driver: "Aso", transporter: "Masoud" }); // not discharged yet
    const p = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: [t.a.manifest, t.b.manifest, t.c.manifest, "H-999", t.a.manifest], bringing: [ids.manifestType] });
    expect(p.lines.map((l) => l.status)).toEqual(["ok", "ok", "not_discharged", "not_found", "duplicate"]);
    expect(p.ok.map((l) => l.amount)).toEqual(["1150", "1849"]);
    expect(p).toMatchObject({ currency: "USD", total: "2999", totalFinal: "2999" });
  });

  it("refuses the whole claim while one manifest has a problem, naming it", async () => {
    await expect(run(createClaim, claim({ jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-20", manifests: [t.a.manifest, t.c.manifest] }))).rejects.toMatchObject({
      details: { missing: [expect.stringMatching(/discharge data is missing/)] },
    });
  });

  it("required papers must be there before a trip can be claimed", async () => {
    const type = await run(defineDocumentType, { name: "Discharge certificate" });
    await run(setDocumentRequirement, { documentTypeId: type.id, scope: "job_type", scopeId: ids.type, appliesTo: "trip", requiredBefore: "completed", active: true, reason: "customer asks for it" });
    const p1 = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: [t.a.manifest], bringing: [ids.manifestType] });
    expect(p1.lines[0]).toMatchObject({ status: "papers_missing", missingPapers: ["Discharge certificate"] });
    for (const x of [t.a, t.b]) await run(recordDocument, { documentTypeId: type.id, entityType: "trip", entityId: x.id, reference: `DC-${x.manifest}` });
    const p2 = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: [t.a.manifest], bringing: [ids.manifestType] });
    expect(p2.lines[0]).toMatchObject({ status: "ok", unverifiedPapers: ["Discharge certificate"], broughtNow: [{ name: "Manifest" }] });
    ids.docType = type.id;
  });

  it("pays whoever brings the papers, not the transporter at loading, and clears the trip's advance", async () => {
    // Zagros brings Masoud's drivers' manifests: Zagros gets the trips' net.
    const r = await run<{ claimNo: string; total: string; trips: number }>(createClaim, claim({ jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-20", manifests: [t.a.manifest, t.b.manifest] }));
    ids.claim1 = (r as unknown as { id: string }).id;
    expect(r).toMatchObject({ total: "2999", trips: 2 });
    expect(r.claimNo).toMatch(/^CLM-2026-/);
    const d = await claimDetail(env.db, env.companyId, ids.claim1);
    expect(d.claim).toMatchObject({ status: "posted", claimant: "Zagros", currency: "USD", totalFinal: "2999" });
    expect(d.lines.map((l) => [l.manifestNo, l.driver, l.amount])).toEqual([[t.a.manifest, "Hemin", "1150"], [t.b.manifest, "Karwan", "1849"]]);
    expect(d.lines[1].calc.carrier).toMatchObject({ fine: "-180", fineWaived: "0", feeDeductions: "50" });
    // Books: Zagros is owed 2,999; the 900 advance is cleared from Hemin; Masoud gets nothing.
    expect(await partnerBalances(env.db, env.companyId, ids.zagros)).toEqual({ USD: "-2999" });
    expect(await partnerBalances(env.db, env.companyId, await partnerIdOf("Hemin"))).toEqual({}); // advance 900 paid, 900 cleared
    expect(await partnerBalances(env.db, env.companyId, ids.masoud)).toEqual({});
    // The entry balances per currency and carries the job's cost: 2100 + 2079 gross earned.
    const [entry] = await env.db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, "claim"), eq(journalEntries.sourceId, r.claimNo)));
    const lines = await env.db.select().from(journalLines).where(eq(journalLines.entryId, entry.id));
    const sum = (k: "debit" | "credit") => lines.reduce((a, l) => a + Number(l[k]), 0);
    expect(sum("debit")).toBeCloseTo(sum("credit"), 6);
    expect(sum("debit")).toBeCloseTo(4179 + 0, 6); // 4179 gross; fines, recoveries, advance and payable on the credit side
  });

  it("a claimed trip cannot be claimed again, by anyone, and is locked for changes", async () => {
    await expect(run(createClaim, claim({ jobId: ids.job, claimantId: ids.masoud, claimDate: "2026-10-21", manifests: [t.a.manifest] }))).rejects.toMatchObject({
      details: { missing: [expect.stringMatching(/already claimed on CLM-/)] },
    });
    await expect(run(saveTrip, { tripId: t.a.id, loadedQty: "31" })).rejects.toThrow(/settled|claimed/i);
    await expect(run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.cash, amount: "100", currency: "USD", paymentDate: "2026-10-21", method: "cash", tripId: t.a.id })).rejects.toThrow(/settled/);
    const { lines } = await tripLines(env.db, env.companyId, { jobId: ids.job });
    expect(lines.find((l) => l.id === t.a.id)!.claim).toMatchObject({ status: "posted" });
  });

  it("is paid to the claimant, in parts if needed, never more than is open; then shows as paid", async () => {
    await expect(run(payClaim, { claimId: ids.claim1, moneyAccountId: ids.cash, amount: "3000", paymentDate: "2026-10-22", method: "cash" })).rejects.toThrow(/cannot be more/);
    const r1 = await run<{ status: string }>(payClaim, { claimId: ids.claim1, moneyAccountId: ids.cash, amount: "1000", paymentDate: "2026-10-22", method: "cash" });
    expect(r1.status).toBe("posted");
    expect((await claimDetail(env.db, env.companyId, ids.claim1)).open).toBe("1999");
    const r2 = await run<{ status: string; paymentNo: string }>(payClaim, { claimId: ids.claim1, moneyAccountId: ids.cash, paymentDate: "2026-10-23", method: "cash" });
    expect(r2.status).toBe("paid");
    expect(await partnerBalances(env.db, env.companyId, ids.zagros)).toEqual({});
    expect((await carrierClaims(env.db, env.companyId, ids.zagros)).map((c) => [c.status, c.open])).toEqual([["paid", "0"]]);
    await expect(run(cancelClaim, { claimId: ids.claim1, reason: "x" })).rejects.toThrow(/reverse the payments first/);
    // A reversed payment reopens the claim.
    const d = await claimDetail(env.db, env.companyId, ids.claim1);
    await run(reversePayment, { paymentId: d.payments[1].id, reversalDate: "2026-10-24", reason: "wrong safe" });
    expect((await claimDetail(env.db, env.companyId, ids.claim1)).claim.status).toBe("posted");
  });
});

describe("negative trips and cancellation", () => {
  it("a trip whose fine is larger than its pay is offset inside the claim; a cancelled claim frees the trips and reverses the books", async () => {
    const good = await trip({ driver: "Dler", transporter: null, discharged: "30" }); // 2100 − 50 = 2050
    const bad = await trip({ driver: "Dler", transporter: null, discharged: "27.5", advance: "900" }); // net 27.5 → 1925; shortage 2.5 − 0.15 = 2.35 × 1200 = 2820 fine → 1925 − 2820 − 50 − 900 = −1845
    for (const x of [good, bad]) await run(recordDocument, { documentTypeId: ids.docType, entityType: "trip", entityId: x.id });
    const dler = await partnerIdOf("Dler");
    const r = await run<{ id: string; total: string }>(createClaim, claim({ jobId: ids.job, claimantId: dler, claimDate: "2026-10-25", manifests: [good.manifest, bad.manifest] }));
    expect(r.total).toBe("205"); // 2050 − 1845
    expect(await partnerBalances(env.db, env.companyId, dler)).toEqual({ USD: "-205" });
    await run(cancelClaim, { claimId: r.id, reason: "papers were not his" });
    expect(await partnerBalances(env.db, env.companyId, dler)).toEqual({ USD: "900" }); // only the advance remains, as before the claim
    const p = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: [good.manifest], bringing: [ids.manifestType] });
    expect(p.lines[0].status).toBe("ok");
  });
});

describe("fine waivers", () => {
  it("needs approval by another person, then reduces the fine in the calculation and the claim", async () => {
    const x = await trip({ driver: "Rebin", transporter: "Masoud", discharged: "29.5" }); // shortage 0.5 − 0.15 = 0.35 × 1200 = 420 fine
    await run(recordDocument, { documentTypeId: ids.docType, entityType: "trip", entityId: x.id });
    await expect(run(waiveFine, { tripId: x.id, amount: "500", reason: "road closure", waiverDate: "2026-10-26" })).rejects.toThrow(/between 0 and the remaining fine/);
    await expect(run(waiveFine, { tripId: x.id, amount: "300", reason: "road closure", waiverDate: "2026-10-26" })).rejects.toMatchObject({ code: "approval_required" });
    const req = await run(submitForApproval, { command: "fines.waive", input: { tripId: x.id, amount: "300", reason: "road closure", waiverDate: "2026-10-26" }, summary: `${x.manifest} waiver` });
    const approver = await loadActor(env.db, ids.approver);
    await run(decideApproval, { requestId: req.id, decision: "approve" }, approver);
    const { lines } = await tripLines(env.db, env.companyId, { jobId: ids.job });
    const l = lines.find((y) => y.id === x.id)!;
    expect(l.calc!.carrier).toMatchObject({ fineFull: "-420", fineWaived: "300", fine: "-120" });
    expect(l.calc!.flags).toContain("fine_waived");
    const r = await run<{ total: string }>(createClaim, claim({ jobId: ids.job, claimantId: ids.masoud, claimDate: "2026-10-27", manifests: [x.manifest] }));
    expect(r.total).toBe("1895"); // 29.5 × 70 = 2065 − 120 fine − 50 visa
    await expect(run(waiveFine, { tripId: x.id, amount: "100", reason: "late", waiverDate: "2026-10-28" })).rejects.toThrow(/already claimed/);
  });
});

async function partnerIdOf(name: string) {
  const { businessPartners } = await import("@/db/schema");
  const [p] = await env.db.select({ id: businessPartners.id }).from(businessPartners).where(and(eq(businessPartners.companyId, env.companyId), eq(businessPartners.name, name)));
  return p.id;
}
