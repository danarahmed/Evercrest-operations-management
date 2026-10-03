import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import type { Db } from "@/db/client";
import { auditEvents, idempotencyKeys } from "@/db/schema";
import { type Actor, type Permission, requirePermission } from "./authz";
import { Conflict, ValidationError, fromDbError } from "./errors";

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvedBy?: string | null;
}

export interface CommandContext {
  tx: Db;
  actor: Actor;
  audit(event: AuditInput): Promise<void>;
  /** Set when this run executes an approved request. */
  approval?: { requestId: string; approvedBy: string };
}

export interface Command<I, O> {
  /** Stable name, e.g. "ledger.post_entry". Part of the idempotency fingerprint. */
  name: string;
  /** Null only for commands that authorize internally (e.g. bootstrap). */
  permission: Permission | null;
  input: ZodType<I>;
  handler(ctx: CommandContext, input: I): Promise<O>;
}

export function defineCommand<I, O>(cmd: Command<I, O>): Command<I, O> {
  return cmd;
}

export interface RunOptions {
  /** Client-generated key; a retry with the same key returns the original result. */
  idempotencyKey?: string;
  /** Internal: run on behalf of an approved request (see domain/approvals). */
  approval?: { requestId: string; approvedBy: string };
}

/**
 * The single entry point for state changes. In one database transaction:
 * validate → authorize → claim idempotency key → run → audit → store result.
 * Every command must record at least one audit event.
 */
export async function runCommand<I, O>(
  db: Db,
  actor: Actor,
  cmd: Command<I, O>,
  rawInput: unknown,
  opts: RunOptions = {},
): Promise<O> {
  const parsed = cmd.input.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(`Invalid input for ${cmd.name}`, { issues: parsed.error.issues });
  }
  const input = parsed.data;
  if (cmd.permission) requirePermission(actor, cmd.permission);
  const key = opts.idempotencyKey;
  const requestHash = createHash("sha256").update(cmd.name).update(stableJson(input)).digest("hex");

  try {
    return await db.transaction(async (tx) => {
      if (key) {
        const claimed = await tx
          .insert(idempotencyKeys)
          .values({ companyId: actor.companyId, key, command: cmd.name, requestHash })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key });
        if (claimed.length === 0) {
          // Another request with this key already committed (a concurrent one waits on the row lock).
          const [prior] = await tx
            .select()
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.companyId, actor.companyId), eq(idempotencyKeys.key, key)));
          if (!prior || prior.command !== cmd.name || prior.requestHash !== requestHash) {
            throw new Conflict("Idempotency key was already used for a different request", { key });
          }
          return prior.response as O;
        }
      }

      let audited = 0;
      const ctx: CommandContext = {
        tx: tx as unknown as Db,
        actor,
        approval: opts.approval,
        audit: async (e) => {
          audited++;
          await tx.insert(auditEvents).values({
            companyId: actor.companyId,
            branchId: actor.branchId,
            actorUserId: actor.userId,
            action: e.action,
            entityType: e.entityType,
            entityId: e.entityId ?? null,
            before: e.before ?? null,
            after: e.after ?? null,
            reason: e.reason ?? null,
            approvedBy: e.approvedBy ?? opts.approval?.approvedBy ?? null,
            idempotencyKey: key ?? null,
          });
        },
      };

      const result = await cmd.handler(ctx, input);
      if (audited === 0) throw new Error(`command ${cmd.name} did not record an audit event`);
      if (key) {
        await tx
          .update(idempotencyKeys)
          .set({ response: (result ?? null) as never })
          .where(and(eq(idempotencyKeys.companyId, actor.companyId), eq(idempotencyKeys.key, key)));
      }
      // Surface deferred constraint violations (e.g. unbalanced journal) inside this call.
      await tx.execute(sql`set constraints all immediate`);
      return result;
    });
  } catch (err) {
    throw fromDbError(err);
  }
}

/** JSON with sorted keys, so equal inputs always hash equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
