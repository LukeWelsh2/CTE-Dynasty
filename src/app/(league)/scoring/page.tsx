import Link from "next/link";
import { CalendarDays, Swords, Trophy } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { loadBigPlays, loadScoreboard } from "@/lib/live/queries";
import { maintainSimulation, simAvailability, simStatusEvent, SIM_SPEEDS } from "@/lib/live/simulate";
import { playoffWeekInfo } from "@/lib/live/format";
import { db } from "@/lib/db";
import { Alert, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/core";
import { LiveScoreboard } from "@/components/scoring/live-scoreboard";
import { NflGamesRail } from "@/components/scoring/nfl-games-rail";
import { BigPlaysFeed } from "@/components/scoring/big-plays-feed";
import { SimControls } from "@/components/scoring/sim-controls";
import { WeekPills } from "@/components/scoring/bits";

export const metadata = { title: "Live Scoring" };

export default async function ScoringPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const maxWeek = Math.max(lastFantasyWeek(ctx.settings), ctx.week);
  const firstWeek = Math.min(ctx.settings.general.firstWeek, ctx.week);
  const requested = Number.parseInt(sp.week ?? "", 10);
  const week = Number.isFinite(requested) ? Math.min(maxWeek, Math.max(firstWeek, requested)) : ctx.week;
  const tz = ctx.settings.general.timezone;

  const sim = await maintainSimulation();
  const [{ cards, games }, plays, teams] = await Promise.all([
    loadScoreboard(ctx, week),
    loadBigPlays(ctx.league.id, ctx.season, week),
    db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true, abbrev: true, primaryColor: true } }),
  ]);

  let simPanel: React.ReactNode = null;
  if (ctx.isCommish) {
    let avail = await simAvailability(ctx.season, week);
    // nothing to score without fantasy matchups (e.g. playoff weeks before seeding)
    if (avail.ok && cards.length === 0) avail = { ...avail, ok: false, reason: `Week ${week} has no fantasy matchups yet — there is nothing to simulate.` };
    let suggestWeek: number | null = null;
    if (!avail.ok && !sim) {
      const from = week > ctx.week ? ctx.week : week + 1;
      for (let w = from; w <= Math.min(18, from + 2); w++) {
        if (w === week) continue;
        const hasMatchups = (await db.matchup.count({ where: { leagueId: ctx.league.id, season: ctx.season, week: w } })) > 0;
        if (hasMatchups && (await simAvailability(ctx.season, w)).ok) {
          suggestWeek = w;
          break;
        }
      }
    }
    simPanel = (
      <SimControls
        leagueId={ctx.league.id}
        tz={tz}
        viewWeek={week}
        status={simStatusEvent(sim)}
        available={avail.ok}
        reason={avail.reason ?? null}
        suggestWeek={suggestWeek}
        speeds={Object.entries(SIM_SPEEDS).map(([key, v]) => ({ key, label: v.label }))}
      />
    );
  }

  const live = cards.filter((c) => c.status === "LIVE").length;
  const final = cards.filter((c) => c.status === "FINAL").length;
  const playoff = playoffWeekInfo(week, ctx.settings);
  const markers: Record<number, string> = {};
  for (let w = ctx.settings.playoffs.startWeek; w <= maxWeek; w++) {
    const info = playoffWeekInfo(w, ctx.settings);
    if (info) markers[w] = info.label;
  }
  const myCard = cards.find((c) => c.isMine);
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, { abbrev: t.abbrev, primaryColor: t.primaryColor }]));
  const subtitle =
    cards.length === 0
      ? "No matchups scheduled"
      : `${cards.length} matchup${cards.length === 1 ? "" : "s"}${live ? ` · ${live} live` : ""}${final ? ` · ${final} final` : ""}`;

  return (
    <div>
      <PageHeader
        kicker={`${ctx.season} · Week ${week}${playoff ? ` · ${playoff.label}` : ""}`}
        title="Live Scoreboard"
        subtitle={subtitle}
        actions={
          <>
            {myCard && (
              <ButtonLink href={`/scoring/${myCard.id}`} size="sm">
                <Swords size={14} /> My matchup
              </ButtonLink>
            )}
            <ButtonLink href="/schedule" variant="secondary" size="sm">
              <CalendarDays size={14} /> Schedule
            </ButtonLink>
          </>
        }
      />
      <WeekPills weeks={Array.from({ length: maxWeek - firstWeek + 1 }, (_, i) => firstWeek + i)} active={week} current={ctx.week} hrefFor={(w) => (w === ctx.week ? "/scoring" : `/scoring?week=${w}`)} markers={markers} />

      {sim && sim.week === week && (
        <Alert tone="warn" className="mb-3">
          <strong>Simulation{sim.status === "complete" ? " complete" : " in progress"}:</strong> week {week} scores, game clocks and plays are simulated, not real NFL results.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {cards.length ? (
            <LiveScoreboard leagueId={ctx.league.id} week={week} cards={cards} />
          ) : (
            <EmptyState title={playoff ? `${playoff.label} matchups aren't set yet` : `No matchups in week ${week}`} icon={<Trophy size={22} />}>
              {playoff
                ? "Playoff matchups appear once the regular season ends and seeds are locked."
                : (
                  <>
                    The league schedule doesn&apos;t include week {week}. See the full <Link href="/schedule" className="link">season schedule</Link>.
                  </>
                )}
            </EmptyState>
          )}
        </div>
        <aside className="min-w-0 space-y-4">
          {simPanel}
          <Panel title={`NFL games · Week ${week}`} subtitle={`Times in ${tz.replace(/_/g, " ")}`} noPad>
            <NflGamesRail leagueId={ctx.league.id} season={ctx.season} week={week} tz={tz} games={games} />
          </Panel>
          <Panel title="Big plays" subtitle="TDs, long gains & takeaways" noPad>
            <BigPlaysFeed leagueId={ctx.league.id} plays={plays} teams={teamMap} live={week === (sim?.week ?? ctx.week) || week === ctx.week} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
