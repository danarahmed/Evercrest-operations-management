import { TRIP_CHIPS, TRIP_SORTS, type TripChip, type TripFilters, type TripSort, type TripState } from "@/domain/transport/trip-view";

/**
 * Trip filters live in the URL (so a filtered view can be shared, reloaded and
 * paged). Parameter names are short: q, route, tr (transporter; "direct" = none),
 * dr (driver), st (state), lf/lt (loaded from/to), df/dt (discharged from/to),
 * chip, sort, dir, page.
 */
type SP = Record<string, string | string[] | undefined>;
const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).flatMap((x) => x.split(",")).filter(Boolean);
const date = (v: string | string[] | undefined) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const STATES: TripState[] = ["estimated", "confirmed", "cancelled", "norule"];

export function parseTripFilters(sp: SP, jobId?: string | null): TripFilters {
  const tr = list(sp.tr);
  const sort = typeof sp.sort === "string" && (TRIP_SORTS as readonly string[]).includes(sp.sort) ? (sp.sort as TripSort) : undefined;
  return {
    jobId: jobId ?? null,
    jobIds: jobId ? [] : list(sp.job),
    q: typeof sp.q === "string" ? sp.q : undefined,
    routeIds: list(sp.route),
    transporterIds: tr.filter((x) => x !== "direct"),
    direct: tr.includes("direct"),
    driverIds: list(sp.dr),
    states: list(sp.st).filter((x): x is TripState => (STATES as string[]).includes(x)),
    loadedFrom: date(sp.lf),
    loadedTo: date(sp.lt),
    dischargedFrom: date(sp.df),
    dischargedTo: date(sp.dt),
    chips: list(sp.chip).filter((x): x is TripChip => (TRIP_CHIPS as readonly string[]).includes(x)),
    sort,
    dir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined,
    page: typeof sp.page === "string" && /^\d+$/.test(sp.page) ? Number(sp.page) : 1,
  };
}

/** The URL query for a filter set (without jobId, which is the page's own). */
export function filterParams(f: TripFilters, extra: Record<string, string | undefined> = {}): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  if (f.q) p.set("q", f.q);
  for (const j of f.jobIds ?? []) p.append("job", j);
  for (const r of f.routeIds ?? []) p.append("route", r);
  for (const t of f.transporterIds ?? []) p.append("tr", t);
  if (f.direct) p.append("tr", "direct");
  for (const d of f.driverIds ?? []) p.append("dr", d);
  for (const s of f.states ?? []) p.append("st", s);
  if (f.loadedFrom) p.set("lf", f.loadedFrom);
  if (f.loadedTo) p.set("lt", f.loadedTo);
  if (f.dischargedFrom) p.set("df", f.dischargedFrom);
  if (f.dischargedTo) p.set("dt", f.dischargedTo);
  for (const c of f.chips ?? []) p.append("chip", c);
  if (f.sort) p.set("sort", f.sort);
  if (f.dir) p.set("dir", f.dir);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  return p;
}

export function activeFilterCount(f: TripFilters): number {
  return (f.q ? 1 : 0) + (f.jobIds?.length ?? 0) + (f.routeIds?.length ?? 0) + (f.transporterIds?.length ?? 0) + (f.direct ? 1 : 0) + (f.driverIds?.length ?? 0) + (f.states?.length ?? 0) + (f.loadedFrom || f.loadedTo ? 1 : 0) + (f.dischargedFrom || f.dischargedTo ? 1 : 0) + (f.chips?.length ?? 0);
}
