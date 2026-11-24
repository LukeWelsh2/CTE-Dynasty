// Batched team week scores for a whole league week (scoreboard cards, matchup detail, schedule
// projections). Same math as teamWeekScore() in @/lib/scoreboard, but a fixed number of queries for
// any number of teams instead of ~5 per team.
import type { NflGame, Player } from "@prisma/client";
import { db } from "@/lib/db";
import { expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { getLineup, weekGamesByTeam } from "@/lib/lineup";
import { weekPoints } from "@/lib/points";
import { POSITION_SD, remainingFraction, type GameState, type StarterLine, type TeamWeekScore } from "@/lib/scoreboard";
import { normalizePosition } from "@/lib/settings/stat-catalog";

const round2 = (n: number) => Math.round(n * 100) / 100;

function gameStateFor(team: string | null | undefined, games: Map<string, NflGame>): GameState {
  if (!team) return "bye";
  const g = games.get(team);
  if (!g) return "bye";
  return (g.state as GameState) ?? "pre";
}

export interface WeekBoard {
  games: Map<string, NflGame>;
  teams: Map<string, TeamWeekScore>;
}

/** Scores for the given teams (default: every team in the league) for one week. */
export async function weekBoard(
  leagueId: string,
  season: number,
  week: number,
  settings: LeagueSettings,
  opts: { teamIds?: string[]; games?: Map<string, NflGame> } = {},
): Promise<WeekBoard> {
  const teamIds = opts.teamIds ?? (await db.team.findMany({ where: { leagueId }, select: { id: true } })).map((t) => t.id);
  const games = opts.games ?? (await weekGamesByTeam(season, week));
  if (!teamIds.length) return { games, teams: new Map() };
  const slots = expandSlots(settings);

  const [lineupRows, roster, adjustments] = await Promise.all([
    db.lineupSlot.findMany({ where: { leagueId, season, week, teamId: { in: teamIds } } }),
    db.rosterSpot.findMany({ where: { leagueId, teamId: { in: teamIds } }, include: { player: true } }),
    db.scoreAdjustment.groupBy({ by: ["teamId"], where: { leagueId, season, week, teamId: { in: teamIds } }, _sum: { points: true } }),
  ]);

  // Lineups: rows by team; teams without a lineup for this week get one created (carry-forward)
  const lineupByTeam = new Map<string, Map<string, string | null>>();
  for (const r of lineupRows) {
    if (!lineupByTeam.has(r.teamId)) lineupByTeam.set(r.teamId, new Map());
    lineupByTeam.get(r.teamId)!.set(`${r.slot}#${r.slotIndex}`, r.playerId);
  }
  for (const teamId of teamIds) {
    if (lineupByTeam.has(teamId)) continue;
    const view = await getLineup(teamId, leagueId, season, week, settings);
    lineupByTeam.set(teamId, new Map(view.map((v) => [`${v.slot}#${v.slotIndex}`, v.playerId])));
  }

  const rosterByTeam = new Map<string, typeof roster>();
  for (const r of roster) {
    if (!rosterByTeam.has(r.teamId)) rosterByTeam.set(r.teamId, []);
    rosterByTeam.get(r.teamId)!.push(r);
  }
  const playersById = new Map<string, Player>(roster.map((r) => [r.playerId, r.player]));
  const starterIds = [...lineupByTeam.values()].flatMap((m) => [...m.values()]).filter((x): x is string => !!x);
  const missing = [...new Set(starterIds.filter((id) => !playersById.has(id)))];
  if (missing.length) for (const p of await db.player.findMany({ where: { id: { in: missing } } })) playersById.set(p.id, p);
  const pts = await weekPoints([...playersById.values()], season, week, settings);
  const adjByTeam = new Map(adjustments.map((a) => [a.teamId, a._sum.points ?? 0]));

  const line = (slot: string, slotIndex: number, label: string, pid: string | null): StarterLine => {
    const player = pid ? playersById.get(pid) ?? null : null;
    const game = player?.team ? games.get(player.team) ?? null : null;
    const p = pid ? pts.get(pid) ?? null : null;
    const rf = player ? remainingFraction(game) : 0;
    const points = p?.points ?? 0;
    const projected = p?.projected ?? 0;
    return { slot, slotIndex, label, player, points, projected, liveProjected: points + projected * rf, gameState: gameStateFor(player?.team, games), game, remainingFraction: rf, pts: p };
  };

  const teams = new Map<string, TeamWeekScore>();
  for (const teamId of teamIds) {
    const lu = lineupByTeam.get(teamId) ?? new Map<string, string | null>();
    const starters = slots.map((s) => line(s.key, s.index, s.label, lu.get(`${s.key}#${s.index}`) ?? null));
    const starterSet = new Set(starters.map((s) => s.player?.id).filter(Boolean) as string[]);
    const bench = (rosterByTeam.get(teamId) ?? [])
      .filter((r) => !starterSet.has(r.playerId))
      .map((r) => line(r.status === "ACTIVE" ? "BN" : r.status, 0, r.status === "ACTIVE" ? "BN" : r.status, r.playerId))
      .sort((a, b) => b.points - a.points || b.projected - a.projected);
    const adj = adjByTeam.get(teamId) ?? 0;
    const penalty = starters.filter((s) => !s.player).length * (settings.lineup.emptySlotPenalty ?? 0);
    const variance = starters.reduce((a, s) => {
      if (!s.player) return a;
      const sd = POSITION_SD[normalizePosition(s.player.position)] ?? 6;
      return a + sd * sd * s.remainingFraction;
    }, 0);
    teams.set(teamId, {
      teamId,
      starters,
      bench,
      points: round2(starters.reduce((a, s) => a + s.points, 0) + adj - penalty),
      projected: round2(starters.reduce((a, s) => a + s.projected, 0) + adj - penalty),
      liveProjected: round2(starters.reduce((a, s) => a + s.liveProjected, 0) + adj - penalty),
      variance,
      adjustments: adj,
      yetToPlay: starters.filter((s) => s.player && s.gameState === "pre").length,
      inProgress: starters.filter((s) => s.gameState === "in").length,
      benchPoints: round2(bench.filter((b) => b.slot === "BN").reduce((a, b) => a + b.points, 0)),
    });
  }
  return { games, teams };
}

/** Starter with the most points (ties: higher projection) */
export function topPerformer(score: TeamWeekScore | undefined): StarterLine | null {
  if (!score) return null;
  let best: StarterLine | null = null;
  for (const s of score.starters) {
    if (!s.player) continue;
    if (!best || s.points > best.points || (s.points === best.points && s.projected > best.projected)) best = s;
  }
  return best;
}
