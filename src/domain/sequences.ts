import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { documentSequences } from "@/db/schema";

/**
 * Next document number, e.g. JOB-2026-00042. Runs inside the caller's transaction:
 * the row lock serializes concurrent callers, and a rollback releases the number,
 * so committed numbers have no gaps.
 */
export async function nextNumber(tx: Db, companyId: string, prefix: string, year: number): Promise<string> {
  const [row] = await tx
    .insert(documentSequences)
    .values({ companyId, prefix, year, lastValue: 1 })
    .onConflictDoUpdate({
      target: [documentSequences.companyId, documentSequences.prefix, documentSequences.year],
      set: { lastValue: sql`${documentSequences.lastValue} + 1` },
    })
    .returning({ value: documentSequences.lastValue });
  return `${prefix}-${year}-${String(row.value).padStart(5, "0")}`;
}

/**
 * Next short reference code for master data (e.g. PRD-0007), so nobody has to
 * invent one. Same counter table as document numbers (year 0 = no year). Codes
 * typed in earlier are skipped, so a generated code never collides.
 */
export async function nextCode(tx: Db, companyId: string, prefix: string, width: number, taken: (code: string) => Promise<boolean>): Promise<string> {
  for (;;) {
    const [row] = await tx
      .insert(documentSequences)
      .values({ companyId, prefix, year: 0, lastValue: 1 })
      .onConflictDoUpdate({
        target: [documentSequences.companyId, documentSequences.prefix, documentSequences.year],
        set: { lastValue: sql`${documentSequences.lastValue} + 1` },
      })
      .returning({ value: documentSequences.lastValue });
    const code = `${prefix}-${String(row.value).padStart(width, "0")}`;
    if (!(await taken(code))) return code;
  }
}
