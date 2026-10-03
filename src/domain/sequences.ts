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
