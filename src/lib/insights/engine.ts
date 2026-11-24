// Manager insights engine: pure functions behind /team/insights and the lineup-warning job.
// Data loading lives in ./data.ts; everything here is deterministic and unit-tested (tests/insights.test.ts).
import { optimalLineup } from "@/lib/lineup";
import type { LeagueSettings } from "@/lib/settings/schema";
import {
  isDoubtfulStatus,
  isUnavailableStatus,
  placeInLineup,
  slotId,
  starterSet,
  type Assignment,
  type SlotDef,
} from "@/lib/team/lineup-model";

export { placeInLineup };

// ───────────────────────────── Start / Sit ─────────────────────────────

export interface StartSitPlayer {
  id: string;
  name: string;
  pos: string;
  projected: number;
  /** actual so far + remaining share of projection */
  liveProjected: number;
  /** POSITION_SD^2 * remaining fraction */
  variance: number;
  locked: boolean;
}

export interface LineupTotals {
  liveProjected: number;
  variance: number;
}

export interface StartSitSwap {
  inId: string;
  outId: string | null;
  /** slot the incoming player takes in the swap lineup */
  slot: string;
  gain: number;
  lineup: Assignment;
  totals: LineupTotals;
}

export interface StartSitResult {
  current: LineupTotals;
  optimal: LineupTotals;
  gain: number;
  swaps: StartSitSwap[];
}

export function lineupTotals(assign: Assignment, players: Map<string, StartSitPlayer>, base: LineupTotals = { liveProjected: 0, variance: 0 }): LineupTotals {
  let lp = base.liveProjected;
  let v = base.variance;
  for (const pid of Object.values(assign)) {
    const p = pid ? players.get(pid) : undefined;
    if (!p) continue;
    lp += p.liveProjected;
    v += p.variance;
  }
  return { liveProjected: Math.round(lp * 100) / 100, variance: v };
}

/**
 * Compare the current lineup with the optimal one and break the difference into individual one-for-one swaps,
 * each with a full valid lineup that can be saved on its own. `base` carries fixed points (adjustments/penalties).
 */
export function startSitAnalysis(input: {
  slots: SlotDef[];
  current: Assignment;
  optimal: Assignment;
  players: Map<string, StartSitPlayer>;
  base?: LineupTotals;
}): StartSitResult {
  const { slots, current, optimal, players } = input;
  const base = input.base ?? { liveProjected: 0, variance: 0 };
  const cur = starterSet(current);
  const opt = starterSet(optimal);
  const positions = new Map([...players.values()].map((p) => [p.id, p.pos]));
  const fixed = new Set(Object.entries(current).filter(([, pid]) => !!pid && players.get(pid!)?.locked).map(([k]) => k));
  const ins = [...opt].filter((id) => !cur.has(id) && players.has(id)).sort((a, b) => players.get(b)!.liveProjected - players.get(a)!.liveProjected);
  const outs: { playerId: string | null; slot: string }[] = Object.entries(current)
    .filter(([, pid]) => !pid || (!opt.has(pid) && !players.get(pid)?.locked))
    .map(([slot, pid]) => ({ playerId: pid ?? null, slot }))
    .sort((a, b) => (a.playerId ? players.get(a.playerId)?.liveProjected ?? 0 : -Infinity) - (b.playerId ? players.get(b.playerId)?.liveProjected ?? 0 : -Infinity));

  const currentTotals = lineupTotals(current, players, base);
  const swaps: StartSitSwap[] = [];
  const usedOuts = new Set<number>();
  for (const inId of ins) {
    const inP = players.get(inId)!;
    for (let i = 0; i < outs.length; i++) {
      if (usedOuts.has(i)) continue;
      const out = outs[i];
      const outP = out.playerId ? players.get(out.playerId) : undefined;
      const gain = Math.round((inP.liveProjected - (outP?.liveProjected ?? 0)) * 100) / 100;
      if (gain <= 0) continue;
      const start: Assignment = { ...current, [out.slot]: null };
      const placed = placeInLineup(start, slots, positions, inId, fixed, out.slot);
      if (!placed) continue;
      usedOuts.add(i);
      const slot = Object.entries(placed).find(([, pid]) => pid === inId)![0];
      swaps.push({ inId, outId: out.playerId, slot, gain, lineup: placed, totals: lineupTotals(placed, players, base) });
      break;
    }
  }
  const optimalTotals = lineupTotals(optimal, players, base);
  return {
    current: currentTotals,
    optimal: optimalTotals,
    gain: Math.round((optimalTotals.liveProjected - currentTotals.liveProjected) * 100) / 100,
    swaps: swaps.sort((a, b) => b.gain - a.gain),
  };
}

