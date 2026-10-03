import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts } from "@/db/schema";
import { ValidationError } from "@/server/errors";
import { getSetting } from "@/server/settings";

export type PostingKey = "advances" | "customer_receivables" | "supplier_payables" | "payables_to_drivers" | "payables_to_transporters" | "currency_exchange";

/** Resolve a configured posting account. Never falls back to a guess. */
export async function postingAccount(tx: Db, companyId: string, key: PostingKey) {
  const map = (await getSetting(tx, companyId, "accounting.posting_accounts")) ?? {};
  const code = map[key];
  if (!code) throw new ValidationError(`Posting account for "${key}" is not configured`, { setting: "accounting.posting_accounts", key });
  const [acc] = await tx.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  if (!acc) throw new ValidationError(`Configured posting account ${code} (${key}) does not exist`, { key, code });
  return acc;
}
