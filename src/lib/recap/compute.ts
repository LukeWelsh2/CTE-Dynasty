// Pure recap computations (no database access): historical roster reconstruction, lineup analysis
// (hindsight-optimal lineup, start/sit decisions, bench misses), weekly awards, matchup of the week,
// standings / playoff-odds movement, marquee NFL games and the recap schedule. Unit-tested in tests/recap.test.ts.
import { optimalLineup } from "@/lib/lineup";
import type { LeagueSettings, Weekday } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import type {
  AwardKey,
  BenchMiss,
  ConfigurableAward,
  EfficiencyRow,
  LineupDecision,
  MarqueeGame,
  OddsMoveRow,
  PlayerPerf,
  PreviewMatchup,
  RecapAward,
  RecapContent,
  RecapPlayoffGame,
  StandingsMoveRow,
} from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function fmtNum(n: number, decimals: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(Math.max(0, Math.min(2, decimals)));
}

export function median(nums: readonly number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function ordinalWord(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ───────────────────────────── Roster reconstruction ─────────────────────────────

export type RosterEvent =
  | { at: number; kind: "ADD"; teamId: string; playerId: string }
  | { at: number; kind: "DROP"; teamId: string; playerId: string }
  | { at: number; kind: "MOVE"; fromTeamId: string; toTeamId: string; playerId: string };

/**
 * Owner (team id) of every rostered player at time `at`: start from the current rosters and undo, newest
 * first, every roster event that happened after `at`.
 */
export function rosterAt(current: ReadonlyMap<string, string>, events: readonly RosterEvent[], at: number): Map<string, string> {
  const owner = new Map(current);
  const later = events.filter((e) => e.at > at).sort((a, b) => b.at - a.at);
  for (const e of later) {
    if (e.kind === "ADD") owner.delete(e.playerId);
    else if (e.kind === "DROP") owner.set(e.playerId, e.teamId);
    else owner.set(e.playerId, e.fromTeamId);
  }
  return owner;
}

/**
 * Which team each player belonged to at his own lineup lock this week (the moment a manager last could have
 * started him). Players without a game this week use `fallbackAt` (end of the week).
 */
export function ownershipAtLock(
  current: ReadonlyMap<string, string>,
  events: readonly RosterEvent[],
  lockByPlayer: ReadonlyMap<string, number>,
  fallbackAt: number,
): Map<string, string> {
  const times = new Set<number>([fallbackAt, ...lockByPlayer.values()]);
  const out = new Map<string, string>();
  for (const t of times) {
    const snap = rosterAt(current, events, t);
    for (const [pid, teamId] of snap) {
      if ((lockByPlayer.get(pid) ?? fallbackAt) === t) out.set(pid, teamId);
    }
  }
  return out;
}

/**
 * Roster effect of a COMMISSIONER transaction, read from its description: force add ("Commissioner added X
 * to T", "Restored X (trade reversal)"), force drop ("Commissioner dropped X from T") or a move between teams
 * ("Commissioner moved X from A to B": teamId = destination, relatedTeamId = origin). Contract edits, FAB
 * adjustments and pick moves have no roster effect (null).
 */
export function commissionerRosterEvent(t: {
  at: number;
  teamId: string | null;
  relatedTeamId: string | null;
  playerId: string | null;
  description: string;
}): RosterEvent | null {
  if (!t.teamId || !t.playerId) return null;
  const d = t.description.trim().replace(/^commissioner\s+/i, "");
  if (/^(moved|transferred|reassigned)\b/i.test(d)) {
    return t.relatedTeamId && t.relatedTeamId !== t.teamId ? { at: t.at, kind: "MOVE", fromTeamId: t.relatedTeamId, toTeamId: t.teamId, playerId: t.playerId } : null;
  }
  if (/^(added|restored|force[- ]?added|assigned|signed)\b/i.test(d)) return { at: t.at, kind: "ADD", teamId: t.teamId, playerId: t.playerId };
  if (/^(dropped|removed|released|force[- ]?dropped|cut)\b/i.test(d)) return { at: t.at, kind: "DROP", teamId: t.teamId, playerId: t.playerId };
  return null;
}

/** Lineup lock time of a player whose NFL game kicks off at `kickoff`, per settings.lineup.lockType / lockOffsetMinutes. */
export function lockTimeFor(
  kickoff: number,
  week: { firstKickoff: number; firstSundayKickoff: number | null },
  lineup: Pick<LeagueSettings["lineup"], "lockType" | "lockOffsetMinutes">,
): number {
  const offset = Math.max(0, lineup.lockOffsetMinutes ?? 0) * 60_000;
  if (lineup.lockType === "FIRST_GAME_OF_WEEK") return week.firstKickoff - offset;
  if (lineup.lockType === "SUNDAY_FIRST_GAME") return Math.min(kickoff, week.firstSundayKickoff ?? kickoff) - offset;
  return kickoff - offset;
}

// ───────────────────────────── Lineup analysis ─────────────────────────────

export interface SlotStart {
  slot: string;
  slotIndex: number;
  label: string;
  eligible: string[];
  player: PlayerPerf | null;
}

export interface TeamWeekInput {
  teamId: string;
  starters: SlotStart[];
  /** bench players who could have started (on the roster at their lock, not IR / taxi) */
  bench: PlayerPerf[];
}

export interface TeamWeekAnalysis {
  teamId: string;
  starterPoints: number;
  projected: number;
  optimalPoints: number;
  efficiency: number;
  pointsLeft: number;
  top: PlayerPerf | null;
  decisions: LineupDecision[];
  biggestMiss: BenchMiss | null;
  /** player ids of the hindsight-optimal lineup */
  optimalIds: string[];
}

/** Hindsight analysis of one team's week: optimal lineup on ACTUAL points, efficiency and every start/sit decision. */
export function analyzeTeamWeek(input: TeamWeekInput, settings: LeagueSettings): TeamWeekAnalysis {
  const started = input.starters.filter((s): s is SlotStart & { player: PlayerPerf } => !!s.player);
  const starterIds = new Set(started.map((s) => s.player.id));
  const bench = input.bench.filter((b) => !starterIds.has(b.id));
  const starterPoints = round2(started.reduce((a, s) => a + s.player.points, 0));
  const projected = round2(started.reduce((a, s) => a + s.player.projected, 0));

  const pool = new Map<string, PlayerPerf>();
  for (const s of started) pool.set(s.player.id, s.player);
  for (const b of bench) if (!pool.has(b.id)) pool.set(b.id, b);
  const value = new Map([...pool.values()].map((p) => [p.id, p.points]));
  const opt = optimalLineup([...pool.values()].map((p) => ({ id: p.id, position: p.position })), value, settings);
  const optimalIds = opt.map((a) => a.playerId).filter((x): x is string => !!x);
  // the greedy optimizer can't do worse than what was actually started; guard odd slot configurations
  const optimalPoints = round2(Math.max(starterPoints, optimalIds.reduce((a, id) => a + (value.get(id) ?? 0), 0)));
  const efficiency = optimalPoints > 0 ? Math.max(0, Math.min(1, starterPoints / optimalPoints)) : 1;

  const decisions: LineupDecision[] = [];
  for (const s of started) {
    let alt: PlayerPerf | null = null;
    for (const b of bench) {
      if (!s.eligible.includes(normalizePosition(b.position))) continue;
      if (!alt || b.points > alt.points || (b.points === alt.points && b.projected > alt.projected)) alt = b;
    }
    if (!alt) continue;
    decisions.push({
      slotLabel: s.label,
      started: { ...s.player, slot: s.label },
      alternative: alt,
      margin: round2(s.player.points - alt.points),
      projGap: round2(s.player.projected - alt.projected),
    });
  }
  const worst = decisions.reduce<LineupDecision | null>((a, d) => (d.margin < 0 && (!a || d.margin < a.margin) ? d : a), null);
  const top = started.reduce<PlayerPerf | null>((a, s) => (!a || s.player.points > a.points ? { ...s.player, slot: s.label } : a), null);
  return {
    teamId: input.teamId,
    starterPoints,
    projected,
    optimalPoints,
    efficiency,
    pointsLeft: round2(optimalPoints - starterPoints),
    top,
    decisions,
    biggestMiss: worst ? { benched: worst.alternative, started: worst.started, slotLabel: worst.slotLabel, diff: round2(-worst.margin) } : null,
    optimalIds,
  };
}

/** Lineup efficiency leaderboard: best (actual / optimal) first, ties broken by fewer points left. */
export function efficiencyBoard(analyses: readonly TeamWeekAnalysis[]): EfficiencyRow[] {
  return analyses
    .map((a) => ({ teamId: a.teamId, starterPoints: a.starterPoints, optimalPoints: a.optimalPoints, efficiency: a.efficiency, pointsLeft: a.pointsLeft }))
    .sort((a, b) => b.efficiency - a.efficiency || a.pointsLeft - b.pointsLeft || b.starterPoints - a.starterPoints);
}

/**
 * Best lineup decision of the week: a started player who outscored the best eligible bench alternative.
 * Real choices come first (the alternative was projected within 3 points or higher); then plausible ones
 * (alternative projected ≥ 60% of the starter); otherwise the largest margin overall.
 */
export function bestDecision(all: readonly { teamId: string; decision: LineupDecision }[]): { teamId: string; decision: LineupDecision } | null {
  const positive = all.filter((d) => d.decision.margin > 0 && d.decision.alternative.points > 0);
  const tiers = [
    positive.filter((d) => d.decision.projGap <= 3),
    positive.filter((d) => d.decision.alternative.projected >= 0.6 * d.decision.started.projected),
    positive,
  ];
  for (const tier of tiers) {
    if (!tier.length) continue;
    return [...tier].sort((a, b) => b.decision.margin - a.decision.margin || a.decision.projGap - b.decision.projGap)[0];
  }
  return null;
}

// ───────────────────────────── Awards ─────────────────────────────

export interface AwardSide {
  teamId: string;
  score: number;
}

/**
 * A week of a multi-week playoff game (settings.playoffs.weeksPerRound / championshipWeeks): the game's combined
 * score through this week and whether it ended this week. Results, margins and luck follow the game, not the week.
 */
export interface AwardGame {
  /** this week within the game (1-based) */
  leg: number;
  legs: number;
  /** combined score through this week */
  homeScore: number;
  awayScore: number;
  /** this was the game's last week */
  decided: boolean;
  /** the game's winner (the bracket's result) once decided */
  winnerTeamId: string | null;
}

export interface AwardMatchup {
  id: string;
  home: AwardSide;
  away: AwardSide;
  winnerTeamId: string | null;
  /** set for a week of a multi-week playoff game */
  game?: AwardGame | null;
}

export interface WaiverPickup {
  teamId: string;
  player: PlayerPerf;
  started: boolean;
  via: "WAIVER" | "FREE_AGENT";
  faab: number | null;
  /** pre-formatted acquisition date ("Oct 29") */
  acquiredLabel: string;
}

export interface AwardInputs {
  matchups: readonly AwardMatchup[];
  analyses: ReadonlyMap<string, TeamWeekAnalysis>;
  name: (teamId: string) => string;
  decimals: number;
  enabled: ReadonlySet<ConfigurableAward>;
  pickups: readonly WaiverPickup[];
  /** settings.niche.weeklyHighScorePrize */
  highScorePrize: number;
}

export interface SideGame {
  /** combined score through this week, this side first */
  score: number;
  opponentScore: number;
  leg: number;
  legs: number;
  decided: boolean;
}

export interface SideResult {
  teamId: string;
  opponentId: string;
  /** this week's score */
  score: number;
  opponentScore: number;
  /** W / L / T; P = a week of a multi-week playoff game that isn't over yet (no result) */
  result: "W" | "L" | "T" | "P";
  matchupId: string;
  /** a week of a multi-week playoff game */
  game?: SideGame | null;
}

/**
 * Every team's result this week (both sides of every two-team matchup). A week of a multi-week playoff game carries
 * the game's result once it ended this week (its winner from the bracket, even if that team lost the week) and no
 * result ("P") before that.
 */
export function sideResults(matchups: readonly AwardMatchup[]): SideResult[] {
  const out: SideResult[] = [];
  for (const m of matchups) {
    const g = m.game ?? null;
    const winner = g
      ? g.decided
        ? g.winnerTeamId ?? (g.homeScore > g.awayScore ? m.home.teamId : g.awayScore > g.homeScore ? m.away.teamId : null)
        : null
      : m.winnerTeamId ?? (m.home.score > m.away.score ? m.home.teamId : m.away.score > m.home.score ? m.away.teamId : null);
    for (const [me, opp] of [
      [m.home, m.away],
      [m.away, m.home],
    ] as const) {
      const isHome = me === m.home;
      out.push({
        teamId: me.teamId,
        opponentId: opp.teamId,
        score: me.score,
        opponentScore: opp.score,
        result: g && !g.decided ? "P" : winner === null ? "T" : winner === me.teamId ? "W" : "L",
        matchupId: m.id,
        ...(g ? { game: { score: isHome ? g.homeScore : g.awayScore, opponentScore: isHome ? g.awayScore : g.homeScore, leg: g.leg, legs: g.legs, decided: g.decided } } : {}),
      });
    }
  }
  return out;
}

/**
 * Where a multi-week playoff game stood at the end of the recap's week: "Aces leads Dukes 140.00–100.00 after week 1
 * of 2", "Level at 120.00 after week 1 of 2", "Aces beat Dukes 245.00–230.00 over 2 weeks".
 */
export function recapGameLine(
  g: Pick<RecapPlayoffGame, "leg" | "legs" | "homeTotal" | "awayTotal" | "decided" | "winnerTeamId">,
  home: { id: string; name: string },
  away: { id: string; name: string },
  decimals: number,
): string {
  const f = (n: number) => fmtNum(n, decimals);
  const homeAhead = g.decided && g.winnerTeamId ? g.winnerTeamId === home.id : g.homeTotal > g.awayTotal;
  const [a, b, at, bt] = homeAhead ? [home.name, away.name, g.homeTotal, g.awayTotal] : [away.name, home.name, g.awayTotal, g.homeTotal];
  if (g.decided) return at === bt ? `${a} and ${b} finished level at ${f(at)} over ${g.legs} weeks; ${a} won on the tiebreaker` : `${a} beat ${b} ${f(at)}–${f(bt)} over ${g.legs} weeks`;
  if (g.homeTotal === g.awayTotal) return `Level at ${f(g.homeTotal)} after week ${g.leg} of ${g.legs}`;
  return `${a} leads ${b} ${f(at)}–${f(bt)} after week ${g.leg} of ${g.legs}`;
}

/** Next week is a later week of a multi-week playoff game: "Week 2 of 2 · Aces lead 140.00–100.00 (game odds)". */
export function previewGameNote(c: Pick<RecapContent, "decimals" | "teams">, m: PreviewMatchup): string {
  const g = m.game;
  if (!g) return "";
  if (g.leg === 1) return `Week 1 of ${g.legs} · odds for the whole ${g.legs}-week game`;
  const n = (x: number) => fmtNum(x, c.decimals);
  const h = c.teams[m.home.teamId]?.name ?? "Home";
  const a = c.teams[m.away.teamId]?.name ?? "Away";
  const stand = g.homeBefore > g.awayBefore ? `${h} leads ${n(g.homeBefore)}–${n(g.awayBefore)}` : g.awayBefore > g.homeBefore ? `${a} leads ${n(g.awayBefore)}–${n(g.homeBefore)}` : `Level at ${n(g.homeBefore)}`;
  return `Week ${g.leg} of ${g.legs} · ${stand} · odds for the whole game`;
}

/** "after week 1 of 2" */
export function legPhrase(g: Pick<SideGame, "leg" | "legs">): string {
  return `after week ${g.leg} of ${g.legs}`;
}

/** Score and margin a side's game is decided by: the combined score for a multi-week game, the week's otherwise. */
export function gameScores(s: SideResult): { score: number; opponentScore: number; weeks: number } {
  return s.game ? { score: s.game.score, opponentScore: s.game.opponentScore, weeks: s.game.legs } : { score: s.score, opponentScore: s.opponentScore, weeks: 1 };
}

/**
 * Would the side's hindsight-optimal lineup this week have won (or tied → won) the game? `optimal` and `starter` are
 * this week's starter points; adjustments carry over. A multi-week game is judged on its combined score, and only in
 * the week it was decided.
 */
export function optimalFlips(s: SideResult, optimal: number, starter: number): boolean {
  if (s.result === "W" || s.result === "P") return false;
  const adj = s.score - starter;
  const before = s.game ? s.game.score - s.score : 0;
  const opp = s.game ? s.game.opponentScore : s.opponentScore;
  return before + optimal + adj > opp;
}

/** Number of other teams a score would have beaten this week (all-play wins). */
export function allPlayWins(score: number, scores: readonly number[]): number {
  return scores.filter((s) => s < score).length;
}

/** "in a win over X" / "and still lost to X" / "to lead X 140–100 after week 1 of 2" for the high (or low) score of the week. */
export function resultPhrase(t: SideResult, name: (id: string) => string, f: (n: number) => string, kind: "high" | "low"): string {
  const opp = name(t.opponentId);
  const g = t.game;
  if (g && t.result === "P") {
    const standing = g.score > g.opponentScore ? "lead" : g.score < g.opponentScore ? "trail" : "level";
    const tally = `${f(g.score)}–${f(g.opponentScore)} ${legPhrase(g)}`;
    if (standing === "level") return `with the game against ${opp} level ${legPhrase(g)}`;
    if (kind === "high") return standing === "lead" ? `to lead ${opp} ${tally}` : `but still trails ${opp} ${tally}`;
    return standing === "lead" ? `but still leads ${opp} ${tally}` : `and trails ${opp} ${tally}`;
  }
  const multi = g ? `${g.legs}-week ` : "";
  if (kind === "high") return t.result === "W" ? (g ? `on the way to a ${multi}win over ${opp}` : `in a win over ${opp}`) : t.result === "T" ? `in a tie with ${opp}` : g ? `and still lost the ${multi}game to ${opp}` : `and still lost to ${opp}`;
  return t.result === "W" ? (g ? `and still won the ${multi}game against ${opp}` : `and somehow still beat ${opp}`) : t.result === "T" ? `and tied ${opp}` : g ? `as ${opp} won the ${multi}game` : `in a loss to ${opp}`;
}

/** All weekly awards, in display order. Configurable awards follow settings.niche.weeklyAwards. */
export function computeAwards(input: AwardInputs): RecapAward[] {
  const { name, decimals, enabled } = input;
  const f = (n: number) => fmtNum(n, decimals);
  const sides = sideResults(input.matchups);
  if (!sides.length) return [];
  const scores = sides.map((s) => s.score);
  const med = median(scores);
  const n = sides.length;
  const awards: RecapAward[] = [];
  const add = (key: AwardKey, a: Omit<RecapAward, "key">) => awards.push({ key, ...a });
  const on = (k: ConfigurableAward) => enabled.has(k);
  const byScoreDesc = [...sides].sort((a, b) => b.score - a.score || a.teamId.localeCompare(b.teamId));

  if (on("TOP_SCORE")) {
    const t = byScoreDesc[0];
    const top = input.analyses.get(t.teamId)?.top;
    const result = resultPhrase(t, name, f, "high");
    const prize = input.highScorePrize > 0 ? ` Collects the $${input.highScorePrize.toLocaleString("en-US")} weekly high-score prize.` : "";
    add("TOP_SCORE", {
      title: "Manager of the Week",
      teamId: t.teamId,
      value: `${f(t.score)} pts`,
      detail: `Highest score of the week ${result}.${top ? ` ${top.name} led the way with ${f(top.points)}.` : ""}${prize}`,
      player: top ?? null,
      matchupId: t.matchupId,
    });
  }

  if (on("LOWEST_SCORE")) {
    const t = byScoreDesc[byScoreDesc.length - 1];
    const result = resultPhrase(t, name, f, "low");
    add("LOWEST_SCORE", {
      title: "Low Score of the Week",
      teamId: t.teamId,
      value: `${f(t.score)} pts`,
      detail: `Week-low output ${result}. League median was ${f(med)}.`,
      matchupId: t.matchupId,
    });
  }

  // games decided this week (a multi-week playoff game by its combined score, in its last week; earlier weeks of it
  // decided nothing yet), winner's side first
  const decided = input.matchups
    .map((m) => {
      const s = sides.find((x) => x.matchupId === m.id && (x.result === "W" || x.result === "T"));
      if (!s) return null;
      const g = gameScores(s);
      return { m, winner: s, ...g, margin: round2(Math.abs(g.score - g.opponentScore)) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const overWeeks = (weeks: number) => (weeks > 1 ? ` over ${weeks} weeks` : "");

  if (on("BIGGEST_BLOWOUT") && decided.length) {
    const b = [...decided].filter((d) => d.winner.result === "W").sort((a, c) => c.margin - a.margin)[0];
    if (b)
      add("BIGGEST_BLOWOUT", {
        title: "Biggest Blowout",
        teamId: b.winner.teamId,
        value: `+${f(b.margin)}`,
        detail: `${name(b.winner.teamId)} beat ${name(b.winner.opponentId)} ${f(b.score)}–${f(b.opponentScore)}${overWeeks(b.weeks)}.`,
        matchupId: b.m.id,
      });
  }

  if (on("CLOSEST_GAME") && decided.length) {
    const c = [...decided].sort((a, b) => a.margin - b.margin || b.score + b.opponentScore - (a.score + a.opponentScore))[0];
    add("CLOSEST_GAME", {
      title: "Closest Game",
      teamId: c.winner.teamId,
      value: c.margin === 0 ? (c.winner.result === "T" ? "Tie" : "Tiebreak") : `${f(c.margin)} pts`,
      detail:
        c.winner.result === "T"
          ? `${name(c.winner.teamId)} and ${name(c.winner.opponentId)} finished dead even at ${f(c.score)}.`
          : c.margin === 0
            ? `${name(c.winner.teamId)} and ${name(c.winner.opponentId)} finished level at ${f(c.score)}${overWeeks(c.weeks)}; ${name(c.winner.teamId)} won on the tiebreaker.`
            : `${name(c.winner.teamId)} edged ${name(c.winner.opponentId)} ${f(c.score)}–${f(c.opponentScore)}${overWeeks(c.weeks)}.`,
      matchupId: c.m.id,
    });
  }

  const allDecisions = [...input.analyses.values()].flatMap((a) => a.decisions.map((d) => ({ teamId: a.teamId, decision: d })));
  const best = bestDecision(allDecisions);
  if (best) {
    const d = best.decision;
    const call = d.projGap < 0 ? `over the higher-projected ${d.alternative.name}` : `over ${d.alternative.name}`;
    add("BEST_DECISION", {
      title: "Best Lineup Decision",
      teamId: best.teamId,
      value: `+${f(d.margin)}`,
      detail: `Started ${d.started.name} (${f(d.started.points)}) at ${d.slotLabel} ${call} (${f(d.alternative.points)}).`,
      player: d.started,
    });
  }

  if (on("BENCH_BLUNDER")) {
    const worst = [...input.analyses.values()].filter((a) => a.pointsLeft > 0).sort((a, b) => b.pointsLeft - a.pointsLeft)[0];
    if (worst) {
      const side = sides.find((s) => s.teamId === worst.teamId);
      const flip = !!side && optimalFlips(side, worst.optimalPoints, worst.starterPoints);
      const miss = worst.biggestMiss;
      add("BENCH_BLUNDER", {
        title: "Bench Blunder",
        teamId: worst.teamId,
        value: `${f(worst.pointsLeft)} pts`,
        detail: `Left ${f(worst.pointsLeft)} points on the bench${miss ? `: ${miss.benched.name} scored ${f(miss.benched.points)} while ${miss.started.name} managed ${f(miss.started.points)}` : ""}.${
          flip && side ? ` The optimal lineup would have beaten ${name(side.opponentId)}${side.game ? ` over the ${side.game.legs} weeks` : ""}.` : ""
        }`,
        player: miss?.benched ?? null,
        matchupId: side?.matchupId ?? null,
      });
    }
  }

  // luck compares a week's score with that week's result: weeks of multi-week playoff games don't qualify
  const lucky = sides.filter((s) => !s.game && s.result === "W" && s.score < med).sort((a, b) => a.score - b.score)[0];
  if (lucky) {
    const ap = allPlayWins(lucky.score, scores);
    add("LUCKIEST_WIN", {
      title: "Luckiest Win",
      teamId: lucky.teamId,
      value: `${f(lucky.score)} pts`,
      detail: `Beat ${name(lucky.opponentId)} with a below-median score. Against the whole league that total goes ${ap}-${n - 1 - ap}.`,
      matchupId: lucky.matchupId,
    });
  }

  const unlucky = sides.filter((s) => !s.game && s.result === "L" && s.score > med).sort((a, b) => b.score - a.score)[0];
  if (unlucky) {
    const ap = allPlayWins(unlucky.score, scores);
    add("UNLUCKIEST_LOSS", {
      title: "Unluckiest Loss",
      teamId: unlucky.teamId,
      value: `${f(unlucky.score)} pts`,
      detail: `Lost to ${name(unlucky.opponentId)} despite an above-median score that beats ${ap} of ${n - 1} teams.`,
      matchupId: unlucky.matchupId,
    });
  }

  if (on("WAIVER_HERO")) {
    const hero = input.pickups.filter((p) => p.started && p.player.points > 0).sort((a, b) => b.player.points - a.player.points)[0];
    if (hero) {
      const how = hero.via === "WAIVER" ? `Claimed off waivers${hero.faab ? ` for $${hero.faab} FAB` : ""}` : `Signed as a free agent${hero.faab ? ` for $${hero.faab} FAB` : ""}`;
      add("WAIVER_HERO", {
        title: "Waiver Wire Hero",
        teamId: hero.teamId,
        value: `${f(hero.player.points)} pts`,
        detail: `${how} on ${hero.acquiredLabel}, ${hero.player.name} delivered ${f(hero.player.points)} in the lineup.`,
        player: hero.player,
      });
    }
  }
  return awards;
}

// ───────────────────────────── Matchup of the week ─────────────────────────────

export interface MotwCandidate {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  /** this week's scores */
  homeScore: number;
  awayScore: number;
  winnerTeamId: string | null;
  /** home win probability over time (may be empty) */
  wpHome: readonly number[];
  preGameHomeWinProb: number | null;
  /**
   * a week of a multi-week playoff game: the close-game test uses the combined score through this week, there is no
   * winner before the game's last week, and the week's win-probability track says nothing about the game (callers
   * pass an empty track, so it can't be a comeback or an upset)
   */
  game?: AwardGame | null;
}

export interface MotwPick {
  matchupId: string;
  reason: "COMEBACK" | "CLOSEST" | "SHOOTOUT" | "UPSET";
  winnerLowWinProb: number | null;
  winnerPreGameWinProb: number | null;
  wpSwing: number | null;
}

function winnerOf(c: MotwCandidate): string | null {
  if (c.game) return c.game.decided ? c.game.winnerTeamId : null;
  return c.winnerTeamId ?? (c.homeScore > c.awayScore ? c.homeTeamId : c.awayScore > c.homeScore ? c.awayTeamId : null);
}

/** Whether to call out the winner's in-game low: only when it dipped below where the winner started. */
export function showWinnerLow(winnerLow: number | null, winnerPre: number | null): boolean {
  if (winnerLow === null) return false;
  return winnerPre === null ? winnerLow < 0.5 : winnerLow < winnerPre - 0.005;
}

/** Win-probability facts for a matchup from its tracked series (winner perspective). */
export function wpFacts(c: MotwCandidate): { winnerLow: number | null; winnerPre: number | null; swing: number | null } {
  const w = winnerOf(c);
  const series = c.wpHome;
  const toWinner = (p: number) => (w === c.homeTeamId ? p : 1 - p);
  const winnerLow = w && series.length >= 2 ? Math.min(...series.map(toWinner)) : null;
  const winnerPre = w && c.preGameHomeWinProb !== null ? toWinner(c.preGameHomeWinProb) : null;
  const swing = series.length >= 2 ? Math.max(...series) - Math.min(...series) : null;
  return { winnerLow, winnerPre, swing };
}

/**
 * Matchup of the Week: a real comeback (winner's win probability fell to 25% or lower) beats a close game
 * (≤ 8 points; a multi-week playoff game by its combined score so far), then an upset (winner ≤ 30% before
 * kickoff); otherwise the highest combined score of the week.
 */
export function pickMatchupOfWeek(cands: readonly MotwCandidate[]): MotwPick | null {
  if (!cands.length) return null;
  // margin: how close the game is (a multi-week game: combined score so far); combined: this week's scoring
  const facts = cands.map((c) => ({ c, ...wpFacts(c), margin: c.game ? Math.abs(c.game.homeScore - c.game.awayScore) : Math.abs(c.homeScore - c.awayScore), combined: c.homeScore + c.awayScore }));
  const mk = (x: (typeof facts)[number], reason: MotwPick["reason"]): MotwPick => ({
    matchupId: x.c.id,
    reason,
    winnerLowWinProb: x.winnerLow,
    winnerPreGameWinProb: x.winnerPre,
    wpSwing: x.swing,
  });
  const comeback = facts.filter((x) => x.winnerLow !== null && x.winnerLow <= 0.25).sort((a, b) => a.winnerLow! - b.winnerLow!)[0];
  if (comeback) return mk(comeback, "COMEBACK");
  const close = facts.filter((x) => x.margin <= 8).sort((a, b) => a.margin - b.margin || b.combined - a.combined)[0];
  if (close) return mk(close, "CLOSEST");
  const upset = facts.filter((x) => x.winnerPre !== null && x.winnerPre <= 0.3).sort((a, b) => a.winnerPre! - b.winnerPre!)[0];
  if (upset) return mk(upset, "UPSET");
  return mk([...facts].sort((a, b) => b.combined - a.combined)[0], "SHOOTOUT");
}

/** Evenly downsample a series to at most `max` points (keeps first and last). */
export function downsample(series: readonly number[], max = 40): number[] {
  if (series.length <= max) return series.map((x) => Math.round(x * 1000) / 1000);
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(series[Math.round((i * (series.length - 1)) / (max - 1))]);
  return out.map((x) => Math.round(x * 1000) / 1000);
}

// ───────────────────────────── Standings & odds movement ─────────────────────────────

export interface StandingLite {
  teamId: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  streak: string;
}

export function standingsMovement(
  current: readonly StandingLite[],
  previousRanks: ReadonlyMap<string, number> | null,
  results: ReadonlyMap<string, "W" | "L" | "T">,
): StandingsMoveRow[] {
  return [...current]
    .sort((a, b) => a.rank - b.rank)
    .map((r) => {
      const prevRank = previousRanks?.get(r.teamId) ?? null;
      return {
        teamId: r.teamId,
        rank: r.rank,
        prevRank,
        change: prevRank === null ? 0 : prevRank - r.rank,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: r.pointsFor,
        streak: r.streak,
        result: results.get(r.teamId) ?? null,
      };
    });
}

export interface OddsLite {
  teamId: string;
  playoffPct: number;
  champPct?: number;
}

export function oddsMovement(before: readonly OddsLite[] | null, after: readonly OddsLite[]): OddsMoveRow[] {
  const prev = new Map((before ?? []).map((o) => [o.teamId, o.playoffPct]));
  return after
    .map((o) => {
      const b = prev.get(o.teamId) ?? o.playoffPct;
      return { teamId: o.teamId, before: b, after: o.playoffPct, delta: Math.round((o.playoffPct - b) * 10_000) / 10_000, champAfter: o.champPct ?? 0 };
    })
    .sort((a, b) => b.after - a.after || b.delta - a.delta);
}

/**
 * Pick the snapshots that bracket this week's results: the latest snapshot with results through ≤ `week`
 * ("after") and the latest one with results through an earlier week ("before").
 */
export function pickOddsSnapshots<T extends { throughWeek: number | null; computedAt: number }>(snaps: readonly T[], week: number): { before: T | null; after: T | null } {
  const usable = snaps.filter((s): s is T & { throughWeek: number } => s.throughWeek !== null && s.throughWeek <= week).sort((a, b) => b.computedAt - a.computedAt);
  const after = [...usable].sort((a, b) => b.throughWeek - a.throughWeek || b.computedAt - a.computedAt)[0] ?? null;
  if (!after) return { before: null, after: null };
  const before = usable.filter((s) => s.throughWeek < after.throughWeek).sort((a, b) => b.throughWeek - a.throughWeek || b.computedAt - a.computedAt)[0] ?? null;
  return { before, after };
}

// ───────────────────────────── Next week ─────────────────────────────

export interface GameLite {
  id: string;
  homeTeam: string;
  awayTeam: string;
  startTime: number;
  spread: number | null;
  overUnder: number | null;
  oddsDetails: string | null;
}

/**
 * Pre-game win probability for a preview matchup, or null when either side has no projection yet (a 50%
 * coin flip built from two empty projections would be fake data).
 */
export function previewWinProb(homeProjected: number, awayProjected: number, prob: () => number): number | null {
  if (!(homeProjected > 0) || !(awayProjected > 0)) return null;
  const p = prob();
  return Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
}

/** NFL games with the most league starters' projected points (ties: higher over/under), with betting lines. */
export function marqueeGames(games: readonly GameLite[], starters: ReadonlyMap<string, { count: number; projected: number }>, limit = 4): MarqueeGame[] {
  return games
    .map((g) => {
      const h = starters.get(g.homeTeam) ?? { count: 0, projected: 0 };
      const a = starters.get(g.awayTeam) ?? { count: 0, projected: 0 };
      return {
        id: g.id,
        away: g.awayTeam,
        home: g.homeTeam,
        kickoff: new Date(g.startTime).toISOString(),
        spread: g.spread,
        overUnder: g.overUnder,
        oddsDetails: g.oddsDetails,
        starters: h.count + a.count,
        starterProjection: round2(h.projected + a.projected),
      };
    })
    .filter((g) => g.starters > 0 || g.overUnder !== null)
    .sort((a, b) => b.starterProjection - a.starterProjection || (b.overUnder ?? 0) - (a.overUnder ?? 0))
    .slice(0, limit);
}

/** Injury designations worth flagging for a projected starter. */
export function isInjuryConcern(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.startsWith("q") || s.startsWith("d") || s === "out" || s === "o" || s.includes("ir") || s.includes("reserve") || s.includes("pup") || s.includes("sus");
}

/** Sort weight for injury rows (most severe first). */
export function injurySeverity(status: string): number {
  const s = status.toLowerCase();
  if (s === "out" || s === "o" || s.includes("ir") || s.includes("reserve") || s.includes("pup") || s.includes("sus")) return 3;
  if (s.startsWith("d")) return 2;
  return 1;
}

// ───────────────────────────── Schedule ─────────────────────────────

const WEEKDAY_BY_SHORT: Record<string, Weekday> = { Sun: "SUN", Mon: "MON", Tue: "TUE", Wed: "WED", Thu: "THU", Fri: "FRI", Sat: "SAT" };

/** Weekday + hour (0-23) of `now` in a timezone. */
export function localWeekdayHour(now: Date, tz: string): { weekday: Weekday; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  }
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { weekday: WEEKDAY_BY_SHORT[wd] ?? "SUN", hour };
}

/** True when `now` (league timezone) is on the recap day at or after the recap hour. */
export function isRecapDue(now: Date, tz: string, day: Weekday, hour: number): boolean {
  const l = localWeekdayHour(now, tz);
  return l.weekday === day && l.hour >= hour;
}

const DAY_MS = 86_400_000;
const WEEKDAY_INDEX: Record<Weekday, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "America/New_York";
  }
}

/** Wall-clock date/time of an instant in a timezone. */
function zonedParts(at: number, tz: string): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute"), s: get("second") };
}

/** Timezone offset (local wall time − UTC, ms) at an instant. */
export function tzOffsetMs(at: number, tz: string): number {
  const p = zonedParts(at, safeTz(tz));
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at / 1000) * 1000;
}

