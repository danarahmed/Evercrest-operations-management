import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, journalLines, payments } from "@/db/schema";
import { decideApproval, submitForApproval } from "@/domain/approvals/approvals";
import { reversePayment } from "@/domain/finance/payments";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { cancelClaim, createClaim } from "@/domain/transport/claims";
import { defineDeductionType } from "@/domain/transport/deductions";
import { closeHeldCuts, giveBackCuts, heldCuts, reverseCutRelease } from "@/domain/transport/held-cuts";
import { setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { tripLines } from "@/domain/transport/trip-view";
import { loadActor } from "@/server/actor";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown, actor = env.admin) => runCommand(env.db, actor, cmd as never, input) as Promise<T>;
let n = 0;
const trip = (extra: Record<string, unknown> = {}) =>
  run(saveTrip, { jobId: ids.job, manifestNo: `C-${++n}`, loadingDate: "2026-10-10", loadedQty: "30", driverName: `Driver ${n}`, plate: `22 C ${n}`, transporterName: "Masoud", dischargeDate: "2026-10-12", dischargedQty: "30", ...extra });
const calc = async (id: string) => (await tripLines(env.db, env.companyId, { jobId: ids.job })).lines.find((l) => l.id === id)!.calc!;
const balance = async (code: string, partnerId?: string) => {
  const [acc] = await env.db.select().from(accounts).where(and(eq(accounts.companyId, env.companyId), eq(accounts.code, code)));
  const rows = await env.db.select().from(journalLines).where(and(eq(journalLines.accountId, acc.id), partnerId ? eq(journalLines.partnerId, partnerId) : undefined));
  return rows.reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0);
};
/** Ask, then have the owner approve: the command runs exactly as asked. */
const approved = async (command: string, input: unknown) => {
  const req = await run(submitForApproval, { command, input, summary: command });
  await run(decideApproval, { requestId: req.id, decision: "approve" }, await loadActor(env.db, ids.owner));
};

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  ids.cash = starter.moneyAccounts.usd;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.zagros = (await run(createPartner, { kind: "organization", name: "Zagros", roles: ["transporter"] })).id;
  const type = (await run(defineJobType, { name: "Transport", defaultCapabilities: ["transportation"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: type, name: "Diesel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  await run(setTerms, { jobId: ids.job, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", carrierPrice: "70", customerPrice: "120" });
  ids.handling = (await run(defineDeductionType, { name: "Claim handling", defaultAmount: "25", defaultCurrency: "USD" })).id;
  const u = await run(createUser, { email: "owner@test.local", displayName: "Owner" });
  const role = await run(defineRole, { code: "owner2", name: "Owner", permissions: ["approvals.decide"], reason: "setup" });
  await run(assignRole, { userId: u.id, roleId: role.id, grant: true, reason: "setup" });
  ids.owner = u.id;
});
afterAll(async () => env.close());

