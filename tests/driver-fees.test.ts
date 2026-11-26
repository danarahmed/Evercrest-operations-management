import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, journalLines, tripFees } from "@/db/schema";
import { decideApproval, submitForApproval } from "@/domain/approvals/approvals";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { createClaim, previewClaim } from "@/domain/transport/claims";
import { payFees, unpaidFees, waiveFeeReceipt } from "@/domain/transport/fees";
import { defineFeeType, setJobBilledFees, setTerms } from "@/domain/transport/terms";
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
const trip = (loadingDate: string, fees: unknown[]) =>
  run(saveTrip, { jobId: ids.job, manifestNo: `D-${++n}`, loadingDate, loadedQty: "30", driverName: `Driver ${n}`, plate: `22 D ${n}`, dischargeDate: loadingDate, dischargedQty: "30", fees });
const calc = async (id: string) => (await tripLines(env.db, env.companyId, { jobId: ids.job })).lines.find((l) => l.id === id)!.calc!;
const balance = async (code: string, partnerId?: string) => {
  const [acc] = await env.db.select().from(accounts).where(and(eq(accounts.companyId, env.companyId), eq(accounts.code, code)));
  const rows = await env.db.select().from(journalLines).where(and(eq(journalLines.accountId, acc.id), partnerId ? eq(journalLines.partnerId, partnerId) : undefined));
  return rows.reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0);
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
  ids.visa = (await run(defineFeeType, { name: "Visa", defaultBasis: "per_trip", defaultAmount: "50", defaultCurrency: "USD" })).id;
  ids.insurance = (await run(defineFeeType, { name: "Insurance", defaultBasis: "per_trip", defaultAmount: "75", defaultCurrency: "USD" })).id;
  const u = await run(createUser, { email: "owner@test.local", displayName: "Owner" });
  const role = await run(defineRole, { code: "owner2", name: "Owner", permissions: ["approvals.decide"], reason: "setup" });
  await run(assignRole, { userId: u.id, roleId: role.id, grant: true, reason: "setup" });
  ids.owner = u.id;
});
afterAll(async () => env.close());

describe("fees the driver paid", () => {
  it("are added back to the trip's balance and are not in Pay fees", async () => {
    const t = await trip("2026-10-05", [{ feeTypeId: ids.visa, paidBy: "carrier" }]);
    const c = await calc(t.id);
    expect(c.carrier).toMatchObject({ feeReimbursed: "50", total: "2150" });
    expect(c.cost).toBe("2150"); // a cost of the job: not on the invoice on this job
    expect(await unpaidFees(env.db, env.companyId, ids.job)).toEqual([]);
    ids.t1 = t.id;
  });

  it("cannot be claimed without the receipt; brought with the claim it is paid back as a job cost", async () => {
    const p = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: ["D-1"] });
    expect(p.lines[0]).toMatchObject({ status: "fee_receipt_missing", missingReceipts: ["Visa"] });
    await expect(run(createClaim, { jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-10", manifests: ["D-1"] })).rejects.toMatchObject({ details: { missing: ["D-1: the receipt of Visa (paid by the driver) is missing"] } });
    await run(createClaim, { jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-10", manifests: ["D-1"], feeReceipts: true });
    const [fee] = await env.db.select().from(tripFees).where(eq(tripFees.tripId, ids.t1));
    expect(fee.receiptReceived).toBe(true);
    expect(await balance("5300")).toBe(50); // Permits and fees: the job's cost
    expect(await balance("2200", ids.zagros)).toBe(-2150); // whoever brings the papers gets it back
  });

  it("without a receipt, an approved exception lets the trip be claimed", async () => {
    const t = await trip("2026-10-06", [{ feeTypeId: ids.visa, paidBy: "carrier" }]);
    const [fee] = await env.db.select().from(tripFees).where(eq(tripFees.tripId, t.id));
    await expect(run(waiveFeeReceipt, { tripFeeId: fee.id, reason: "receipt lost" })).rejects.toMatchObject({ code: "approval_required" });
    const req = await run(submitForApproval, { command: "trip_fees.receipt_waive", input: { tripFeeId: fee.id, reason: "receipt lost" }, summary: "Visa" });
    await run(decideApproval, { requestId: req.id, decision: "approve" }, await loadActor(env.db, ids.owner));
    const p = await previewClaim(env.db, env.companyId, { jobId: ids.job, manifests: [`D-${n}`] });
    expect(p.lines[0].status).toBe("ok");
  });
});

describe("fees on the customer's invoice (pass-through)", () => {
  it("are set on the job from a date: trips loaded before keep the earlier rule", async () => {
    await run(setJobBilledFees, { jobId: ids.job, effectiveFrom: "2026-10-15", feeTypeIds: [ids.visa, ids.insurance] });
    expect((await calc(ids.t1)).fees[0].billedToCustomer).toBe(false); // loaded 2026-10-05
    const t = await trip("2026-10-16", [{ feeTypeId: ids.visa, paidBy: "carrier", receipt: true }, { feeTypeId: ids.insurance }]);
    const c = await calc(t.id);
    expect(c.fees.every((f) => f.billedToCustomer)).toBe(true);
    expect(c.carrier.total).toBe("2150"); // the driver still gets his 50 back
    expect(c.cost).toBe("2100"); // neither fee is a job cost
    expect(c.feesToBill).toBe("125");
    ids.t3 = t.id;
  });

  it("the driver's fee is owed by the customer when the claim posts; the company's fee when it is paid", async () => {
    await run(createClaim, { jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-10-20", manifests: [`D-${n}`] });
    expect(await balance("1150", ids.customer)).toBe(50);
    const unpaid = await unpaidFees(env.db, env.companyId, ids.job);
    await run(payFees, { tripFeeIds: unpaid.map((u) => u.id), moneyAccountId: ids.cash, paymentDate: "2026-10-21" });
    expect(await balance("1150", ids.customer)).toBe(125);
    expect(await balance("5300")).toBe(50); // only the claimed driver-paid visa on the earlier trip is a job cost
  });
});
