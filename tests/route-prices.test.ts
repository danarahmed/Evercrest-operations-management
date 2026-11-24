import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { setRoutePrice, setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { tripLines } from "@/domain/transport/trip-view";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
let n = 0;
const trip = (route: string, date: string, discharged = "30") =>
  run(saveTrip, { jobId: ids.job, manifestNo: `R-${++n}`, routeName: route, loadingDate: date, loadedQty: "30", driverName: "Hemin", plate: "22 C 1", dischargeDate: date, dischargedQty: discharged });

beforeAll(async () => {
  env = await freshDb();
  await applyStarterConfiguration(env.db, env.admin);
  const customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  const type = (await run(defineJobType, { name: "Transport", defaultCapabilities: ["transportation"] })).id;
  ids.job = (await run(createJob, { customerId: customer, jobTypeId: type, name: "Diesel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  // Job-wide: 70 per MT, reward 10, allowance 0.15, fine 1,200.
  await run(setTerms, { jobId: ids.job, effectiveFrom: "2026-10-01", currency: "USD", unit: "MT", carrierPrice: "70", rewardPerTrip: "10", carrierAllowance: "0.15", carrierFinePrice: "1200" });
});
afterAll(async () => env.close());

const calcOf = async (id: string) => (await tripLines(env.db, env.companyId, { jobId: ids.job })).lines.find((l) => l.id === id)!.calc!.carrier;

describe("prices by route", () => {
  it("a route's own price, reward and allowance win from their date; everything else stays job-wide", async () => {
    // A new route typed by name, with its own price and reward from 15 October, and a wider allowance.
    const r = await run<{ routeId: string }>(setRoutePrice, { jobId: ids.job, routeName: "Erbil – Latakia", effectiveFrom: "2026-10-15", carrierPrice: "85", rewardPerTrip: "20", carrierAllowance: "0.3" });
    expect(r.routeId).toBeTruthy();
    const before = await trip("Erbil – Latakia", "2026-10-10");
    const after = await trip("Erbil – Latakia", "2026-10-20", "29.75"); // 0.25 short: inside the route's 0.3 allowance
    const other = await trip("Erbil – Baghdad", "2026-10-20", "29.75"); // job-wide 0.15 allowance: 0.1 fined
    expect(await calcOf(before.id)).toMatchObject({ freight: "2100", reward: "10" }); // loaded before the route price: job-wide
    expect(await calcOf(after.id)).toMatchObject({ freight: "2528.75", reward: "20", fine: "0" }); // 29.75 × 85
    expect(await calcOf(other.id)).toMatchObject({ freight: "2082.5", reward: "10", fine: "-120" }); // 29.75 × 70; 0.1 × 1,200
  });

  it("a later line for the route replaces it from its date; older trips keep their price", async () => {
    await run(setRoutePrice, { jobId: ids.job, routeName: "Erbil – Latakia", effectiveFrom: "2026-11-01", carrierPrice: "90" });
    const nov = await trip("Erbil – Latakia", "2026-11-02");
    expect(await calcOf(nov.id)).toMatchObject({ freight: "2700", reward: "10" }); // reward not set on the new line: job-wide
  });
});