/** UTC instant of `hour`:00 on a local calendar date in a timezone (DST-aware). */
export function zonedHourToUtc(y: number, m: number, d: number, hour: number, tz: string): number {
  const zone = safeTz(tz);
  const wall = Date.UTC(y, m - 1, d, hour);
  const first = wall - tzOffsetMs(wall, zone);
  return wall - tzOffsetMs(first, zone);
}

/**
 * The scheduled send time of a recap for a week completed at `completedAt`: the first recap day at the
 * recap hour (league timezone) at or after completion.
 */
export function recapSendTime(completedAt: number, tz: string, day: Weekday, hour: number): number {
  const zone = safeTz(tz);
  const local = zonedParts(completedAt, zone);
  for (let i = 0; i <= 8; i++) {
    const date = new Date(Date.UTC(local.y, local.m - 1, local.d + i));
    if (date.getUTCDay() !== WEEKDAY_INDEX[day]) continue;
    const t = zonedHourToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, zone);
    if (t >= completedAt) return t;
  }
  return completedAt;
}

/**
 * Whether the scheduled job should deliver a week's recap now: its send time has passed (so a missed run,
 * e.g. the server was down on recap day, catches up later) but by less than `graceDays` (no stale recaps
 * for weeks that ended long ago, e.g. after recaps were switched on mid-season).
 */
