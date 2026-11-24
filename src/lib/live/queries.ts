// Page data for /scoring, /scoring/[id], /schedule and the live matchup API (server only).
import "server-only";
import type { Matchup, NflGame, Team, User } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { optimalLineup } from "@/lib/lineup";
import { refreshWeekMatchups, winProbability, type StarterLine, type TeamWeekScore } from "@/lib/scoreboard";
import { computeStandings, type StandingRow } from "@/lib/standings";
import type { LeagueSettings } from "@/lib/settings/schema";
import { record } from "@/lib/utils";
import { topPerformer, weekBoard } from "@/lib/live/board";
import { matchupRoundLabel, opponentLabel, statLine } from "@/lib/live/format";
import { toGameLite } from "@/lib/live/pipeline";
import type { BigPlay, CardSide, GameLite, MatchupSide, PlayerCell, ScoreboardCard, TeamRef, WpPoint } from "@/lib/live/types";

type TeamWithOwner = Team & { owner: Pick<User, "id" | "name"> | null; member: { user: Pick<User, "id" | "name"> } | null };

const teamInclude = { owner: { select: { id: true, name: true } }, member: { select: { user: { select: { id: true, name: true } } } } } as const;

export function teamRef(t: TeamWithOwner, standings: Map<string, StandingRow>): TeamRef {
  const s = standings.get(t.id);
  const managers = new Map<string, string>();
  if (t.owner) managers.set(t.owner.id, t.owner.name);
  if (t.member) managers.set(t.member.user.id, t.member.user.name);
  return {
    id: t.id,
    name: t.name,
    abbrev: t.abbrev,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    record: s ? record(s.wins, s.losses, s.ties) : "0-0",
    rank: s?.rank ?? null,
    managers: [...managers.entries()].map(([id, name]) => ({ id, name })),
  };
}

export async function standingsMap(ctx: Pick<LeagueContext, "league" | "season" | "settings">) {
  const rows = await computeStandings(ctx.league.id, ctx.season, ctx.settings);
  return new Map(rows.map((r) => [r.team.id, r]));
}

const lastRefresh = (globalThis as unknown as { __cteBoardRefresh?: Map<string, number> }).__cteBoardRefresh ?? new Map<string, number>();
(globalThis as unknown as { __cteBoardRefresh?: Map<string, number> }).__cteBoardRefresh = lastRefresh;

/**
 * Stored matchup rows drive the ticker and live events. When nothing has refreshed them recently
 * (e.g. background jobs are off), recompute the current week before rendering (throttled).
 */
async function ensureFreshMatchups(ctx: LeagueContext, week: number, rows: Pick<Matchup, "updatedAt" | "status">[]): Promise<boolean> {
  if (week !== ctx.week || !rows.length || rows.every((m) => m.status === "FINAL")) return false;
  const oldest = Math.min(...rows.map((m) => m.updatedAt.getTime()));
  const key = `${ctx.league.id}:${ctx.season}:${week}`;
  const now = Date.now();
  if (now - oldest < 90_000 || now - (lastRefresh.get(key) ?? 0) < 90_000) return false;
  lastRefresh.set(key, now);
  await refreshWeekMatchups(ctx.league.id, ctx.season, week, ctx.settings);
  return true;
}

function sideCounts(score: TeamWeekScore | undefined) {
  if (!score) return { yetToPlay: 0, inProgress: 0, done: 0 };
  const withPlayer = score.starters.filter((s) => s.player);
  return {
    yetToPlay: withPlayer.filter((s) => s.gameState === "pre").length,
    inProgress: withPlayer.filter((s) => s.gameState === "in").length,
    done: withPlayer.filter((s) => s.gameState === "post" || s.gameState === "bye").length,
  };
}

function topRef(line: StarterLine | null) {
  if (!line?.player || line.points <= 0) return null;
  return { id: line.player.id, name: line.player.fullName, position: line.player.position, nflTeam: line.player.team, points: line.points };
}

