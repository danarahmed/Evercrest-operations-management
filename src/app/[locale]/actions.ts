"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { submitForApproval } from "@/domain/approvals/approvals";
import { runCommand } from "@/server/command";
import { DomainError } from "@/server/errors";
import { currentActor } from "@/server/session";
import { UI_COMMANDS } from "@/server/ui-commands";

export interface FormState {
  ok?: boolean;
  error?: { code: string; message: string; issues?: { path: string; message: string }[] };
  /** The operation exceeds a limit and can be sent for approval. */
  approvalRequired?: boolean;
  /** Fresh key for the next submission after a success. */
  nextKey?: string;
}

/** Turn form fields into plain input: "" → absent, "a[]" → array. */
function toInput(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // "__target" = "<entityType>:<entityId>" (one select choosing what a record belongs to)
  const target = form.get("__target");
  if (typeof target === "string" && target.includes(":")) {
    const [entityType, entityId] = target.split(":");
    Object.assign(out, { entityType, entityId });
  }
  for (const [k, v] of form.entries()) {
    if (k.startsWith("__") || typeof v !== "string") continue;
    if (k.endsWith("[]")) {
      // Arrays keep empty entries so parallel columns (e.g. invoice lines) stay aligned.
      const key = k.slice(0, -2);
      out[key] = [...((out[key] as string[]) ?? []), v.trim()];
    } else if (v.trim() !== "") out[k] = v.trim();
  }
  return out;
}

/**
 * The single entry point for every form. The idempotency key is generated when
 * the form is rendered, so double clicks, refreshes and network retries of the
 * same submission can never create a second record.
 */
export async function submitCommand(_prev: FormState, form: FormData): Promise<FormState> {
  const locale = String(form.get("__locale") ?? "en");
  const name = String(form.get("__command"));
  const key = String(form.get("__key"));
  const entry = UI_COMMANDS[name];
  if (!entry) return { error: { code: "not_allowed", message: "This action is not available" } };
  const actor = await currentActor(locale);
  const db = getDb();
  let input = toInput(form);
  if (entry.prepare) input = await entry.prepare(db, actor, input);
  let result: unknown;
  try {
    if (form.get("__mode") === "approval") {
      await runCommand(db, actor, submitForApproval, { command: name, input, summary: String(form.get("__summary") || name) }, { idempotencyKey: `${key}:approval` });
    } else {
      result = await runCommand(db, actor, entry.command, input, { idempotencyKey: key });
    }
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    const issues = (e.details?.issues as { path: (string | number)[]; message: string }[] | undefined)?.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { error: { code: e.code, message: e.message, issues }, approvalRequired: e.code === "approval_required" };
  }
  revalidatePath(`/${locale}`, "layout");
  // Optional: go to the created record, e.g. "/en/jobs/{id}". Only same-app paths.
  const to = form.get("__redirect");
  const id = (result as { id?: string } | undefined)?.id;
  if (typeof to === "string" && to.startsWith(`/${locale}/`) && id) redirect(to.replace("{id}", id));
  return { ok: true, nextKey: crypto.randomUUID() };
}
