// Fantasy scoring engine. Pure functions: (stats, position, scoring settings) -> points + breakdown.
// Used for live scoring, projections, player tables, recaps, simulations and trade values.

import type { LeagueSettings } from "@/lib/settings/schema";
import { STAT_BY_KEY, normalizePosition } from "@/lib/settings/stat-catalog";

export type StatMap = Record<string, number>;

export interface PointsLine {
  key: string;
  label: string;
  value: number;
  points: number;
}

export interface PointsResult {
  points: number;
  breakdown: PointsLine[];
}

const FG_BUCKETS: { key: string; distance: number }[] = [
  { key: "fgm_0_19", distance: 15 },
  { key: "fgm_20_29", distance: 25 },
  { key: "fgm_30_39", distance: 35 },
  { key: "fgm_40_49", distance: 45 },
  { key: "fgm_50_59", distance: 55 },
  { key: "fgm_60p", distance: 62 },
];

/** Keys that are computed by special handling and must not also be scored via `rules` */
const SPECIAL_KEYS = new Set(["pts_allow", "yds_allow"]);

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Read a stat, supporting derived combo keys */
export function statValue(stats: StatMap, key: string): number {
  if (key in stats) return num(stats[key]);
  switch (key) {
    case "rush_rec_yd":
      return num(stats.rush_yd) + num(stats.rec_yd);
    case "pass_rush_yd":
      return num(stats.pass_yd) + num(stats.rush_yd);
    case "all_purpose_yd":
      return num(stats.rush_yd) + num(stats.rec_yd) + num(stats.kr_yd) + num(stats.pr_yd);
    case "total_td":
      return num(stats.pass_td) + num(stats.rush_td) + num(stats.rec_td);
    case "scrimmage_td":
      return num(stats.rush_td) + num(stats.rec_td);
    default:
      return 0;
  }
}

function round(n: number, decimals: number) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function tierPoints(value: number, tiers: { max: number; points: number }[]): number {
  const sorted = [...tiers].sort((a, b) => a.max - b.max);
  for (const t of sorted) if (value <= t.max) return t.points;
  return sorted.length ? sorted[sorted.length - 1].points : 0;
}

export function effectiveRules(scoring: LeagueSettings["scoring"], position: string): Record<string, number> {
  const pos = normalizePosition(position);
  return { ...scoring.rules, ...(scoring.positionOverrides?.[pos] ?? {}) };
}

/** Did the player record any game activity? (Used to decide whether DEF tiers apply.) */
function playedGame(stats: StatMap): boolean {
  return num(stats.gp) > 0 || num(stats.gms_active) > 0 || "pts_allow" in stats || "yds_allow" in stats;
}

export function calcPoints(
  stats: StatMap | null | undefined,
  position: string,
  scoring: LeagueSettings["scoring"],
): PointsResult {
  const s: StatMap = stats ?? {};
  const pos = normalizePosition(position);
  const rules = effectiveRules(scoring, pos);
  const breakdown: PointsLine[] = [];
  const add = (key: string, label: string, value: number, points: number) => {
    if (!points) return;
    breakdown.push({ key, label, value, points });
  };

  // Kicking by distance replaces the flat fgm rule
  const useDistance = scoring.useFieldGoalDistance && pos === "K";
  if (useDistance) {
    let bucketed = 0;
    const has5059 = "fgm_50_59" in s || "fgm_60p" in s;
    const buckets = has5059 ? FG_BUCKETS : [...FG_BUCKETS.slice(0, 4), { key: "fgm_50p", distance: 55 }];
    for (const b of buckets) {
      const made = num(s[b.key]);
      if (!made) continue;
      bucketed += made;
      const rule = scoring.fieldGoalsByDistance.find((r) => b.distance >= r.min && b.distance <= r.max);
      const per = rule ? rule.points : num(rules.fgm);
      add(b.key, STAT_BY_KEY[b.key]?.label ?? b.key, made, made * per);
    }
    const unbucketed = Math.max(0, num(s.fgm) - bucketed);
    if (unbucketed) {
      const rule = scoring.fieldGoalsByDistance.find((r) => 35 >= r.min && 35 <= r.max);
      add("fgm", "Field Goals Made", unbucketed, unbucketed * (rule ? rule.points : num(rules.fgm)));
    }
  }

  for (const [key, per] of Object.entries(rules)) {
    if (!per) continue;
    if (SPECIAL_KEYS.has(key)) continue;
    if (useDistance && key === "fgm") continue;
    const value = statValue(s, key);
    if (!value) continue;
    add(key, STAT_BY_KEY[key]?.label ?? key, value, value * per);
  }

  // Team defense tiers
  if (pos === "DEF" && playedGame(s)) {
    if ("pts_allow" in s && scoring.pointsAllowedTiers.length) {
      const pa = num(s.pts_allow);
      add("pts_allow", `Points Allowed (${pa})`, pa, tierPoints(pa, scoring.pointsAllowedTiers));
    }
    if ("yds_allow" in s && scoring.yardsAllowedTiers.length) {
      const ya = num(s.yds_allow);
      add("yds_allow", `Yards Allowed (${ya})`, ya, tierPoints(ya, scoring.yardsAllowedTiers));
    }
  }

  // Milestone bonuses
  for (const b of scoring.bonuses ?? []) {
    if (b.positions && b.positions.length && !b.positions.includes(pos)) continue;
    const value = statValue(s, b.stat);
    if (value < b.threshold) continue;
    let times = 1;
    if (b.repeatEvery && b.repeatEvery > 0) times += Math.floor((value - b.threshold) / b.repeatEvery);
    add(`bonus:${b.id}`, b.label, value, b.points * times);
  }

  // Long touchdown bonuses (data provides 40+ and 50+ buckets)
  for (const lt of scoring.longTdBonuses ?? []) {
    const bucket = lt.minYards >= 50 ? "50p" : lt.minYards >= 40 ? "40p" : null;
    if (!bucket) continue;
    const count = num(s[`rush_td_${bucket}`]) + num(s[`rec_td_${bucket}`]) + num(s[`pass_td_${bucket}`]);
    if (count) add(`longtd:${lt.minYards}`, `${lt.minYards}+ yard TD bonus`, count, count * lt.points);
  }

  let total = breakdown.reduce((a, l) => a + l.points, 0);
  if (scoring.negativePointsFloor !== null && scoring.negativePointsFloor !== undefined) {
    total = Math.max(scoring.negativePointsFloor, total);
  }
  const decimals = scoring.decimals ?? 2;
  total = scoring.roundToDecimals ? round(total, decimals) : total;
  for (const l of breakdown) l.points = round(l.points, 2);
  breakdown.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { points: total, breakdown };
}

/** Convenience: just the number */
export function points(stats: StatMap | null | undefined, position: string, scoring: LeagueSettings["scoring"]): number {
  return calcPoints(stats, position, scoring).points;
}

/** Stat keys that represent touchdowns (used for live TD alerts) */
export const TOUCHDOWN_KEYS = ["pass_td", "rush_td", "rec_td", "def_td", "def_st_td", "st_td", "fum_rec_td", "idp_def_td"];
