import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { partnerBalances } from "@/domain/finance/invoices";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { claimDetail, listClaims } from "@/domain/transport/claims";
import { decideApproval, submitForApproval } from "@/domain/approvals/approvals";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { approveRemoteSettlement, compareRemoteSettlement, discardRemoteSettlement, getRemoteSettlement, stageRemoteSettlement } from "@/domain/transport/remote";
import { loadActor } from "@/server/actor";
import { setSetting } from "@/server/settings";
import { setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown, actor = env.admin) => runCommand(env.db, actor, cmd as never, input) as Promise<T>;

let n = 0;
async function trip(driver: string, discharged?: string, advance?: string) {
  const manifest = `R-${++n}`;
  const r = await run(saveTrip, { jobId: ids.job, manifestNo: manifest, loadingDate: "2026-10-10", loadedQty: "30", driverName: driver, transporterId: null, plate: `11 A ${2000 + n}`, dischargeDate: discharged ? "2026-10-12" : undefined, dischargedQty: discharged, advanceAmount: advance, advanceMoneyAccountId: advance ? ids.siteBox : undefined });
  return { id: r.id, manifest };
}
const row = (rowNo: number, manifest: string, paid?: string, driver?: string) => ({ rowNo, values: { manifest, paid, driver } });

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  ids.siteBox = starter.moneyAccounts.usd;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Diesel, site-paid", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  await run(setTerms, { jobId: ids.job, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", customerPrice: "120", carrierPrice: "70", carrierAllowance: "0.15", carrierFinePrice: "1200", advanceMax: "900" });
});
afterAll(async () => env.close());

describe("remote settlement: the site paid with its own figures", () => {
  const t: Record<string, { id: string; manifest: string }> = {};

  it("compares the sheet line by line and shows only what differs", async () => {
    t.a = await trip("Hemin", "30", "900"); // system: 2100 − 900 = 1200
    t.b = await trip("Hemin", "29.7"); // 2079 − 180 fine = 1899
    t.c = await trip("Karwan", "30"); // 2100
    t.d = await trip("Karwan"); // not discharged
    const rows = [row(2, t.a.manifest, "1200", "Hemin"), row(3, t.b.manifest, "1950", "Hemin"), row(4, t.c.manifest, "2100", "Karwan"), row(5, t.d.manifest, "2100", "Karwan"), row(6, "R-404", "500"), row(7, t.c.manifest, "2100")];
    const cmp = await compareRemoteSettlement(env.db, env.companyId, ids.job, rows);
    expect(cmp.lines.map((l) => l.status)).toEqual(["match", "amount_differs", "match", "not_discharged", "not_found", "duplicate"]);
    expect(cmp.lines[1]).toMatchObject({ system: "1899", paid: "1950", difference: "51" });
    expect(cmp.byDriver).toEqual([
      { driverId: expect.any(String), driver: "Hemin", trips: 2, system: "3099", paid: "3150", difference: "51" },
      { driverId: expect.any(String), driver: "Karwan", trips: 1, system: "2100", paid: "2100", difference: "0" },
    ]);
    expect(cmp.totals).toEqual({ system: "5199", paid: "5250", difference: "51" });
    const st = await run(stageRemoteSettlement, { jobId: ids.job, fileName: "site-oct.xlsx", settlementDate: "2026-10-15", moneyAccountId: ids.siteBox, columns: [], rows });
    ids.remote = st.id;
  });

  it("on approval each driver's trips become his claim, paid from the site box for what the system owes; the difference is reported", async () => {
    const r = await run<{ claims: { driver: string; claimNo: string; system: string; sitePaid: string; recorded: string; difference: string; paymentNo: string | null }[]; skipped: { manifest: string; status: string }[] }>(approveRemoteSettlement, { remoteSettlementId: ids.remote });
    expect(r.claims.map((c) => [c.driver, c.system, c.sitePaid, c.recorded, c.difference])).toEqual([
      ["Hemin", "3099", "3150", "3099", "51"],
      ["Karwan", "2100", "2100", "2100", "0"],
    ]);
    expect(r.claims.every((c) => c.paymentNo)).toBe(true);
    expect(r.skipped.map((s) => [s.manifest, s.status])).toEqual([[t.d.manifest, "not_discharged"], ["R-404", "not_found"], [t.c.manifest, "duplicate"]]);
    const all = await listClaims(env.db, env.companyId, { jobId: ids.job });
    expect(all.map((c) => [c.claimant, c.source, c.status]).sort()).toEqual([["Hemin", "remote", "paid"], ["Karwan", "remote", "paid"]]);
    const hemin = await claimDetail(env.db, env.companyId, all.find((c) => c.claimant === "Hemin")!.id);
    expect(hemin.lines.map((l) => l.manifestNo).sort()).toEqual([t.a.manifest, t.b.manifest].sort());
    expect(hemin.open).toBe("0");
    // Drivers' accounts are square; the trips are now claimed, so the same sheet cannot be approved twice.
    for (const c of all) expect(await partnerBalances(env.db, env.companyId, c.claimantId)).toEqual({});
    expect((await getRemoteSettlement(env.db, env.companyId, ids.remote)).status).toBe("approved");
    await expect(run(approveRemoteSettlement, { remoteSettlementId: ids.remote })).rejects.toThrow(/already approved/);
    const again = await compareRemoteSettlement(env.db, env.companyId, ids.job, [row(2, t.a.manifest, "1200")]);
    expect(again.lines[0]).toMatchObject({ status: "already_claimed" });
  });

  it("a short payment leaves the rest open on the claim; a sheet with nothing claimable is refused; staged sheets can be discarded", async () => {
    const x = await trip("Dler", "30"); // 2100
    const st = await run(stageRemoteSettlement, { jobId: ids.job, fileName: "site-2.xlsx", settlementDate: "2026-10-16", moneyAccountId: ids.siteBox, columns: [], rows: [row(2, x.manifest, "2000")] });
    const r = await run<{ claims: { claimId: string; recorded: string; difference: string }[] }>(approveRemoteSettlement, { remoteSettlementId: st.id });
    expect(r.claims[0]).toMatchObject({ recorded: "2000", difference: "-100" });
    const d = await claimDetail(env.db, env.companyId, r.claims[0].claimId);
    expect(d.claim.status).toBe("posted");
    expect(d.open).toBe("100");
    const empty = await run(stageRemoteSettlement, { jobId: ids.job, fileName: "site-3.xlsx", settlementDate: "2026-10-16", moneyAccountId: ids.siteBox, columns: [], rows: [row(2, "R-404", "1")] });
    await expect(run(approveRemoteSettlement, { remoteSettlementId: empty.id })).rejects.toThrow(/Nothing in this sheet/);
    await run(discardRemoteSettlement, { remoteSettlementId: empty.id, reason: "wrong job" });
    expect((await getRemoteSettlement(env.db, env.companyId, empty.id)).status).toBe("discarded");
  });
});

