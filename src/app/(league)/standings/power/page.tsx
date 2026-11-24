// Power rankings: composite score (record, points, all-play, recent form — weights from league settings),
// week-over-week movement, rest-of-season projection and an auto-generated blurb per team.
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui/core";
import { getLeagueContext } from "@/lib/league";
import { loadPowerView } from "@/lib/playoffs/view";
import { MarkerLegend, StandingsTabs } from "@/components/standings/bits";
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
            : `Through Week ${view.throughWeek}${view.comparedTo ? ` · movement vs. Week ${view.comparedTo}` : ""}`
        }
      />
      {view.rows.length === 0 ? (
        <EmptyState title="No teams yet">Power rankings appear once the league has teams and results.</EmptyState>
      ) : noGames ? (
        <EmptyState title="No results yet">Power rankings blend record, scoring, all-play and recent form, so they start once Week {settings.general.firstWeek} is final.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <PowerList rows={view.rows} myTeamId={ctx.myTeam?.id ?? null} />
          <aside className="space-y-4">
            <Panel title="How it works">
              <div className="space-y-3 text-sm">
                <p>
                  <b>Power score</b> (0–100) = {formula.join(" + ")}. Points are scaled to the league&apos;s top scorer.
                </p>
                <p className="text-muted">
                  <b className="text-ink">All-play</b> is the record a team would have playing every opponent every week — it strips out schedule luck.
                </p>
                {rosLabel && (
                  <p className="text-muted">
                    <b className="text-ink">ROS/wk</b> is the average optimal-lineup projection for {rosLabel} from current rosters, with injured players removed.
                  </p>
                )}
                <p className="text-muted">Arrows compare with last week&apos;s power ranking.</p>
                <MarkerLegend />
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </div>
  );
}
