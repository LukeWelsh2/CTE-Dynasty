// League standings with configurable tiebreakers, all-play records, streaks, power rankings.
//
// Ranking rules — implemented once in rankTeams()/rankLeague() below and used by both the standings and the
// playoff-odds simulation (src/lib/sim/core.ts), so the two can never order the same records differently:
//  1. Win percentage, (W + ½T) / G, where G includes median-game and weekly high-score bonus results.
//  2. Teams with the same win percentage form a tied group that is ranked with the tiebreaker chain
//     (settings.standings.tiebreakers overall; divisionTiebreakChain() for division ranks). Each step is applied to
//     the whole group at once and is used only when it separates at least one team; otherwise the next step is tried.
//  3. Once a step separates the group into tiers, every tier that is still tied restarts at the first step of the
//     chain with only its own teams (so a two-team tier gets plain head-to-head between those two).
//  4. HEAD_TO_HEAD on a group: see h2hValues() — combined win % in games among the tied teams when every pair met
//     equally often, otherwise only a clean sweep counts.
//  5. Every tie ends in a deterministic order that does not depend on the order teams are listed in:
//     overall — after the configured chain: points for, then a coin flip that is fixed for the season, then team id;
//     division — after the division chain: the overall standings order.
import type { Matchup, Team } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { hashString } from "@/lib/sim/rng";

export interface StandingRow {
  team: Team;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  pointsFor: number;
  pointsAgainst: number;
  divWins: number;
  divLosses: number;
  divTies: number;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  streak: string; // "W3"
  last5: ("W" | "L" | "T")[];
  gamesBack: number;
  divisionRank: number;
  maxPointsFor: number; // optimal lineup PF not tracked here; equals PF placeholder
  powerScore: number;
  powerRank: number;
  /** wins over median (when the median game is enabled) */
  medianWins: number;
  medianLosses: number;
  /** this season's coin-flip draw in [0, 1): the COIN_FLIP tiebreaker ranks the higher draw first */
  coinFlip?: number;
  /** why this team ranks directly above the next team in the standings (null unless they share a win pct) */
  tiebreak?: TieSplit | null;
  /** why this team ranks directly above the next team in its division (null unless they share a win pct) */
  divisionTiebreak?: TieSplit | null;
}

/** Head-to-head record of one team against another (regular-season final games). */
export interface H2HRecord {
  w: number;
  l: number;
  /** tied games (optional for older callers; treated as 0) */
  t?: number;
}

export async function computeStandings(leagueId: string, season: number, settings: LeagueSettings, opts: { throughWeek?: number } = {}): Promise<StandingRow[]> {
  const teams = await db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } });
  const matchups = await db.matchup.findMany({
    where: { leagueId, season, isPlayoff: false, status: "FINAL", ...(opts.throughWeek ? { week: { lte: opts.throughWeek } } : {}) },
    orderBy: { week: "asc" },
  });
  return standingsFromMatchups(teams, matchups, settings, { season });
}

/**
 * Standings from final regular-season matchups (pure). `opts.season` seeds the coin flip; it defaults to the
 * matchups' season.
 */
