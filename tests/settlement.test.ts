import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoices, tripSettlements } from "@/db/schema";
import { createAccount, trialBalance } from "@/domain/accounting/ledger";
import { jobProfitability, partnerBalances } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment } from "@/domain/finance/payments";
import { changeJobStatus, createJob, defineJobType, getJob, nextAction } from "@/domain/jobs/commands";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { createPartner } from "@/domain/masterdata/partners";
import { roundToIncrement, dec, toStr } from "@/domain/money";
import { billTrips } from "@/domain/transport/billing";
import { defineRate, endRate } from "@/domain/transport/rates";
import { calculateSettlement, reverseSettlement, settleTrip } from "@/domain/transport/settlement";
import { createTrip, getTrip, recordArrival, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
const rate = (r: Record<string, unknown>) => run(defineRate, { effectiveFrom: "2026-01-01", reason: "price list", ...r });

beforeAll(async () => {
  env = await freshDb();
  const acc = async (code: string, type: string, currency?: string) => (ids[code] = (await run(createAccount, { code, name: code, type, currency })).id);
  for (const [c, t, cur] of [["1011", "asset", "USD"], ["1012", "asset", "IQD"], ["1100", "asset"], ["1300", "asset"], ["2200", "liability"], ["2300", "liability"],
    ["4000", "income"], ["4100", "income"], ["4200", "income"], ["5000", "expense"], ["5010", "expense"], ["5900", "expense"]] as const) await acc(c, t, cur);
  await run(setSetting, { key: "accounting.posting_accounts", reason: "setup", value: {
    advances: "1300", customer_receivables: "1100", payables_to_transporters: "2200", payables_to_drivers: "2300",
    transport_revenue: "4000", shortage_fines: "4100", demurrage_revenue: "4200", driver_costs: "5000", transporter_costs: "5010", rounding_differences: "5900",
  } });
  await run(setSetting, { key: "rounding.final_increment", value: { IQD: "250" }, reason: "we pay in 250 IQD steps" });
  ids.iqdCash = (await run(createMoneyAccount, { name: "Safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: ids["1012"] })).id;
  ids.usdCash = (await run(createMoneyAccount, { name: "Safe USD", kind: "cash", currency: "USD", ledgerAccountId: ids["1011"] })).id;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.transporter = (await run(createPartner, { kind: "organization", name: "Zagros Transport", roles: ["transporter"] })).id;
  ids.diesel = (await run(createCatalogItem, { kind: "product", code: "DSL", name: "Diesel", defaultUnit: "MT" })).id;
  ids.benzine = (await run(createCatalogItem, { kind: "product", code: "BNZ", name: "Benzine", defaultUnit: "MT" })).id;
  ids.type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances", "billing"] })).id;

  // The company's own rules (IQD work on diesel)
  await rate({ rateType: "driver_pay", basis: "actual_qty", amount: "40000", currency: "IQD", unit: "MT", productId: ids.diesel });
  await rate({ rateType: "allowance", basis: "quantity", amount: "0.20", unit: "MT", productId: ids.diesel });
  await rate({ rateType: "shortage_fine", basis: "quantity", amount: "600000", currency: "IQD", unit: "MT", productId: ids.diesel });
  await rate({ rateType: "customer_price", basis: "actual_qty", amount: "55000", currency: "IQD", unit: "MT", productId: ids.diesel, customerId: ids.customer });
});
afterAll(async () => env.close());

async function trip(opts: { loaded: string; discharged: string; product?: string; transporter?: string; loading?: string; discharge?: string }) {
  const job = await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Fuel", startDate: "2026-09-01", responsibleUserId: env.admin.userId });
  const t = await run<{ id: string; driverId: string }>(createTrip, { jobId: job.id, newDriverName: `Driver ${Math.random()}`, truckPlate: `P${Math.random()}`, productId: opts.product ?? ids.diesel, transporterId: opts.transporter });
  await run(recordLoading, { tripId: t.id, loadingDate: opts.loading ?? "2026-09-10", loadedQty: opts.loaded, loadedUnit: "MT" });
  await run(recordDischarge, { tripId: t.id, dischargeDate: opts.discharge ?? "2026-09-12", dischargedQty: opts.discharged, dischargedUnit: "MT" });
  return { jobId: job.id, tripId: t.id, driverId: t.driverId };
}
const calc = async (tripId: string) => calculateSettlement(env.db, env.companyId, await getTrip(env.db, env.companyId, tripId));

describe("rounding", () => {
  it("rounds final amounts to the nearest 250", () => {
    expect(toStr(roundToIncrement(dec("1234566"), "250"))).toBe("1234500");
    expect(toStr(roundToIncrement(dec("1234625"), "250"))).toBe("1234750");
    expect(toStr(roundToIncrement(dec("910000"), "250"))).toBe("910000");
  });
});

describe("driver settlement", () => {
  it("worked example: pay on discharged, allowance, fine, advance deducted", async () => {
    const t = await trip({ loaded: "30", discharged: "29.75" });
    await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.iqdCash, amount: "250000", currency: "IQD", paymentDate: "2026-09-10", method: "cash", tripId: t.tripId });
    const r = await calc(t.tripId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.calc.quantities).toMatchObject({ actual: "29.75", loss: "0.25" });
    expect(r.calc.allowance).toBe("0.2");
    expect(r.calc.chargeableShortage).toBe("0.05");
    expect(r.calc.driver.lines).toEqual([{ code: "driver_pay", amount: "1190000" }, { code: "shortage_fine", amount: "-30000" }]);
    expect(r.calc.driver).toMatchObject({ advancesDeducted: "250000", netFinal: "910000", rounding: "0" });
    expect(r.calc.transporter).toBeNull();

    await run(settleTrip, { tripId: t.tripId, settlementDate: "2026-09-13" });
    expect(await partnerBalances(env.db, env.companyId, t.driverId)).toEqual({ IQD: "-910000" }); // we owe the driver 910,000
    ids.workedJob = t.jobId;
  });

  it("discharged more than loaded: paid on the loaded quantity, no surplus, no fine", async () => {
    const t = await trip({ loaded: "30", discharged: "30.4" });
    const r = await calc(t.tripId);
    expect(r.ok && r.calc.quantities).toMatchObject({ actual: "30", loss: "0" });
    expect(r.ok && r.calc.driver.netFinal).toBe("1200000");
  });

  it("loss within the allowance is not fined", async () => {
    const t = await trip({ loaded: "30", discharged: "29.85" });
    const r = await calc(t.tripId);
    expect(r.ok && r.calc.chargeableShortage).toBe("0");
    expect(r.ok && r.calc.driver.lines.map((l) => l.code)).toEqual(["driver_pay"]);
  });

  it("rounds the final amount to 250 and books the difference", async () => {
    const t = await trip({ loaded: "30.8641", discharged: "30.8641" }); // 30.8641 × 40,000 = 1,234,564
    const r = await calc(t.tripId);
    expect(r.ok && r.calc.driver).toMatchObject({ net: "1234564", rounding: "64", netFinal: "1234500" });
    await run(settleTrip, { tripId: t.tripId, settlementDate: "2026-09-13" });
  });

  it("refuses to settle while a rule is missing (never assumes zero)", async () => {
    const t = await trip({ loaded: "30", discharged: "29.5", product: ids.benzine });
    const r = await calc(t.tripId);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.missing.map((m) => m.code)).toEqual(["rates.driver_pay_missing", "rates.allowance_missing"]);
    await expect(run(settleTrip, { tripId: t.tripId, settlementDate: "2026-09-13" })).rejects.toMatchObject({ code: "validation" });
  });

  it("keeps advances in another currency separate instead of converting them", async () => {
    const t = await trip({ loaded: "30", discharged: "30" });
    await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.usdCash, amount: "100", currency: "USD", paymentDate: "2026-09-10", method: "cash", tripId: t.tripId });
    const r = await calc(t.tripId);
    expect(r.ok && r.calc.driver).toMatchObject({ advancesDeducted: "0", advancesOtherCurrency: { USD: "100" }, netFinal: "1200000" });
  });
});

