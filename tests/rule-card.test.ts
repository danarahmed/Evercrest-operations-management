import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordPayment } from "@/domain/finance/payments";
import { setSetting } from "@/server/settings";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { defineFeeType, defineRoute, setJobFee, setTerms } from "@/domain/transport/terms";
import { calculateTrip, demurrageDays } from "@/domain/transport/trip-calc";
import { applyTripImport, type ImportRow, planImport, stageTripImport } from "@/domain/transport/trip-import";
import { jobTripLines } from "@/domain/transport/trip-view";
import { feeTypes, trips } from "@/db/schema";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";
import { eq } from "drizzle-orm";

let env: Awaited<ReturnType<typeof freshDb>>;
let jobId: string;
let cashUsd: string;
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

/** The owner's diesel-to-Syria rules (docs/business/example-diesel-syria.md). */
const DIESEL = {
  currency: "USD",
  unit: "MT",
  customerPrice: "120",
  carrierPrice: "70",
  carrierAllowance: "0.15",
  carrierFinePrice: "1200",
};

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  cashUsd = starter.moneyAccounts.usd;
  const customer = await run(createPartner, { kind: "organization", name: "Syria Fuel Co", roles: ["customer"] });
  const type = await run(defineJobType, { code: "PTR", name: "Petroleum transportation", defaultCapabilities: ["transportation", "advances", "documents", "billing", "expenses"] });
  jobId = (await run(createJob, { customerId: customer.id, jobTypeId: type.id, name: "Diesel Kawergosk → Banias", startDate: "2026-10-13", responsibleUserId: env.admin.userId })).id;
});
afterAll(async () => env.close());

