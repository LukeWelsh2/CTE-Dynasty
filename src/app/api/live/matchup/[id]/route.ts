// GET /api/live/matchup/:id — live matchup snapshot (polling fallback when SSE is unavailable).
// League members only.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/auth/session";
import { resolveSettings } from "@/lib/settings/schema";
import { weekBoard } from "@/lib/live/board";
import { toGameLite } from "@/lib/live/pipeline";
import type { TeamWeekScore } from "@/lib/scoreboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function side(score: TeamWeekScore | undefined, stored: { score: number; projected: number }) {
  if (!score) return null;
  const players = [...score.starters, ...score.bench]
    .filter((l) => l.player)
    .map((l) => ({
      playerId: l.player!.id,
      name: l.player!.fullName,
      slot: l.slot,
      points: l.points,
      projected: l.projected,
      liveProjected: Math.round(l.liveProjected * 100) / 100,
      gameState: l.gameState,
      gameId: l.game?.id ?? null,
    }));
  return {
    teamId: score.teamId,
    score: stored.score,
    liveProjected: stored.projected,
    projected: score.projected,
    yetToPlay: score.yetToPlay,
    inProgress: score.inProgress,
    benchPoints: score.benchPoints,
    players,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const m = await db.matchup.findUnique({ where: { id }, include: { league: { select: { id: true, settings: true } } } });
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const member = await db.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: m.leagueId, userId: user.id } }, select: { id: true } });
  if (!member && !user.isSiteAdmin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const settings = resolveSettings(m.league.settings);
  const teamIds = [m.homeTeamId, m.awayTeamId].filter((x): x is string => !!x);
  const board = await weekBoard(m.leagueId, m.season, m.week, settings, { teamIds });
  const games = [...new Set(board.games.values())].map(toGameLite);
  return NextResponse.json(
    {
      matchup: {
        id: m.id,
        season: m.season,
        week: m.week,
        status: m.status,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homeProjected: m.homeProjected,
        awayProjected: m.awayProjected,
        homeWinProb: m.homeWinProb,
        updatedAt: m.updatedAt.toISOString(),
      },
      home: side(m.homeTeamId ? board.teams.get(m.homeTeamId) : undefined, { score: m.homeScore, projected: m.homeProjected }),
      away: side(m.awayTeamId ? board.teams.get(m.awayTeamId) : undefined, { score: m.awayScore, projected: m.awayProjected }),
      games,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