export async function loadScoreboard(ctx: LeagueContext, week: number) {
  const where = { leagueId: ctx.league.id, season: ctx.season, week };
  let rows = await db.matchup.findMany({ where, include: { homeTeam: { include: teamInclude }, awayTeam: { include: teamInclude } }, orderBy: { id: "asc" } });
  if (await ensureFreshMatchups(ctx, week, rows)) {
    rows = await db.matchup.findMany({ where, include: { homeTeam: { include: teamInclude }, awayTeam: { include: teamInclude } }, orderBy: { id: "asc" } });
  }
  const teamIds = rows.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x);
  const [standings, board] = await Promise.all([standingsMap(ctx), weekBoard(ctx.league.id, ctx.season, week, ctx.settings, { teamIds })]);
  const myId = ctx.myTeam?.id ?? null;

  const cards: ScoreboardCard[] = rows.map((m) => {
    const upcoming = m.status === "UPCOMING";
    const hs = m.homeTeamId ? board.teams.get(m.homeTeamId) : undefined;
    const as = m.awayTeamId ? board.teams.get(m.awayTeamId) : undefined;
    // Upcoming weeks use fresh pre-game projections; live / final use the stored (ticker) numbers
    const side = (team: TeamWithOwner | null, score: TeamWeekScore | undefined, isHome: boolean, seed: number | null): CardSide | null => {
      if (!team) return null;
      return {
        team: teamRef(team, standings),
        seed,
        score: upcoming ? 0 : isHome ? m.homeScore : m.awayScore,
        // final cards compare against the pre-game projection
        projected: upcoming || m.status === "FINAL" ? score?.projected ?? 0 : isHome ? m.homeProjected : m.awayProjected,
        ...sideCounts(score),
        top: upcoming ? null : topRef(topPerformer(score)),
      };
    };
    const homeWinProb = upcoming && hs && as ? winProbability({ liveProjected: hs.projected, variance: hs.variance }, { liveProjected: as.projected, variance: as.variance }) : m.homeWinProb;
    return {
      id: m.id,
      week: m.week,
      status: m.status,
      label: matchupRoundLabel(m, ctx.settings),
      homeWinProb,
      isMine: !!myId && (m.homeTeamId === myId || m.awayTeamId === myId),
      home: side(m.homeTeam, hs, true, m.homeSeed),
      away: side(m.awayTeam, as, false, m.awaySeed),
    };
  });
  cards.sort((a, b) => Number(b.isMine) - Number(a.isMine) || Number(b.label === "Championship") - Number(a.label === "Championship"));
  const games = [...new Set(board.games.values())].sort((a, b) => a.startTime.getTime() - b.startTime.getTime() || a.id.localeCompare(b.id));
  return { cards, games: games.map(toGameLite) };
}

export async function loadBigPlays(leagueId: string, season: number, week: number, opts: { teamIds?: string[]; take?: number } = {}): Promise<BigPlay[]> {
  const events = await db.scoringEvent.findMany({
    where: { leagueId, season, week },
    include: { player: { select: { fullName: true, position: true, team: true } } },
    orderBy: { createdAt: "desc" },
    take: opts.teamIds ? 200 : opts.take ?? 40,
  });
  const spots = await db.rosterSpot.findMany({
    where: { leagueId, playerId: { in: [...new Set(events.map((e) => e.playerId))] } },
    select: { playerId: true, team: { select: { id: true, abbrev: true, primaryColor: true } } },
  });
  const teamBy = new Map(spots.map((s) => [s.playerId, s.team]));
  let out: BigPlay[] = events.map((e) => ({
    id: e.id,
    playerId: e.playerId,
    playerName: e.player.fullName,
    position: e.player.position,
    nflTeam: e.player.team,
    statKey: e.statKey,
    points: e.points,
    description: e.description ?? e.player.fullName,
    fantasyTeam: teamBy.get(e.playerId) ?? null,
    at: e.createdAt.toISOString(),
  }));
  if (opts.teamIds) out = out.filter((p) => p.fantasyTeam && opts.teamIds!.includes(p.fantasyTeam.id)).slice(0, opts.take ?? 40);
  return out;
}

// ───────────────────────────── matchup detail ─────────────────────────────

function cell(l: StarterLine, slotLabel: string): PlayerCell {
  const p = l.player;
  return {
    slot: l.slot,
    slotLabel,
    player: p ? { id: p.id, name: p.fullName, position: p.position, nflTeam: p.team, injuryStatus: p.injuryStatus } : null,
    points: l.points,
    projected: l.projected,
    liveProjected: Math.round(l.liveProjected * 100) / 100,
    gameState: l.gameState,
    gameId: l.game?.id ?? null,
    opp: p ? opponentLabel(p.team, l.game) : "",
    statLine: p ? statLine(l.pts?.stats ?? null, p.position) : "",
    breakdown: (l.pts?.breakdown ?? []).map((b) => ({ label: b.label, value: b.value, points: b.points })),
    remaining: l.remainingFraction,
  };
}