export function isRecapDueFor(now: Date, completedAt: number, tz: string, day: Weekday, hour: number, graceDays = 6): boolean {
  const send = recapSendTime(completedAt, tz, day, hour);
  const t = now.getTime();
  return t >= send && t - send < graceDays * DAY_MS;
}

/** When a fantasy week ended: last NFL kickoff + game length, or the last matchup update when no games are known. */
export function weekCompletedAt(kickoffs: readonly number[], matchupUpdates: readonly number[], gameLengthMs = 4 * 3_600_000): number {
  if (kickoffs.length) return Math.max(...kickoffs) + gameLengthMs;
  return matchupUpdates.length ? Math.max(...matchupUpdates) : 0;
}

/** Most recent week whose matchups are all FINAL (null if none). */
export function latestCompletedWeek(matchups: readonly { week: number; status: string }[]): number | null {
  const byWeek = new Map<number, { total: number; final: number }>();
  for (const m of matchups) {
    const e = byWeek.get(m.week) ?? { total: 0, final: 0 };
    e.total++;
    if (m.status === "FINAL") e.final++;
    byWeek.set(m.week, e);
  }
  const done = [...byWeek.entries()].filter(([, e]) => e.total > 0 && e.final === e.total).map(([w]) => w);
  return done.length ? Math.max(...done) : null;
}

