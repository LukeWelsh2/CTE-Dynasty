// Pure live-scoring logic: stat diffing, touchdown / big-play detection, play descriptions,
// per-play fantasy points and touchdown-alert recipient selection. No DB access (unit tested).
import { TOUCHDOWN_KEYS, calcPoints, effectiveRules, type StatMap } from "@/lib/scoring/engine";
import type { LeagueSettings } from "@/lib/settings/schema";
import { TD_SCOPES, type TdScope } from "@/lib/live/types";

export type StatDelta = Record<string, number>;

/** Stat keys that change constantly but never matter for scoring / play detection */
const NOISE_KEY = /(^|_)(snp|pct|rtg|ypa|ypc|ypr|ypt|yar|yac|air_yd)$|^pts_|^tm_|^h1_|^q1_|^cmp_pct$|^penalty|^bonus_|^anytime_tds$|^first_td$|^gs$/;

export function isNoiseKey(key: string): boolean {
  return NOISE_KEY.test(key);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Per-player stat changes between two snapshots. Only players present in `next` are compared
 * (a player missing from a feed response is treated as a glitch, never as "all stats removed").
 * Noise keys (snap counts, rates, provider fantasy points) are ignored.
 */
export function diffStatMaps(previous: Map<string, StatMap>, next: Map<string, StatMap>): Map<string, StatDelta> {
  const out = new Map<string, StatDelta>();
  for (const [playerId, n] of next) {
    const p = previous.get(playerId) ?? {};
    const delta: StatDelta = {};
    const keys = new Set([...Object.keys(p), ...Object.keys(n)]);
    for (const k of keys) {
      if (isNoiseKey(k)) continue;
      const d = num(n[k]) - num(p[k]);
      if (Math.abs(d) > 1e-9) delta[k] = Math.round(d * 1000) / 1000;
    }
    if (Object.keys(delta).length) out.set(playerId, delta);
  }
  return out;
}

// ───────────────────────────── Play detection ─────────────────────────────

export type PlayKind = "TD" | "BIG" | "NEGATIVE";

export interface DetectedPlay {
  playerId: string;
  statKey: string;
  /** count for TDs / count stats, yards for big gains */
  delta: number;
  yards: number | null;
  kind: PlayKind;
  pairedPlayerId?: string | null;
}

/** Longest-play keys that tell us the length of a touchdown */
const TD_LENGTH_KEY: Record<string, string> = { rush_td: "rush_td_lng", rec_td: "rec_td_lng", pass_td: "pass_td_lng" };

/** Count-based big plays worth showing in the "Big plays" feed */
export const BIG_PLAY_COUNT_KEYS: { key: string; kind: PlayKind }[] = [
  { key: "fgm_50p", kind: "BIG" },
  { key: "int", kind: "BIG" },
  { key: "fum_rec", kind: "BIG" },
  { key: "safe", kind: "BIG" },
  { key: "blk_kick", kind: "BIG" },
  { key: "idp_int", kind: "BIG" },
  { key: "idp_sack", kind: "BIG" },
  { key: "idp_safe", kind: "BIG" },
  { key: "pass_int", kind: "NEGATIVE" },
  { key: "fum_lost", kind: "NEGATIVE" },
];

/** Long gains (non-TD) of at least this many yards are "big plays" */
export const BIG_GAIN_YARDS = 40;
const BIG_GAINS: { lng: string; td: string; statKey: string }[] = [
  { lng: "rush_lng", td: "rush_td", statKey: "big_rush" },
  { lng: "rec_lng", td: "rec_td", statKey: "big_rec" },
];

export const PLAY_KEYS = [...TOUCHDOWN_KEYS, ...BIG_PLAY_COUNT_KEYS.map((k) => k.key), ...BIG_GAINS.map((g) => g.statKey)];

/** 50+ yard field goals made, from whichever buckets the provider sends */
function fg50(s: StatMap): number {
  return Math.max(num(s.fgm_50p), num(s.fgm_50_59) + num(s.fgm_60p));
}

/** Yards of the newest touchdown when it can be derived from the longest-TD stat. */
export function touchdownYards(prev: StatMap, next: StatMap, tdKey: string): number | null {
  const lngKey = TD_LENGTH_KEY[tdKey];
  if (!lngKey) return null;
  const delta = num(next[tdKey]) - num(prev[tdKey]);
  if (delta !== 1) return null;
  const nextLng = next[lngKey];
  if (nextLng === undefined) return null;
  if (num(prev[tdKey]) === 0) return num(nextLng) || null;
  if (num(nextLng) > num(prev[lngKey])) return num(nextLng);
  return null;
}

/** Detect touchdowns and big plays for one player between two snapshots. */
export function detectPlays(playerId: string, prevStats: StatMap | null | undefined, nextStats: StatMap): DetectedPlay[] {
  const prev = prevStats ?? {};
  const next = nextStats;
  const out: DetectedPlay[] = [];
  for (const key of TOUCHDOWN_KEYS) {
    const d = num(next[key]) - num(prev[key]);
    if (d > 0) out.push({ playerId, statKey: key, delta: d, yards: touchdownYards(prev, next, key), kind: "TD" });
  }
  const defTd = num(next.def_td) - num(prev.def_td) > 0;
  for (const { key, kind } of BIG_PLAY_COUNT_KEYS) {
    const d = key === "fgm_50p" ? fg50(next) - fg50(prev) : num(next[key]) - num(prev[key]);
    if (d <= 0) continue;
    // a pick-six / scoop-and-score is already described by the defensive TD
    if (defTd && (key === "int" || key === "fum_rec")) continue;
    let yards: number | null = null;
    if (key === "fgm_50p" && d === 1 && num(next.fgm_lng) >= 50 && num(next.fgm_lng) > num(prev.fgm_lng)) yards = num(next.fgm_lng);
    out.push({ playerId, statKey: key, delta: d, yards, kind });
  }
  for (const g of BIG_GAINS) {
    const lng = num(next[g.lng]);
    if (lng < BIG_GAIN_YARDS || lng <= num(prev[g.lng])) continue;
    // the long gain was the touchdown itself
    const td = out.find((p) => p.statKey === g.td);
    if (td && (td.yards === lng || td.yards === null)) continue;
    out.push({ playerId, statKey: g.statKey, delta: lng, yards: lng, kind: "BIG" });
  }
  return out;
}

/**
 * Link passing touchdowns to the receiving touchdown on the same NFL team in the same update
 * (matched by length first, then a lone pass TD with a lone catch). Mutates `pairedPlayerId`.
 */
export function pairPassingTouchdowns(plays: (DetectedPlay & { nflTeam: string | null })[]): void {
  const byTeam = new Map<string, (DetectedPlay & { nflTeam: string | null })[]>();
  for (const p of plays) {
    if (!p.nflTeam || (p.statKey !== "pass_td" && p.statKey !== "rec_td") || p.delta !== 1) continue;
    if (!byTeam.has(p.nflTeam)) byTeam.set(p.nflTeam, []);
    byTeam.get(p.nflTeam)!.push(p);
  }
  for (const list of byTeam.values()) {
    const passes = list.filter((p) => p.statKey === "pass_td" && !p.pairedPlayerId);
    const catches = list.filter((p) => p.statKey === "rec_td" && !p.pairedPlayerId);
    for (const pass of passes) {
      if (pass.yards === null) continue;
      const c = catches.find((x) => !x.pairedPlayerId && x.yards === pass.yards && x.playerId !== pass.playerId);
      if (c) {
        pass.pairedPlayerId = c.playerId;
        c.pairedPlayerId = pass.playerId;
      }
    }
    const lp = passes.filter((p) => !p.pairedPlayerId);
    const lc = catches.filter((p) => !p.pairedPlayerId);
    if (lp.length === 1 && lc.length === 1 && lp[0]!.playerId !== lc[0]!.playerId) {
      lp[0]!.pairedPlayerId = lc[0]!.playerId;
      lc[0]!.pairedPlayerId = lp[0]!.playerId;
      if (lp[0]!.yards === null) lp[0]!.yards = lc[0]!.yards;
      if (lc[0]!.yards === null) lc[0]!.yards = lp[0]!.yards;
    }
  }
}

export interface PlayerName {
  name: string;
  position?: string | null;
}

/** Human description, e.g. "Bijan Robinson 34-yd rush TD" or "Joe Burrow 12-yd TD pass to Ja'Marr Chase". */
export function describePlay(play: DetectedPlay, names: Map<string, PlayerName>): string {
  const name = names.get(play.playerId)?.name ?? "Player";
  const paired = play.pairedPlayerId ? names.get(play.pairedPlayerId)?.name ?? null : null;
  const y = play.yards;
  const many = play.delta > 1 ? play.delta : 0;
  switch (play.statKey) {
    case "rush_td":
      return many ? `${name} ${many} rushing TDs` : y ? `${name} ${y}-yd rush TD` : `${name} rushing TD`;
    case "rec_td":
      if (many) return `${name} ${many} receiving TDs`;
      if (y) return `${name} ${y}-yd TD catch${paired ? ` from ${paired}` : ""}`;
      return paired ? `${name} TD catch from ${paired}` : `${name} receiving TD`;
    case "pass_td":
      if (many) return `${name} ${many} TD passes`;
      return `${name} ${y ? `${y}-yd ` : ""}TD pass${paired ? ` to ${paired}` : ""}`;
    case "def_td":
    case "idp_def_td":
      return `${name} defensive TD`;
    case "def_st_td":
    case "st_td":
      return `${name} return TD`;
    case "fum_rec_td":
      return `${name} fumble-recovery TD`;
    case "big_rush":
      return `${name} ${y}-yd run`;
    case "big_rec":
      return `${name} ${y}-yd catch`;
    case "fgm_50p":
      return many ? `${name} ${many} field goals of 50+ yds` : y ? `${name} ${y}-yd field goal` : `${name} 50+ yd field goal`;
    case "int":
    case "idp_int":
      return many ? `${name} ${many} interceptions` : `${name} interception`;
    case "fum_rec":
      return `${name} fumble recovery`;
    case "safe":
    case "idp_safe":
      return `${name} safety`;
    case "blk_kick":
      return `${name} blocked kick`;
    case "idp_sack":
      return many ? `${name} ${many} sacks` : `${name} sack`;
    case "pass_int":
      return many ? `${name} throws ${many} interceptions` : `${name} throws an interception`;
    case "fum_lost":
      return `${name} lost fumble`;
    default:
      return `${name} scoring play`;
  }
}

/** Short label for a stat key when no player context is needed (fallback descriptions). */
export function playLabel(statKey: string): string {
  const labels: Record<string, string> = {
    rush_td: "Rushing TD",
    rec_td: "Receiving TD",
    pass_td: "Passing TD",
    def_td: "Defensive TD",
    idp_def_td: "Defensive TD",
    def_st_td: "Return TD",
    st_td: "Return TD",
    fum_rec_td: "Fumble-recovery TD",
    big_rush: "Big run",
    big_rec: "Big catch",
    fgm_50p: "50+ yd FG",
    int: "Interception",
    idp_int: "Interception",
    fum_rec: "Fumble recovery",
    safe: "Safety",
    idp_safe: "Safety",
    blk_kick: "Blocked kick",
    idp_sack: "Sack",
    pass_int: "Interception thrown",
    fum_lost: "Fumble lost",
  };
  return labels[statKey] ?? "Scoring play";
}

/** Stat increments a single play represents (used to value plays when a player has several in one update). */
function playStatChange(play: DetectedPlay): StatDelta {
  switch (play.statKey) {
    case "big_rush":
      return { rush_yd: play.delta };
    case "big_rec":
      return { rec_yd: play.delta, rec: 1 };
    case "fgm_50p":
      return { fgm: play.delta, fgm_50p: play.delta, fgm_50_59: play.delta };
    default:
      return { [play.statKey]: play.delta };
  }
}

function addDelta(stats: StatMap, d: StatDelta): StatMap {
  const out: StatMap = { ...stats };
  for (const [k, v] of Object.entries(d)) out[k] = num(out[k]) + v;
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Touchdowns, long gains and long field goals carry the yardage of the update; the rest are counted plays */
function isPrimaryPlay(p: DetectedPlay): boolean {
  return p.kind === "TD" || p.statKey === "big_rush" || p.statKey === "big_rec" || p.statKey === "fgm_50p";
}

/**
 * Fantasy points for each detected play of one player. Counted plays (interceptions, fumbles,
 * sacks, takeaways) are worth their marginal value. When exactly one primary play (TD, long gain,
 * 50+ yd FG) happened in the update it gets the rest of the point change (its yardage + bonuses);
 * with several primary plays each gets its marginal value.
 */
export function playPoints(
  prevStats: StatMap | null | undefined,
  nextStats: StatMap,
  plays: DetectedPlay[],
  position: string,
  scoring: LeagueSettings["scoring"],
): number[] {
  const prev = prevStats ?? {};
  const before = calcPoints(prev, position, scoring).points;
  const marginal = plays.map((p) => round2(calcPoints(addDelta(prev, playStatChange(p)), position, scoring).points - before));
  const primary = plays.map(isPrimaryPlay);
  if (primary.filter(Boolean).length !== 1) return marginal;
  const total = calcPoints(nextStats, position, scoring).points - before;
  const secondary = marginal.reduce((a, v, i) => (primary[i] ? a : a + v), 0);
  return plays.map((_, i) => (primary[i] ? round2(total - secondary) : marginal[i]!));
}

/** Points per unit of a stat key for a position (handy for UI hints). */
export function ruleValue(scoring: LeagueSettings["scoring"], position: string, key: string): number {
  return effectiveRules(scoring, position)[key] ?? 0;
}

/**
 * How many NEW events to record for a cumulative counting stat, given what the database already has.
 * Makes event creation idempotent across restarts and provider glitches (a player dropping out of a
 * feed response and coming back never re-triggers a touchdown alert).
 */
export function newEventCount(currentValue: number, alreadyRecorded: number): number {
  return Math.max(0, Math.round(currentValue - alreadyRecorded));
}

// ───────────────────────────── Touchdown alert recipients ─────────────────────────────

export function normalizeTdScope(v: string | null | undefined, fallback: TdScope): TdScope {
  return v && (TD_SCOPES as string[]).includes(v) ? (v as TdScope) : fallback;
}

export interface TdRecipientInput {
  /** fantasy team that rosters the scoring player */
  ownerTeamId: string;
  /** the player is in that team's starting lineup this week */
  isStarter: boolean;
  /** both team ids of the owner team's matchup this week (empty when the team has no matchup) */
  matchupTeamIds: string[];
  /** user ids managing each team (owner + co-managers) */
  managersByTeam: Map<string, string[]>;
  /** every league member with their stored scope (null = no preference row) */
  members: { userId: string; scope: string | null }[];
  /** settings.notifications.touchdownAlertsDefault */
  defaultScope: TdScope;
}

/** Users who should get a touchdown alert, by each user's NotificationPreference.tdScope. */
export function selectTdRecipients(input: TdRecipientInput): string[] {
  const teamsByUser = new Map<string, Set<string>>();
  for (const [teamId, users] of input.managersByTeam) {
    for (const u of users) {
      if (!teamsByUser.has(u)) teamsByUser.set(u, new Set());
      teamsByUser.get(u)!.add(teamId);
    }
  }
  const out = new Set<string>();
  for (const m of input.members) {
    const scope = m.scope === null ? input.defaultScope : normalizeTdScope(m.scope, input.defaultScope);
    const mine = teamsByUser.get(m.userId) ?? new Set<string>();
    let include = false;
    switch (scope) {
      case "LEAGUE":
        include = true;
        break;
      case "MY_ROSTER":
        include = mine.has(input.ownerTeamId);
        break;
      case "MY_STARTERS":
        include = input.isStarter && mine.has(input.ownerTeamId);
        break;
      case "MY_MATCHUP":
        include = input.isStarter && input.matchupTeamIds.some((t) => mine.has(t));
        break;
      case "OFF":
        include = false;
        break;
    }
    if (include) out.add(m.userId);
  }
  return [...out];
}

/** "Bijan Robinson 34-yd rush TD (+9.40 pts). Concussion Protocol 102.4 – 88.1 Helmet to Helmet" */
export function touchdownAlertBody(opts: {
  description: string;
  points: number;
  team?: { name: string; score: number } | null;
  opponent?: { name: string; score: number } | null;
}): string {
  const sign = opts.points >= 0 ? "+" : "−";
  let body = `${opts.description} (${sign}${Math.abs(opts.points).toFixed(2)} pts).`;
  if (opts.team && opts.opponent) body += ` ${opts.team.name} ${opts.team.score.toFixed(1)} – ${opts.opponent.score.toFixed(1)} ${opts.opponent.name}`;
  else if (opts.team) body += ` ${opts.team.name} ${opts.team.score.toFixed(1)}`;
  return body;
}

/** Did a matchup's displayed numbers change enough to broadcast? */
export function matchupChanged(
  a: { homeScore: number; awayScore: number; homeProjected: number; awayProjected: number; homeWinProb: number; status: string },
  b: { homeScore: number; awayScore: number; homeProjected: number; awayProjected: number; homeWinProb: number; status: string },
): boolean {
  return (
    a.status !== b.status ||
    Math.abs(a.homeScore - b.homeScore) >= 0.005 ||
    Math.abs(a.awayScore - b.awayScore) >= 0.005 ||
    Math.abs(a.homeProjected - b.homeProjected) >= 0.05 ||
    Math.abs(a.awayProjected - b.awayProjected) >= 0.05 ||
    Math.abs(a.homeWinProb - b.homeWinProb) >= 0.001
  );
}

/** Throttle for WinProbPoint rows: record when enough time passed and something moved. */
export function shouldRecordWinProb(
  last: { at: Date; homeWinProb: number; homeScore: number; awayScore: number } | null,
  current: { homeWinProb: number; homeScore: number; awayScore: number },
  now: Date,
  minIntervalMs = 60_000,
): boolean {
  if (!last) return true;
  const moved =
    Math.abs(last.homeWinProb - current.homeWinProb) >= 0.002 || Math.abs(last.homeScore - current.homeScore) >= 0.01 || Math.abs(last.awayScore - current.awayScore) >= 0.01;
  return moved && now.getTime() - last.at.getTime() >= minIntervalMs;
}
