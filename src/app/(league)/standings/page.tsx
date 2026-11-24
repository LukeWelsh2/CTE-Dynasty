// League standings: overall (with playoff line, clinch markers, odds), by division, and all-play.
import type { Metadata } from "next";
import { EmptyState, PageHeader, Panel } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { divisionTiebreakChain } from "@/lib/standings";
import { loadStandingsView, settingsSummary } from "@/lib/playoffs/view";
import { fmtWhen, MarkerLegend, SegmentLinks, StandingsTabs, TIEBREAKER_LABELS } from "@/components/standings/bits";
import { AllPlayTable, DivisionTables, OverallTable } from "@/components/standings/standings-tables";
import { PlayoffPicture } from "@/components/standings/playoff-picture";
import { LiveRefresh } from "@/components/standings/live-refresh";

export const metadata: Metadata = { title: "Standings" };

type View = "overall" | "division" | "allplay";

export default async function StandingsPage({ searchParams }: { searchParams: Promise<{ view?: string; season?: string }> }) {
  const sp = await searchParams;
  const ctx = await getLeagueContext();
  const { settings } = ctx;
  const showAllPlay = settings.standings.showAllPlayRecord !== false;
  const hasDivisions = settings.general.divisions.length > 0;
  const requested = (sp.view as View) ?? "overall";
  const viewKey: View = requested === "division" && hasDivisions ? "division" : requested === "allplay" && showAllPlay ? "allplay" : "overall";
  const view = await loadStandingsView(ctx, sp.season ? Number(sp.season) : undefined);
  const myTeamId = ctx.myTeam?.id ?? null;
  const tz = settings.general.timezone;
  const qs = (v: View, season = view.season) => {
    const p = new URLSearchParams();
    if (v !== "overall") p.set("view", v);
    if (season !== ctx.season) p.set("season", String(season));
    const s = p.toString();
    return `/standings${s ? `?${s}` : ""}`;
  };
  const views = [
    { key: "overall", label: "Overall", href: qs("overall") },
    ...(hasDivisions ? [{ key: "division", label: "Divisions", href: qs("division") }] : []),
    ...(showAllPlay ? [{ key: "allplay", label: "All-Play", href: qs("allplay") }] : []),
  ];
  const played = view.lastFinalWeek;
  const subtitleParts = [
    played ? `Through Week ${played}` : "No games played yet",
    view.playoffsStarted ? "Playoffs under way" : view.gamesLeft ? `${view.remainingWeeks} week${view.remainingWeeks === 1 ? "" : "s"} left in the regular season` : view.standings.length && played ? "Regular season complete" : null,
  ].filter(Boolean);
  const latest = view.odds.latest;
  const tiebreakers = settings.standings.tiebreakers;
  const divisionChain = divisionTiebreakChain(settings);
  const noGames = view.standings.every((r) => r.wins + r.losses + r.ties === 0);

  return (
    <div>
      <LiveRefresh leagueId={ctx.league.id} />
      <StandingsTabs active="standings" showPower={settings.standings.showPowerRankings} />
      <PageHeader
        kicker={`${view.season} season`}
        title="Standings"
        subtitle={subtitleParts.join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view.seasons.length > 1 && (
              <SegmentLinks label="Season" active={String(view.season)} items={view.seasons.map((s) => ({ key: String(s), label: String(s), href: qs(viewKey, s) }))} />
            )}
            {views.length > 1 && <SegmentLinks label="Standings view" active={viewKey} items={views} />}
          </div>
        }
      />

      {view.standings.length === 0 ? (
        <EmptyState title="No teams yet">Standings appear once the commissioner adds teams and the schedule is set.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-3">
            {noGames && (
              <EmptyState title="The season hasn't started">
                Records, points and the playoff race fill in after Week {settings.general.firstWeek} is final.
              </EmptyState>
            )}
            {viewKey === "overall" && <OverallTable view={view} settings={settings} myTeamId={myTeamId} />}
            {viewKey === "division" && <DivisionTables view={view} settings={settings} myTeamId={myTeamId} />}
            {viewKey === "allplay" && (
              <>
                <p className="text-sm text-muted">
                  All-play ranks teams by the record they would have if they played every other team every week. <b className="text-ink">Luck</b> compares actual
                  head-to-head wins with the wins that all-play rate predicts.
                </p>
                <AllPlayTable view={view} myTeamId={myTeamId} />
              </>
            )}
            {latest && (
              <p className="text-xs text-muted">
                Playoff odds from {latest.simulations.toLocaleString()} simulated seasons using projected optimal lineups · updated {fmtWhen(latest.computedAt, tz)}.
              </p>
            )}
          </div>
          <aside className="space-y-4">
            <PlayoffPicture view={view} myTeamId={myTeamId} />
            <Panel title="Legend & tiebreakers">
              <div className="space-y-3 text-sm">
                <MarkerLegend />
                <div>
                  <div className="label">Ties in the standings</div>
                  <p className="mb-1 text-xs text-muted">Win percentage first, then:</p>
                  <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                    {tiebreakers.map((t) => (
                      <li key={t}>{TIEBREAKER_LABELS[t] ?? t}</li>
                    ))}
                  </ol>
                  <p className="mt-1 text-[11px] text-muted">Hover a dotted rank to see why a team sits above the team it&apos;s tied with.</p>
                </div>
                {hasDivisions && divisionChain.join() !== tiebreakers.join() && (
                  <div>
                    <div className="label">Ties within a division</div>
                    <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                      {divisionChain.map((t) => (
                        <li key={t}>{TIEBREAKER_LABELS[t] ?? t}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <div>
                  <div className="label">Playoffs</div>
                  <p className="text-xs text-muted">
                    {settingsSummary(settings, view.schedule)} · Weeks {view.schedule.firstWeek}–{view.schedule.lastWeek}
                  </p>
                </div>
                {(view.medianGame || settings.niche.weeklyHighScoreBonusWin) && (
                  <div>
                    <div className="label">Bonus results</div>
                    <ul className="space-y-0.5 text-xs text-muted">
                      {view.medianGame && <li>Every team also plays the weekly league median: an extra win or loss each week.</li>}
                      {settings.niche.weeklyHighScoreBonusWin && <li>The week&apos;s highest score earns an extra win.</li>}
                    </ul>
                  </div>
                )}
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}