describe("deductions the company keeps", () => {
  it("are ticked per trip, come off the carrier's pay, and go to income when the claim posts", async () => {
    const t = await trip({ deductions: [{ deductionTypeId: ids.handling }] });
    let c = await calc(t.id);
    expect(c.carrier).toMatchObject({ companyDeductions: "25", total: "2075" }); // 30 × 70 − 25
    expect(c.cost).toBe("2075");
    await run(saveTrip, { tripId: t.id, deductions: [{ deductionTypeId: ids.handling, amount: "30" }] });
    c = await calc(t.id);
    expect(c.carrier.total).toBe("2070");
    // The claimant (whoever brings the papers) gets 30 less; 30 is the company's income.
    await run(createClaim, { jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-20", manifests: [`C-${n}`] });
    expect(await balance("4500")).toBe(-30);
    expect(await balance("2200", ids.zagros)).toBe(-2070);
  });
});

describe("cuts held for transporters", () => {
  it("a cut is held against the trip, not owed to anyone, when the claim posts", async () => {
    const a = await trip({ transporterCut: "75" });
    const b = await trip({ transporterCut: "75" });
    const c = await calc(a.id);
    expect(c.carrier).toMatchObject({ transporterCut: "75", total: "2025" });
    expect(c.cost).toBe("2100"); // the cut is a cost while held
    await run(createClaim, { jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-20", manifests: [`C-${n - 1}`, `C-${n}`] });
    expect(await balance("2500")).toBe(-150);
    const held = await heldCuts(env.db, env.companyId, { jobId: ids.job });
    expect(held.map((h) => [h.manifest, h.held, h.transporterAtLoading])).toEqual([[`C-${n - 1}`, "75", "Masoud"], [`C-${n}`, "75", "Masoud"]]);
    ids.a = a.id;
    ids.b = b.id;
  });

  it("giving back always needs approval; the rest of each trip's cut becomes income at once", async () => {
    const input = { transporterName: "Masoud", releaseDate: "2026-10-25", method: "cash", moneyAccountId: ids.cash, lines: [{ tripId: ids.a, given: "60" }, { tripId: ids.b, given: "75" }] };
    await expect(run(giveBackCuts, input)).rejects.toMatchObject({ code: "approval_required" });
    // More than is held is refused.
    await expect(run(giveBackCuts, { ...input, lines: [{ tripId: ids.a, given: "80" }] })).rejects.toThrow(/more than/);
    await approved("held_cuts.give_back", input);
    expect(await balance("2500")).toBe(0);
    expect(await balance("4400")).toBe(-15);
    expect(await balance("1011")).toBe(-135);
    expect((await calc(ids.a)).cost).toBe("2085"); // 2,100 − 15 kept
    expect(await heldCuts(env.db, env.companyId, { jobId: ids.job })).toEqual([]);
    // A trip released once cannot be given back again, and its claim cannot be cancelled until the release is reversed.
    await expect(run(giveBackCuts, { ...input, lines: [{ tripId: ids.a, given: "1" }] })).rejects.toThrow(/no cut held/);
    const [claim] = await env.db.select().from(payments).where(eq(payments.paymentDate, "2026-10-25"));
    expect(claim).toMatchObject({ purpose: "other", amount: "135.0000" });
  });

  it("reversing the cash payment puts the cuts back on hold", async () => {
    const [pay] = await env.db.select().from(payments).where(eq(payments.paymentDate, "2026-10-25"));
    await run(reversePayment, { paymentId: pay.id, reversalDate: "2026-10-26", reason: "wrong transporter" });
    expect(await balance("2500")).toBe(-150);
    expect(await balance("4400")).toBe(0);
    expect((await heldCuts(env.db, env.companyId, { jobId: ids.job })).length).toBe(2);
  });

  it("given back to the transporter's account instead of cash: he is owed it", async () => {
    const zagrosBefore = await balance("2200", ids.zagros);
    await approved("held_cuts.give_back", { transporterId: ids.zagros, releaseDate: "2026-10-27", method: "account", lines: [{ tripId: ids.a, given: "75" }] });
    expect((await balance("2200", ids.zagros)) - zagrosBefore).toBe(-75);
    expect(await balance("2500")).toBe(-75);
  });

  it("old cuts nobody asked for are closed into income, with a reason and approval; a release can be reversed", async () => {
    await expect(run(closeHeldCuts, { tripIds: [ids.b], releaseDate: "2027-11-01", reason: "" })).rejects.toThrow();
    const old = await heldCuts(env.db, env.companyId, { olderThanDays: 365, today: "2027-11-01" });
    expect(old.map((h) => h.tripId)).toEqual([ids.b]);
    await approved("held_cuts.close", { tripIds: [ids.b], releaseDate: "2027-11-01", reason: "not asked for in a year" });
    expect(await balance("2500")).toBe(0);
    expect(await balance("4400")).toBe(-75);
    const [rel] = await env.db.query.cutReleases.findMany({ where: (r, { eq: e }) => e(r.kind, "close") });
    await run(reverseCutRelease, { releaseId: rel.id, reversalDate: "2027-11-02", reason: "the transporter came back" });
    expect(await balance("2500")).toBe(-75);
  });

  it("a claim with a released cut cannot be cancelled until the release is reversed", async () => {
    const [line] = await env.db.query.claimItems.findMany({ where: (c, { eq: e }) => e(c.tripId, ids.a) });
    await expect(run(cancelClaim, { claimId: line.claimId, reason: "wrong claimant" })).rejects.toThrow(/held cuts released/);
  });
});