const terms = (over: Partial<Parameters<typeof calculateTrip>[1]> = {}): Parameters<typeof calculateTrip>[1] => ({
  id: "t",
  currency: "USD",
  unit: "MT",
  customerPrice: "120",
  customerPriceBasis: "per_unit",
  customerQtyBasis: "net",
  customerAllowance: null,
  customerAllowanceBasis: "per_trip",
  customerFinePrice: null,
  carrierPrice: "70",
  carrierPriceBasis: "per_unit",
  rewardPerTrip: "0",
  transporterCommission: "0",
  carrierAllowance: "0.15",
  carrierFinePrice: "1200",
  demurrageMethod: "none",
  demurrageFreeDays: 0,
  carrierDemurrageRate: "0",
  customerDemurrageRate: "0",
  advanceMax: null,
  ...over,
});
const trip = (over: Partial<Parameters<typeof calculateTrip>[0]> = {}): Parameters<typeof calculateTrip>[0] => ({
  loadedQty: "30.28",
  dischargedQty: "30.2",
  arrivalDate: null,
  dischargeDate: null,
  carrierPriceOverride: null,
  rewardOverride: null,
  transporterCut: "0",
  carrierDeduction: "0",
  advances: { USD: "900" },
  ...over,
});
const BORDER = [
  { feeTypeId: "g", name: "Guarantee", rate: "100", basis: "per_trip" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
  { feeTypeId: "i", name: "Insurance", rate: "75", basis: "per_trip" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
  { feeTypeId: "v", name: "Visa", rate: "50", basis: "per_trip" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
  { feeTypeId: "e", name: "Entry slip", rate: "50", basis: "per_trip" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
  { feeTypeId: "d", name: "Declaration", rate: "70", basis: "per_trip" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
  { feeTypeId: "b", name: "Border commission", rate: "10", basis: "per_trip" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
  { feeTypeId: "c", name: "Customs", rate: "30", basis: "per_loaded_unit" as const, currency: "USD", deductFromCarrier: false, billedToCustomer: false },
];

describe("trip calculation reproduces the owner's diesel sheet", () => {
  it("row H-151: shortage within the allowance, no fine", () => {
    // Excel: V=30.2 (min), Z = 30.2×70 = 2114, AA = 2114 − 900 = 1214, border 345 + 10, customs 30×30.28 = 908.4
    const c = calculateTrip(trip(), terms(), BORDER);
    expect(c.state).toBe("confirmed");
    expect(c.net).toBe("30.2");
    expect(c.carrier.fine).toBe("0");
    expect(c.carrier.freight).toBe("2114");
    expect(c.carrier.toPay).toBe("1214");
    expect(c.feesTotal).toBe("1263.4"); // 345 + 10 + 908.4
    expect(c.cost).toBe("3377.4"); // 2114 + 1263.4
    expect(c.customer.revenue).toBe("3624"); // 30.2 × 120
    expect(c.margin).toBe("246.6");
  });

  it("shortage beyond the allowance is fined at 1200 per ton on the excess, like the settlement form", () => {
    // loaded 30.76, discharged 30.29: shortage −0.47, beyond −0.15 → −0.32 × 1200 = −384
    const c = calculateTrip(trip({ loadedQty: "30.76", dischargedQty: "30.29" }), terms(), []);
    expect(c.carrier.fineQty).toBe("-0.32");
    expect(c.carrier.fine).toBe("-384");
    expect(c.carrier.freight).toBe("2120.3"); // 30.29 × 70
    expect(c.carrier.total).toBe("1736.3");
  });

  it("the transporter's cut lowers the driver's pay but stays a company cost (settlement-form rule)", () => {
    const c = calculateTrip(trip({ transporterCut: "50" }), terms(), []);
    expect(c.carrier.total).toBe("2064"); // 2114 − 50
    expect(c.cost).toBe("2114"); // 2064 + 50
  });

  it("before discharge the trip is an estimate on the loaded quantity with no shortage", () => {
    const c = calculateTrip(trip({ dischargedQty: null }), terms(), []);
    expect(c.state).toBe("estimated");
    expect(c.net).toBe("30.28");
    expect(c.carrier.fine).toBe("0");
    expect(c.customer.revenue).toBe("3633.6");
  });

  it("a price to be decided leaves revenue and margin open and flags it", () => {
    const c = calculateTrip(trip(), terms({ customerPrice: null }), []);
    expect(c.customer.total).toBeNull();
    expect(c.margin).toBeNull();
    expect(c.flags).toContain("customer_price_tbd");
  });

  it("the customer's own allowance and fine reduce what we bill, separately from the driver's", () => {
    // Customer: allowance 0.2 % of loaded (per_unit 0.002), fine 1000/t. loaded 30, discharged 29.5 → shortage −0.5, allowance 0.06 → −0.44 × 1000 = −440
    const c = calculateTrip(trip({ loadedQty: "30", dischargedQty: "29.5" }), terms({ customerAllowance: "0.002", customerAllowanceBasis: "per_unit", customerFinePrice: "1000" }), []);
    expect(c.customer.fine).toBe("-440");
    expect(c.customer.total).toBe("3100"); // 29.5 × 120 − 440
    expect(c.carrier.fine).toBe("-420"); // (−0.5 + 0.15) × 1200
  });

  it("demurrage counts the days between arrival and discharge, both excluded, minus free days", () => {
    expect(demurrageDays("arrival_to_discharge", "2026-10-01", "2026-10-06", 2)).toBe(2);
    expect(demurrageDays("arrival_to_discharge", "2026-10-01", "2026-10-02", 0)).toBe(0);
    expect(demurrageDays("none", "2026-10-01", "2026-10-06", 0)).toBe(0);
    const c = calculateTrip(trip({ arrivalDate: "2026-10-01", dischargeDate: "2026-10-06" }), terms({ demurrageMethod: "arrival_to_discharge", demurrageFreeDays: 1, carrierDemurrageRate: "50", customerDemurrageRate: "80" }), []);
    expect(c.carrier.demurrageDays).toBe(3);
    expect(c.carrier.demurrage).toBe("150");
    expect(c.customer.demurrage).toBe("240");
  });

  it("fees marked as deducted come out of the carrier's pay and still count as cost", () => {
    const fees = [{ feeTypeId: "v", name: "Visa", rate: "50", basis: "per_trip" as const, currency: "USD", deductFromCarrier: true, billedToCustomer: true }];
    const c = calculateTrip(trip(), terms(), fees);
    expect(c.carrier.feeDeductions).toBe("50");
    expect(c.carrier.total).toBe("2064");
    expect(c.cost).toBe("2114"); // carrier 2064 + fee 50
    expect(c.customer.billedFees).toBe("50");
    expect(c.customer.total).toBe("3674");
  });
});

const sheetRow = (rowNo: number, v: Record<string, string>, fees: Record<string, string> = {}): ImportRow => ({
  rowNo,
  values: { loadingDate: "2026-10-14", route: "هەولێر - لازقیە", loadingPlace: "کەورگۆسک", dischargePlace: "بانیاس", carrierPrice: "70", advance: "900", transporter: "مسعود", loadedQty: "30.02", ...v },
  fees: { guarantee: "100", insurance: "75", visa: "50", entry_slip: "50", declaration_fee: "70", border_commission: "10", customs_rate: "30", ...fees },
});

describe("rule card and sheet import", () => {
  it("sets the job's dated terms and fees; later versions apply from their date", async () => {
    const route = await run(defineRoute, { jobId, name: "هەولێر - لازقیە", loadingPlace: "Kawergosk", dischargePlace: "Banias" });
    await run(setTerms, { jobId, effectiveFrom: "2026-10-13", ...DIESEL, advanceNormal: "900", advanceMax: "900" });
    await run(setTerms, { jobId, routeId: route.id, effectiveFrom: "2026-10-20", ...DIESEL, carrierPrice: "75" });
    const types = await env.db.select().from(feeTypes).where(eq(feeTypes.companyId, env.companyId));
    const byName = (w: string) => types.find((t) => t.name.toLowerCase().includes(w))!.id;
    for (const [w, amount, basis] of [["guarantee", "100", "per_trip"], ["insurance", "75", "per_trip"], ["visa", "50", "per_trip"], ["entry", "50", "per_trip"], ["declaration", "70", "per_trip"], ["border", "10", "per_trip"], ["customs", "30", "per_loaded_unit"]] as const)
      await run(setJobFee, { jobId, feeTypeId: byName(w), effectiveFrom: "2026-10-13", amount, currency: "USD", basis });
    const extra = await run(defineFeeType, { name: "Exchanger financing fee", defaultBasis: "per_loaded_unit" });
    expect(extra).toMatchObject({ code: "FEE-008" });
  });

  it("previews a sheet: new trips, new names, advances, and values outside the rules", async () => {
    const rows = [
      sheetRow(4, { manifest: "H-185", driver: "بارزان حمدامین", plate: "22 B 16403", dischargedQty: "29.7", dischargeDate: "2026-10-20" }),
      sheetRow(5, { manifest: "H-186", driver: "شوان عمر", plate: "22 C 17827", carrierPrice: "72", advance: "1200" }),
      sheetRow(6, { manifest: "H-186", driver: "دوبارە", plate: "1 A 1" }),
      sheetRow(7, { driver: "بێ منفیست", plate: "2 B 2" }),
    ];
    const plan = await planImport(env.db, env.companyId, jobId, rows);
    // Row 5's advance (1200) is above the rule card's limit (900): not imported until the limit is raised or it is approved.
    expect(plan.counts).toEqual({ new: 1, update: 0, same: 0, error: 3 });
    expect(plan.newDrivers).toHaveLength(4);
    expect(plan.newTransporters).toEqual(["مسعود"]);
    expect(plan.advanceTotal).toBe("900");
    const codes = (i: number) => plan.rows[i].notes.map((n) => n.code);
    expect(codes(1)).toEqual(expect.arrayContaining(["price_differs", "advance_above_max"]));
    expect(codes(2)).toContain("manifest_twice_in_file");
    expect(codes(3)).toContain("manifest_missing");
  });

  it("applies the sheet once: trips, drivers, transporter, advances from the cash box, fees from the sheet", async () => {
    const rows = [
      sheetRow(4, { manifest: "H-185", driver: "بارزان حمدامین", plate: "22 B 16403", dischargedQty: "29.7", dischargeDate: "2026-10-20" }),
      sheetRow(5, { manifest: "H-186", driver: "شوان عمر", plate: "22 C 17827", transporterCut: "50" }, { guarantee: "0", insurance: "0" }),
    ];
    const staged = await run(stageTripImport, { jobId, fileName: "DIESEL.xlsx", columns: [], rows });
    const result = await run<{ created: number; updated: number }>(applyTripImport, { importId: staged.id, moneyAccountId: cashUsd });
    expect(result).toMatchObject({ created: 2, updated: 0 });
    await expect(run(applyTripImport, { importId: staged.id, moneyAccountId: cashUsd })).rejects.toMatchObject({ code: "conflict" });

    const view = await jobTripLines(env.db, env.companyId, jobId);
    expect(view.lines).toHaveLength(2);
    const [a, b] = view.lines;
    expect(a.manifestNo).toBe("H-185");
    expect(a.calc!.state).toBe("confirmed");
    expect(a.calc!.carrier.advance).toBe("900");
    expect(a.calc!.carrier.fine).toBe("-204"); // (29.7 − 30.02 + 0.15) × 1200 = −0.17 × 1200
    expect(a.calc!.feesTotal).toBe("1255.6"); // 355 + 30 × 30.02
    expect(b.calc!.state).toBe("estimated");
    expect(b.calc!.feesTotal).toBe("1080.6"); // 180 + 900.6 (guarantee and insurance 0 on the sheet)
    expect(b.calc!.carrier.transporterCut).toBe("50");
    expect(view.totals[0]).toMatchObject({ currency: "USD", trips: 2, onTheWay: 1, discharged: 1, advances: "1800" });
  });

  it("re-importing the sheet fills in discharge data and refuses to overwrite recorded figures", async () => {
    const rows = [
      sheetRow(4, { manifest: "H-185", driver: "بارزان حمدامین", plate: "22 B 16403", dischargedQty: "29.9", dischargeDate: "2026-10-20" }),
      sheetRow(5, { manifest: "H-186", driver: "شوان عمر", plate: "22 C 17827", dischargedQty: "30.0", dischargeDate: "2026-10-21" }),
    ];
    const plan = await planImport(env.db, env.companyId, jobId, rows);
    expect(plan.rows[0].status).toBe("same");
    expect(plan.rows[0].notes.map((n) => n.code)).toContain("differs_discharged");
    expect(plan.rows[1].status).toBe("update");
    const staged = await run(stageTripImport, { jobId, fileName: "DIESEL-2.xlsx", columns: [], rows });
    const result = await run<{ created: number; updated: number }>(applyTripImport, { importId: staged.id });
    expect(result).toMatchObject({ created: 0, updated: 1 });
    const [t] = await env.db.select().from(trips).where(eq(trips.manifestKey, "H186"));
    expect(t.status).toBe("discharged");
    expect(t.dischargedQty).toBe("30.0000");
  });

  it("the same manifest cannot be entered twice in a job, even directly", async () => {
    const [t] = await env.db.select().from(trips).where(eq(trips.manifestKey, "H185"));
    await expect(
      env.db.insert(trips).values({ ...t, id: undefined, tripNo: "TRP-X", manifestNo: "h 185", manifestKey: "H185" } as never),
    ).rejects.toThrow();
  });

  it("advances within the rule card's limit need no approval even with a company payment limit; above it the row is refused", async () => {
    await run(setSetting, { key: "approvals.payment_out_limits", value: { USD: "750" }, reason: "test" });
    const rows = [
      sheetRow(10, { manifest: "H-300", driver: "ئاسۆ کەریم", plate: "30 A 30001", advance: "900" }),
      sheetRow(11, { manifest: "H-301", driver: "ڕێبین ساڵح", plate: "30 A 30002", advance: "950" }),
    ];
    const plan = await planImport(env.db, env.companyId, jobId, rows);
    expect(plan.rows[0].status).toBe("new");
    expect(plan.rows[1].status).toBe("error");
    expect(plan.rows[1].notes.map((n) => n.code)).toContain("advance_above_max");
    const staged = await run(stageTripImport, { jobId, fileName: "DIESEL-3.xlsx", columns: [], rows });
    const result = await run<{ created: number; error: number }>(applyTripImport, { importId: staged.id, moneyAccountId: cashUsd });
    expect(result).toMatchObject({ created: 1, error: 1 });
    // A second advance on the same trip that would pass the limit in total is refused by the normal approval rule
    const [t] = await env.db.select().from(trips).where(eq(trips.manifestKey, "H300"));
    await expect(
      run(recordPayment, { direction: "out", purpose: "advance", moneyAccountId: cashUsd, amount: "800", currency: "USD", paymentDate: "2026-10-15", method: "cash", tripId: t.id }),
    ).rejects.toMatchObject({ code: "approval_required" });
    await run(setSetting, { key: "approvals.payment_out_limits", value: {}, reason: "test" });
  });
});
