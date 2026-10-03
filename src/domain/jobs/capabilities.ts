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
  /** Human-readable next action in English (fallback). */
  action: string;
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
  blockers(tx: Db, job: Job): Promise<Blocker[]>;
  inUse(tx: Db, job: Job): Promise<boolean>;
}

const registry = new Map<Capability, CapabilityModule>();

export function registerCapabilityModule(m: CapabilityModule) {
  registry.set(m.capability, m);
}

export function capabilityModule(c: Capability): CapabilityModule | undefined {
  return registry.get(c);
}
