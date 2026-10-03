import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { journalLines, payments } from "@/db/schema";
import { createAccount } from "@/domain/accounting/ledger";
import { createMoneyAccount, moneyAccountBalance, recordPayment, reversePayment, tripAdvances } from "@/domain/finance/payments";
import { changeJobStatus, createJob, defineJobType, setJobCapabilities } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { createTrip } from "@/domain/transport/trips";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown, key?: string) =>
  runCommand(env.db, env.admin, cmd as never, input, { idempotencyKey: key }) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const acc = async (code: string, type: string, currency?: string) => (await run(createAccount, { code, name: code, type, currency })).id;
  ids.cashUsdAcc = await acc("1011", "asset", "USD");
  ids.cashIqdAcc = await acc("1012", "asset", "IQD");
  await acc("1300", "asset");
  ids.cashUsd = (await run(createMoneyAccount, { name: "Main safe USD", kind: "cash", currency: "USD", ledgerAccountId: ids.cashUsdAcc })).id;
  ids.cashIqd = (await run(createMoneyAccount, { name: "Main safe IQD", kind: "cash", currency: "IQD", ledgerAccountId: ids.cashIqdAcc })).id;
  ids.customer = (await run(createPartner, { kind: "organization", name: "North Oil", roles: ["customer"] })).id;
  ids.transporter = (await run(createPartner, { kind: "organization", name: "Company A", roles: ["transporter"] })).id;
  const type = (await run(defineJobType, { code: "PTR", name: "Transport", defaultCapabilities: ["transportation", "advances"] })).id;
  ids.job = (await run(createJob, { customerId: ids.customer, jobTypeId: type, name: "Fuel", startDate: "2026-10-01", responsibleUserId: env.admin.userId })).id;
  const trip = await run<{ id: string; driverId: string }>(createTrip, { jobId: ids.job, newDriverName: "Ahmed", truckPlate: "P1", transporterId: ids.transporter });
  ids.trip = trip.id;
  ids.driver = trip.driverId;
});
afterAll(async () => env.close());

const advance = (amount: string, currency = "USD", extra: object = {}) => ({
  direction: "out", purpose: "advance", moneyAccountId: currency === "USD" ? ids.cashUsd : ids.cashIqd,
  amount, currency, paymentDate: "2026-10-02", method: "cash", tripId: ids.trip, ...extra,
});

describe("advances", () => {
  it("refuses to post until the advances account is configured (no guessing)", async () => {
    await expect(run(recordPayment, advance("100"))).rejects.toThrow(/"advances" is not configured/);
    await run(setSetting, { key: "accounting.posting_accounts", value: { advances: "1300" }, reason: "setup" });
  });

  it("posts multiple advances per trip in both currencies, kept separate", async () => {
    const a = await run<{ id: string; journalEntryId: string; paymentNo: string }>(recordPayment, advance("200"));
    await run(recordPayment, advance("150"));
    await run(recordPayment, advance("250000", "IQD"));
    expect(await tripAdvances(env.db, env.companyId, ids.trip)).toEqual({ USD: "350", IQD: "250000" });
    expect(await moneyAccountBalance(env.db, ids.cashUsd)).toBe("-350");
    const lines = await env.db.select().from(journalLines).where(eq(journalLines.entryId, a.journalEntryId));
    const debit = lines.find((l) => l.debit !== "0.0000")!;
    expect(debit.partnerId).toBe(ids.driver); // advance sits on the driver's sub-ledger
    expect(debit.jobId).toBe(ids.job); // and on the job for profitability
  });

  it("can be paid to the trip's transporter, but not to an unrelated partner", async () => {
    await run(recordPayment, advance("50", "USD", { partnerId: ids.transporter }));
    await expect(run(recordPayment, advance("50", "USD", { partnerId: ids.customer }))).rejects.toThrow(/driver or transporter/);
  });

  it("refuses a currency the cash box does not hold", async () => {
    await expect(run(recordPayment, advance("100", "USD", { moneyAccountId: ids.cashIqd }))).rejects.toThrow(/holds IQD/);
  });

  it("is not duplicated by a retried request", async () => {
    const before = (await env.db.select().from(payments)).length;
    const a = await run(recordPayment, advance("75"), "adv-retry-1");
    const b = await run(recordPayment, advance("75"), "adv-retry-1");
    expect(b).toEqual(a);
    expect((await env.db.select().from(payments)).length).toBe(before + 1);
  });

  it("is corrected by reversal; totals and cash drop back", async () => {
    const before = await tripAdvances(env.db, env.companyId, ids.trip);
    const p = await run(recordPayment, advance("1000"));
    await run(reversePayment, { paymentId: p.id, reversalDate: "2026-10-03", reason: "paid twice by mistake" });
    expect(await tripAdvances(env.db, env.companyId, ids.trip)).toEqual(before);
    await expect(run(reversePayment, { paymentId: p.id, reversalDate: "2026-10-03", reason: "again" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("locks the advances capability and blocks job cancellation while advances exist", async () => {
    await expect(run(setJobCapabilities, { jobId: ids.job, capabilities: ["transportation"] })).rejects.toMatchObject({ code: "conflict" });
    await expect(run(changeJobStatus, { jobId: ids.job, status: "cancelled", reason: "x" })).rejects.toMatchObject({ code: "conflict" });
  });
});