export function standingsFromMatchups(teams: Team[], matchups: Matchup[], settings: LeagueSettings, opts: { season?: number } = {}): StandingRow[] {
  const season = opts.season ?? matchups[0]?.season ?? 0;
  const rows = new Map<string, StandingRow>();
  for (const t of teams) {
    rows.set(t.id, {
      team: t, rank: 0, wins: 0, losses: 0, ties: 0, pct: 0, pointsFor: 0, pointsAgainst: 0,
      divWins: 0, divLosses: 0, divTies: 0, allPlayWins: 0, allPlayLosses: 0, allPlayTies: 0,
      streak: "", last5: [], gamesBack: 0, divisionRank: 0, maxPointsFor: 0, powerScore: 0, powerRank: 0,
      medianWins: 0, medianLosses: 0, coinFlip: coinFlipDraw(season, t.id), tiebreak: null, divisionTiebreak: null,
    });
  }
  const results = new Map<string, ("W" | "L" | "T")[]>();
  const h2h = new Map<string, { w: number; l: number; t: number }>(); // key a|b
  const byWeek = new Map<number, Matchup[]>();
  for (const m of matchups) {
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week)!.push(m);
  }
  const push = (id: string, r: "W" | "L" | "T") => {
    if (!results.has(id)) results.set(id, []);
    results.get(id)!.push(r);
  };
  for (const [, ms] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const weekScores: { id: string; pts: number }[] = [];
    for (const m of ms) {
      if (!m.homeTeamId || !m.awayTeamId) continue;
      const h = rows.get(m.homeTeamId);
      const a = rows.get(m.awayTeamId);
      if (!h || !a) continue;
      h.pointsFor += m.homeScore; h.pointsAgainst += m.awayScore;
      a.pointsFor += m.awayScore; a.pointsAgainst += m.homeScore;
      weekScores.push({ id: h.team.id, pts: m.homeScore }, { id: a.team.id, pts: m.awayScore });
      const sameDiv = h.team.division && h.team.division === a.team.division;
      let hr: "W" | "L" | "T";
      if (m.winnerTeamId === m.homeTeamId) hr = "W";
      else if (m.winnerTeamId === m.awayTeamId) hr = "L";
      else hr = m.homeScore > m.awayScore ? "W" : m.homeScore < m.awayScore ? "L" : "T";
      const ar: "W" | "L" | "T" = hr === "W" ? "L" : hr === "L" ? "W" : "T";
      for (const [row, r] of [[h, hr], [a, ar]] as const) {
        if (r === "W") row.wins++; else if (r === "L") row.losses++; else row.ties++;
        if (sameDiv) { if (r === "W") row.divWins++; else if (r === "L") row.divLosses++; else row.divTies++; }
        push(row.team.id, r);
      }
      const k1 = `${h.team.id}|${a.team.id}`, k2 = `${a.team.id}|${h.team.id}`;
      const e1 = h2h.get(k1) ?? { w: 0, l: 0, t: 0 }, e2 = h2h.get(k2) ?? { w: 0, l: 0, t: 0 };
      if (hr === "W") { e1.w++; e2.l++; } else if (hr === "L") { e1.l++; e2.w++; } else { e1.t++; e2.t++; }
      h2h.set(k1, e1); h2h.set(k2, e2);
    }
    // all-play + median game
    const sorted = [...weekScores].sort((x, y) => x.pts - y.pts);
    const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)].pts + sorted[Math.ceil((sorted.length - 1) / 2)].pts) / 2 : 0;
    for (const ws of weekScores) {
      const row = rows.get(ws.id)!;
      for (const other of weekScores) {
        if (other.id === ws.id) continue;
        if (ws.pts > other.pts) row.allPlayWins++; else if (ws.pts < other.pts) row.allPlayLosses++; else row.allPlayTies++;
      }
      if (settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN") {
        if (ws.pts > median) { row.medianWins++; row.wins++; push(ws.id, "W"); }
        else if (ws.pts < median) { row.medianLosses++; row.losses++; push(ws.id, "L"); }
      }
    }
    if (settings.niche.weeklyHighScoreBonusWin && weekScores.length) {
      const top = [...weekScores].sort((x, y) => y.pts - x.pts)[0];
      rows.get(top.id)!.wins++;
    }
  }

  for (const row of rows.values()) {
    const g = row.wins + row.losses + row.ties;
    row.pct = g ? (row.wins + row.ties * 0.5) / g : 0;
    row.pointsFor = Math.round(row.pointsFor * 100) / 100;
    row.pointsAgainst = Math.round(row.pointsAgainst * 100) / 100;
    const res = results.get(row.team.id) ?? [];
    row.last5 = res.slice(-5);
    if (res.length) {
      const last = res[res.length - 1];
      let n = 0;
      for (let i = res.length - 1; i >= 0 && res[i] === last; i--) n++;
      row.streak = `${last}${n}`;
    }
  }

  // overall + division order (shared with the simulation)
  const base = [...rows.values()];
  const table = tieTableFromRows(base, h2h);
  const divNames = [...new Set(base.map((r) => r.team.division ?? ""))];
  const div = base.map((r) => divNames.indexOf(r.team.division ?? ""));
  const trace = new Map<number, TieSplit>();
  const divisionTrace = new Map<number, TieSplit>();
  const ranked = rankLeague(table, div, settings.standings.tiebreakers, divisionTiebreakChain(settings), { trace, divisionTrace });
  const list = ranked.order.map((i) => base[i]!);
  ranked.order.forEach((i, k) => {
    const r = base[i]!;
    r.rank = k + 1;
    r.tiebreak = trace.get(i) ?? null;
  });
  for (const members of ranked.divisions) {
    members.forEach((i, k) => {
      const r = base[i]!;
      r.divisionRank = k + 1;
      r.divisionTiebreak = divisionTrace.get(i) ?? null;
    });
  }
  const leader = list[0];
  for (const r of list) r.gamesBack = leader ? ((leader.wins - r.wins) + (r.losses - leader.losses)) / 2 : 0;

  // power rankings
  const w = settings.standings.powerRanking;
  const maxPF = Math.max(1, ...list.map((r) => r.pointsFor));
  for (const r of list) {
    const apg = r.allPlayWins + r.allPlayLosses + r.allPlayTies;
    const allPlayPct = apg ? (r.allPlayWins + r.allPlayTies * 0.5) / apg : 0;
    const recent = r.last5.length ? r.last5.filter((x) => x === "W").length / r.last5.length : 0;
    r.powerScore = Math.round((w.recordWeight * r.pct + w.pointsWeight * (r.pointsFor / maxPF) + w.allPlayWeight * allPlayPct + w.recentFormWeight * recent) * 1000) / 10;
  }
  [...list].sort((a, b) => b.powerScore - a.powerScore).forEach((r, i) => (r.powerRank = i + 1));
  return list;
}

