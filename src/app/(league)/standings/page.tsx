// League standings — "Where do I stand, and will I make the playoffs?" (docs/DESIGN.md → Reference screens →
// Standings). Summary strip (rank, record, playoff odds, seed), then the ranked list (phones: StandingsList with a
// column switcher and tap-to-expand rows; md+: the full table). Overall, by division, and all-play; explanations sit
// in collapsed "About" rows.
import type { Metadata } from "next";
import { Collapsible, EmptyState, InfoButton, PageHeader, Panel, SummaryStrip, type SummaryItem } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { divisionTiebreakChain, overallTiebreakChain } from "@/lib/standings";
import { loadStandingsView, settingsSummary } from "@/lib/playoffs/view";
import { fmtProb, fmtWhen, MarkerLegend, SegmentLinks, StandingsTabs, TIEBREAKER_LABELS } from "@/components/standings/bits";
import { AllPlayTable, DivisionTables, OverallTable, phoneStandingsRows, standingsCuts } from "@/components/standings/standings-tables";
import { StandingsList } from "@/components/standings/standings-list";
import { fmtPts, ordinal, record } from "@/lib/utils";
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
  // steps the ranking adds after the configured list (nothing after a coin flip can matter)
  const tailSteps = tiebreakers.includes("COIN_FLIP") ? [] : overallTiebreakChain(tiebreakers).slice(tiebreakers.length);
  const usesH2H = tiebreakers.includes("H2H") || (hasDivisions && divisionChain.includes("H2H"));
  const noGames = view.standings.every((r) => r.wins + r.losses + r.ties === 0);

  // the summary strip answers "where do I stand?": my rank, record, playoff odds and seed
  const mine = myTeamId ? view.standings.find((r) => r.team.id === myTeamId) : undefined;
  const myOdds = mine ? view.odds.odds.get(mine.team.id) : undefined;
  const myPrev = mine ? view.odds.previous.get(mine.team.id) : undefined;
  const myClinch = mine ? view.clinch.get(mine.team.id) : undefined;
  const mySeed = mine ? view.seedOf.get(mine.team.id) ?? null : null;
  const oddsDelta = myOdds && myPrev ? Math.round((myOdds.playoffPct - myPrev.playoffPct) * 100) : 0;
  const summary: SummaryItem[] = mine
    ? [
        { label: "Rank", value: ordinal(mine.rank), sub: `of ${view.standings.length}` },
        { label: "Record", value: record(mine.wins, mine.losses, mine.ties), sub: mine.gamesBack > 0 ? `${mine.gamesBack} GB` : `PF ${fmtPts(mine.pointsFor, 0)}` },
        ...(view.odds.odds.size
          ? [
              {
                label: "Odds",
                value: fmtProb(myOdds?.playoffPct, myClinch?.playoffs),
                tone: myClinch?.playoffs === "clinched" ? ("good" as const) : undefined,
                title: oddsDelta ? `Playoff odds · ${oddsDelta > 0 ? "up" : "down"} ${Math.abs(oddsDelta)} points since last week` : "Playoff odds",
                sub: oddsDelta ? <span className={oddsDelta > 0 ? "text-win" : "text-loss"}>{`${oddsDelta > 0 ? "▲" : "▼"} ${Math.abs(oddsDelta)} wk`}</span> : "playoffs",
              },
            ]
          : [{ label: "PF", value: fmtPts(mine.pointsFor, 0), sub: "points for" }]),
        { label: "Seed", value: mySeed ? `#${mySeed}` : "—", sub: mySeed ? (mySeed <= view.schedule.plan.byes ? "bye" : "in") : "out" },
      ]
    : [];
  const cuts = standingsCuts(view);

  return (
    <div>
      <LiveRefresh leagueId={ctx.league.id} />
      <StandingsTabs active="standings" showPower={settings.standings.showPowerRankings} />
      <PageHeader kicker={`${view.season} season`} title="Standings" subtitle={subtitleParts.join(" · ")} />

      {view.standings.length === 0 ? (
        <EmptyState title="No teams yet">Standings appear once the commissioner adds teams and the schedule is set.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
          <div className="min-w-0 space-y-4">
            {summary.length > 0 && !noGames && <SummaryStrip items={summary} />}
            {noGames && <EmptyState title="The season hasn't started">Records, points and the playoff race fill in after Week {settings.general.firstWeek} is final.</EmptyState>}
            {(views.length > 1 || view.seasons.length > 1) && (
              <div className="flex flex-wrap items-center gap-2">
                {views.length > 1 && <SegmentLinks label="Standings view" active={viewKey} items={views} full={false} />}
                {view.seasons.length > 1 && <SegmentLinks label="Season" active={String(view.season)} items={view.seasons.map((s) => ({ key: String(s), label: String(s), href: qs(viewKey, s) }))} />}
                {viewKey === "allplay" && (
                  <InfoButton title="All-play">
                    <p>All-play ranks teams by the record they would have if they played every other team every week.</p>
                    <p>
                      <b>Luck</b> compares actual head-to-head wins with the wins that all-play rate predicts.
                    </p>
                  </InfoButton>
                )}
              </div>
            )}
            {viewKey === "overall" && (
              <>
                <div className="md:hidden">
                  <StandingsList rows={phoneStandingsRows(view, settings, myTeamId)} playoffAfter={cuts.playoffAfter} byeAfter={cuts.byeAfter} hasOdds={view.odds.odds.size > 0} />
                </div>
                <div className="hidden md:block">
                  <OverallTable view={view} settings={settings} myTeamId={myTeamId} />
                </div>
              </>
            )}
            {viewKey === "division" && <DivisionTables view={view} settings={settings} myTeamId={myTeamId} />}
            {viewKey === "allplay" && <AllPlayTable view={view} myTeamId={myTeamId} />}
          </div>
          <aside className="min-w-0 space-y-4">
            <PlayoffPicture view={view} myTeamId={myTeamId} />
            {/* explanations live behind taps, not in the flow */}
            <Panel title="About these standings" noPad>
              <div className="divide-y divide-line/70 border-t border-line/70 px-4">
                {latest && (
                  <Collapsible summary="Playoff odds" meta={fmtWhen(latest.computedAt, tz)}>
                    <p className="text-[13px] leading-5 text-muted">
                      From {latest.simulations.toLocaleString()} simulated seasons using projected optimal lineups · updated {fmtWhen(latest.computedAt, tz)}.
                    </p>
                  </Collapsible>
                )}
                <Collapsible summary="Legend">
                  <MarkerLegend />
                </Collapsible>
                <Collapsible summary="Tiebreakers" meta={`${tiebreakers.length} steps`}>
                  <div className="space-y-2 text-[13px] leading-5">
                    <p className="text-muted">Win percentage first, then:</p>
                    <ol className="list-decimal space-y-0.5 pl-5">
                      {tiebreakers.map((t) => (
                        <li key={t}>{TIEBREAKER_LABELS[t] ?? t}</li>
                      ))}
                    </ol>
                    {tailSteps.length > 0 && (
                      <p className="text-muted">
                        If still tied: {tailSteps.map((t) => (t === "COIN_FLIP" ? "a coin flip drawn once per season" : (TIEBREAKER_LABELS[t] ?? t).toLowerCase())).join(", then ")}.
                      </p>
                    )}
                    <p className="text-muted">
                      Ties among three or more teams are broken as a group.
                      {usesH2H &&
                        " Head-to-head uses each team's record in games among the tied teams when they have all played each other equally often; otherwise it only moves a team that beat, or lost to, every other tied team."}{" "}
                      Once a step separates teams, any still tied start the list again.
                    </p>
                    <p className="text-muted">A dotted rank marks a tie: hover it (or tap the row on a phone) to see why a team sits above the team it&apos;s tied with.</p>
                    {hasDivisions && (
                      <div>
                        <div className="font-semibold">Within a division</div>
                        {divisionChain.join() !== tiebreakers.join() ? (
                          <ol className="list-decimal space-y-0.5 pl-5">
                            {divisionChain.map((t) => (
                              <li key={t}>{TIEBREAKER_LABELS[t] ?? t}</li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-muted">The same steps as above.</p>
                        )}
                        <p className="text-muted">Applied among the division&apos;s teams only; if still tied, the overall standings order decides.</p>
                      </div>
                    )}
                  </div>
                </Collapsible>
                <Collapsible summary="Playoff format" meta={`Wk ${view.schedule.firstWeek}–${view.schedule.lastWeek}`}>
                  <p className="text-[13px] leading-5 text-muted">
                    {settingsSummary(settings, view.schedule)} · Weeks {view.schedule.firstWeek}–{view.schedule.lastWeek}
                  </p>
                </Collapsible>
                {(view.medianGame || settings.niche.weeklyHighScoreBonusWin) && (
                  <Collapsible summary="Bonus results">
                    <ul className="space-y-0.5 text-[13px] leading-5 text-muted">
                      {view.medianGame && <li>Every team also plays the weekly league median: an extra win or loss each week.</li>}
                      {settings.niche.weeklyHighScoreBonusWin && <li>The week&apos;s highest score earns an extra win.</li>}
                    </ul>
                  </Collapsible>
                )}
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}
