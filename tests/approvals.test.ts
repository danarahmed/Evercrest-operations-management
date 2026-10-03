import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalRequests, auditEvents, payments } from "@/db/schema";
import { createAccount } from "@/domain/accounting/ledger";
import { decideApproval, submitForApproval } from "@/domain/approvals/approvals";
import { createMoneyAccount, recordPayment } from "@/domain/finance/payments";
import { assignRole, createUser, defineRole } from "@/domain/org/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz";
import { runCommand } from "@/server/command";
import { setSetting } from "@/server/settings";
import { freshDb } from "./helpers";

let env: Awaited<ReturnType<typeof freshDb>>;
let clerk: Actor;
const ids: Record<string, string> = {};
const run = <T = { id: string }>(cmd: unknown, input: unknown, actor?: Actor) => runCommand(env.db, actor ?? env.admin, cmd as never, input) as Promise<T>;

beforeAll(async () => {
  env = await freshDb();
  const exp = (await run(createAccount, { code: "5100", name: "Expenses", type: "expense" })).id;
  const cash = (await run(createAccount, { code: "1011", name: "Cash USD", type: "asset", currency: "USD" })).id;
  ids.exp = exp;
  ids.cash = (await run(createMoneyAccount, { name: "Safe USD", kind: "cash", currency: "USD", ledgerAccountId: cash })).id;
  ids.vendor = (await run(createPartner, { kind: "organization", name: "Garage", roles: ["supplier"] })).id;
  await run(setSetting, { key: "approvals.payment_out_limits", value: { USD: "1000" }, reason: "policy" });
  const u = await run(createUser, { email: "clerk@test.local", displayName: "Clerk" });
  const role = await run(defineRole, { code: "clerk", name: "Clerk", permissions: ["payments.create"], reason: "setup" });
  await run(assignRole, { userId: u.id, roleId: role.id, grant: true, reason: "setup" });
  clerk = await loadActor(env.db, u.id);
});
afterAll(async () => env.close());

const expense = (amount: string) => ({
  direction: "out", purpose: "expense", moneyAccountId: ids.cash, amount, currency: "USD",
  paymentDate: "2026-10-03", method: "cash", counterAccountId: ids.exp, partnerId: ids.vendor,
});

describe("payment approvals", () => {
  it("pays below the limit directly", async () => {
    await expect(run(recordPayment, expense("400"), clerk)).resolves.toBeTruthy();
  });

  it("counts same-day payments to the same payee, so splitting does not bypass the limit", async () => {
    await expect(run(recordPayment, expense("700"), clerk)).rejects.toMatchObject({
      code: "approval_required",
      details: { total: "1100", alreadyPaidToday: "400" },
    });
  });

  it("holds the payment until a different person approves it, then runs it exactly as submitted", async () => {
    const req = await run(submitForApproval, { command: "payments.record", input: expense("700"), summary: "Truck repair" }, clerk);
    const before = (await env.db.select().from(payments)).length;
    // The requester cannot approve, even with the permission
    await expect(run(decideApproval, { requestId: req.id, decision: "approve" }, { ...clerk, permissions: new Set(["approvals.decide"]) })).rejects.toMatchObject({ code: "permission_denied" });
    const r = await run<{ status: string }>(decideApproval, { requestId: req.id, decision: "approve", note: "invoice seen" });
    expect(r).toMatchObject({ status: "approved" });
    expect((await env.db.select().from(payments)).length).toBe(before + 1);
    const evs = await env.db.select().from(auditEvents).where(eq(auditEvents.action, "payments.record"));
    expect(evs.map((e) => e.approvedBy)).toEqual([null, env.admin.userId]);
    await expect(run(decideApproval, { requestId: req.id, decision: "approve" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("requires a reason to reject, and a requester needs the underlying permission", async () => {
    const req = await run(submitForApproval, { command: "payments.record", input: expense("5000"), summary: "Big one" }, clerk);
    await expect(run(decideApproval, { requestId: req.id, decision: "reject" })).rejects.toThrow(/why/);
    await run(decideApproval, { requestId: req.id, decision: "reject", note: "no quotation" });
    const [row] = await env.db.select().from(approvalRequests).where(eq(approvalRequests.id, req.id));
    expect(row.status).toBe("rejected");
    const nobody = { ...clerk, permissions: new Set<string>() };
    await expect(run(submitForApproval, { command: "payments.record", input: expense("5000"), summary: "x" }, nobody)).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("marks the request failed (and pays nothing) if it is no longer valid when approved", async () => {
    const bad = { ...expense("2000"), counterAccountId: "00000000-0000-0000-0000-000000000000" };
    const req = await run(submitForApproval, { command: "payments.record", input: bad, summary: "x" }, clerk);
    const before = (await env.db.select().from(payments)).length;
    const r = await run<{ status: string }>(decideApproval, { requestId: req.id, decision: "approve" });
    expect(r.status).toBe("failed");
    expect((await env.db.select().from(payments)).length).toBe(before);
  });
});
