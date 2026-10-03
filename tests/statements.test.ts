import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccount } from "@/domain/accounting/ledger";
import { invoiceDetail, partnerBalances } from "@/domain/finance/invoices";
import { createMoneyAccount, recordPayment, reversePayment } from "@/domain/finance/payments";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createCatalogItem } from "@/domain/masterdata/catalog";
import { createPartner } from "@/domain/masterdata/partners";
import { billTrips } from "@/domain/transport/billing";
import { defineRate } from "@/domain/transport/rates";
import { reverseSettlement, settleTrip } from "@/domain/transport/settlement";
import { awaitingStatement, cancelPayStatement, createPayStatement, payStatement, statementDetail } from "@/domain/transport/statements";
import { createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
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
  ids.ahmed = (await run(createPartner, { kind: "person", name: "Ahmed", roles: ["driver"] })).id;
  ids.karwan = (await run(createPartner, { kind: "person", name: "Karwan", roles: ["driver"] })).id;
  ids.diesel = (await run(createCatalogItem, { kind: "product", code: "DSL", name: "Diesel", defaultUnit: "MT" })).id;
  ids.crude = (await run(createCatalogItem, { kind: "product", code: "CRD", name: "Crude", defaultUnit: "MT" })).id;
  ids.type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances", "billing"] })).id;
  await rate({ rateType: "driver_pay", basis: "actual_qty", amount: "40000", currency: "IQD", unit: "MT", productId: ids.diesel });
  await rate({ rateType: "driver_pay", basis: "actual_qty", amount: "20", currency: "USD", unit: "MT", productId: ids.crude });
  await rate({ rateType: "allowance", basis: "quantity", amount: "0.20", unit: "MT" });
  await rate({ rateType: "shortage_fine", basis: "quantity", amount: "600000", currency: "IQD", unit: "MT", productId: ids.diesel });
  await rate({ rateType: "customer_price", basis: "actual_qty", amount: "55000", currency: "IQD", unit: "MT", productId: ids.diesel, customerId: ids.customer });
  await rate({ rateType: "transporter_fee", basis: "per_trip", amount: "100000", currency: "IQD", transporterId: ids.transporter });
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: ids.type, name: "Diesel to field", startDate: "2026-09-01", responsibleUserId: env.admin.userId })).id;
});
afterAll(async () => env.close());

let plate = 0;
async function settledTrip(driverId: string, loaded: string, discharged: string, opts: { product?: string; transporter?: string } = {}) {
  const t = await run(createTrip, { jobId: ids.job, driverId, truckPlate: `T-${++plate}`, productId: opts.product ?? ids.diesel, transporterId: opts.transporter });
  await run(recordLoading, { tripId: t.id, loadingDate: "2026-09-10", loadedQty: loaded, loadedUnit: "MT" });
  await run(recordDischarge, { tripId: t.id, dischargeDate: "2026-09-12", dischargedQty: discharged, dischargedUnit: "MT" });
  const s = await run(settleTrip, { tripId: t.id, settlementDate: "2026-09-13" });
  return { tripId: t.id, settlementId: s.id };
}

