"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import "@/domain/register";
import { stageRemoteSettlement } from "@/domain/transport/remote";
import { runCommand } from "@/server/command";
import { DomainError } from "@/server/errors";
import { parseRemoteSheet } from "@/server/remote-sheet";
import { currentActor } from "@/server/session";

export interface UploadState {
  error?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Read a site's settlement sheet, stage it, and go to the comparison. Nothing is posted until the owner approves. */
export async function uploadRemoteSheet(_prev: UploadState, form: FormData): Promise<UploadState> {
  const locale = String(form.get("locale") ?? "en");
  const jobId = String(form.get("jobId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "no_file" };
  if (file.size > MAX_BYTES) return { error: "too_large" };
  const actor = await currentActor(locale);
  let id: string;
  try {
    const parsed = await parseRemoteSheet(await file.arrayBuffer());
    const r = await runCommand(
      getDb(),
      actor,
      stageRemoteSettlement,
      { jobId, fileName: file.name.slice(0, 200), settlementDate: String(form.get("settlementDate") ?? ""), moneyAccountId: String(form.get("moneyAccountId") ?? ""), columns: parsed.columns, rows: parsed.rows },
      { idempotencyKey: String(form.get("key") ?? crypto.randomUUID()) },
    );
    id = r.id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(`/${locale}/jobs/${jobId}/remote/${id}`);
}
