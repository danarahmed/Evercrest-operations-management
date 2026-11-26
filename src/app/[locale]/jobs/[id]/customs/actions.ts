"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import "@/domain/register";
import { stageCustomsStatement } from "@/domain/transport/customs";
import { runCommand } from "@/server/command";
import { parseCustomsSheet } from "@/server/customs-sheet";
import { DomainError } from "@/server/errors";
import { currentActor } from "@/server/session";

export interface UploadState {
  error?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Read the border person's statement, keep it, and go to the comparison. Nothing changes until someone chooses to. */
export async function uploadCustomsSheet(_prev: UploadState, form: FormData): Promise<UploadState> {
  const locale = String(form.get("locale") ?? "en");
  const jobId = String(form.get("jobId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "no_file" };
  if (file.size > MAX_BYTES) return { error: "too_large" };
  const actor = await currentActor(locale);
  let id: string;
  try {
    const rows = await parseCustomsSheet(await file.arrayBuffer());
    const r = await runCommand(getDb(), actor, stageCustomsStatement, { jobId, fileName: file.name.slice(0, 200), rows }, { idempotencyKey: String(form.get("key") ?? crypto.randomUUID()) });
    id = r.id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(`/${locale}/jobs/${jobId}/customs/${id}`);
}
