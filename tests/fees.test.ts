import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, journalLines, tripFees } from "@/db/schema";
import { reversePayment } from "@/domain/finance/payments";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createClaim } from "@/domain/transport/claims";
import { addFeeToTrips, payFees, unpaidFees } from "@/domain/transport/fees";
import { defineFeeType, setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { tripLines } from "@/domain/transport/trip-view";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
let n = 0;
const trip = (extra: Record<string, unknown> = {}) =>
  run(saveTrip, { jobId: ids.job, manifestNo: `F-${++n}`, loadingDate: "2026-10-10", loadedQty: "30", driverName: "Hemin", plate: "22 C 1", dischargeDate: "2026-10-12", dischargedQty: "30", ...extra });
const line = async (id: string) => (await tripLines(env.db, env.companyId, { jobId: ids.job })).lines.find((l) => l.id === id)!.calc!;
const accountByCode = async (code: string) => (await env.db.select().from(accounts).where(and(eq(accounts.companyId, env.companyId), eq(accounts.code, code))))[0];
const balance = async (accountId: string) => {
  const rows = await env.db.select().from(journalLines).where(eq(journalLines.accountId, accountId));
  return rows.reduce((a, r) => a + Number(r.debit) - Number(r.credit), 0);
};

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  ids.cash = starter.moneyAccounts.usd;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.transporter = (await run(createPartner, { kind: "organization", name: "Zagros", roles: ["transporter"] })).id;
  const type = (await run(defineJobType, { name: "Transport", defaultCapabilities: ["transportation"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: type, name: "Diesel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  await run(setTerms, { jobId: ids.job, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", carrierPrice: "70", customerPrice: "120" });
  // Customs: the company pays it and carries it. Visa: the company pays it and takes it back from the carrier.
  // Border slip: the customer paid it directly; it is taken back from the carrier and owed back to the customer.
  ids.customs = (await run(defineFeeType, { name: "Customs", defaultBasis: "per_trip", defaultAmount: "100", defaultCurrency: "USD" })).id;
  ids.visa = (await run(defineFeeType, { name: "Visa", defaultBasis: "per_trip", defaultAmount: "50", defaultCurrency: "USD", deductFromCarrier: true })).id;
  ids.slip = (await run(defineFeeType, { name: "Border slip", defaultBasis: "per_trip", defaultAmount: "40", defaultCurrency: "USD", paidBy: "customer", deductFromCarrier: true, billedToCustomer: true })).id;
});
afterAll(async () => env.close());

describe("fees on trips", () => {
  it("are never added automatically; operations tick them, with the usual amount or another one", async () => {
    const t = await trip();
    expect((await line(t.id)).fees).toEqual([]);
    await run(saveTrip, { tripId: t.id, fees: [{ feeTypeId: ids.customs }, { feeTypeId: ids.visa, amount: "60" }] });
    let c = await line(t.id);
    expect(c.fees.map((f) => [f.name, f.amount]).sort()).toEqual([["Customs", "100"], ["Visa", "60"]]);
    expect(c.carrier).toMatchObject({ feeDeductions: "60", total: "2040" }); // 2,100 − 60 visa
    expect(c.feesTotal).toBe("160");
    // Untick the customs: only the visa stays.
    await run(saveTrip, { tripId: t.id, fees: [{ feeTypeId: ids.visa, amount: "60" }] });
    c = await line(t.id);
    expect(c.fees.map((f) => f.name)).toEqual(["Visa"]);
  });

  it("one kind of fee can be put on many trips at once", async () => {
    const a = await trip();
    const b = await trip();
    const r = await run<{ added: number }>(addFeeToTrips, { jobId: ids.job, feeTypeId: ids.customs, manifests: [`F-${n - 1}`, `F-${n}`] });
    expect(r.added).toBe(2);
    expect((await line(a.id)).fees.map((f) => f.name)).toEqual(["Customs"]);
    expect((await line(b.id)).fees.map((f) => f.name)).toEqual(["Customs"]);
    await expect(run(addFeeToTrips, { jobId: ids.job, feeTypeId: ids.customs, manifests: ["NOPE-1"] })).rejects.toThrow(/not on this job/);
  });

  it("company fees are paid later in one payment; a paid fee is locked until that payment is reversed", async () => {
    const unpaid = await unpaidFees(env.db, env.companyId, ids.job);
    const customs = unpaid.filter((u) => u.name === "Customs");
    expect(customs).toHaveLength(2);
    const pay = await run<{ id: string; total: string }>(payFees, { tripFeeIds: customs.map((u) => u.id), moneyAccountId: ids.cash, paymentDate: "2026-10-15" });
    expect(pay.total).toBe("200");
    const fees5300 = await accountByCode("5300");
    expect(await balance(fees5300.id)).toBe(200); // the fees' account (shared "Trip fees" = Permits and fees)
    expect((await unpaidFees(env.db, env.companyId, ids.job)).filter((u) => u.name === "Customs")).toHaveLength(0);
    // A paid fee cannot be changed or removed on the trip.
    const [paid] = await env.db.select().from(tripFees).where(eq(tripFees.paymentId, pay.id));
    await expect(run(saveTrip, { tripId: paid.tripId, fees: [] })).rejects.toThrow(/already paid/);
    await expect(run(payFees, { tripFeeIds: [paid.id], moneyAccountId: ids.cash, paymentDate: "2026-10-15" })).rejects.toThrow(/already paid/);
    // Reversing the payment makes the fees unpaid again.
    await run(reversePayment, { paymentId: pay.id, reversalDate: "2026-10-16", reason: "wrong box" });
    expect((await unpaidFees(env.db, env.companyId, ids.job)).filter((u) => u.name === "Customs")).toHaveLength(2);
    expect(await balance(fees5300.id)).toBe(0);
  });

  it("the payment limit applies to the total of a fees payment", async () => {
    await run(setSetting, { key: "approvals.payment_out_limits", value: { USD: "150" }, reason: "policy" });
    const customs = (await unpaidFees(env.db, env.companyId, ids.job)).filter((u) => u.name === "Customs");
    await expect(run(payFees, { tripFeeIds: customs.map((u) => u.id), moneyAccountId: ids.cash, paymentDate: "2026-10-17" })).rejects.toMatchObject({ code: "approval_required" });
    await run(setSetting, { key: "approvals.payment_out_limits", value: {}, reason: "policy" });
  });

  it("a fee the customer paid directly costs the company nothing; taken back from the carrier it is owed back to the customer", async () => {
    const t = await trip({ transporterName: "Zagros", fees: [{ feeTypeId: ids.slip }, { feeTypeId: ids.visa }] });
    const c = await line(t.id);
    expect(c.fees.find((f) => f.name === "Border slip")).toMatchObject({ paidBy: "customer", billedToCustomer: false });
    expect(c.carrier).toMatchObject({ feeDeductions: "90", total: "2010" }); // 2,100 − 40 slip − 50 visa
    expect(c.feesTotal).toBe("50"); // only the visa is the company's own fee
    expect(c.customerFeeCredit).toBe("40");
    expect(c.cost).toBe("2100"); // 2,010 to the carrier + 50 visa paid + 40 owed back to the customer
    // The customer-paid fee is never in "Pay fees".
    expect((await unpaidFees(env.db, env.companyId, ids.job)).some((u) => u.name === "Border slip")).toBe(false);
    // The claim books the visa back to the fees' account and the slip as owed to the customer.
    await run(createClaim, { jobId: ids.job, claimantId: ids.transporter, claimDate: "2026-10-20", manifests: [`F-${n}`] });
    const owed = await accountByCode("2400");
    const rows = await env.db.select().from(journalLines).where(eq(journalLines.accountId, owed.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ partnerId: ids.customer, credit: "40.0000" });
    const fees5300 = await accountByCode("5300");
    expect(await balance(fees5300.id)).toBe(-50); // the visa taken back from the carrier (its payment comes with "Pay fees")
  });
});
