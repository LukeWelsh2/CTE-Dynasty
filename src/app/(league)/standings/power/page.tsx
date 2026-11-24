// Power rankings: composite score (record, points, all-play, recent form — weights from league settings),
// week-over-week movement, rest-of-season projection and an auto-generated blurb per team.
import type { Metadata } from "next";
import Link from "next/link";
import { Collapsible, EmptyState, PageHeader, Panel, SummaryStrip, type SummaryItem } from "@/components/ui/core";
import { fmtPts, ordinal } from "@/lib/utils";
import { getLeagueContext } from "@/lib/league";
import { loadPowerView } from "@/lib/playoffs/view";
import { fmtProb, MarkerLegend, StandingsTabs } from "@/components/standings/bits";
import { PowerList } from "@/components/standings/power-list";
import { LiveRefresh } from "@/components/standings/live-refresh";

export const metadata: Metadata = { title: "Power Rankings" };

export default async function PowerRankingsPage() {
  const ctx = await getLeagueContext();
  const { settings } = ctx;
  if (!settings.standings.showPowerRankings) {
    return (
      <div>
        <StandingsTabs active="power" showPower={false} />
        <PageHeader title="Power rankings" />
        <EmptyState title="Power rankings are turned off">
          The commissioner has hidden power rankings for this league.{" "}
          {ctx.isCommish ? (
            <Link href="/commissioner/settings" className="link">
              Turn them on in league settings
            </Link>
          ) : (
            <Link href="/standings" className="link">
              See the standings
            </Link>
          )}
          .
        </EmptyState>
      </div>
    );
  }
  const view = await loadPowerView(ctx);
  const w = settings.standings.powerRanking;
  const total = w.recordWeight + w.pointsWeight + w.allPlayWeight + w.recentFormWeight || 1;
  const pc = (x: number) => `${Math.round((x / total) * 100)}%`;
  const formula = [
    w.recordWeight ? `${pc(w.recordWeight)} win percentage` : null,
    w.pointsWeight ? `${pc(w.pointsWeight)} points scored` : null,
    w.allPlayWeight ? `${pc(w.allPlayWeight)} all-play record` : null,
    w.recentFormWeight ? `${pc(w.recentFormWeight)} last five games` : null,
  ].filter(Boolean);
  const rosLabel = view.rosWeeks ? (view.rosWeeks[0] === view.rosWeeks[1] ? `Week ${view.rosWeeks[0]}` : `Weeks ${view.rosWeeks[0]}–${view.rosWeeks[1]}`) : null;
  const noGames = view.throughWeek === 0;
  const myTeamId = ctx.myTeam?.id ?? null;
  // summary: where I rank, my score against the top, my rest-of-season strength, my playoff odds
  const mine = view.rows.find((r) => r.row.team.id === myTeamId);
  const top = view.rows[0];
  const move = mine && mine.prevRank !== null ? mine.prevRank - mine.row.powerRank : null;
  const summary: SummaryItem[] = mine
    ? [
        {
          label: "Rank",
          value: ordinal(mine.row.powerRank),
          sub: move ? <span className={move > 0 ? "text-win" : "text-loss"}>{`${move > 0 ? "▲" : "▼"} ${Math.abs(move)} wk`}</span> : move === 0 ? "no change" : `of ${view.rows.length}`,
        },
        { label: "Score", value: mine.row.powerScore.toFixed(1), sub: top && top !== mine ? `top ${top.row.powerScore.toFixed(1)}` : "top score" },
        { label: "ROS/wk", value: mine.rosPerWeek !== null ? fmtPts(mine.rosPerWeek, 1) : "—", sub: mine.rosRank ? ordinal(mine.rosRank) : undefined, title: "Rest-of-season projection per week" },
        { label: "Playoffs", value: mine.playoffPct !== null ? fmtProb(mine.playoffPct, mine.playoffLock) : "—", tone: mine.playoffLock === "clinched" ? "good" : undefined, sub: "odds" },
      ]
    : [];

  return (
    <div>
      <LiveRefresh leagueId={ctx.league.id} />
      <StandingsTabs active="power" />
      <PageHeader
        kicker={`${ctx.season} season`}
        title="Power rankings"
        subtitle={
          noGames
            ? "Rankings start after the first week of results"
            : `Through Week ${view.throughWeek}${view.comparedTo ? ` · vs. Week ${view.comparedTo}` : ""}`
        }
      />
      {view.rows.length === 0 ? (
        <EmptyState title="No teams yet">Power rankings appear once the league has teams and results.</EmptyState>
      ) : noGames ? (
        <EmptyState title="No results yet">Power rankings blend record, scoring, all-play and recent form, so they start once Week {settings.general.firstWeek} is final.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
          <div className="min-w-0 space-y-4">
            {summary.length > 0 && <SummaryStrip items={summary} />}
            <PowerList rows={view.rows} myTeamId={myTeamId} />
          </div>
          <aside className="min-w-0 space-y-4">
            {/* the method lives behind taps, not in the flow */}
            <Panel title="About power rankings" noPad>
              <div className="divide-y divide-line/70 border-t border-line/70 px-4">
                <Collapsible summary="Power score" meta="0–100">
                  <p className="text-[13px] leading-5 text-muted">
                    {formula.join(" + ")}. Points are scaled to the league&apos;s top scorer. Arrows compare with last week&apos;s ranking.
                  </p>
                </Collapsible>
                <Collapsible summary="All-play">
                  <p className="text-[13px] leading-5 text-muted">The record a team would have playing every opponent every week — it strips out schedule luck.</p>
                </Collapsible>
                {rosLabel && (
                  <Collapsible summary="ROS/wk" meta={rosLabel}>
                    <p className="text-[13px] leading-5 text-muted">The average optimal-lineup projection for {rosLabel} from current rosters, with injured players removed.</p>
                  </Collapsible>
                )}
                <Collapsible summary="Legend">
                  <MarkerLegend />
                </Collapsible>
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}