describe("pay statement for several drivers", () => {
  const trips: Record<string, { tripId: string; settlementId: string }> = {};

  it("puts several drivers' trips on one statement and shows every trip", async () => {
    trips.a1 = await settledTrip(ids.ahmed, "30", "29.75"); // 1,190,000 − 30,000 fine = 1,160,000
    trips.a2 = await settledTrip(ids.ahmed, "20", "20"); // 800,000
    trips.k1 = await settledTrip(ids.karwan, "25", "25"); // 1,000,000
    expect((await awaitingStatement(env.db, env.companyId, "driver")).map((r) => r.payee).sort()).toEqual(["Ahmed", "Ahmed", "Karwan"]);

    const st = await run<{ id: string; statementNo: string }>(createPayStatement, { party: "driver", settlementIds: [trips.a1.settlementId, trips.a2.settlementId, trips.k1.settlementId], statementDate: "2026-09-14" });
    ids.statement = st.id;
    const d = await statementDetail(env.db, env.companyId, st.id);
    expect(d.statement).toMatchObject({ party: "driver", currency: "IQD", total: "2960000", status: "open" });
    expect(d.lines.map((l) => [l.driver, l.side.netFinal])).toEqual([["Ahmed", "1160000"], ["Ahmed", "800000"], ["Karwan", "1000000"]]);
    expect(d.lines[0].calc.quantities).toMatchObject({ loaded: "30", discharged: "29.75", actual: "29.75", loss: "0.25" });
    expect(d.lines[0].calc.chargeableShortage).toBe("0.05");
    expect(d.payees.map((p) => [p.name, p.total, p.payment])).toEqual([["Ahmed", "1960000", null], ["Karwan", "1000000", null]]);
    expect(await awaitingStatement(env.db, env.companyId, "driver")).toEqual([]);
  });

  it("a trip cannot be on two live statements, and its settlement cannot be reversed while on one", async () => {
    await expect(run(createPayStatement, { party: "driver", settlementIds: [trips.k1.settlementId], statementDate: "2026-09-14" })).rejects.toMatchObject({ details: { missing: [expect.stringMatching(/already on PST-/)] } });
    await expect(run(reverseSettlement, { settlementId: trips.k1.settlementId, reversalDate: "2026-09-15", reason: "x" })).rejects.toThrow(/on pay statement/);
  });

  it("settlement balances are only paid through a statement, for the exact amount", async () => {
    await expect(run(recordPayment, { direction: "out", purpose: "settlement", moneyAccountId: ids.iqdCash, amount: "1000000", currency: "IQD", paymentDate: "2026-09-15", method: "cash", partnerId: ids.karwan })).rejects.toThrow(/pay statement/);
    await expect(run(recordPayment, { direction: "out", purpose: "settlement", moneyAccountId: ids.iqdCash, amount: "900000", currency: "IQD", paymentDate: "2026-09-15", method: "cash", partnerId: ids.karwan, statementId: ids.statement })).rejects.toThrow(/pay exactly/);
  });

  it("pays every driver in one step, one payment each; their balances are cleared", async () => {
    await expect(run(payStatement, { statementId: ids.statement, moneyAccountId: ids.usdCash, paymentDate: "2026-09-15", method: "cash" })).rejects.toThrow(/IQD/);
    const r = await run<{ status: string; payments: { partner: string; amount: string }[] }>(payStatement, { statementId: ids.statement, moneyAccountId: ids.iqdCash, paymentDate: "2026-09-15", method: "cash" });
    expect(r.status).toBe("paid");
    expect(r.payments.map((p) => [p.partner, p.amount])).toEqual([["Ahmed", "1960000"], ["Karwan", "1000000"]]);
    expect(await partnerBalances(env.db, env.companyId, ids.ahmed)).toEqual({});
    expect(await partnerBalances(env.db, env.companyId, ids.karwan)).toEqual({});
    await expect(run(payStatement, { statementId: ids.statement, moneyAccountId: ids.iqdCash, paymentDate: "2026-09-15", method: "cash" })).rejects.toThrow(/is paid/);
    await expect(run(cancelPayStatement, { statementId: ids.statement, reason: "x" })).rejects.toThrow(/reverse the payments first/);
  });

  it("reversing one driver's payment reopens the statement for that driver only", async () => {
    const d = await statementDetail(env.db, env.companyId, ids.statement);
    const karwan = d.payees.find((p) => p.name === "Karwan")!;
    await run(reversePayment, { paymentId: karwan.payment!.id, reversalDate: "2026-09-16", reason: "paid from wrong safe" });
    expect((await statementDetail(env.db, env.companyId, ids.statement)).statement.status).toBe("open");
    const r = await run<{ status: string; payments: { partner: string }[] }>(payStatement, { statementId: ids.statement, moneyAccountId: ids.iqdCash, paymentDate: "2026-09-16", method: "cash" });
    expect(r.payments.map((p) => p.partner)).toEqual(["Karwan"]);
    expect(r.status).toBe("paid");
  });

  it("can pay some payees now and the rest later", async () => {
    const b1 = await settledTrip(ids.ahmed, "10", "10");
    const b2 = await settledTrip(ids.karwan, "10", "10");
    const st = await run(createPayStatement, { party: "driver", settlementIds: [b1.settlementId, b2.settlementId], statementDate: "2026-09-20" });
    const r1 = await run<{ status: string }>(payStatement, { statementId: st.id, moneyAccountId: ids.iqdCash, paymentDate: "2026-09-20", method: "cash", partnerIds: [ids.ahmed] });
    expect(r1.status).toBe("open");
    const r2 = await run<{ status: string; payments: { partner: string }[] }>(payStatement, { statementId: st.id, moneyAccountId: ids.iqdCash, paymentDate: "2026-09-21", method: "cash" });
    expect(r2).toMatchObject({ status: "paid", payments: [{ partner: "Karwan" }] });
  });

  it("refuses mixing currencies; a cancelled statement frees its trips", async () => {
    const iqd = await settledTrip(ids.karwan, "5", "5");
    const usd = await settledTrip(ids.karwan, "5", "5", { product: ids.crude });
    await expect(run(createPayStatement, { party: "driver", settlementIds: [iqd.settlementId, usd.settlementId], statementDate: "2026-09-22" })).rejects.toMatchObject({ details: { missing: [expect.stringMatching(/separate/)] } });
    const st = await run(createPayStatement, { party: "driver", settlementIds: [iqd.settlementId], statementDate: "2026-09-22" });
    await run(cancelPayStatement, { statementId: st.id, reason: "wrong batch" });
    await expect(run(createPayStatement, { party: "driver", settlementIds: [iqd.settlementId], statementDate: "2026-09-22" })).resolves.toBeTruthy();
  });
});

