import "server-only";
import { ValidationError } from "./errors";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "./supabase";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const storageConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));

/**
 * Store a scanned document in the private Supabase Storage bucket. Files live
 * under the company's folder; nobody can open them directly, only through the
 * ERP's permission-checked download link (a signed URL valid for two minutes).
 */
export async function storeDocumentFile(companyId: string, file: File): Promise<{ fileKey: string; fileName: string }> {
  if (!storageConfigured()) throw new ValidationError("File storage is not set up yet (Supabase Storage)");
  if (file.size > MAX_FILE_BYTES) throw new ValidationError("The file is larger than 15 MB");
  const ext = ALLOWED[file.type];
  if (!ext) throw new ValidationError("Only PDF or photo files (JPG, PNG, WEBP, HEIC) can be attached");
  const fileName = file.name.slice(0, 200) || `document.${ext}`;
  const fileKey = `${companyId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin().storage.from(DOCUMENTS_BUCKET).upload(fileKey, file, { contentType: file.type, upsert: false });
  if (error) throw new ValidationError(`The file could not be stored: ${error.message}`);
  return { fileKey, fileName };
}

/** Undo an upload whose record could not be saved (no orphan files). */
export async function removeStoredFile(fileKey: string) {
  if (!storageConfigured()) return;
  await supabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove([fileKey]);
}

export async function signedFileUrl(fileKey: string, fileName: string | null) {
  const { data, error } = await supabaseAdmin().storage.from(DOCUMENTS_BUCKET).createSignedUrl(fileKey, 120, fileName ? { download: false } : undefined);
  if (error || !data) throw new Error(`Could not open the file: ${error?.message}`);
  return data.signedUrl;
}
