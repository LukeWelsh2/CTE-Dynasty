// Who is still alive for the championship? One answer for every "eliminated teams can't …" rule
// (settings.waivers.eliminatedTeamsCanAdd, settings.playoffs.eliminatedTeamsCanTransact) and anything else
// that needs to know whether a team is out of the title race.
//
// Rules (from the stored bracket + aggregated bracket games, see ./bracket.ts):
//   • Before the bracket exists (regular season) nobody is eliminated.
//   • Once it exists, teams that weren't seeded into the championship bracket are out.
//   • A seeded team is out only after it LOSES a completed championship-bracket game. Multi-week rounds count
//     once every week of the round is FINAL; teams with a first-round bye (no round-1 game) are alive.
//   • Side brackets (3rd place, placement games, consolation, toilet bowl) never change the answer.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { bracketGames, loadStoredBracket, resolveTies, type BracketEntry } from "@/lib/playoffs/bracket";
import { bracketPlan, roundLabel, type BracketKind } from "@/lib/playoffs/structure";

export interface ChampionshipStatus {
  alive: boolean;
  /** why the team is out ("Missed the playoffs", "Lost in the quarterfinal") — set when alive is false */
  reason?: string;
  /** championship-bracket seed (null when not seeded or the bracket doesn't exist yet) */
  seed: number | null;
  /** championship-bracket round the team lost (1-based) */
  eliminatedRound?: number;
}

/** The parts of a BracketGame elimination needs (bracketGames() output fits). */
export interface EliminationGame {
  kind: BracketKind;
  round: number;
  status: "UPCOMING" | "LIVE" | "FINAL";
  loserTeamId: string | null;
}

/** Pure: championship status for every team from the stored seed list and the aggregated bracket games. */
export function championshipStatusFrom(
  stored: { winners: Pick<BracketEntry, "teamId" | "seed">[] } | null,
  games: readonly EliminationGame[],
  teamIds: readonly string[],
): Map<string, ChampionshipStatus> {
  const out = new Map<string, ChampionshipStatus>();
  if (!stored) {
    for (const id of teamIds) out.set(id, { alive: true, seed: null });
    return out;
  }
  const rounds = bracketPlan(stored.winners.length).rounds;
  const seedOf = new Map(stored.winners.map((e) => [e.teamId, e.seed]));
  const lostIn = new Map<string, number>();
  for (const g of games) {
    if (g.kind !== "WINNERS" || g.status !== "FINAL" || !g.loserTeamId) continue;
    lostIn.set(g.loserTeamId, Math.max(lostIn.get(g.loserTeamId) ?? 0, g.round));
  }
  for (const id of new Set([...teamIds, ...seedOf.keys()])) {
    const seed = seedOf.get(id) ?? null;
    if (seed === null) {
      out.set(id, { alive: false, reason: "Missed the playoffs", seed: null });
      continue;
    }
    const round = lostIn.get(id);
    if (round === undefined) out.set(id, { alive: true, seed });
    else out.set(id, { alive: false, reason: `Lost in the ${roundLabel("WINNERS", round, rounds).toLowerCase()}`, seed, eliminatedRound: round });
  }
  return out;
}

type Client = Prisma.TransactionClient | typeof db;

/**
 * Championship status for every team in the league for `season`: the stored bracket, the league's team ids
 * and its championship-bracket Matchup rows (three small queries). A completed game that ended tied is
 * settled with settings.standings.playoffMatchupTiebreakers, exactly as advancePlayoffs() settles it.
 */
export async function championshipStatus(leagueId: string, season: number, settings: LeagueSettings, client: Client = db): Promise<Map<string, ChampionshipStatus>> {
  const [stored, teams, rows] = await Promise.all([
    loadStoredBracket(leagueId, season, client),
    client.team.findMany({ where: { leagueId }, select: { id: true } }),
    client.matchup.findMany({ where: { leagueId, season, isPlayoff: true, isConsolation: false } }),
  ]);
  const teamIds = teams.map((t) => t.id);
  if (!stored) return championshipStatusFrom(null, [], teamIds);
  const rounds = bracketPlan(stored.winners.length).rounds;
  let games = bracketGames(rows, stored, rounds);
  if (games.some((g) => g.status === "FINAL" && g.homeTeamId && g.awayTeamId && g.homeScore === g.awayScore)) {
    const ties = await resolveTies(games, leagueId, season, settings);
    if (ties.size) games = bracketGames(rows, stored, rounds, ties);
  }
  return championshipStatusFrom(stored, games, teamIds);
}

// ───────────────────────────── Transaction rules ─────────────────────────────

export type EliminationMove = "ADD" | "TRADE";

/**
 * Does an elimination rule restrict this kind of move right now? Only during the PLAYOFFS phase:
 *   ADD   — settings.waivers.eliminatedTeamsCanAdd or settings.playoffs.eliminatedTeamsCanTransact is off
 *           (free-agent adds and waiver claims);
 *   TRADE — settings.playoffs.eliminatedTeamsCanTransact is off (proposing or accepting trades).
 * Callers skip loading championshipStatus() when this is false.
 */
export function eliminationRuleActive(settings: LeagueSettings, phase: string, move: EliminationMove): boolean {
  if (phase !== "PLAYOFFS") return false;
  const transact = settings.playoffs.eliminatedTeamsCanTransact !== false;
  if (move === "TRADE") return !transact;
  return !transact || settings.waivers.eliminatedTeamsCanAdd === false;
}

/**
 * Why a team can't make this move because it is out of the championship race (null = allowed).
 * `who` names the team in the message ("Your team" for the viewer's own team).
 */
export function eliminationBlock(
  settings: LeagueSettings,
  phase: string,
  status: ChampionshipStatus | undefined,
  move: EliminationMove,
  who = "Your team",
): string | null {
  if (!status || status.alive || !eliminationRuleActive(settings, phase, move)) return null;
  const why = status.seed === null ? `${who} missed the playoffs` : `${who} ${status.reason ? status.reason.charAt(0).toLowerCase() + status.reason.slice(1) : "was eliminated from the playoffs"}`;
  return move === "TRADE"
    ? `${why}. Teams eliminated from the playoffs can't make trades in this league.`
    : `${why}. Teams eliminated from the playoffs can't add players in this league.`;
}

/** Block reasons for every team a rule stops from making `move` (empty when no rule applies). */
export function eliminationBlocks(settings: LeagueSettings, phase: string, statuses: ReadonlyMap<string, ChampionshipStatus>, move: EliminationMove, who = "Your team"): Map<string, string> {
  const out = new Map<string, string>();
  for (const [teamId, st] of statuses) {
    const reason = eliminationBlock(settings, phase, st, move, who);
    if (reason) out.set(teamId, reason);
  }
  return out;
}

/** Load statuses and return the block reasons for `move` — no queries when no rule applies. */
export async function loadEliminationBlocks(
  leagueId: string,
  season: number,
  settings: LeagueSettings,
  phase: string,
  move: EliminationMove,
  opts: { who?: string; client?: Client } = {},
): Promise<Map<string, string>> {
  if (!eliminationRuleActive(settings, phase, move)) return new Map();
  return eliminationBlocks(settings, phase, await championshipStatus(leagueId, season, settings, opts.client), move, opts.who);
}