// ───────────────────────────── Matchup difficulty (fantasy points allowed) ─────────────────────────────

export interface DvpRow {
  pos: string;
  /** defense the player faced */
  opponent: string;
  week: number;
  points: number;
}

export interface DvpEntry {
  team: string;
  pos: string;
  total: number;
  games: number;
  perGame: number;
  /** 1 = toughest (fewest points allowed) … N = easiest */
  rank: number;
}

export interface DvpTable {
  positions: string[];
  teamCount: Record<string, number>;
  byPos: Record<string, DvpEntry[]>;
  get(pos: string, team: string | null | undefined): DvpEntry | undefined;
}

export function defenseVsPosition(rows: DvpRow[], positions: string[]): DvpTable {
  const totals = new Map<string, number>(); // pos|team -> pts
  const games = new Map<string, Set<number>>(); // team -> weeks faced
  for (const r of rows) {
    if (!r.opponent) continue;
    if (!games.has(r.opponent)) games.set(r.opponent, new Set());
    games.get(r.opponent)!.add(r.week);
    if (!positions.includes(r.pos)) continue;
    const k = `${r.pos}|${r.opponent}`;
    totals.set(k, (totals.get(k) ?? 0) + r.points);
  }
  const byPos: Record<string, DvpEntry[]> = {};
  const teamCount: Record<string, number> = {};
  const index = new Map<string, DvpEntry>();
  for (const pos of positions) {
    const list: DvpEntry[] = [];
    for (const [team, weeks] of games) {
      const total = Math.round((totals.get(`${pos}|${team}`) ?? 0) * 100) / 100;
      const g = weeks.size;
      list.push({ team, pos, total, games: g, perGame: g ? Math.round((total / g) * 100) / 100 : 0, rank: 0 });
    }
    list.sort((a, b) => a.perGame - b.perGame || a.team.localeCompare(b.team));
    list.forEach((e, i) => {
      e.rank = i + 1;
      index.set(`${pos}|${e.team}`, e);
    });
    byPos[pos] = list;
    teamCount[pos] = list.length;
  }
  return { positions, teamCount, byPos, get: (pos, team) => (team ? index.get(`${pos}|${team}`) : undefined) };
}

export type Difficulty = "easy" | "avg" | "tough";

/** Thirds of the league: rank 1..N where 1 = toughest */
export function difficultyFor(rank: number, total: number): Difficulty {
  if (!total) return "avg";
  if (rank <= Math.round(total / 3)) return "tough";
  if (rank > Math.round((2 * total) / 3)) return "easy";
  return "avg";
}

// ───────────────────────────── Lineup efficiency ─────────────────────────────

export interface WeekEfficiency {
  week: number;
  actual: number;
  optimal: number;
  left: number;
  /** 0..1 */
  pct: number;
}

/** Actual starter points vs the best possible lineup from `candidates` (optimalLineup on actual points). */
export function weekEfficiency(
  week: number,
  starters: string[],
  candidates: { id: string; position: string }[],
  points: Map<string, number>,
  settings: LeagueSettings,
): WeekEfficiency {
  const actual = round2(starters.reduce((a, id) => a + (points.get(id) ?? 0), 0));
  const pool = new Map(candidates.map((c) => [c.id, c]));
  const best = optimalLineup([...pool.values()], points, settings);
  const optimalRaw = best.reduce((a, s) => a + (s.playerId ? Math.max(0, points.get(s.playerId) ?? 0) : 0), 0);
  const optimal = round2(Math.max(actual, optimalRaw));
  const left = round2(optimal - actual);
  return { week, actual, optimal, left, pct: optimal > 0 ? actual / optimal : 1 };
}

export interface EfficiencySummary {
  teamId: string;
  actual: number;
  optimal: number;
  left: number;
  pct: number;
  rank: number;
}