/** Tiebreakers used to rank teams inside a division (falls back to the overall chain). */
export function divisionTiebreakChain(settings: LeagueSettings): readonly string[] {
  const d = settings.standings.divisionTiebreakers;
  return d && d.length ? d : settings.standings.tiebreakers;
}

/** The season's deterministic coin-flip draw for a team, in [0, 1) (same value all season, new draw each season). */
export function coinFlipDraw(season: number, teamId: string): number {
  return hashString(`coin-flip:${season}:${teamId}`) / 4294967296;
}

// ───────── Tie-breaking (pure; shared with src/lib/sim/core.ts) ─────────

export type StandingsTiebreaker = LeagueSettings["standings"]["tiebreakers"][number] | LeagueSettings["standings"]["divisionTiebreakers"][number];

/**
 * Everything the ranking reads, by team index 0..n-1 (plain arrays or typed arrays, so the simulation can rank
 * its typed-array state without copying).
 */
export interface TieTable {
  n: number;
  ids: readonly string[];
  W: ArrayLike<number>;
  L: ArrayLike<number>;
  T: ArrayLike<number>;
  PF: ArrayLike<number>;
  PA: ArrayLike<number>;
  dW: ArrayLike<number>;
  dL: ArrayLike<number>;
  dT: ArrayLike<number>;
  apW: ArrayLike<number>;
  /** coin-flip draw per team (higher wins) */
  coin: ArrayLike<number>;
  /** n×n row-major: wins of i over j */
  h2hW: ArrayLike<number>;
  /** n×n row-major: tied games between i and j (symmetric) */
  h2hT: ArrayLike<number>;
}

/** Why one team ranks directly above the next one with the same win percentage. */
export interface TieSplit {
  /** the step that separated them: a tiebreaker, the overall order (division ranks) or team id (last resort) */
  by: StandingsTiebreaker | "OVERALL_RANK" | "TEAM_ID";
  /** ids of every team still tied when the step was applied (both teams included), in final order */
  group: string[];
  /**
   * The two teams' values for `by` (higher ranks first, except OVERALL_RANK: lower first). H2H: combined win %
   * among `group` (mode RECORD) or 1 / 0 / −1 for swept everyone / neither / lost to everyone (mode SWEEP).
   */
  value: number;
  nextValue: number;
  /** H2H only: how the step was applied and each team's [W, L, T] in games among `group` */
  h2h?: { mode: "RECORD" | "SWEEP"; record: [number, number, number]; nextRecord: [number, number, number] };
}

export interface RankOptions {
  /**
   * Total order applied after the chain (lower value first), e.g. overall standings position for division ranks.
   * Default (overall standings): points for, then the coin flip, then team id.
   */
  tail?: ArrayLike<number>;
  /** receives, for each team index, why it ranks above the team right below it (only within a win-pct tie) */
  trace?: Map<number, TieSplit>;
}