describe("rules change over time", () => {
  it("uses the rule in force on the loading date; history is unchanged", async () => {
    await run(defineRate, { rateType: "driver_pay", basis: "actual_qty", amount: "45000", currency: "IQD", unit: "MT", productId: ids.diesel, effectiveFrom: "2026-10-01", reason: "new price" })
      .then(() => { throw new Error("overlap should be refused"); })
      .catch((e) => expect(e).toMatchObject({ code: "conflict" }));
    const [old] = await env.db.select().from((await import("@/db/schema")).rates).where(eq((await import("@/db/schema")).rates.amount, "40000.000000"));
    await run(endRate, { rateId: old.id, effectiveTo: "2026-09-30", reason: "new price from October" });
    await run(defineRate, { rateType: "driver_pay", basis: "actual_qty", amount: "45000", currency: "IQD", unit: "MT", productId: ids.diesel, effectiveFrom: "2026-10-01", reason: "new price" });

    const sept = await trip({ loaded: "10", discharged: "10", loading: "2026-09-29", discharge: "2026-10-02" });
    const oct = await trip({ loaded: "10", discharged: "10", loading: "2026-10-02", discharge: "2026-10-04" });
    expect((await calc(sept.tripId)).ok && ((await calc(sept.tripId)) as { calc: { driver: { netFinal: string } } }).calc.driver.netFinal).toBe("400000");
    expect(((await calc(oct.tripId)) as { calc: { driver: { netFinal: string } } }).calc.driver.netFinal).toBe("450000");
    // The settlement posted earlier keeps the old rate in its snapshot
    const [s] = await env.db.select().from(tripSettlements).limit(1);
    expect((s.calculation as { rates: { driver_pay: { amount: string } } }).rates.driver_pay.amount).toBe("40000.000000");
  });
});

