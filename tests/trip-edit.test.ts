import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { setTerms } from "@/domain/transport/terms";
import { saveTrip, tripHistory } from "@/domain/transport/trip-edit";
import { saveTripRows } from "@/domain/transport/trip-import";
import { tripLines } from "@/domain/transport/trip-view";
import { auditEvents, trips } from "@/db/schema";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
let jobId: string;
let cashUsd: string;
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const starter = await applyStarterConfiguration(env.db, env.admin);
  cashUsd = starter.moneyAccounts.usd;
  const customer = await run(createPartner, { kind: "organization", name: "Customer", roles: ["customer"] });
  const type = await run(defineJobType, { code: "PTR", name: "PTR", defaultCapabilities: ["transportation", "advances"] });
  jobId = (await run(createJob, { customerId: customer.id, jobTypeId: type.id, name: "Diesel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  await run(setTerms, { jobId, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", customerPrice: "120", carrierPrice: "70", carrierAllowance: "0.15", carrierFinePrice: "1200", advanceMax: "900" });
});
afterAll(async () => env.close());

describe("one screen for a trip", () => {
  let tripId: string;
  it("creates a trip from one form: new driver, new transporter, new route, advance from a cash box", async () => {
    const r = await run(saveTrip, { jobId, manifestNo: "H-900", routeName: "Erbil – Latakia", loadingDate: "2026-10-14", loadedQty: "30.5", driverName: "Hemin Aziz", transporterName: "Masoud", plate: "33 C 12345", advanceAmount: "900", advanceMoneyAccountId: cashUsd });
    tripId = r.id;
    const { lines } = await tripLines(env.db, env.companyId, { jobId });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ manifestNo: "H-900", driver: "Hemin Aziz", transporter: "Masoud", route: "Erbil – Latakia", state: "estimated" });
    expect(lines[0].calc!.carrier.toPay).toBe("1235"); // 30.5 × 70 − 900
  });

  it("the same manifest cannot be entered twice on the job", async () => {
    await expect(run(saveTrip, { jobId, manifestNo: "h 900", loadingDate: "2026-10-14", loadedQty: "30", driverName: "Other", plate: "1 A 1" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("staff correct a saved trip directly; the history shows who changed what, from what to what", async () => {
    await run(saveTrip, { tripId, loadedQty: "30.2", dischargeDate: "2026-10-20", dischargedQty: "30.0", reason: "manifest says 30.2" });
    const { changes } = await tripHistory(env.db, env.companyId, tripId);
    const change = changes.find((c) => c.e.action === "trips.save" && c.e.before)!;
    expect(change.e.before).toMatchObject({ loadedQty: "30.5000", dischargedQty: null, status: "loaded" });
    expect(change.e.after).toMatchObject({ loadedQty: "30.2", dischargedQty: "30.0", status: "discharged" });
    expect(change.e.reason).toBe("manifest says 30.2");
    expect(change.by).toBe("Admin");
    const { lines } = await tripLines(env.db, env.companyId, { jobId });
    expect(lines[0].state).toBe("confirmed");
    expect(lines[0].calc!.carrier.fine).toBe("-60"); // (30.0 − 30.2 + 0.15) × 1200
  });

  it("an unchanged save records nothing; a price equal to the rule card is not stored as an override", async () => {
    const changes = async () => (await env.db.select().from(auditEvents).where(and(eq(auditEvents.entityId, tripId), eq(auditEvents.action, "trips.save")))).length;
    const before = await changes();
    await run(saveTrip, { tripId, carrierPriceOverride: "70" });
    expect(await changes()).toBe(before);
    expect((await tripHistory(env.db, env.companyId, tripId)).changes.every((c) => c.e.action !== "trips.save_unchanged")).toBe(true);
    const [t] = await env.db.select().from(trips).where(eq(trips.id, tripId));
    expect(t.carrierPriceOverride).toBeNull();
  });

  it("clearing the transporter makes the trip direct", async () => {
    await run(saveTrip, { tripId, transporterId: null });
    const [t] = await env.db.select().from(trips).where(eq(trips.id, tripId));
    expect(t.transporterId).toBeNull();
  });
});

describe("grid entry and spreadsheet filters", () => {
  it("saves several typed rows at once; a row with an error stops the whole batch", async () => {
    const rows = (over: Record<string, string>[]) => over.map((o, i) => ({ rowNo: i + 1, values: { loadingDate: "2026-10-15", route: "Erbil – Homs", carrierPrice: "70", advance: "900", transporter: "Rekan", loadedQty: "30", ...o }, fees: {} }));
    await expect(run(saveTripRows, { jobId, moneyAccountId: cashUsd, rows: rows([{ manifest: "H-901", driver: "A", plate: "2 A 2" }, { manifest: "H-901", driver: "B", plate: "3 A 3" }]) })).rejects.toMatchObject({ code: "validation" });
    const r = await run<{ created: number }>(saveTripRows, { jobId, moneyAccountId: cashUsd, rows: rows([{ manifest: "H-901", driver: "Ali", plate: "2 A 2" }, { manifest: "H-902", driver: "Bakr", plate: "3 A 3", dischargeDate: "2026-10-21", dischargedQty: "29.5" }]) });
    expect(r.created).toBe(2);
  });

  it("filters combine: route, transporter, state, chips, text; totals follow the filtered rows; sorting works", async () => {
    const all = await tripLines(env.db, env.companyId, { jobId });
    expect(all.total).toBe(3);
    const homs = all.options.routes.find((r) => r.name === "Erbil – Homs")!;
    const rekan = all.options.transporters.find((r) => r.name === "Rekan")!;
    const byRoute = await tripLines(env.db, env.companyId, { jobId, routeIds: [homs.id] });
    expect(byRoute.total).toBe(2);
    expect(byRoute.totals[0].trips).toBe(2);
    const confirmedRekan = await tripLines(env.db, env.companyId, { jobId, transporterIds: [rekan.id], states: ["confirmed"] });
    expect(confirmedRekan.lines.map((l) => l.manifestNo)).toEqual(["H-902"]);
    const direct = await tripLines(env.db, env.companyId, { jobId, direct: true });
    expect(direct.lines.map((l) => l.manifestNo)).toEqual(["H-900"]);
    const noDischarge = await tripLines(env.db, env.companyId, { jobId, chips: ["nodischarge"] });
    expect(noDischarge.lines.map((l) => l.manifestNo)).toEqual(["H-901"]);
    const text = await tripLines(env.db, env.companyId, { jobId, q: "bakr" });
    expect(text.total).toBe(1);
    const sorted = await tripLines(env.db, env.companyId, { jobId, sort: "toPay", dir: "desc" });
    const pays = sorted.lines.map((l) => Number(l.calc!.carrier.toPay));
    expect(pays).toEqual([...pays].sort((a, b) => b - a));
    const paged = await tripLines(env.db, env.companyId, { jobId, pageSize: 10, page: 1 });
    expect(paged.lines).toHaveLength(3);
  });

  it("the company-wide view spans jobs and can be limited to some of them", async () => {
    const company = await tripLines(env.db, env.companyId, {});
    expect(company.total).toBe(3);
    expect(company.options.jobs).toHaveLength(1);
    const limited = await tripLines(env.db, env.companyId, { jobIds: [company.options.jobs[0].id] });
    expect(limited.total).toBe(3);
  });
});
