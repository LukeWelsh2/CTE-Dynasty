import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, ButtonLink, EmptyState, PageHeader, TabLinks } from "@/components/ui/core";
import { firstOpenDraftSeason } from "@/lib/picks";
import { getAdpMap, positionFilters, rookieEligibleWhere } from "@/lib/draft/data";
import { rookieRankMap, ROOM_PLAYER_SELECT } from "@/lib/draft/state";
import { getTierBreaks } from "@/lib/draft/board";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { BigBoard, type BoardPlayer, type BoardRow } from "@/components/draft/big-board";

export const metadata: Metadata = { title: "My Big Board" };

export default async function BigBoardPage({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const next = firstOpenDraftSeason(ctx.league.season, ctx.league.phase);
  const classes = [next, next + 1];
  const requested = Number(sp.class);
  const classYear = classes.includes(requested) ? requested : next;
  const header = <PageHeader kicker="Draft prep" title="My Big Board" subtitle="Your private rookie rankings — autopick uses them if you're away when you're on the clock" />;
  const tabs = <TabLinks active={String(classYear)} tabs={classes.map((c) => ({ key: String(c), label: `${c} class`, href: `/draft/board?class=${c}` }))} />;
  if (!ctx.myTeam) {
    return (
      <div>
        {header}
        <EmptyState title="You don't manage a team">Big boards belong to teams. Ask the commissioner to assign you a team.</EmptyState>
      </div>
    );
  }
  const teamId = ctx.myTeam.id;
  const [entries, breaks, pool, ranks, adp, rankingsCount, draft] = await Promise.all([
    db.bigBoardEntry.findMany({ where: { teamId, classYear }, orderBy: { rank: "asc" }, include: { player: { select: ROOM_PLAYER_SELECT } } }),
    getTierBreaks(teamId, classYear),
    db.player.findMany({ where: rookieEligibleWhere(ctx.league.id, classYear, ctx.settings, "ROOKIES_ONLY"), select: ROOM_PLAYER_SELECT }),
    rookieRankMap(ctx.league.id, classYear),
    getAdpMap(Math.min(classYear, ctx.league.season)),
    db.rookieRanking.count({ where: { leagueId: ctx.league.id, classYear: { in: [classYear, classYear - 1] }, playerId: { not: null } } }),
    db.draft.findFirst({ where: { leagueId: ctx.league.id, type: "ROOKIE", season: classYear } }),
  ]);
  const spots = entries.length ? await db.rosterSpot.findMany({ where: { leagueId: ctx.league.id, playerId: { in: entries.map((e) => e.playerId) } }, select: { playerId: true, team: { select: { abbrev: true } } } }) : [];
  const rosteredBy = new Map(spots.map((s) => [s.playerId, s.team.abbrev]));
  const toBoard = (p: (typeof pool)[number]): BoardPlayer => ({
    id: p.id,
    fullName: p.fullName,
    position: normalizePosition(p.position),
    team: p.team,
    college: p.college,
    age: p.age,
    injuryStatus: p.injuryStatus,
    adp: adp.get(p.id) ?? null,
    leagueRank: ranks.get(p.id)?.rank ?? null,
    rosteredBy: rosteredBy.get(p.id) ?? null,
  });
  const rows: BoardRow[] = entries.map((e) => ({ ...toBoard(e.player), note: e.note }));
  const poolRows = pool
    .map(toBoard)
    .sort((a, b) => (a.leagueRank ?? 1e6) - (b.leagueRank ?? 1e6) || (a.adp ?? 1e6) - (b.adp ?? 1e6) || a.fullName.localeCompare(b.fullName))
    .slice(0, 400);
  return (
    <div className="space-y-3">
      {header}
      {tabs}
      {draft && (draft.status === "LIVE" || draft.status === "PAUSED") && (
        <Alert tone="info">
          The {draft.name} is {draft.status.toLowerCase()} — drafted players drop off automatically.{" "}
          <ButtonLink href={`/draft/rookie?id=${draft.id}`} size="xs" className="ml-1">
            Go to the draft room
          </ButtonLink>
        </Alert>
      )}
      <BigBoard classYear={classYear} initialRows={rows} initialBreaks={breaks} pool={poolRows} positions={positionFilters(ctx.settings, { includeDef: false }).filter((p) => p !== "K")} rankingsCount={rankingsCount} />
    </div>
  );
}