/** Steps appended to the overall chain so a tie can always be broken (skipped when already in the chain). */
const OVERALL_TAIL: readonly StandingsTiebreaker[] = ["POINTS_FOR", "COIN_FLIP"];

const winPct = (w: number, l: number, t: number) => (w + l + t ? (w + t * 0.5) / (w + l + t) : 0);

/**
 * Ranks `members` (team indices into `t`) best first: win percentage, then the tiebreaker `chain` applied to each
 * tied group as described at the top of this file. The result is a total order and does not depend on the order
 * of `members`.
 */
export function rankTeams(t: TieTable, members: readonly number[], chain: readonly string[], opts: RankOptions = {}): number[] {
  const k = members.length;
  if (k < 2) return [...members];
  const steps = opts.tail ? chain : [...chain, ...OVERALL_TAIL.filter((s) => !chain.includes(s))];
  const p = new Float64Array(k);
  for (let x = 0; x < k; x++) {
    const i = members[x];
    p[x] = winPct(t.W[i], t.L[i], t.T[i]);
  }
  const at = Array.from({ length: k }, (_, x) => x).sort((x, y) => p[y] - p[x] || x - y);
  const out: number[] = [];
  for (let a = 0; a < k; ) {
    let b = a + 1;
    while (b < k && p[at[b]] === p[at[a]]) b++;
    if (b - a === 1) out.push(members[at[a]]);
    else {
      const group: number[] = [];
      for (let x = a; x < b; x++) group.push(members[at[x]]);
      for (const i of breakTie(t, group, steps, opts)) out.push(i);
    }
    a = b;
  }
  return out;
}

/** Orders one group of teams with the same win percentage (recursive: still-tied tiers restart the chain). */
function breakTie(t: TieTable, group: readonly number[], steps: readonly string[], opts: RankOptions): number[] {
  const k = group.length;
  const vals = new Float64Array(k);
  for (const step of steps) {
    const mode = stepValues(t, step, group, vals);
    if (mode === null) continue;
    let separates = false;
    for (let x = 1; x < k && !separates; x++) if (vals[x] !== vals[0]) separates = true;
    if (!separates) continue;
    const at = Array.from({ length: k }, (_, x) => x).sort((x, y) => vals[y] - vals[x] || x - y);
    const out: number[] = [];
    const tiers: number[][] = [];
    for (let a = 0; a < k; ) {
      let b = a + 1;
      while (b < k && vals[at[b]] === vals[at[a]]) b++;
      const tier: number[] = [];
      for (let x = a; x < b; x++) tier.push(group[at[x]]);
      tiers.push(tier.length > 1 ? breakTie(t, tier, steps, opts) : tier);
      a = b;
    }
    for (const tier of tiers) for (const i of tier) out.push(i);
    if (opts.trace) {
      const value = new Map<number, number>();
      group.forEach((i, x) => value.set(i, vals[x]));
      const ids = out.map((i) => t.ids[i]);
      for (let m = 0; m + 1 < tiers.length; m++) {
        const upper = tiers[m][tiers[m].length - 1];
        const lower = tiers[m + 1][0];
        const split: TieSplit = { by: step as StandingsTiebreaker, group: ids, value: value.get(upper)!, nextValue: value.get(lower)! };
        if (step === "H2H") split.h2h = { mode: mode === "SWEEP" ? "SWEEP" : "RECORD", record: groupRecord(t, group, upper), nextRecord: groupRecord(t, group, lower) };
        opts.trace.set(upper, split);
      }
    }
    return out;
  }
  // chain exhausted: the tail is a total order
  const tail = opts.tail;
  const out = tail ? [...group].sort((a, b) => tail[a] - tail[b] || a - b) : [...group].sort((a, b) => (t.ids[a] < t.ids[b] ? -1 : t.ids[a] > t.ids[b] ? 1 : a - b));
  if (opts.trace) {
    const ids = out.map((i) => t.ids[i]);
    for (let m = 0; m + 1 < out.length; m++) {
      const [upper, lower] = [out[m], out[m + 1]];
      opts.trace.set(upper, tail ? { by: "OVERALL_RANK", group: ids, value: tail[upper], nextValue: tail[lower] } : { by: "TEAM_ID", group: ids, value: m, nextValue: m + 1 });
    }
  }
  return out;
}

/**
 * Fills `out` (aligned with `group`) with each team's value for one tiebreaker (higher ranks first). Returns null
 * when the step cannot be applied to this group; for H2H, which form was used.
 */
