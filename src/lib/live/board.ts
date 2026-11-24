// Batched team week scores for a whole league week (scoreboard cards, matchup detail, schedule
// projections). Scores come from buildTeamWeekScore() in @/lib/scoreboard (same rules as teamWeekScore), but
// with a fixed number of queries for any number of teams instead of ~5 per team.
import type { NflGame, Player } from "@prisma/client";
import { db } from "@/lib/db";
import { expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { canStart, optimalLineup, weekGamesByTeam } from "@/lib/lineup";
import { weekPoints } from "@/lib/points";
import { buildTeamWeekScore, type StarterLine, type TeamWeekScore } from "@/lib/scoreboard";

/** injury designations that keep a player out of an auto-filled preview lineup (mirrors autoFillLineup) */
const INJURED_OUT = new Set(["Out", "IR", "Doubtful", "PUP", "Sus"]);

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

  // Lineups: saved rows by team. Teams without a saved lineup for this week get a READ-ONLY preview
  // (the same carry-forward getLineup() would build) — viewing a future or past week must never
  // materialize lineup rows, or later lineup changes would stop carrying forward into that week.
  const lineupByTeam = new Map<string, Map<string, string | null>>();
  for (const r of lineupRows) {
    if (!lineupByTeam.has(r.teamId)) lineupByTeam.set(r.teamId, new Map());
    lineupByTeam.get(r.teamId)!.set(`${r.slot}#${r.slotIndex}`, r.playerId);
  }

  const rosterByTeam = new Map<string, typeof roster>();
  for (const r of roster) {
    if (!rosterByTeam.has(r.teamId)) rosterByTeam.set(r.teamId, []);
    rosterByTeam.get(r.teamId)!.push(r);
  }
  const unsaved = teamIds.filter((t) => !lineupByTeam.has(t));
  const needsAutoFill: string[] = [];
  if (unsaved.length) {
    const prior = await db.lineupSlot.findMany({
      where: { leagueId, season, week: { lt: week }, teamId: { in: unsaved } },
      select: { teamId: true, week: true, slot: true, slotIndex: true, playerId: true },
    });
    const latest = new Map<string, number>();
    for (const r of prior) latest.set(r.teamId, Math.max(latest.get(r.teamId) ?? 0, r.week));
    // mirror getLineup's lineup.defaultCarryOver without writing rows
    const mode = settings.lineup.defaultCarryOver ?? "PREVIOUS_WEEK";
    for (const teamId of unsaved) {
      const from = latest.get(teamId);
      if (from === undefined || mode === "OPTIMAL_PROJECTED") {
        needsAutoFill.push(teamId);
        continue;
      }
      if (mode === "EMPTY") {
        lineupByTeam.set(teamId, new Map(slots.map((s) => [`${s.key}#${s.index}`, null] as const)));
        continue;
      }
      const active = new Set((rosterByTeam.get(teamId) ?? []).filter((r) => canStart(r.status, settings)).map((r) => r.playerId));
      const src = new Map(prior.filter((r) => r.teamId === teamId && r.week === from).map((r) => [`${r.slot}#${r.slotIndex}`, r.playerId]));
      lineupByTeam.set(teamId, new Map(slots.map((s) => {
        const pid = src.get(`${s.key}#${s.index}`) ?? null;
        return [`${s.key}#${s.index}`, pid && active.has(pid) ? pid : null] as const;
      })));
    }
  }

  const playersById = new Map<string, Player>(roster.map((r) => [r.playerId, r.player]));
  const starterIds = [...lineupByTeam.values()].flatMap((m) => [...m.values()]).filter((x): x is string => !!x);
  const missing = [...new Set(starterIds.filter((id) => !playersById.has(id)))];
  if (missing.length) for (const p of await db.player.findMany({ where: { id: { in: missing } } })) playersById.set(p.id, p);
  const pts = await weekPoints([...playersById.values()], season, week, settings);
  const adjByTeam = new Map(adjustments.map((a) => [a.teamId, a._sum.points ?? 0]));

  // brand-new teams (no lineup in any earlier week): preview the best projected lineup, like getLineup's auto-fill
  for (const teamId of needsAutoFill) {
    const active = (rosterByTeam.get(teamId) ?? []).filter((r) => canStart(r.status, settings));
    const value = new Map(active.map((r) => [r.playerId, (pts.get(r.playerId)?.projected ?? 0) - (INJURED_OUT.has(r.player.injuryStatus ?? "") ? 100 : 0)]));
    const best = optimalLineup(active.map((r) => r.player), value, settings);
    lineupByTeam.set(teamId, new Map(best.map((a) => [`${a.slot}#${a.slotIndex}`, a.playerId])));
  }

  const teams = new Map<string, TeamWeekScore>();
  for (const teamId of teamIds) {
    const lu = lineupByTeam.get(teamId) ?? new Map<string, string | null>();
    teams.set(
      teamId,
      buildTeamWeekScore({
        teamId,
        slots: slots.map((s) => ({ slot: s.key, slotIndex: s.index, label: s.label, eligible: s.eligible, playerId: lu.get(`${s.key}#${s.index}`) ?? null })),
        roster: rosterByTeam.get(teamId) ?? [],
        playersById,
        pts,
        games,
        adjustments: adjByTeam.get(teamId) ?? 0,
        settings,
      }),
    );
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