describe("transporter statement", () => {
  it("lists every driver who drove for the transporter", async () => {
    const t1 = await settledTrip(ids.ahmed, "30", "30", { transporter: ids.transporter });
    const t2 = await settledTrip(ids.karwan, "30", "30", { transporter: ids.transporter });
    const st = await run(createPayStatement, { party: "transporter", settlementIds: [t1.settlementId, t2.settlementId], statementDate: "2026-09-23" });
    const d = await statementDetail(env.db, env.companyId, st.id);
    expect(d.lines.map((l) => [l.driver, l.transporter, l.side.netFinal])).toEqual([["Ahmed", "Zagros Transport", "100000"], ["Karwan", "Zagros Transport", "100000"]]);
    expect(d.payees).toMatchObject([{ name: "Zagros Transport", total: "200000" }]);
    // The drivers of these trips are still waiting for their own (driver) statement.
    expect((await awaitingStatement(env.db, env.companyId, "driver")).filter((r) => [t1, t2].some((t) => t.settlementId === r.settlementId))).toHaveLength(2);
  });
});

describe("customer invoice detail", () => {
  it("shows every trip with its driver and truck", async () => {
    const t1 = await settledTrip(ids.ahmed, "30", "29.75");
    const t2 = await settledTrip(ids.karwan, "20", "20");
    const inv = await run(billTrips, { jobId: ids.job, tripIds: [t1.tripId, t2.tripId], invoiceDate: "2026-09-25" });
    const d = await invoiceDetail(env.db, env.companyId, inv.id);
    expect(d).toMatchObject({ partner: "North Oil", tripCount: 2, driverCount: 2 });
    expect(d.lines.map((l) => [l.driver, l.line.quantity, l.line.amount])).toEqual([["Ahmed", "29.75", "1636250"], ["Karwan", "20", "1100000"]]);
    expect(d.invoice.total).toBe("2736250");
  });
});
