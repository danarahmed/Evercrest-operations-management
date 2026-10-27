"use server";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import "@/domain/register";
import { stageTripImport } from "@/domain/transport/trip-import";
import { runCommand } from "@/server/command";
import { DomainError } from "@/server/errors";
import { currentActor } from "@/server/session";
import { parseTripSheet } from "@/server/trip-sheet";

export interface UploadState {
  error?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Read an uploaded trip sheet, stage it, and go to its preview. Nothing is created until the preview is confirmed. */
export async function uploadTripSheet(_prev: UploadState, form: FormData): Promise<UploadState> {
  const locale = String(form.get("locale") ?? "en");
  const jobId = String(form.get("jobId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "no_file" };
  if (file.size > MAX_BYTES) return { error: "too_large" };
  const actor = await currentActor(locale);
  let importId: string;
  try {
    const parsed = await parseTripSheet(await file.arrayBuffer());
    const r = await runCommand(getDb(), actor, stageTripImport, { jobId, fileName: file.name.slice(0, 200), columns: parsed.columns, rows: parsed.rows }, { idempotencyKey: String(form.get("key") ?? crypto.randomUUID()) });
    importId = r.id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(`/${locale}/jobs/${jobId}/import/${importId}`);
}
