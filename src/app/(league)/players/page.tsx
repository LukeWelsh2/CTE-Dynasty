import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { capSummary } from "@/lib/roster";
import { NFL_TEAMS } from "@/lib/nfl/teams";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui/core";
import { PlayerFilterBar } from "@/components/players/filter-bar";
import { PlayersTable } from "@/components/players/players-table";
import { Pagination } from "@/components/players/pagination";
import { parsePlayerFilters, playersHref } from "@/lib/players/filters";
import { positionFilterOptions, timeframeLabel } from "@/lib/players/logic";
import { PER_PAGE, searchPlayers } from "@/lib/players/search";

export const metadata: Metadata = { title: "Players" };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getLeagueContext();
  const f = parsePlayerFilters(await searchParams, ctx.settings);
  const [result, mine] = await Promise.all([searchPlayers(ctx, f), myTeamStrip(ctx)]);
  const fptsLabel = timeframeLabel(f.tf, { week: ctx.week, season: ctx.season, specificWeek: result.window.specificWeek });
  const preset = ctx.settings.scoring.preset === "HALF_PPR" ? "Half-PPR" : ctx.settings.scoring.preset === "CUSTOM" ? "Custom" : ctx.settings.scoring.preset;

  return (
    <div>
      <PageHeader
        kicker={`Week ${ctx.week} · ${preset} scoring`}
        title="Players"
        subtitle={`${result.total.toLocaleString()} players · FPTS = ${fptsLabel}${f.tf === "ros" ? ` (weeks ${result.window.rosFrom}–${result.window.rosTo})` : ""}`}
        actions={
          <>
            <ButtonLink href="/news" variant="secondary" size="sm">
              Player news
            </ButtonLink>
            <ButtonLink href="/injuries" variant="secondary" size="sm">
              Injury report
            </ButtonLink>
            {ctx.myTeam && (
              <ButtonLink href="/waivers" variant="secondary" size="sm">
                My claims{mine?.claims ? ` (${mine.claims})` : ""}
              </ButtonLink>
            )}
          </>
        }
      />

      {mine && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-panel">
          <span className="font-bold uppercase tracking-wide text-muted">{ctx.myTeam!.name}</span>
          {ctx.settings.waivers.type === "FAB" && (
            <span>
              FAB <b className="tabular-nums">${mine.faab}</b>
            </span>
          )}
          {ctx.settings.salaryCap.enabled && (
            <span>
              Cap space <b className={mine.capSpace < 0 ? "text-loss" : "text-win"}>${mine.capSpace}</b>
              <span className="text-muted"> of ${ctx.settings.salaryCap.cap}</span>
            </span>
          )}
          <span>
            Active roster{" "}
            <b className={mine.active >= ctx.settings.roster.maxActiveRoster ? "text-loss" : ""}>
              {mine.active}/{ctx.settings.roster.maxActiveRoster}
            </b>
          </span>
          {mine.claims > 0 && (
            <Link href="/waivers" className="link">
              {mine.claims} pending claim{mine.claims === 1 ? "" : "s"}
            </Link>
          )}
          <span className="text-muted">{addRulesNote(ctx)}</span>
        </div>
      )}

      <PlayerFilterBar
        filters={f}
        positions={positionFilterOptions(ctx.settings)}
        teams={result.teams}
        nflTeams={NFL_TEAMS.map((t) => ({ abbr: t.abbr, name: `${t.city} ${t.name}` }))}
        maxWeek={result.maxWeek}
        week={ctx.week}
        hasTeam={!!ctx.myTeam}
      />

      {result.rows.length ? (
        <>
          <PlayersTable rows={result.rows} columns={result.columns} f={f} fptsLabel={fptsLabel} tz={ctx.settings.general.timezone} hasTeam={!!ctx.myTeam} />
          <Pagination page={result.page} pages={result.pages} total={result.total} perPage={PER_PAGE} href={(p) => playersHref(f, { page: p })} />
        </>
      ) : (
        <EmptyState title={f.status === "watch" ? "Your watch list is empty" : "No players match these filters"}>
          {f.status === "watch" ? (
            <>Tap the star next to any player to follow him here.</>
          ) : (
            <>
              Try a different position, availability or name.{" "}
              <Link href="/players" className="link">
                Reset filters
              </Link>
            </>
          )}
        </EmptyState>
      )}
    </div>
  );
}

async function myTeamStrip(ctx: Awaited<ReturnType<typeof getLeagueContext>>) {
  if (!ctx.myTeam) return null;
  const [team, cap, active, claims] = await Promise.all([
    db.team.findUnique({ where: { id: ctx.myTeam.id }, select: { faabBalance: true } }),
    capSummary(ctx.league.id, ctx.myTeam.id, ctx.season, ctx.settings),
    db.rosterSpot.count({ where: { teamId: ctx.myTeam.id, status: "ACTIVE" } }),
    db.waiverClaim.count({ where: { teamId: ctx.myTeam.id, status: "PENDING" } }),
  ]);
  return { faab: team?.faabBalance ?? 0, capSpace: cap.space, active, claims };
}

/** One-line summary of how adds work right now (league settings + phase) */
function addRulesNote(ctx: Awaited<ReturnType<typeof getLeagueContext>>): string {
  const w = ctx.settings.waivers;
  if (w.disableAdds) return "Adds are frozen by the commissioner";
  if (ctx.league.phase === "PLAYOFFS" && ctx.settings.playoffs.lockRostersInPlayoffs) return "Rosters are locked for the playoffs";
  const offseason = ctx.league.phase === "OFFSEASON" || ctx.league.phase === "KEEPER";
  if (offseason && !w.offseasonWaivers) return "Offseason: free agents add instantly";
  const claimsOnly = (w.type !== "FREE_FOR_ALL" && !w.continuousFreeAgency) || (ctx.league.phase === "PLAYOFFS" && w.playoffMode === "FAB_ONLY");
  return `${claimsOnly ? "All adds go through waivers" : "Free agents add instantly"}${w.lockPlayersAfterGameStart && !offseason ? " · players lock at kickoff until waivers run" : ""}`;
}