export function efficiencyTable(rows: { teamId: string; weeks: WeekEfficiency[] }[]): EfficiencySummary[] {
  const list = rows.map((r) => {
    const actual = round2(r.weeks.reduce((a, w) => a + w.actual, 0));
    const optimal = round2(r.weeks.reduce((a, w) => a + w.optimal, 0));
    return { teamId: r.teamId, actual, optimal, left: round2(optimal - actual), pct: optimal > 0 ? actual / optimal : 1, rank: 0 };
  });
  list.sort((a, b) => b.pct - a.pct || a.left - b.left);
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}

// ───────────────────────────── Position needs & waiver targets ─────────────────────────────

/** Starters needed per position: dedicated slots (single-position) count fully, multi-position slots are shared. */
export function startersByPosition(slots: SlotDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slots) if (s.eligible.length === 1) out[s.eligible[0]] = (out[s.eligible[0]] ?? 0) + 1;
  for (const s of slots) for (const p of s.eligible) if (!(p in out)) out[p] = 0;
  // positions that only appear in flex slots still need one body to be meaningful
  for (const p of Object.keys(out)) if (out[p] === 0) out[p] = 1;
  return out;
}

/** Average value of a team's top-k players at each position (k = starters needed). */
export function positionStrength(players: { pos: string; value: number }[], need: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [pos, k] of Object.entries(need)) {
    const vals = players.filter((p) => p.pos === pos).map((p) => p.value).sort((a, b) => b - a).slice(0, k);
    while (vals.length < k) vals.push(0);
    out[pos] = round2(vals.reduce((a, b) => a + b, 0) / Math.max(1, k));
  }
  return out;
}

export interface PositionNeed {
  pos: string;
  mine: number;
  leagueAvg: number;
  /** 1 = strongest in league */
  rank: number;
  of: number;
  diff: number;
}

export function positionNeeds(myTeamId: string, strengths: { teamId: string; strength: Record<string, number> }[]): PositionNeed[] {
  const mine = strengths.find((s) => s.teamId === myTeamId);
  if (!mine) return [];
  const out: PositionNeed[] = [];
  for (const pos of Object.keys(mine.strength)) {
    const vals = strengths.map((s) => s.strength[pos] ?? 0);
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const m = mine.strength[pos] ?? 0;
    const rank = 1 + vals.filter((v) => v > m).length;
    out.push({ pos, mine: m, leagueAvg: round2(avg), rank, of: vals.length, diff: round2(m - avg) });
  }
  // weakest first: worst rank, then biggest shortfall
  return out.sort((a, b) => b.rank / b.of - a.rank / a.of || a.diff - b.diff);
}

export interface UpgradeCandidate<T> {
  player: T;
  value: number;
  /** improvement over the weakest of my starters-level players at the position */
  upgrade: number;
  replaces: string | null;
}

/** Free agents that beat my k-th best player at a position, best first. */
export function waiverUpgrades<T extends { id: string; pos: string; value: number }>(
  pos: string,
  need: number,
  myPlayers: { id: string; name: string; pos: string; value: number }[],
  freeAgents: T[],
  limit = 5,
): UpgradeCandidate<T>[] {
  const mine = myPlayers.filter((p) => p.pos === pos).sort((a, b) => b.value - a.value);
  const bar = mine[Math.max(0, need - 1)];
  const barValue = bar?.value ?? 0;
  return freeAgents
    .filter((f) => f.pos === pos && f.value > barValue)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((f) => ({ player: f, value: round2(f.value), upgrade: round2(f.value - barValue), replaces: bar?.name ?? null }));
}

// ───────────────────────────── Bye-week planner ─────────────────────────────

export interface ByePlayer {
  id: string;
  name: string;
  pos: string;
  team: string | null;
  starter: boolean;
  unavailable: boolean;
}

export interface ByeWeekPlan {
  week: number;
  onBye: ByePlayer[];
  startersOnBye: number;
  /** positions where healthy, non-bye players can't cover the dedicated starting slots */
  short: { pos: string; have: number; need: number }[];
}

