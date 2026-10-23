import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { documents } from "@/db/schema";
import { can } from "@/server/authz";
import { signedFileUrl } from "@/server/files";
import { currentActor } from "@/server/session";

/**
 * Open a document's scanned copy. Checks the user's permission and company, then
 * forwards to a signed link that works for two minutes only.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor("en");
  if (!can(actor, "jobs.view")) return new NextResponse("Forbidden", { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const [doc] = await getDb().select().from(documents).where(and(eq(documents.id, id), eq(documents.companyId, actor.companyId)));
  if (!doc?.fileKey) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(await signedFileUrl(doc.fileKey, doc.fileName), 302);
}
