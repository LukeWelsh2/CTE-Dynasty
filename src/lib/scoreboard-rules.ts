// Pure matchup-scoring rules used by @/lib/scoreboard (no DB access, unit tested in tests/league-rules.test.ts and
// tests/scoreboard.test.ts): regular season winner / tiebreak resolution, forfeits, reverse-scoring weeks,
// playoff row results and inactive-starter auto-subs.
import { resolvePlayoffTie } from "@/lib/playoffs/structure";
import type { LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { hashString } from "@/lib/sim/rng";

export type TieBreak = "BENCH_POINTS" | "HIGHEST_STARTER" | "HOME_TEAM";

export interface SideResult {
  teamId: string;
  points: number;
  benchPoints: number;
  /** best single starter score (HIGHEST_STARTER tiebreak) */
  topStarter: number;
  /** true when the team started fewer than niche.minimumStartersOrForfeit players who played */
  forfeit?: boolean;
}

/**
 * Ordered tiebreak chain for a regular season matchup:
 * matchups.tiebreaker first, then bench points when lineup.benchPointsTiebreaker is on, and — when the
 * league doesn't allow ties (or `mustHaveWinner`) — bench points, highest starter and finally the home team.
 * Playoff games don't use this chain: the bracket settles them (see playoffRowWinners).
 */
export function tiebreakChain(settings: Pick<LeagueSettings, "matchups" | "lineup">, opts: { mustHaveWinner?: boolean } = {}): TieBreak[] {
  const chain: TieBreak[] = [];
  const add = (t: TieBreak) => {
    if (!chain.includes(t)) chain.push(t);
  };
  const tb = settings.matchups.tiebreaker;
  if (tb && tb !== "NONE") add(tb);
  if (settings.lineup.benchPointsTiebreaker) add("BENCH_POINTS");
  if (opts.mustHaveWinner || !settings.matchups.allowTies) {
    add("BENCH_POINTS");
    add("HIGHEST_STARTER");
    add("HOME_TEAM");
  }
  return chain;
}

/**
 * Winner of a final regular season matchup (null = tie). `reverse` = niche.reverseScoringWeek (lowest score wins).
 * A forfeiting team loses to a non-forfeiting one regardless of score.
 */
export function decideWinner(
  home: SideResult,
  away: SideResult,
  settings: Pick<LeagueSettings, "matchups" | "lineup">,
  opts: { reverse?: boolean; mustHaveWinner?: boolean } = {},
): string | null {
  if (home.forfeit && !away.forfeit) return away.teamId;
  if (away.forfeit && !home.forfeit) return home.teamId;
  const sign = opts.reverse ? -1 : 1;
  const diff = sign * (round2(home.points) - round2(away.points));
  if (diff > 0) return home.teamId;
  if (diff < 0) return away.teamId;
  for (const t of tiebreakChain(settings, opts)) {
    if (t === "HOME_TEAM") return home.teamId;
    const [h, a] = t === "BENCH_POINTS" ? [home.benchPoints, away.benchPoints] : [home.topStarter, away.topStarter];
    if (round2(h) > round2(a)) return home.teamId;
    if (round2(a) > round2(h)) return away.teamId;
  }
  return null;
}

// ───────── Playoff rows ─────────

/** One week's Matchup row of a playoff game (the fields its stored result depends on). */
export interface PlayoffRowLike {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  status: string;
  /** the row's current win probability (kept while the game is undecided and the week isn't final) */
  homeWinProb: number;
}

/** The parts of a playoff bracket game (@/lib/playoffs/bracket bracketGames) its Matchup rows' results come from. */
export interface PlayoffGameResult {
  status: "UPCOMING" | "LIVE" | "FINAL";
  /**
   * the game's winner as the bracket decides it: combined score over the game's weeks, a tie settled by
   * standings.playoffMatchupTiebreakers (in the toilet bowl it is the loser who advances)
   */
  winnerTeamId: string | null;
  /** NFL weeks the game spans */
  weeks: readonly number[];
  /** the game's Matchup rows, one per week it spans */
  rows: readonly PlayoffRowLike[];
}

export interface PlayoffRowResult {
  winnerTeamId: string | null;
  /**
   * Matchup.homeWinProb to store: 1 / 0 once the game is decided (the row's home team won it or didn't), a final but
   * undecided week by its own score (0.5 when level), otherwise the row's live probability unchanged
   */
  homeWinProb: number;
}

/** Winner of one row by its own score (null when level or a side is missing). */
export function rowScoreWinner(r: Pick<PlayoffRowLike, "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore">): string | null {
  if (!r.homeTeamId || !r.awayTeamId) return null;
  const h = round2(r.homeScore);
  const a = round2(r.awayScore);
  return h > a ? r.homeTeamId : a > h ? r.awayTeamId : null;
}

/**
 * Results for playoff Matchup rows (row id → result), for the games that span `week` (every game when omitted).
 * A playoff game is decided the way the bracket decides it — the combined score over all of its weeks (forfeits and
 * reverse scoring don't apply), a tie settled by standings.playoffMatchupTiebreakers — so every week's row of a game
 * carries the game's winner once all of its weeks are final, and no winner before that (views then read that week's
 * own score). A single week of a two-week round therefore never names a different winner than the round.
 */
export function playoffRowWinners(games: readonly PlayoffGameResult[], opts: { week?: number } = {}): Map<string, PlayoffRowResult> {
  const out = new Map<string, PlayoffRowResult>();
  for (const g of games) {
    if (opts.week !== undefined && !g.weeks.includes(opts.week)) continue;
    const winner = g.status === "FINAL" ? g.winnerTeamId : null;
    for (const r of g.rows) {
      let homeWinProb = r.homeWinProb;
      if (winner) homeWinProb = winner === r.homeTeamId ? 1 : 0;
      else if (r.status === "FINAL") {
        const w = rowScoreWinner(r);
        homeWinProb = w ? (w === r.homeTeamId ? 1 : 0) : 0.5;
      }
      out.set(r.id, { winnerTeamId: winner, homeWinProb });
    }
  }
  return out;
}

/**
 * Winner of a final playoff row that has no bracket position (none are created today): its own score, a tie settled
 * by standings.playoffMatchupTiebreakers through the bracket's resolvePlayoffTie (falling back to the higher seed),
 * so a playoff game never ends level. `coinKey` keys the deterministic coin flip.
 */
export function unbracketedPlayoffWinner(
  row: Pick<PlayoffRowLike, "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore"> & { homeSeed: number | null; awaySeed: number | null },
  home: Pick<SideResult, "benchPoints" | "topStarter">,
  away: Pick<SideResult, "benchPoints" | "topStarter">,
  settings: Pick<LeagueSettings, "standings">,
  coinKey: string,
): string | null {
  if (!row.homeTeamId || !row.awayTeamId) return null;
  return (
    rowScoreWinner(row) ??
    resolvePlayoffTie(
      settings.standings.playoffMatchupTiebreakers ?? [],
      {
        key: coinKey,
        homeTeamId: row.homeTeamId,
        awayTeamId: row.awayTeamId,
        homeSeed: row.homeSeed,
        awaySeed: row.awaySeed,
        bench: [round2(home.benchPoints), round2(away.benchPoints)],
        highestStarter: [round2(home.topStarter), round2(away.topStarter)],
      },
      hashString,
    )
  );
}

const OUT_STATUSES = new Set(["out", "ir", "pup", "sus", "na", "cov", "dnr"]);

/** Injury designation that means the player won't play (Out / IR / PUP / suspended …). */
export function isRuledOut(injuryStatus: string | null | undefined): boolean {
  return OUT_STATUSES.has((injuryStatus ?? "").trim().toLowerCase());
}

export interface SubCandidate {
  playerId: string;
  position: string;
  injuryStatus: string | null;
  /** NFL game state for the week; "bye" when the player's team doesn't play */
  gameState: "pre" | "in" | "post" | "bye";
  kickoff: Date | null;
  /** player recorded a stat line this week */
  hasStats: boolean;
  /** value used to pick the best replacement (actual points once played, projection before) */
  value: number;
}

/**
 * Did a starter sit out? True once the game is over with no stat line, or when he's ruled out and hasn't
 * recorded anything (so a stale "Out" tag never removes a player who actually played).
 */
export function didNotPlay(c: Pick<SubCandidate, "gameState" | "hasStats" | "injuryStatus">): boolean {
  if (c.gameState === "bye" || c.hasStats) return false;
  return c.gameState === "post" || isRuledOut(c.injuryStatus);
}

/**
 * lineup.autoSubOutPlayers: replace inactive starters with the best eligible bench player.
 * Returns slot index (into `starters`) -> bench playerId. Honors autoSubsMaxPerWeek (0 = unlimited) and
 * autoSubRequireLaterKickoff (the replacement's game must start after the starter's).
 */
export function planAutoSubs(
  starters: { eligible: string[]; player: SubCandidate | null }[],
  bench: SubCandidate[],
  settings: Pick<LeagueSettings, "lineup">,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!settings.lineup.autoSubOutPlayers) return out;
  const max = settings.lineup.autoSubsMaxPerWeek > 0 ? settings.lineup.autoSubsMaxPerWeek : Infinity;
  const used = new Set<string>();
  starters.forEach((s, i) => {
    if (out.size >= max || !s.player || !didNotPlay(s.player)) return;
    const starterKick = s.player.kickoff?.getTime() ?? null;
    let best: SubCandidate | null = null;
    for (const b of bench) {
      if (used.has(b.playerId) || b.gameState === "bye" || didNotPlay(b)) continue;
      if (!s.eligible.includes(normalizePosition(b.position))) continue;
      if (settings.lineup.autoSubRequireLaterKickoff && starterKick !== null && (b.kickoff?.getTime() ?? 0) <= starterKick) continue;
      if (!best || b.value > best.value) best = b;
    }
    if (best) {
      out.set(i, best.playerId);
      used.add(best.playerId);
    }
  });
  return out;
}

/** niche.minimumStartersOrForfeit: number of starters who played (or still can) this week. */
export function playingStarters(starters: (Pick<SubCandidate, "gameState" | "hasStats" | "injuryStatus"> | null)[]): number {
  return starters.filter((s) => s && s.gameState !== "bye" && !didNotPlay(s)).length;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