function stepValues(t: TieTable, step: string, group: readonly number[], out: Float64Array): "VALUE" | "RECORD" | "SWEEP" | null {
  const k = group.length;
  switch (step) {
    case "H2H":
      return h2hValues(t, group, out);
    case "POINTS_FOR":
      for (let x = 0; x < k; x++) out[x] = t.PF[group[x]];
      return "VALUE";
    case "POINTS_AGAINST": // more points against ranks higher (the tougher schedule)
      for (let x = 0; x < k; x++) out[x] = t.PA[group[x]];
      return "VALUE";
    case "DIVISION_RECORD":
      for (let x = 0; x < k; x++) {
        const i = group[x];
        out[x] = winPct(t.dW[i], t.dL[i], t.dT[i]);
      }
      return "VALUE";
    case "ALL_PLAY":
      for (let x = 0; x < k; x++) out[x] = t.apW[group[x]];
      return "VALUE";
    case "COIN_FLIP":
      for (let x = 0; x < k; x++) out[x] = t.coin[group[x]];
      return "VALUE";
    default:
      return null;
  }
}

/**
 * Head-to-head among the tied teams only (two teams: their head-to-head record).
 *
 * Choice for groups of three or more: the combined record in games among the tied teams is used only when every
 * pair of them met the same number of times (at least once). With an unbalanced schedule — common in fantasy
 * leagues, where not everyone plays everyone — a combined record would reward whoever drew the extra games against
 * the weaker tied team, so then only a clean sweep counts (NFL wild-card rule): a team that beat every other tied
 * team in every meeting ranks above them, a team that lost every meeting to each of them ranks below, and nothing
 * else is decided by head-to-head. A two-team group is always "balanced" when they met, so it gets plain
 * head-to-head; when they never met the step is skipped.
 */
function h2hValues(t: TieTable, group: readonly number[], out: Float64Array): "RECORD" | "SWEEP" {
  const k = group.length;
  const n = t.n;
  let meetings = -1;
  let balanced = true;
  for (let x = 0; x < k && balanced; x++) {
    for (let y = x + 1; y < k; y++) {
      const i = group[x];
      const j = group[y];
      const m = t.h2hW[i * n + j] + t.h2hW[j * n + i] + t.h2hT[i * n + j];
      if (meetings < 0) meetings = m;
      else if (m !== meetings) {
        balanced = false;
        break;
      }
    }
  }
  if (balanced && meetings > 0) {
    for (let x = 0; x < k; x++) {
      const i = group[x];
      let w = 0;
      let ties = 0;
      let games = 0;
      for (let y = 0; y < k; y++) {
        if (y === x) continue;
        const j = group[y];
        w += t.h2hW[i * n + j];
        ties += t.h2hT[i * n + j];
        games += t.h2hW[i * n + j] + t.h2hW[j * n + i] + t.h2hT[i * n + j];
      }
      out[x] = games ? (w + ties * 0.5) / games : 0;
    }
    return "RECORD";
  }
  for (let x = 0; x < k; x++) {
    const i = group[x];
    let sweep = true;
    let swept = true;
    for (let y = 0; y < k && (sweep || swept); y++) {
      if (y === x) continue;
      const j = group[y];
      const games = t.h2hW[i * n + j] + t.h2hW[j * n + i] + t.h2hT[i * n + j];
      if (games === 0) sweep = swept = false;
      else {
        if (t.h2hW[i * n + j] !== games) sweep = false;
        if (t.h2hW[j * n + i] !== games) swept = false;
      }
    }
    out[x] = sweep ? 1 : swept ? -1 : 0;
  }
  return "SWEEP";
}

function groupRecord(t: TieTable, group: readonly number[], i: number): [number, number, number] {
  let w = 0;
  let l = 0;
  let ties = 0;
  for (const j of group) {
    if (j === i) continue;
    w += t.h2hW[i * t.n + j];
    l += t.h2hW[j * t.n + i];
    ties += t.h2hT[i * t.n + j];
  }
  return [w, l, ties];
}

/**
 * Overall order plus the order inside each division (division ranks use `divisionChain`, then the overall order).
 * `div[i]` is a division index (negative = no division, not ranked as one). `divisions` lists each division's
 * teams best first, in order of first appearance in `div`.
 */
