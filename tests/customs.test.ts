import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, journalLines } from "@/db/schema";
import { jobProfitability } from "@/domain/finance/invoices";
import { createJob, defineJobType } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createClaim } from "@/domain/transport/claims";
import {
  bookCustoms,
  compareCustomsStatement,
  jobCustomsView,
  payCustomsAgent,
  reverseCustomsBooking,
  setCustomsRate,
  setJobCustoms,
  stageCustomsStatement,
  useStatementQuantities,
} from "@/domain/transport/customs";
import { setTerms } from "@/domain/transport/terms";
import { saveTrip } from "@/domain/transport/trip-edit";
import { tripLines } from "@/domain/transport/trip-view";
import { runCommand } from "@/server/command";
import { applyStarterConfiguration } from "@/server/starter";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown) => runCommand(env.db, env.admin, cmd as never, input) as Promise<T>;
let n = 0;
const trip = (extra: Record<string, unknown> = {}) =>
  run(saveTrip, { jobId: ids.job, manifestNo: `K-${++n}`, loadingDate: "2026-10-10", loadedQty: "30", driverName: `Driver ${n}`, plate: `22 K ${n}`, dischargeDate: "2026-10-12", dischargedQty: "30", ...extra });
const calc = async (id: string) => (await tripLines(env.db, env.companyId, { jobId: ids.job })).lines.find((l) => l.id === id)!.calc!;
const balance = async (code: string) => {
  const [acc] = await env.db.select().from(accounts).where(and(eq(accounts.companyId, env.companyId), eq(accounts.code, code)));
  const rows = await env.db.select().from(journalLines).where(eq(journalLines.accountId, acc.id));
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
});
afterAll(async () => env.close());

describe("customs duty", () => {
  it("is the customs MT (or the loaded MT) × the job's rate, a cost of the job apart from the fees", async () => {
    await run(setCustomsRate, { jobId: ids.job, effectiveFrom: "2026-10-01", rate: "9", currency: "USD" });
    const a = await trip();
    const b = await trip({ customsQty: "31" });
    expect((await calc(a.id)).customs).toMatchObject({ qty: "30", amount: "270", differs: false });
    const cb = await calc(b.id);
    expect(cb.customs).toMatchObject({ qty: "31", amount: "279", differs: true });
    expect(cb.flags).toContain("customs_qty_differs");
    expect(cb.cost).toBe("2379"); // 2,100 to the carrier + 279 customs
    expect(cb.feesTotal).toBe("0"); // never mixed with the fees
    ids.a = a.id;
    ids.b = b.id;
  });

  it("the border person is paid in lump sums; booking the trucks' duty draws on that money", async () => {
    await expect(run(payCustomsAgent, { jobId: ids.job, amount: "20000", moneyAccountId: ids.cash, paymentDate: "2026-10-05" })).rejects.toThrow(/customs agent first/);
    await run(setJobCustoms, { jobId: ids.job, agentName: "Kak Aras" });
    await run(payCustomsAgent, { jobId: ids.job, amount: "20000", moneyAccountId: ids.cash, paymentDate: "2026-10-05" });
    await run(payCustomsAgent, { jobId: ids.job, amount: "10000", moneyAccountId: ids.cash, paymentDate: "2026-10-09" });
    const r = await run<{ bookings: { total: string; trips: number }[] }>(bookCustoms, { jobId: ids.job, bookingDate: "2026-10-31" });
    expect(r.bookings).toEqual([expect.objectContaining({ total: "549", trips: 2 })]);
    expect(await balance("5600")).toBe(549);
    const view = await jobCustomsView(env.db, env.companyId, ids.job);
    expect(view.balance).toEqual({ USD: "29451" }); // 30,000 paid − 549 duty: still with him
    expect(view.totals[0]).toMatchObject({ trucks: 2, qty: "61", duty: "549", unbookedTrucks: 0, differs: 1 });
    // Nothing left to book.
    await expect(run(bookCustoms, { jobId: ids.job, bookingDate: "2026-10-31" })).rejects.toThrow(/No customs to book/);
  });

  it("a booked truck's customs MT is locked until its booking is reversed", async () => {
    await expect(run(saveTrip, { tripId: ids.b, customsQty: "32" })).rejects.toThrow(/customs is already booked/);
    const view = await jobCustomsView(env.db, env.companyId, ids.job);
    await run(reverseCustomsBooking, { bookingId: view.bookings[0].id, reversalDate: "2026-11-01", reason: "wrong MT" });
    expect(await balance("5600")).toBe(0);
    await run(saveTrip, { tripId: ids.b, customsQty: "32" });
    expect((await calc(ids.b)).customs!.amount).toBe("288");
  });

  it("the agent's statement is compared truck by truck; his MT can be taken for the trucks that differ", async () => {
    const st = await run(stageCustomsStatement, {
      jobId: ids.job,
      fileName: "aras-october.xlsx",
      rows: [
        { rowNo: 2, manifest: "K-1", quantity: "30", amount: "270" },
        { rowNo: 3, manifest: "K-2", quantity: "31.5" },
        { rowNo: 4, manifest: "K-99", quantity: "30" },
      ],
    });
    const c = await compareCustomsStatement(env.db, env.companyId, st.id);
    expect(c.lines.map((l) => l.status)).toEqual(["match", "qty_differs", "not_found"]);
    expect(c.counts).toMatchObject({ match: 1, qty_differs: 1, not_found: 1 });
    await run(useStatementQuantities, { statementId: st.id, tripIds: [ids.b] });
    expect((await calc(ids.b)).customs).toMatchObject({ qty: "31.5", amount: "283.5" });
  });

  it("shows on its own line in the job's profit, apart from the carriers and the fees", async () => {
    await run(bookCustoms, { jobId: ids.job, bookingDate: "2026-11-02" });
    await run(createClaim, { jobId: ids.job, claimantId: ids.zagros, claimDate: "2026-11-02", manifests: ["K-1", "K-2"] });
    const [p] = await jobProfitability(env.db, ids.job);
    expect(p.lines.map((l) => [l.code, l.amount])).toEqual([["5000", "4200"], ["5600", "553.5"]]);
    expect(p.costs).toBe("4753.5");
  });
});
