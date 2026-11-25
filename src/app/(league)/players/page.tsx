import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { activeRosterLimit, bindingCapRoom, capLimitLabel, capSummary } from "@/lib/roster";
import { NFL_TEAMS } from "@/lib/nfl/teams";
import { Clock, HeartPulse, Newspaper, Star } from "lucide-react";
import { Alert, Chip, EmptyState, PageHeader, SummaryStrip } from "@/components/ui/core";
import { ScrollRow } from "@/components/ui/scroll-row";
import { fmtMoney as money } from "@/lib/utils";
import { PlayerFilterBar } from "@/components/players/filter-bar";
import { PlayersTable } from "@/components/players/players-table";
import { Pagination } from "@/components/players/pagination";
import { parsePlayerFilters, playersHref } from "@/lib/players/filters";
import { positionFilterOptions, timeframeLabel } from "@/lib/players/logic";
import { PER_PAGE, searchPlayers } from "@/lib/players/search";
import { teamAddBlock } from "@/lib/players/context";

export const metadata: Metadata = { title: "Players" };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getLeagueContext();
  const f = parsePlayerFilters(await searchParams, ctx.settings);
  // my team knocked out of the playoffs (waivers.eliminatedTeamsCanAdd / playoffs.eliminatedTeamsCanTransact):
  // every free agent shows as locked, so say why
  const [result, mine, addBlock] = await Promise.all([searchPlayers(ctx, f), myTeamStrip(ctx), teamAddBlock(ctx)]);
  const fptsLabel = timeframeLabel(f.tf, { week: ctx.week, season: ctx.season, specificWeek: result.window.specificWeek });
  const preset = ctx.settings.scoring.preset === "HALF_PPR" ? "Half-PPR" : ctx.settings.scoring.preset === "CUSTOM" ? "Custom" : ctx.settings.scoring.preset;

  return (
    <div>
      <PageHeader
        kicker={`Week ${ctx.week} · ${preset} scoring`}
        title="Players"
        subtitle={`${result.total.toLocaleString()} players · FPTS = ${fptsLabel}${f.tf === "ros" ? ` (weeks ${result.window.rosFrom}–${result.window.rosTo})` : ""}`}
      />
      <ScrollRow as="nav" aria-label="Player pages" className="-mx-3 mb-3 scroll-px-3 gap-2 px-3 sm:mx-0 sm:scroll-px-0 sm:px-0">
        <Chip href="/news" icon={<Newspaper size={15} aria-hidden />}>
          News
        </Chip>
        <Chip href="/injuries" icon={<HeartPulse size={15} aria-hidden />}>
          Injuries
        </Chip>
        {ctx.myTeam && (
          <Chip href="/waivers" icon={<Clock size={15} aria-hidden />} count={mine?.claims || null}>
            My claims
          </Chip>
        )}
        <Chip href={playersHref(f, { status: "watch", owner: null, page: 1 })} icon={<Star size={15} aria-hidden />} active={f.status === "watch"}>
          Watch list
        </Chip>
      </ScrollRow>

      {mine && (
        <div className="mb-4">
          <SummaryStrip
            // four numbers → 2×2 under 380px so nothing truncates on small phones
            className={ctx.settings.waivers.type === "FAB" && ctx.settings.salaryCap.enabled ? "max-[379px]:grid-cols-2" : undefined}
            items={[
              ...(ctx.settings.waivers.type === "FAB" ? [{ label: "FAB", value: money(mine.faab), sub: "to bid" }] : []),
              ...(ctx.settings.salaryCap.enabled
                ? [
                    {
                      label: "Room",
                      value: money(mine.capSpace),
                      tone: mine.capSpace < 0 ? ("bad" as const) : undefined,
                      sub: `of ${money(mine.capOf)}`,
                      title: mine.capOf !== ctx.settings.salaryCap.cap ? `Cap room under the ${capLimitLabel(ctx.settings)}` : "Cap room",
                    },
                  ]
                : []),
              { label: "Roster", value: `${mine.active}/${mine.maxActive}`, sub: mine.active >= mine.maxActive ? "full" : "active", tone: mine.active >= mine.maxActive ? ("bad" as const) : undefined, title: "Active roster" },
              { label: "Claims", value: mine.claims, sub: "pending", href: "/waivers" },
            ]}
          />
          <p className={addBlock ? "mt-1.5 px-1 text-[13px] font-semibold text-loss" : "mt-1.5 line-clamp-2 px-1 text-[13px] text-muted"}>{addRulesNote(ctx, addBlock)}</p>
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

      {addBlock && (
        <Alert tone="warn" className="mb-3">
          {addBlock}
        </Alert>
      )}

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
  // the same figures the add / claim dialog (PlayerQuote) and acquirePlayerAction use: room under the capLimit ceiling
  // while the cap is enforced (else under the league cap), and activeRosterLimit for the league phase
  const room = bindingCapRoom(cap.committed, ctx.settings, { phase: ctx.league.phase });
  return {
    faab: team?.faabBalance ?? 0,
    capSpace: room ?? cap.space,
    capOf: room !== null ? room + cap.committed : cap.cap,
    maxActive: activeRosterLimit(ctx.settings, { phase: ctx.league.phase }),
    active,
    claims,
  };
}

/** One-line summary of how adds work right now for my team (league settings + phase; `addBlock` = teamAddBlock) */
function addRulesNote(ctx: Awaited<ReturnType<typeof getLeagueContext>>, addBlock: string | null): string {
  const w = ctx.settings.waivers;
  if (w.disableAdds) return "Adds are frozen by the commissioner";
  if (ctx.league.phase === "PLAYOFFS" && ctx.settings.playoffs.lockRostersInPlayoffs) return "Rosters are locked for the playoffs";
  if (addBlock) return "Your team can't add players or make claims";
  const offseason = ctx.league.phase === "OFFSEASON" || ctx.league.phase === "KEEPER";
  if (offseason && !w.offseasonWaivers) return "Offseason: free agents add instantly";
  const claimsOnly = (w.type !== "FREE_FOR_ALL" && !w.continuousFreeAgency) || (ctx.league.phase === "PLAYOFFS" && w.playoffMode === "FAB_ONLY");
  return `${claimsOnly ? "All adds go through waivers" : "Free agents add instantly"}${w.lockPlayersAfterGameStart && !offseason ? " · players lock at kickoff until waivers run" : ""}`;
}
