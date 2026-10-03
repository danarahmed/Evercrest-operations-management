import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trips, trucks } from "@/db/schema";
import { changeJobStatus, createJob, defineJobType, getJob, nextAction, setJobCapabilities } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { cancelTrip, createTrip, getTrip, plateKey, quantityDifference, recordDischarge, recordLoading } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil Co", roles: ["customer"] })).id;
  ids.transA = (await run(createPartner, { kind: "organization", name: "Company A", roles: ["transporter"] })).id;
  ids.transB = (await run(createPartner, { kind: "organization", name: "Company B", roles: ["transporter"] })).id;
  ids.type = (await run(defineJobType, { code: "PTR", name: "Petroleum transportation", defaultCapabilities: ["transportation"] })).id;
  ids.general = (await run(defineJobType, { code: "GEN", name: "General", defaultCapabilities: [] })).id;
});
afterAll(async () => env.close());

const newJob = (typeId = ids.type) =>
  run<{ id: string }>(createJob, { customerId: ids.customer, jobTypeId: typeId, name: "Fuel delivery", startDate: "2026-10-01", responsibleUserId: env.admin.userId });

describe("trips", () => {
  it("starts with only a driver name and a plate; the transporter is optional (scenario C)", async () => {
    const job = await newJob();
    const t = await run<{ id: string; tripNo: string; driverId: string }>(createTrip, { jobId: job.id, newDriverName: "Ahmed", truckPlate: "12 B 34567" });
    expect(t.tripNo).toMatch(/^TRP-\d{4}-00001$/);
    const trip = await getTrip(env.db, env.companyId, t.id);
    expect(trip.transporterId).toBeNull();
    expect(trip.loadedQty).toBeNull();
    ids.ahmed = t.driverId;
  });

  it("keeps the transporter per trip, so a driver changing transporter does not rewrite history (scenario D)", async () => {
    const job = await newJob();
    const t1 = await run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "12-B-34567", transporterId: ids.transA });
    const t2 = await run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "١٢ب٣٤٥٦٧", transporterId: ids.transB });
    expect((await getTrip(env.db, env.companyId, t1.id)).transporterId).toBe(ids.transA);
    expect((await getTrip(env.db, env.companyId, t2.id)).transporterId).toBe(ids.transB);
    // Same physical truck despite different spellings of the plate
    expect(plateKey("١٢ب٣٤٥٦٧")).toBe("12ب34567");
    expect(await env.db.select().from(trucks).where(eq(trucks.plateKey, plateKey("12 B 34567")))).toHaveLength(1);
  });

  it("refuses trips on jobs without the transportation capability (scenario E stays simple)", async () => {
    const job = await newJob(ids.general);
    await expect(run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "X1" })).rejects.toThrow(/not enabled/);
  });

  it("refuses a transporter that is not a transporter", async () => {
    const job = await newJob();
    await expect(run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "X2", transporterId: ids.customer })).rejects.toThrow(/not marked as a transporter/);
  });
});

describe("quantities", () => {
  it("reports missing quantities instead of zero, and compares across units of the same kind", async () => {
    const job = await newJob();
    const t = await run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "Q1" });
    expect(await quantityDifference(env.db, await getTrip(env.db, env.companyId, t.id))).toEqual({ status: "missing", missing: ["loaded", "discharged"] });
    await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-02", loadedQty: "30", loadedUnit: "MT" });
    expect(await quantityDifference(env.db, await getTrip(env.db, env.companyId, t.id))).toEqual({ status: "missing", missing: ["discharged"] });
    await run(recordDischarge, { tripId: t.id, dischargeDate: "2026-10-05", dischargedQty: "29750", dischargedUnit: "KG" });
    expect(await quantityDifference(env.db, await getTrip(env.db, env.companyId, t.id))).toEqual({ status: "known", difference: "0.25", unit: "MT" });
  });

  it("does not compare litres with kilograms", async () => {
    const job = await newJob();
    const t = await run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "Q2" });
    await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-02", loadedQty: "36000", loadedUnit: "L" });
    await run(recordDischarge, { tripId: t.id, dischargeDate: "2026-10-04", dischargedQty: "30000", dischargedUnit: "KG" });
    expect((await quantityDifference(env.db, await getTrip(env.db, env.companyId, t.id))).status).toBe("incomparable");
  });

  it("validates dates and requires a reason to correct", async () => {
    const job = await newJob();
    const t = await run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "Q3" });
    await expect(run(recordDischarge, { tripId: t.id, dischargeDate: "2026-10-05", dischargedQty: "1", dischargedUnit: "MT" })).rejects.toThrow(/loading before/);
    await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-05", loadedQty: "30", loadedUnit: "MT" });
    await expect(run(recordDischarge, { tripId: t.id, dischargeDate: "2026-10-04", dischargedQty: "30", dischargedUnit: "MT" })).rejects.toThrow(/before the loading/);
    await expect(run(recordLoading, { tripId: t.id, loadingDate: "2026-10-05", loadedQty: "31", loadedUnit: "MT" })).rejects.toThrow(/reason/);
    await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-05", loadedQty: "31", loadedUnit: "MT", reason: "weighbridge ticket corrected" });
    expect((await getTrip(env.db, env.companyId, t.id)).loadedQty).toBe("31.0000");
  });
});

describe("job integration", () => {
  it("shows the next action from trips and blocks completion until discharge (scenario B)", async () => {
    const job = await newJob();
    const t = await run<{ id: string; tripNo: string }>(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "J1" });
    expect(await nextAction(env.db, await getJob(env.db, env.companyId, job.id))).toBe(`Waiting for loading of ${t.tripNo}`);
    await run(recordLoading, { tripId: t.id, loadingDate: "2026-10-02", loadedQty: "30", loadedUnit: "MT" });
    expect(await nextAction(env.db, await getJob(env.db, env.companyId, job.id))).toBe(`Waiting for discharge of ${t.tripNo}`);
    await expect(run(changeJobStatus, { jobId: job.id, status: "completed" })).rejects.toMatchObject({ code: "validation" });
    await expect(run(setJobCapabilities, { jobId: job.id, capabilities: [] })).rejects.toMatchObject({ code: "conflict" });
    await run(recordDischarge, { tripId: t.id, dischargeDate: "2026-10-03", dischargedQty: "30", dischargedUnit: "MT" });
    await run(changeJobStatus, { jobId: job.id, status: "completed" });
  });

  it("cancelled trips do not block, and a discharged trip cannot be cancelled", async () => {
    const job = await newJob();
    const t = await run(createTrip, { jobId: job.id, driverId: ids.ahmed, truckPlate: "J2" });
    await run(cancelTrip, { tripId: t.id, reason: "truck broke down" });
    await run(changeJobStatus, { jobId: job.id, status: "completed" });
    const rows = await env.db.select().from(trips).where(eq(trips.status, "discharged")).limit(1);
    await expect(run(cancelTrip, { tripId: rows[0].id, reason: "x" })).rejects.toMatchObject({ code: "conflict" });
  });
});