describe("demurrage", () => {
  it("counts from loading to discharge minus free days", async () => {
    ids.demLoading = (await rate({ rateType: "demurrage_pay", basis: "per_day", amount: "25000", currency: "IQD", freeDays: 5, startEvent: "loading", customerId: ids.customer, productId: ids.diesel, effectiveFrom: "2026-11-01" })).id;
    const t = await trip({ loaded: "10", discharged: "10", loading: "2026-11-01", discharge: "2026-11-10" });
    const r = await calc(t.tripId);
    expect(r.ok && r.calc.demurrageDays).toBe(4);
    expect(r.ok && r.calc.driver.lines).toContainEqual({ code: "demurrage", amount: "100000" });
  });

  it("counts from arrival when the rule says so, and waits for the arrival date", async () => {
    await run(endRate, { rateId: ids.demLoading, effectiveTo: "2026-11-30", reason: "new demurrage terms from December" });
    await rate({ rateType: "demurrage_pay", basis: "per_day", amount: "25000", currency: "IQD", freeDays: 5, startEvent: "arrival", customerId: ids.customer, productId: ids.diesel, effectiveFrom: "2026-12-01" });
    const t = await trip({ loaded: "10", discharged: "10", loading: "2026-12-01", discharge: "2026-12-12" });
    const r1 = await calc(t.tripId);
    expect(!r1.ok && r1.missing.map((m) => m.code)).toEqual(["transport.arrival_date_missing"]);
    await run(recordArrival, { tripId: t.tripId, arrivalDate: "2026-12-04" });
    const r2 = await calc(t.tripId);
    expect(r2.ok && r2.calc.demurrageDays).toBe(3);
  });
});

