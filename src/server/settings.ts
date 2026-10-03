import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { defineCommand } from "./command";

/**
 * Registry of configurable business rules. A setting must be declared here
 * (with its schema) before it can be stored, so typos and bad values are rejected.
 */
export const SETTINGS = {
  /** Default currency preselected in forms. Does not convert anything. */
  "ui.default_currency": z.enum(["IQD", "USD"]),
  /**
   * Money paid out above these amounts (per currency) needs approval by a second
   * person. A currency with no limit configured needs no approval.
   */
  "approvals.payment_out_limits": z.record(z.string().regex(/^[A-Z]{3}$/), z.string().regex(/^\d+(\.\d+)?$/)),
  /** Flag a loaded trip that has not been discharged after this many days. Unset = no alert. */
  "alerts.trip_transit_days": z.number().int().positive(),
  /**
   * Which ledger account (by code) each kind of automatic posting uses.
   * Nothing is posted to a default: a missing mapping stops the operation.
   */
  "accounting.posting_accounts": z
    .object({
      advances: z.string(),
      customer_receivables: z.string(),
      supplier_payables: z.string(),
      payables_to_drivers: z.string(),
      payables_to_transporters: z.string(),
      currency_exchange: z.string(),
    })
    .partial(),
} satisfies Record<string, z.ZodType>;
export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]>;

export async function getSetting<K extends SettingKey>(
  db: Db,
  companyId: string,
  key: K,
): Promise<SettingValue<K> | undefined> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.companyId, companyId), eq(settings.key, key)));
  return row ? (SETTINGS[key].parse(row.value) as SettingValue<K>) : undefined;
}

export const setSetting = defineCommand({
  name: "settings.set",
  permission: "settings.manage",
  input: z
    .object({ key: z.string(), value: z.unknown(), reason: z.string().min(1) })
    .superRefine((v, ctx) => {
      const schema = SETTINGS[v.key as SettingKey];
      if (!schema) ctx.addIssue({ code: "custom", message: `Unknown setting: ${v.key}`, path: ["key"] });
      else if (!schema.safeParse(v.value).success)
        ctx.addIssue({ code: "custom", message: `Invalid value for ${v.key}`, path: ["value"] });
    }),
  async handler({ tx, actor, audit }, { key, value, reason }) {
    const where = and(eq(settings.companyId, actor.companyId), eq(settings.key, key));
    const [prev] = await tx.select().from(settings).where(where);
    await tx
      .insert(settings)
      .values({ companyId: actor.companyId, key, value: value as never, updatedBy: actor.userId })
      .onConflictDoUpdate({
        target: [settings.companyId, settings.key],
        set: { value: value as never, updatedBy: actor.userId, updatedAt: new Date() },
      });
    await audit({ action: "settings.set", entityType: "setting", entityId: key, before: prev?.value ?? null, after: value, reason });
    return { key, value };
  },
});