describe("site payments above the payment limit", () => {
  it("wait for approval by another person, then post and pay exactly as checked", async () => {
    await run(setSetting, { key: "approvals.payment_out_limits", value: { USD: "750" }, reason: "policy" });
    const u = await run(createUser, { email: "approver@test.local", displayName: "Approver" });
    const role = await run(defineRole, { code: "approver", name: "Approver", permissions: ["approvals.decide"], reason: "setup" });
    await run(assignRole, { userId: u.id, roleId: role.id, grant: true, reason: "setup" });
    const x = await trip("Hiwa", "30"); // 2100 > 750
    const st = await run(stageRemoteSettlement, { jobId: ids.job, fileName: "site-4.xlsx", settlementDate: "2026-10-17", moneyAccountId: ids.siteBox, columns: [], rows: [row(2, x.manifest, "2100")] });
    await expect(run(approveRemoteSettlement, { remoteSettlementId: st.id })).rejects.toMatchObject({ code: "approval_required" });
    expect((await getRemoteSettlement(env.db, env.companyId, st.id)).status).toBe("staged"); // nothing half-done
    const req = await run(submitForApproval, { command: "remote_settlements.approve", input: { remoteSettlementId: st.id }, summary: "site-4" });
    await run(decideApproval, { requestId: req.id, decision: "approve" }, await loadActor(env.db, u.id));
    expect((await getRemoteSettlement(env.db, env.companyId, st.id)).status).toBe("approved");
    const c = (await listClaims(env.db, env.companyId, { jobId: ids.job })).find((k) => k.claimant === "Hiwa")!;
    expect(c.status).toBe("paid");
  });
});
