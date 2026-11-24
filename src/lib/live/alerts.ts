// Touchdown phone alerts. Each touchdown ScoringEvent is claimed atomically (notifiedAt) before it
// is sent, so restarts, overlapping ticks or a second process can never alert twice.
import type { Matchup } from "@prisma/client";
import { TOUCHDOWN_KEYS } from "@/lib/scoring/engine";
import type { LeagueSettings } from "@/lib/settings/schema";
import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { selectTdRecipients, touchdownAlertBody } from "@/lib/live/diff";

/** Alerts older than this are marked handled without sending (e.g. after a long outage). */
const STALE_MS = 3 * 60 * 60_000;

export async function sendPendingTouchdownAlerts(opts: {
  leagueId: string;
  settings: LeagueSettings;
  season: number;
  week: number;
  /** current matchup rows (after refresh) for the score line */
  matchups?: Matchup[];
  /** false = claim without sending (simulation with alerts off) */
  send?: boolean;
  simulated?: boolean;
  now?: Date;
}): Promise<number> {
  const { leagueId, settings, season, week } = opts;
  const now = opts.now ?? new Date();
  const pending = await db.scoringEvent.findMany({
    where: { leagueId, season, week, statKey: { in: TOUCHDOWN_KEYS }, notifiedAt: null },
    include: { player: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (!pending.length) return 0;

  const playerIds = [...new Set(pending.map((e) => e.playerId))];
  const [members, teams, spots, starters, matchups] = await Promise.all([
    db.leagueMember.findMany({ where: { leagueId }, select: { userId: true, teamId: true, user: { select: { notificationPrefs: { select: { tdScope: true } } } } } }),
    db.team.findMany({ where: { leagueId }, select: { id: true, name: true, ownerId: true } }),
    db.rosterSpot.findMany({ where: { leagueId, playerId: { in: playerIds } }, select: { playerId: true, teamId: true } }),
    db.lineupSlot.findMany({ where: { leagueId, season, week, playerId: { in: playerIds } }, select: { teamId: true, playerId: true } }),
    opts.matchups ? Promise.resolve(opts.matchups) : db.matchup.findMany({ where: { leagueId, season, week } }),
  ]);

  const managersByTeam = new Map<string, string[]>();
  for (const t of teams) managersByTeam.set(t.id, t.ownerId ? [t.ownerId] : []);
  for (const m of members) if (m.teamId) managersByTeam.set(m.teamId, [...new Set([...(managersByTeam.get(m.teamId) ?? []), m.userId])]);
  const memberScopes = members.map((m) => ({ userId: m.userId, scope: m.user.notificationPrefs?.tdScope ?? null }));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const ownerByPlayer = new Map(spots.map((s) => [s.playerId, s.teamId]));
  const starterKeys = new Set(starters.map((s) => `${s.teamId}:${s.playerId}`));
  const matchupByTeam = new Map<string, Matchup>();
  for (const m of matchups) {
    if (m.homeTeamId) matchupByTeam.set(m.homeTeamId, m);
    if (m.awayTeamId) matchupByTeam.set(m.awayTeamId, m);
  }

  let sent = 0;
  for (const e of pending) {
    // atomic claim — only one tick / process ever sends a given touchdown
    const claim = await db.scoringEvent.updateMany({ where: { id: e.id, notifiedAt: null }, data: { notifiedAt: now } });
    if (claim.count !== 1) continue;
    if (opts.send === false || now.getTime() - e.createdAt.getTime() > STALE_MS) continue;
    const ownerTeamId = ownerByPlayer.get(e.playerId);
    if (!ownerTeamId) continue;
    const m = matchupByTeam.get(ownerTeamId) ?? null;
    const userIds = selectTdRecipients({
      ownerTeamId,
      isStarter: starterKeys.has(`${ownerTeamId}:${e.playerId}`),
      matchupTeamIds: m ? ([m.homeTeamId, m.awayTeamId].filter(Boolean) as string[]) : [],
      managersByTeam,
      members: memberScopes,
      defaultScope: settings.notifications.touchdownAlertsDefault,
    });
    if (!userIds.length) continue;
    const isHome = m?.homeTeamId === ownerTeamId;
    const oppId = m ? (isHome ? m.awayTeamId : m.homeTeamId) : null;
    const body = touchdownAlertBody({
      description: e.description ?? `${e.player.fullName} touchdown`,
      points: e.points,
      team: m ? { name: teamById.get(ownerTeamId)?.name ?? "", score: isHome ? m.homeScore : m.awayScore } : null,
      opponent: m && oppId ? { name: teamById.get(oppId)?.name ?? "", score: isHome ? m.awayScore : m.homeScore } : null,
    });
    await notify({
      userIds,
      leagueId,
      type: "TOUCHDOWN",
      title: `🏈 TOUCHDOWN – ${e.player.fullName}`,
      body: opts.simulated ? `${body} (simulation)` : body,
      url: m ? `/scoring/${m.id}` : "/scoring",
      data: { scoringEventId: e.id, playerId: e.playerId, matchupId: m?.id ?? null, simulated: !!opts.simulated },
    });
    sent++;
  }
  return sent;
}