export function byePlanner(weeks: number[], players: ByePlayer[], byes: Map<string, number[]>, need: Record<string, number>): ByeWeekPlan[] {
  return weeks.map((week) => {
    const onBye = players.filter((p) => p.team && (byes.get(p.team) ?? []).includes(week));
    const byeIds = new Set(onBye.map((p) => p.id));
    const short: ByeWeekPlan["short"] = [];
    for (const [pos, k] of Object.entries(need)) {
      const have = players.filter((p) => p.pos === pos && !p.unavailable && !byeIds.has(p.id) && p.team).length;
      if (have < k && players.some((p) => p.pos === pos)) short.push({ pos, have, need: k });
    }
    return { week, onBye, startersOnBye: onBye.filter((p) => p.starter).length, short };
  });
}

// ───────────────────────────── Roster age & contract snapshot ─────────────────────────────

export interface AgeRow {
  pos: string;
  mine: number | null;
  league: number | null;
  count: number;
}

export function ageByPosition(mine: { pos: string; age: number | null }[], league: { pos: string; age: number | null }[], positions: string[]): AgeRow[] {
  const avg = (list: { pos: string; age: number | null }[], pos: string) => {
    const ages = list.filter((p) => p.pos === pos && p.age).map((p) => p.age!);
    return ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null;
  };
  return positions
    .map((pos) => ({ pos, mine: avg(mine, pos), league: avg(league, pos), count: mine.filter((p) => p.pos === pos).length }))
    .filter((r) => r.count > 0 || r.league !== null);
}

export function contractYearsHistogram(spots: { contractYears: number }[], maxYears: number): { years: number; count: number }[] {
  const out: { years: number; count: number }[] = [];
  for (let y = 1; y <= Math.max(1, maxYears); y++) out.push({ years: y, count: spots.filter((s) => (y === maxYears ? s.contractYears >= y : s.contractYears === y)).length });
  return out;
}

// ───────────────────────────── Lineup warnings (job) ─────────────────────────────

export interface WarningPlayer {
  id: string;
  fullName: string;
  team: string | null;
  injuryStatus: string | null;
}

export interface LineupWarning {
  /** dedupe key part: playerId, or slot id for empty slots */
  key: string;
  kind: "empty" | "bye" | "injury" | "doubtful";
  slotLabel: string;
  playerName: string | null;
  status: string | null;
  kickoff: Date;
}

/**
 * Starters that need attention before their relevant kickoff: empty slots and bye-week starters (relevant kickoff =
 * next kickoff of the week), Out/IR/Doubtful/Suspended starters (their own game). Only warnings whose kickoff falls
 * within `hoursBefore` hours from `now` and hasn't started are returned; locked slots are skipped.
 */
export function findLineupWarnings(input: {
  slots: SlotDef[];
  lineup: Assignment;
  players: Map<string, WarningPlayer>;
  games: Map<string, { startTime: Date; state: string }>;
  now: Date;
  hoursBefore: number;
  isLocked: (team: string | null) => boolean;
}): LineupWarning[] {
  const { slots, lineup, players, games, now, hoursBefore } = input;
  if (!hoursBefore || hoursBefore <= 0) return [];
  const horizon = now.getTime() + hoursBefore * 3600_000;
  const upcoming = [...new Set(games.values())].filter((g) => g.state === "pre" && g.startTime.getTime() > now.getTime()).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const next = upcoming[0]?.startTime ?? null;
  const out: LineupWarning[] = [];
  const within = (d: Date | null): d is Date => !!d && d.getTime() > now.getTime() && d.getTime() <= horizon;
  for (const s of slots) {
    const id = slotId(s.key, s.index);
    const pid = lineup[id] ?? null;
    const p = pid ? players.get(pid) : undefined;
    if (!pid || !p) {
      if (input.isLocked(null)) continue;
      if (within(next)) out.push({ key: id, kind: "empty", slotLabel: s.label, playerName: null, status: null, kickoff: next });
      continue;
    }
    if (input.isLocked(p.team)) continue;
    const game = p.team ? games.get(p.team) : undefined;
    if (!game) {
      if (within(next)) out.push({ key: p.id, kind: "bye", slotLabel: s.label, playerName: p.fullName, status: null, kickoff: next });
      continue;
    }
    if (game.state !== "pre") continue;
    const bad = isUnavailableStatus(p.injuryStatus) ? "injury" : isDoubtfulStatus(p.injuryStatus) ? "doubtful" : null;
    if (bad && within(game.startTime)) out.push({ key: p.id, kind: bad, slotLabel: s.label, playerName: p.fullName, status: p.injuryStatus, kickoff: game.startTime });
  }
  return out;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