/** Every completed week (all matchups FINAL), newest first. */
export function completedWeeks(matchups: readonly { week: number; status: string }[]): number[] {
  const weeks = [...new Set(matchups.map((m) => m.week))];
  return weeks.filter((w) => matchups.filter((m) => m.week === w).every((m) => m.status === "FINAL")).sort((a, b) => b - a);
}

// ───────────────────────────── Player stat lines ─────────────────────────────

/** Short box-score line: "287 pass yds, 3 TD · 34 rush yds", "8 rec, 132 yds, 2 TD", "3/4 FG, 2 XP". */
export function statLine(stats: Record<string, number> | null | undefined, position: string): string {
  if (!stats) return "";
  const v = (k: string) => Number(stats[k] ?? 0) || 0;
  const pos = normalizePosition(position);
  const parts: string[] = [];
  const td = (n: number) => (n ? `${n} TD` : "");
  const join = (...xs: string[]) => xs.filter(Boolean).join(", ");
  const passing = () => (v("pass_yd") || v("pass_td") ? join(`${Math.round(v("pass_yd"))} pass yds`, td(v("pass_td")), v("pass_int") ? `${v("pass_int")} INT` : "") : "");
  const rushing = (min = 0) => (v("rush_yd") > min || v("rush_td") ? join(`${Math.round(v("rush_yd"))} rush yds`, td(v("rush_td"))) : "");
  const receiving = () => (v("rec") || v("rec_yd") || v("rec_td") ? join(`${v("rec")} rec`, `${Math.round(v("rec_yd"))} yds`, td(v("rec_td"))) : "");
  if (pos === "QB") parts.push(passing(), rushing(14));
  else if (pos === "RB") parts.push(rushing(), receiving());
  else if (pos === "WR" || pos === "TE") parts.push(receiving(), rushing(9));
  else if (pos === "K") parts.push(join(v("fga") ? `${v("fgm")}/${v("fga")} FG` : v("fgm") ? `${v("fgm")} FG` : "", v("xpm") ? `${v("xpm")} XP` : ""));
  else if (pos === "DEF")
    parts.push(join(v("sack") ? `${v("sack")} sacks` : "", v("int") ? `${v("int")} INT` : "", v("fum_rec") ? `${v("fum_rec")} FR` : "", v("def_td") + v("def_st_td") ? `${v("def_td") + v("def_st_td")} TD` : "", `${Math.round(v("pts_allow"))} PA`));
  else parts.push(join(v("idp_tkl") || v("idp_tkl_solo") ? `${v("idp_tkl") || v("idp_tkl_solo") + v("idp_tkl_ast")} tkl` : "", v("idp_sack") ? `${v("idp_sack")} sacks` : "", v("idp_int") ? `${v("idp_int")} INT` : ""));
  if (v("st_td")) parts.push(`${v("st_td")} return TD`);
  return parts.filter(Boolean).join(" · ");
}
