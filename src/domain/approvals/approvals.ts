import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { approvalRequests } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { requirePermission } from "@/server/authz";
import { type Command, defineCommand } from "@/server/command";
import { Conflict, DomainError, NotFound, PermissionDenied, ValidationError } from "@/server/errors";

const approvable = new Map<string, Command<unknown, unknown>>();

/** Commands that may be submitted for approval. */
export function registerApprovable(cmd: Command<any, any>) {
  approvable.set(cmd.name, cmd as Command<unknown, unknown>);
}

function getApprovable(name: string) {
  const cmd = approvable.get(name);
  if (!cmd) throw new ValidationError(`${name} cannot be submitted for approval`);
  return cmd;
}

/** Hold an operation for approval. The requester must be allowed to perform it themselves. */
export const submitForApproval = defineCommand({
  name: "approvals.submit",
  permission: null,
  input: z.object({ command: z.string(), input: z.unknown(), summary: z.string().min(1) }),
  async handler({ tx, actor, audit }, { command, input, summary }) {
    const cmd = getApprovable(command);
    if (cmd.permission) requirePermission(actor, cmd.permission);
    const parsed = cmd.input.safeParse(input);
    if (!parsed.success) throw new ValidationError(`Invalid input for ${command}`, { issues: parsed.error.issues });
    const [row] = await tx
      .insert(approvalRequests)
      .values({ companyId: actor.companyId, branchId: actor.branchId, command, input: parsed.data as never, summary, requestedBy: actor.userId })
      .returning();
    await audit({ action: "approvals.submit", entityType: "approval_request", entityId: row.id, after: { command, summary } });
    return { id: row.id };
  },
});

/**
 * Approve (runs the held operation exactly as submitted, as the requester, with
 * the approver recorded) or reject. Nobody approves their own request.
 */
export const decideApproval = defineCommand({
  name: "approvals.decide",
  permission: "approvals.decide",
  input: z.object({ requestId: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().optional() }),
  async handler(ctx, { requestId, decision, note }) {
    const { tx, actor, audit } = ctx;
    const [req] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.companyId, actor.companyId)))
      .for("update");
    if (!req) throw new NotFound("approval_request", requestId);
    if (req.status !== "pending") throw new Conflict(`Request is already ${req.status}`);
    if (req.requestedBy === actor.userId) throw new PermissionDenied("approve_own_request");
    const decided = { decidedBy: actor.userId, decidedAt: new Date(), decisionNote: note ?? null };

    if (decision === "reject") {
      if (!note) throw new ValidationError("Say why the request is rejected");
      await tx.update(approvalRequests).set({ ...decided, status: "rejected" }).where(eq(approvalRequests.id, requestId));
      await audit({ action: "approvals.reject", entityType: "approval_request", entityId: requestId, after: { status: "rejected" }, reason: note });
      return { status: "rejected" as const };
    }

    const cmd = getApprovable(req.command);
    const requester = await loadActor(tx, req.requestedBy, req.branchId);
    let status: "approved" | "failed" = "approved";
    let result: unknown = null;
    try {
      // Savepoint: if the operation is no longer valid (e.g. invoice already paid), only it is undone.
      result = await tx.transaction(async (sp) => {
        if (cmd.permission) requirePermission(requester, cmd.permission);
        const input = cmd.input.parse(req.input);
        return cmd.handler(
          {
            tx: sp as never,
            actor: requester,
            approval: { requestId, approvedBy: actor.userId },
            // The operation's own audit events record who approved it.
            audit: (e) => ctx.audit({ ...e, approvedBy: actor.userId }),
          },
          input,
        );
      });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      status = "failed";
      result = { error: e.code, message: e.message };
    }
    await tx.update(approvalRequests).set({ ...decided, status, result: result as never }).where(eq(approvalRequests.id, requestId));
    await audit({ action: `approvals.${status === "approved" ? "approve" : "approve_failed"}`, entityType: "approval_request", entityId: requestId, after: { status, result }, reason: note });
    return { status, result };
  },
});