describe("transporter fee", () => {
  it("is owed to the transporter, never deducted from the driver; its advances are deducted from it", async () => {
    await rate({ rateType: "transporter_fee", basis: "loaded_qty", amount: "5000", currency: "IQD", unit: "MT", transporterId: ids.transporter });
    const t = await trip({ loaded: "30", discharged: "29.75", transporter: ids.transporter });
    await run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.iqdCash, amount: "50000", currency: "IQD", paymentDate: "2026-09-10", method: "cash", tripId: t.tripId, partnerId: ids.transporter });
    const r = await calc(t.tripId);
    expect(r.ok && r.calc.driver.netFinal).toBe("1160000"); // 1,190,000 − 30,000 fine; no fee deducted
    expect(r.ok && r.calc.transporter).toMatchObject({ lines: [{ code: "transporter_fee", amount: "150000" }], advancesDeducted: "50000", netFinal: "100000" });
  });

  it("blocks settlement if the trip has a transporter but no fee rule", async () => {
    const other = (await run(createPartner, { kind: "organization", name: "New Haulage", roles: ["transporter"] })).id;
    const t = await trip({ loaded: "30", discharged: "30", transporter: other });
    const r = await calc(t.tripId);
    expect(!r.ok && r.missing.map((m) => m.code)).toEqual(["rates.transporter_fee_missing"]);
  });
});

describe("controls", () => {
  it("settles once; a settled trip is frozen; reversal allows a corrected settlement", async () => {
    const t = await trip({ loaded: "20", discharged: "20" });
    const s = await run(settleTrip, { tripId: t.tripId, settlementDate: "2026-09-13" });
    await expect(run(settleTrip, { tripId: t.tripId, settlementDate: "2026-09-13" })).rejects.toMatchObject({ code: "conflict" });
    await expect(run(recordDischarge, { tripId: t.tripId, dischargeDate: "2026-09-12", dischargedQty: "19", dischargedUnit: "MT", reason: "x" })).rejects.toMatchObject({ code: "conflict" });
    await expect(run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: ids.iqdCash, amount: "1000", currency: "IQD", paymentDate: "2026-09-14", method: "cash", tripId: t.tripId })).rejects.toThrow(/already settled/);
    await run(reverseSettlement, { settlementId: s.id, reversalDate: "2026-09-14", reason: "wrong discharge" });
    await run(recordDischarge, { tripId: t.tripId, dischargeDate: "2026-09-12", dischargedQty: "19.9", dischargedUnit: "MT", reason: "corrected ticket" });
    await expect(run(settleTrip, { tripId: t.tripId, settlementDate: "2026-09-14" })).resolves.toBeTruthy();
  });
});

describe("customer billing and job close", () => {
  it("bills actual quantity × customer price, rounded; no double billing; then the job can close", async () => {
    const jobId = ids.workedJob;
    const job = await getJob(env.db, env.companyId, jobId);
    await run(changeJobStatus, { jobId, status: "completed" });
    const [t] = await env.db.select().from((await import("@/db/schema")).trips).where(eq((await import("@/db/schema")).trips.jobId, jobId));
    expect(await nextAction(env.db, await getJob(env.db, env.companyId, jobId))).toBe(`Bill ${t.tripNo}`);

    const inv = await run<{ id: string; total: string }>(billTrips, { jobId, tripIds: [t.id], invoiceDate: "2026-09-15" });
    expect(inv.total).toBe("1636250"); // 29.75 × 55,000 = 1,636,250
    await expect(run(billTrips, { jobId, tripIds: [t.id], invoiceDate: "2026-09-15" })).rejects.toThrow(/Already billed/);

    await run(changeJobStatus, { jobId, status: "financially_closed" });
    expect(job.customerId).toBe(ids.customer);
    expect(await jobProfitability(env.db, jobId)).toEqual([{ currency: "IQD", revenue: "1666250", costs: "1190000", profit: "476250" }]);
  });

  it("keeps the ledger balanced in each currency", async () => {
    const tb = await trialBalance(env.db, env.companyId, "2026-12-31");
    for (const cur of ["IQD", "USD"]) expect(tb.filter((r) => r.currency === cur).reduce((s, r) => s + Number(r.balance), 0)).toBe(0);
    const [i] = await env.db.select().from(invoices).limit(1);
    expect(i.rounding).toBe("0.0000");
  });
});