export function rankLeague(
  t: TieTable,
  div: ArrayLike<number>,
  chain: readonly string[],
  divisionChain: readonly string[],
  opts: { trace?: Map<number, TieSplit>; divisionTrace?: Map<number, TieSplit> } = {},
): { order: number[]; divisions: number[][] } {
  const all = Array.from({ length: t.n }, (_, i) => i);
  const order = rankTeams(t, all, chain, { trace: opts.trace });
  const position = new Float64Array(t.n);
  order.forEach((i, k) => (position[i] = k));
  const groups = new Map<number, number[]>();
  for (let i = 0; i < t.n; i++) {
    const d = div[i];
    if (d < 0) continue;
    let g = groups.get(d);
    if (!g) groups.set(d, (g = []));
    g.push(i);
  }
  const divisions = [...groups.values()].map((g) => rankTeams(t, g, divisionChain.length ? divisionChain : chain, { tail: position, trace: opts.divisionTrace }));
  return { order, divisions };
}

function tieTableFromRows(rows: readonly StandingRow[], h2h: ReadonlyMap<string, H2HRecord>): TieTable {
  const n = rows.length;
  const index = new Map(rows.map((r, i) => [r.team.id, i]));
  const h2hW = new Int32Array(n * n);
  const h2hT = new Int32Array(n * n);
  for (const [key, rec] of h2h) {
    const [a, b] = key.split("|");
    const i = index.get(a!);
    const j = index.get(b!);
    if (i === undefined || j === undefined) continue;
    h2hW[i * n + j] = rec.w;
    h2hT[i * n + j] = rec.t ?? 0;
  }
  return {
    n,
    ids: rows.map((r) => r.team.id),
    W: rows.map((r) => r.wins),
    L: rows.map((r) => r.losses),
    T: rows.map((r) => r.ties),
    PF: rows.map((r) => r.pointsFor),
    PA: rows.map((r) => r.pointsAgainst),
    dW: rows.map((r) => r.divWins),
    dL: rows.map((r) => r.divLosses),
    dT: rows.map((r) => r.divTies),
    apW: rows.map((r) => r.allPlayWins),
    coin: rows.map((r) => r.coinFlip ?? 0),
    h2hW,
    h2hT,
  };
}

/**
 * Playoff seeding from standings.
 * - divisionWinnersTopSeeds: division winners take the top seeds (standings order), the rest follow.
 * - playoffs.divisionWinnersQualify: every division winner is guaranteed a spot (taking the place of the last
 *   at-large qualifier) but is seeded with everyone else by record (or points).
 * - seeding POINTS_FOR orders the at-large field by total points; wildcardsByPoints fills the last spots with the
 *   highest scorers not already in, seeded last.
 */
export function playoffSeeds(standings: StandingRow[], settings: LeagueSettings): StandingRow[] {
  const n = settings.playoffs.teams;
  const byPoints = settings.playoffs.wildcardsByPoints ?? 0;
  const winners = standings.filter((r) => r.divisionRank === 1 && r.team.division);
  const primary = settings.playoffs.seeding === "POINTS_FOR" ? [...standings].sort((a, b) => b.pointsFor - a.pointsFor) : standings;
  let seeds: StandingRow[] = [];
  if (settings.standings.divisionWinnersTopSeeds) {
    seeds.push(...winners);
    const recordSpots = Math.max(0, n - seeds.length - byPoints);
    seeds.push(...primary.filter((r) => !seeds.includes(r)).slice(0, recordSpots));
  } else if (settings.playoffs.divisionWinnersQualify && winners.length) {
    const guaranteed = winners.slice(0, Math.max(0, n));
    const otherSpots = Math.max(0, n - byPoints - guaranteed.length);
    const others = primary.filter((r) => !guaranteed.includes(r)).slice(0, otherSpots);
    seeds.push(...primary.filter((r) => guaranteed.includes(r) || others.includes(r)));
  } else {
    seeds.push(...primary.slice(0, Math.max(0, n - byPoints)));
  }
  const remaining = standings.filter((r) => !seeds.includes(r)).sort((a, b) => b.pointsFor - a.pointsFor);
  seeds.push(...remaining.slice(0, Math.max(0, Math.min(byPoints, n - seeds.length))));
  seeds = seeds.slice(0, Math.max(0, n));
  return seeds;
}
