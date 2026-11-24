import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext, getLeagueContextOrNull } from "@/lib/league";
import { loadMatchupDetail } from "@/lib/live/queries";
import { getSimState } from "@/lib/live/simulate";
import { Alert, ButtonLink, Panel } from "@/components/ui/core";
import { MatchupView } from "@/components/scoring/matchup-view";
import { WinProbChart } from "@/components/scoring/wp-chart";
import { BigPlaysFeed } from "@/components/scoring/big-plays-feed";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLeagueContextOrNull();
  // scoped to the viewer's league: never reveal another league's team names in the tab title
  const m = ctx
    ? await db.matchup.findFirst({ where: { id, leagueId: ctx.league.id }, select: { week: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } })
    : null;
  return { title: m ? `${m.awayTeam?.name ?? "Bye"} vs ${m.homeTeam?.name ?? "Bye"} · Week ${m.week}` : "Matchup" };
}

export default async function MatchupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLeagueContext();
  const [detail, sim] = await Promise.all([loadMatchupDetail(ctx, id), getSimState()]);
  if (!detail) notFound();
  const { matchup, home, away } = detail;
  const myId = ctx.myTeam?.id ?? null;
  // my team on the left when I'm in this matchup; otherwise away | home like a box score
  const leftIsHome = !!myId && home?.team.id === myId;
  const left = leftIsHome ? home : away;
  const right = leftIsHome ? away : home;
  const tz = ctx.settings.general.timezone;
  const teamIds = [home?.team.id, away?.team.id].filter((x): x is string => !!x);
  const teamMap = Object.fromEntries([home, away].filter(Boolean).map((s) => [s!.team.id, { abbrev: s!.team.abbrev, primaryColor: s!.team.primaryColor }]));
  const liveWeek = matchup.week === ctx.week || matchup.week === sim?.week;

  return (
    <div className="space-y-4">
      {/* the other matchups of the week are one tap away in the score strip above and on the scoreboard */}
      <div className="-my-1 flex items-center justify-between gap-2">
        <ButtonLink href={matchup.week === ctx.week ? "/scoring" : `/scoring?week=${matchup.week}`} variant="plain" size="sm" className="-ml-3">
          <ArrowLeft size={16} aria-hidden /> Scoreboard
        </ButtonLink>
        <ButtonLink href="/schedule" variant="plain" size="sm" className="-mr-3">
          <CalendarDays size={16} aria-hidden /> Schedule
        </ButtonLink>
      </div>
      {sim && sim.week === matchup.week && (
        <Alert tone="warn" icon>
          <strong>Simulated week</strong> · scores and clocks come from the commissioner&apos;s simulation
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6">
        <div className="min-w-0">
          <MatchupView
            leagueId={ctx.league.id}
            tz={tz}
            // game: a week of a multi-week playoff game — its combined score and the whole game's odds
            matchup={{ id: matchup.id, week: matchup.week, status: matchup.status, homeWinProb: matchup.homeWinProb, label: matchup.label, game: matchup.game }}
            left={left}
            right={right}
            leftIsHome={leftIsHome}
            games={detail.games}
            myTeamId={myId}
          />
        </div>
        <aside className="min-w-0 space-y-4">
          {left && right && (
            <Panel
              title="Win probability"
              info={
                <p>
                  {matchup.game
                    ? `The chance to win the whole ${matchup.game.legs}-week game. `
                    : ""}
                  {matchup.status === "UPCOMING" ? "Before kickoff it comes from the two lineups' projections." : "It is recomputed on every scoring change, from live scores and the projections of players still to play."}
                </p>
              }
            >
              <WinProbChart leagueId={ctx.league.id} matchupId={matchup.id} points={detail.wpHistory} leftIsHome={leftIsHome} leftName={left.team.abbrev} rightName={right.team.abbrev} tz={tz} status={matchup.status} plays={detail.plays} />
            </Panel>
          )}
          <Panel title="Big plays" info={<p>Touchdowns and big plays by either team&apos;s players, newest first.</p>} noPad>
            <BigPlaysFeed leagueId={ctx.league.id} plays={detail.plays} teams={teamMap} teamIds={teamIds} live={liveWeek} emptyText="None yet" />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