function matchupSide(team: TeamWithOwner, score: TeamWeekScore, seed: number | null, standings: Map<string, StandingRow>, settings: LeagueSettings, stored: { score: number; projected: number }): MatchupSide {
  const starters = score.starters.map((s) => cell(s, s.label));
  const bench = score.bench.filter((b) => b.slot === "BN").map((b) => cell(b, "BN"));
  const reserve = score.bench.filter((b) => b.slot !== "BN").map((b) => cell(b, b.slot));
  // best possible lineup from actual points (starters + active bench)
  const pool = [...score.starters, ...score.bench.filter((b) => b.slot === "BN")].filter((l) => l.player);
  const value = new Map(pool.map((l) => [l.player!.id, l.points]));
  const best = optimalLineup(pool.map((l) => ({ id: l.player!.id, position: l.player!.position })), value, settings);
  const optimal = Math.round((best.reduce((a, s) => a + (s.playerId ? value.get(s.playerId) ?? 0 : 0), 0) + score.adjustments) * 100) / 100;
  return {
    team: teamRef(team, standings),
    seed,
    score: stored.score,
    projected: score.projected,
    liveProjected: stored.projected,
    ...sideCounts(score),
    starters,
    bench,
    reserve,
    benchPoints: score.benchPoints,
    optimalPoints: optimal,
    adjustments: score.adjustments,
  };
}

export async function loadMatchupDetail(ctx: LeagueContext, id: string) {
  const m = await db.matchup.findFirst({ where: { id, leagueId: ctx.league.id }, include: { homeTeam: { include: teamInclude }, awayTeam: { include: teamInclude } } });
  if (!m) return null;
  const weekRows = await db.matchup.findMany({ where: { leagueId: ctx.league.id, season: m.season, week: m.week }, select: { updatedAt: true, status: true, id: true } });
  let matchup = m;
  if (await ensureFreshMatchups(ctx, m.week, weekRows)) {
    matchup = (await db.matchup.findFirst({ where: { id }, include: { homeTeam: { include: teamInclude }, awayTeam: { include: teamInclude } } }))!;
  }
  const teamIds = [matchup.homeTeamId, matchup.awayTeamId].filter((x): x is string => !!x);
  const [standings, board, wp, others] = await Promise.all([
    standingsMap(ctx),
    weekBoard(ctx.league.id, matchup.season, matchup.week, ctx.settings, { teamIds }),
    db.winProbPoint.findMany({ where: { matchupId: id }, orderBy: { at: "asc" }, take: 2000 }),
    db.matchup.findMany({ where: { leagueId: ctx.league.id, season: matchup.season, week: matchup.week }, include: { homeTeam: true, awayTeam: true }, orderBy: { id: "asc" } }),
  ]);
  const upcoming = matchup.status === "UPCOMING";
  const hs = matchup.homeTeamId ? board.teams.get(matchup.homeTeamId) : undefined;
  const as = matchup.awayTeamId ? board.teams.get(matchup.awayTeamId) : undefined;
  const home = matchup.homeTeam && hs ? matchupSide(matchup.homeTeam, hs, matchup.homeSeed, standings, ctx.settings, upcoming ? { score: 0, projected: hs.projected } : { score: matchup.homeScore, projected: matchup.homeProjected }) : null;
  const away = matchup.awayTeam && as ? matchupSide(matchup.awayTeam, as, matchup.awaySeed, standings, ctx.settings, upcoming ? { score: 0, projected: as.projected } : { score: matchup.awayScore, projected: matchup.awayProjected }) : null;
  const homeWinProb = upcoming && hs && as ? winProbability({ liveProjected: hs.projected, variance: hs.variance }, { liveProjected: as.projected, variance: as.variance }) : matchup.homeWinProb;
  const games: Record<string, GameLite> = {};
  for (const g of new Set(board.games.values())) games[g.id] = toGameLite(g as NflGame);
  const wpHistory: WpPoint[] = wp.map((p) => ({ at: p.at.toISOString(), homeWinProb: p.homeWinProb, homeScore: p.homeScore, awayScore: p.awayScore }));
  const plays = await loadBigPlays(ctx.league.id, matchup.season, matchup.week, { teamIds, take: 30 });
  return {
    matchup: { id: matchup.id, week: matchup.week, season: matchup.season, status: matchup.status, homeWinProb, label: matchupRoundLabel(matchup, ctx.settings), isPlayoff: matchup.isPlayoff },
    home,
    away,
    games,
    wpHistory,
    plays,
    others: others.map((o) => ({
      id: o.id,
      status: o.status,
      home: o.homeTeam ? { id: o.homeTeam.id, abbrev: o.homeTeam.abbrev, primaryColor: o.homeTeam.primaryColor, score: o.homeScore, projected: o.homeProjected } : null,
      away: o.awayTeam ? { id: o.awayTeam.id, abbrev: o.awayTeam.abbrev, primaryColor: o.awayTeam.primaryColor, score: o.awayScore, projected: o.awayProjected } : null,
    })),
  };
}

export type MatchupDetail = NonNullable<Awaited<ReturnType<typeof loadMatchupDetail>>>;
export type OtherMatchup = MatchupDetail["others"][number];
