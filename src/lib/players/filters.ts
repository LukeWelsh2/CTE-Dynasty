// URL <-> filter state for the players search page. Every piece of table state lives in the query string
// so views are shareable. Pure: used by the server page and the client filter bar.
import { z } from "zod";
import type { LeagueSettings } from "@/lib/settings/schema";
import { STAT_BY_KEY } from "@/lib/settings/stat-catalog";
import { defaultSortDir, parsePositionFilter, parseTimeframe, type PositionFilter, type SortDir, type Timeframe } from "@/lib/players/logic";

export const AVAILABILITY = ["all", "available", "fa", "waivers", "rostered", "mine", "watch"] as const;
export type Availability = (typeof AVAILABILITY)[number] | "team";

export const AVAILABILITY_LABELS: Record<(typeof AVAILABILITY)[number], string> = {
  all: "All players",
  available: "Available (FA + waivers)",
  fa: "Free agents only",
  waivers: "On waivers",
  rostered: "Rostered",
  mine: "My team",
  watch: "Watch list",
};

export const BASE_SORTS = ["rank", "name", "owner", "salary", "age", "bye", "opp", "pts", "avg", "proj"] as const;

export interface PlayerFilters {
  pos: PositionFilter;
  status: Availability;
  /** fantasy team id when status === "team" */
  owner: string | null;
  /** NFL team abbreviation, or "FA" for players without an NFL team */
  nfl: string | null;
  health: "all" | "healthy" | "injured";
  rookies: boolean;
  q: string;
  tf: Timeframe;
  /** specific week for tf=week */
  wk: number | null;
  sort: string;
  dir: SortDir;
  page: number;
}

export const DEFAULT_FILTERS: PlayerFilters = {
  pos: "ALL",
  status: "all",
  owner: null,
  nfl: null,
  health: "all",
  rookies: false,
  q: "",
  tf: "season",
  wk: null,
  sort: "pts",
  dir: "desc",
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);
const weekSchema = z.coerce.number().int().min(1).max(18).nullable().catch(null);

export function isValidSort(sort: string): boolean {
  if ((BASE_SORTS as readonly string[]).includes(sort)) return true;
  return sort.startsWith("stat:") && !!STAT_BY_KEY[sort.slice(5)];
}

export function parsePlayerFilters(sp: RawParams, settings: Pick<LeagueSettings, "roster">): PlayerFilters {
  const statusRaw = (first(sp.status) ?? "all").toLowerCase();
  let status: Availability = "all";
  let owner: string | null = null;
  if (statusRaw.startsWith("team:") && statusRaw.length > 5) {
    status = "team";
    owner = (first(sp.status) ?? "").slice(5);
  } else if ((AVAILABILITY as readonly string[]).includes(statusRaw)) status = statusRaw as Availability;
  const nflRaw = (first(sp.nfl) ?? "").toUpperCase().trim();
  const healthRaw = first(sp.health);
  const sortRaw = first(sp.sort) ?? DEFAULT_FILTERS.sort;
  const sort = isValidSort(sortRaw) ? sortRaw : DEFAULT_FILTERS.sort;
  const dirRaw = first(sp.dir);
  const tf = parseTimeframe(first(sp.tf));
  const wkRaw = first(sp.wk);
  return {
    pos: parsePositionFilter(first(sp.pos), settings),
    status,
    owner,
    nfl: /^[A-Z]{2,3}$/.test(nflRaw) ? nflRaw : null,
    health: healthRaw === "healthy" || healthRaw === "injured" ? healthRaw : "all",
    rookies: first(sp.rookies) === "1",
    q: (first(sp.q) ?? "").slice(0, 60).trim(),
    tf,
    wk: tf === "week" && wkRaw !== undefined ? weekSchema.parse(wkRaw) : null,
    sort,
    dir: dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultSortDir(sort),
    page: pageSchema.parse(first(sp.page) ?? 1),
  };
}

/** Serialize filters to a query string, omitting defaults. */
export function filtersToQuery(f: PlayerFilters): string {
  const p = new URLSearchParams();
  if (f.pos !== "ALL") p.set("pos", f.pos);
  if (f.status === "team" && f.owner) p.set("status", `team:${f.owner}`);
  else if (f.status !== "all") p.set("status", f.status);
  if (f.nfl) p.set("nfl", f.nfl);
  if (f.health !== "all") p.set("health", f.health);
  if (f.rookies) p.set("rookies", "1");
  if (f.q) p.set("q", f.q);
  if (f.tf !== "season") p.set("tf", f.tf);
  if (f.tf === "week" && f.wk) p.set("wk", String(f.wk));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (f.dir !== defaultSortDir(f.sort)) p.set("dir", f.dir);
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** href for the players page with some filters changed (page resets unless explicitly set) */
export function playersHref(f: PlayerFilters, patch: Partial<PlayerFilters>): string {
  const next = { ...f, page: 1, ...patch };
  return `/players${filtersToQuery(next)}`;
}

/** Toggle sort on a column: same column flips direction, new column starts at its default direction */
export function sortHref(f: PlayerFilters, key: string): string {
  const dir: SortDir = f.sort === key ? (f.dir === "asc" ? "desc" : "asc") : defaultSortDir(key);
  return playersHref(f, { sort: key, dir });
}
