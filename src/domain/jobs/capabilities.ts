import type { Db } from "@/db/client";
import type { jobs } from "@/db/schema";

/** Optional capabilities a job can switch on (CLAUDE.md §4). */
export const CAPABILITIES = [
  "transportation",
  "products",
  "field_work",
  "expenses",
  "advances",
  "purchasing",
  "billing",
  "documents",
  "approvals",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Job = typeof jobs.$inferSelect;

/** Something that must be resolved before a job can move forward. */
export interface Blocker {
  /** Stable code, translated in the UI, e.g. "transport.manifest_missing". */
  code: string;
  /** Human-readable next action in English (fallback when a translation is missing). */
  action: string;
  /** Values for the translated message (keyed by `code`). */
  params?: Record<string, string>;
  /** Which status this blocks. */
  blocks: "completed" | "financially_closed";
}

/**
 * Specialized modules plug in here instead of the job engine knowing about them:
 * - blockers(): what remains before completion / financial close (drives Next Action)
 * - inUse(): whether disabling the capability would orphan existing records
 */
export interface CapabilityModule {
  capability: Capability;
  /** Check blockers even when the job has not switched this capability on (configured controls). */
  alwaysCheck?: boolean;
  blockers(tx: Db, job: Job): Promise<Blocker[]>;
  inUse(tx: Db, job: Job): Promise<boolean>;
}

/** Several modules may serve one capability (e.g. transportation: trips, settlement). */
const registry: CapabilityModule[] = [];

export function registerCapabilityModule(m: CapabilityModule) {
  registry.push(m);
}

/** True if any module of this capability holds records for the job. */
export async function capabilityInUse(tx: Db, c: Capability, job: Job): Promise<boolean> {
  for (const m of registry.filter((x) => x.capability === c)) if (await m.inUse(tx, job)) return true;
  return false;
}

/** Modules whose blockers apply to this job: its capabilities plus always-checked controls. */
export function modulesFor(job: { capabilities: string[] }): CapabilityModule[] {
  return registry.filter((m) => m.alwaysCheck || job.capabilities.includes(m.capability));
}
