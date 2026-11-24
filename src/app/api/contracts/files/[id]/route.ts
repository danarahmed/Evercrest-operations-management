import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { contractFiles } from "@/db/schema";
import { can } from "@/server/authz";
import { signedFileUrl } from "@/server/files";
import { currentActor } from "@/server/session";

/** Open a contract's scanned file: only people who manage contracts, only their company, through a two-minute link. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor("en");
  if (!can(actor, "contracts.manage")) return new NextResponse("Forbidden", { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const [f] = await getDb().select().from(contractFiles).where(and(eq(contractFiles.id, id), eq(contractFiles.companyId, actor.companyId)));
  if (!f) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(await signedFileUrl(f.fileKey, f.fileName), 302);
}
