// Pure rookie-ranking math (no database access). Unit-tested in tests/rookies.test.ts.
import type { LeagueSettings } from "@/lib/settings/schema";

/** Sleeper search_rank (lower = more relevant) → 0..100 */
export function searchRankScore(searchRank: number | null | undefined): number | null {
  if (searchRank === null || searchRank === undefined || !Number.isFinite(searchRank) || searchRank <= 0 || searchRank >= 9_999_999) return null;
  return 100 / (1 + searchRank / 250);
}

/** Dynasty ADP (overall pick) → 0..100 */
export function adpScore(adp: number | null | undefined): number | null {
  if (adp === null || adp === undefined || !Number.isFinite(adp) || adp <= 0 || adp >= 999) return null;
  return 100 / (1 + adp / 60);
}

/** NFL draft capital (round + pick in round, 32 teams) → 0..100. Undrafted = small but non-zero. */
export function draftCapitalScore(round: number | null | undefined, pick: number | null | undefined): number | null {
  if (!round || round < 1) return null;
  const overall = (round - 1) * 32 + (pick && pick > 0 ? pick : 16);
  return 100 * Math.exp(-overall / 90);
}

export function isSuperflex(settings: Pick<LeagueSettings, "roster">): boolean {
  return settings.roster.slots.some((s) => s.count > 0 && s.eligible.includes("QB") && s.eligible.length > 1);
}

export function hasTePremium(settings: Pick<LeagueSettings, "scoring">): boolean {
  const base = settings.scoring.rules.rec ?? 0;
  const te = settings.scoring.positionOverrides?.TE?.rec;
  return typeof te === "number" && te > base;
}

/** Positional value multiplier for rookie rankings. */
export function positionMultiplier(position: string, opts: { superflex: boolean; tePremium: boolean }): number {
  switch (position) {
    case "QB":
      return opts.superflex ? 1.12 : 0.82;
    case "RB":
      return 1.02;
    case "WR":
      return 1.0;
    case "TE":
      return opts.tePremium ? 0.97 : 0.88;
    case "K":
      return 0.35;
    case "DEF":
      return 0.3;
    default:
      return 0.6; // IDP
  }
}

/** Younger prospects get a small dynasty bump; 22 is neutral. */
export function ageMultiplier(age: number | null | undefined): number {
  if (!age || !Number.isFinite(age)) return 1;
  return Math.max(0.92, Math.min(1.06, 1 + (22 - age) * 0.02));
}

export interface ScoreInput {
  searchRank?: number | null;
  adp?: number | null;
  draftRound?: number | null;
  draftPick?: number | null;
  position: string;
  age?: number | null;
}

/** Composite 0..~110 score: weighted mean of the available signals × position × age. */
export function rookieAutoScore(input: ScoreInput, opts: { superflex: boolean; tePremium: boolean }): number {
  const parts: [number | null, number][] = [
    [searchRankScore(input.searchRank), 0.45],
    [adpScore(input.adp), 0.35],
    [draftCapitalScore(input.draftRound, input.draftPick), 0.2],
  ];
  let num = 0;
  let den = 0;
  for (const [v, w] of parts) {
    if (v === null) continue;
    num += v * w;
    den += w;
  }
  const base = den ? num / den : 0;
  return Math.round(base * positionMultiplier(input.position, opts) * ageMultiplier(input.age) * 10) / 10;
}

/**
 * Merge pinned (commissioner) ranks with auto-scored rows.
 * Pinned rows keep their rank (collisions resolved in input order, out-of-range ranks move to the end);
 * auto rows fill the remaining ranks in score order. Returns keys in final rank order (index 0 = rank 1).
 */
export function mergeRanks(pinned: { key: string; rank: number }[], auto: { key: string; score: number }[]): string[] {
  const total = pinned.length + auto.length;
  const slots: (string | null)[] = new Array(total).fill(null);
  const overflow: string[] = [];
  for (const p of [...pinned].sort((a, b) => a.rank - b.rank)) {
    let r = Math.max(1, Math.round(p.rank)) - 1;
    while (r < total && slots[r] !== null) r++;
    if (r < total) slots[r] = p.key;
    else overflow.push(p.key);
  }
  const autoSorted = [...auto].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).map((a) => a.key);
  const fill = [...autoSorted];
  for (let i = 0; i < total; i++) if (slots[i] === null) slots[i] = fill.shift() ?? overflow.shift() ?? null;
  return [...slots.filter((s): s is string => s !== null), ...fill, ...overflow];
}

/** Tier breaks from a descending score list: new tier on a big relative drop or after a long run. */
export function autoTiers(scores: number[]): number[] {
  const tiers: number[] = [];
  let tier = 1;
  let run = 0;
  for (let i = 0; i < scores.length; i++) {
    if (i > 0) {
      const prev = scores[i - 1];
      const drop = prev - scores[i];
      const big = drop >= Math.max(3, prev * 0.08);
      if (big || (run >= 8 && drop >= 1)) {
        tier++;
        run = 0;
      }
    }
    run++;
    tiers.push(tier);
  }
  return tiers;
}

/** Positive = moved up. */
export function rankMovement(previousRank: number | null | undefined, rank: number): number {
  if (!previousRank) return 0;
  return previousRank - rank;
}

/** Stable key used to follow a ranking row across rewrites and snapshots. */
export function rankingKey(row: { playerId?: string | null; prospectName?: string | null; position: string }): string {
  if (row.playerId) return `p:${row.playerId}`;
  return `x:${(row.prospectName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")}:${row.position}`;
}

/** NFL draft round / pick from a Sleeper metadata blob, when present. */
export function draftCapitalFromMetadata(metadata: unknown): { round: number | null; pick: number | null } {
  const m = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const round = num(m.draft_round ?? m.nfl_draft_round ?? m.round);
  const pick = num(m.draft_pick ?? m.nfl_draft_pick ?? m.pick_in_round ?? m.draft_pick_in_round);
  const overall = num(m.draft_overall ?? m.overall_pick);
  if (round) return { round, pick };
  if (overall) return { round: Math.ceil(overall / 32), pick: ((overall - 1) % 32) + 1 };
  return { round: null, pick: null };
}

/**
 * Which rows did the commissioner actually move? Given each row's previous rank in its new order (null = new),
 * the rows on a longest increasing subsequence kept their relative order; everything else was moved.
 * Returns the indexes (in the new order) of moved / new rows.
 */
export function movedIndexes(previousRanks: (number | null)[]): Set<number> {
  const idx: number[] = [];
  const vals: number[] = [];
  previousRanks.forEach((r, i) => {
    if (r !== null) {
      idx.push(i);
      vals.push(r);
    }
  });
  // patience-sorting LIS with predecessor links
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev = new Array<number>(vals.length).fill(-1);
  for (let i = 0; i < vals.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < vals[i]) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = vals[i];
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const keep = new Set<number>();
  let k = tailIdx[tails.length - 1] ?? -1;
  while (k >= 0) {
    keep.add(idx[k]);
    k = prev[k];
  }
  const moved = new Set<number>();
  previousRanks.forEach((r, i) => {
    if (r === null || !keep.has(i)) moved.add(i);
  });
  return moved;
}
