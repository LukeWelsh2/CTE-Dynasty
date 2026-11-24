// Playoffs: live bracket (or "if the season ended today"), side brackets, Monte Carlo odds, seed heat map
// and the odds trend. Commissioners can recompute odds / advance the bracket on demand.
import type { Metadata } from "next";
import { RefreshCw, Trophy } from "lucide-react";
import { Alert, EmptyState, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { getLeagueContext } from "@/lib/league";
import { db } from "@/lib/db";
import { loadOdds, loadOddsHistory, loadPlayoffsView, loadStandingsView, settingsSummary } from "@/lib/playoffs/view";
import { recomputePlayoffOddsAction } from "@/lib/playoffs/actions";
import { weekRangeLabel } from "@/lib/playoffs/structure";
import { fmtWhen, MarkerLegend, StandingsTabs } from "@/components/standings/bits";
import { BracketBoard } from "@/components/standings/bracket";
import { OddsTable, SeedHeatmap, type OddsRow } from "@/components/standings/odds-table";
import { OddsTrendChart } from "@/components/standings/odds-trend-chart";
import { LiveRefresh } from "@/components/standings/live-refresh";
import { ordinal, timeAgo } from "@/lib/utils";

export const metadata: Metadata = { title: "Playoffs" };

export default async function PlayoffsPage() {
  const ctx = await getLeagueContext();
  const { settings, season } = ctx;
  const leagueId = ctx.league.id;
  const odds = await loadOdds(leagueId, season);
  const [view, standings, history, owners] = await Promise.all([
    loadPlayoffsView(ctx, odds),
    loadStandingsView(ctx),
    loadOddsHistory(leagueId, season),
    db.team.findMany({ where: { leagueId }, select: { id: true, owner: { select: { name: true } } } }),
  ]);
  const myTeamId = ctx.myTeam?.id ?? null;
  const tz = settings.general.timezone;
  const ownerOf = new Map(owners.map((o) => [o.id, o.owner?.name ?? null]));
  const recompute = ctx.isCommish ? (
    <ActionButton action={recomputePlayoffOddsAction} variant="secondary" size="sm" title="Advance the bracket if a round is final, then re-run 10,000 simulations">
      <RefreshCw size={14} aria-hidden /> Recompute odds now
    </ActionButton>
  ) : null;

  if (!view) {
    return (
      <div>
        <StandingsTabs active="playoffs" showPower={settings.standings.showPowerRankings} />
        <PageHeader title="Playoffs" />
        <EmptyState title="No bracket yet">The playoff bracket appears once the league has at least two teams.</EmptyState>
      </div>
    );
  }

  const latest = odds.latest;
  const rows: OddsRow[] = [];
  for (const o of odds.odds.values()) {
    const team = view.teams.get(o.teamId);
    if (!team) continue;
    // markers / locks come from today's standings (the snapshot may predate the latest results)
    const clinch = standings.clinch.get(o.teamId) ?? o.clinch ?? null;
    rows.push({ team, owner: ownerOf.get(o.teamId) ?? null, odds: { ...o, marker: standings.markers.get(o.teamId) ?? o.marker }, prev: odds.previous.get(o.teamId) ?? null, clinch });
  }
  const winners = view.brackets.find((b) => b.kind === "WINNERS")!;
  const sides = view.brackets.filter((b) => b.kind !== "WINNERS");
  const playoffTeams = view.schedule.plan.teams;
  const hasRemaining = standings.gamesLeft > 0;
  const leverageWeek = hasRemaining ? standings.lastFinalWeek + 1 : null;
  const trophy = settings.general.championTrophyName?.trim() || "the championship";
  const lastPlace = settings.niche.lastPlaceTrophyName?.trim() || null;
  const regularEndWeek = settings.general.firstWeek + settings.general.regularSeasonWeeks - 1;
  const initialTrend = [myTeamId, ...[...rows].sort((a, b) => b.odds.champPct - a.odds.champPct).map((r) => r.team.id)].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).slice(0, 3);

  return (
    <div className="space-y-4">
      <LiveRefresh leagueId={leagueId} scoreTicks={view.liveGames > 0} />
      <div>
        <StandingsTabs active="playoffs" showPower={settings.standings.showPowerRankings} />
        <PageHeader
          className="mb-0"
          kicker={`${season} playoffs`}
          title="Playoff bracket & odds"
          subtitle={`${settingsSummary(settings, view.schedule)} · ${weekRangeLabel(view.schedule.roundWeeks.flat())}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {latest && (
                <span className="text-xs text-muted" title={fmtWhen(latest.computedAt, tz)}>
                  Odds updated {timeAgo(latest.computedAt)}
                </span>
              )}
              {recompute}
            </div>
          }
        />
      </div>

      {view.champion && (
        <div className="flex items-center gap-3 rounded-lg border border-gold-400 bg-gradient-to-r from-gold-300/30 to-transparent p-4 shadow-panel">
          <Trophy className="shrink-0 text-gold-600 dark:text-gold-400" size={36} aria-hidden />
          <TeamLogo team={view.champion} size={44} />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">{season} champion</div>
            <div className="truncate font-display text-2xl font-extrabold uppercase tracking-wide">{view.champion.name}</div>
            <div className="text-xs text-muted">Winners of {trophy}</div>
          </div>
        </div>
      )}

      {view.mode === "PROJECTED" && (
        <Alert tone="info">
          <b>If the season ended today.</b> Seeds come from the current standings
          {standings.gamesLeft ? `; the bracket locks when Week ${regularEndWeek} is final and the first round starts in Week ${view.schedule.firstWeek}.` : "; the bracket is created as soon as the regular season is final."}
          {view.settingsByesDiffer && ` A ${playoffTeams}-team bracket gives exactly ${view.schedule.plan.byes} first-round ${view.schedule.plan.byes === 1 ? "bye" : "byes"}.`}
        </Alert>
      )}

      <Panel title="Championship bracket" subtitle={view.mode === "LIVE" ? (view.liveGames ? "Scores update live" : "Click a game for the full box score") : "Projected matchups with title odds"} noPad>
        <BracketBoard bracket={winners} myTeamId={myTeamId} third={view.third} />
      </Panel>

      {sides.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sides.map((b) => {
            const firstRank = Math.min(...b.rounds.flatMap((r) => r.games.flatMap((g) => [g.home.seed ?? 99, g.away.seed ?? 99])));
            const subtitle =
              b.kind === "CONSOLATION"
                ? `${b.teamCount} teams · winner finishes ${ordinal(firstRank < 99 ? firstRank : playoffTeams + 1)}`
                : `${b.teamCount} teams · the loser advances${lastPlace && settings.niche.tacoTrophy ? ` · last one standing takes ${lastPlace}` : " · last one standing finishes last"}`;
            return (
              <Panel key={b.kind} title={b.kind === "CONSOLATION" ? "Consolation bracket" : "Toilet Bowl"} subtitle={subtitle} noPad className={sides.length === 1 ? "xl:col-span-2" : undefined}>
                <BracketBoard bracket={b} myTeamId={myTeamId} />
              </Panel>
            );
          })}
        </div>
      )}

      <Panel
        title="Playoff odds"
        subtitle={latest ? `${latest.simulations.toLocaleString()} simulated seasons · ${fmtWhen(latest.computedAt, tz)}${odds.previousThrough ? ` · ▲▼ vs. after Week ${odds.previousThrough}` : ""}` : undefined}
        noPad
      >
        {rows.length ? (
          <>
            <OddsTable rows={rows} myTeamId={myTeamId} showDivision={settings.general.divisions.length > 0 && rows.some((r) => r.team.division)} hasRemaining={hasRemaining} leverageWeek={leverageWeek} />
            <div className="space-y-2 border-t border-line p-3 text-xs text-muted">
              <MarkerLegend />
              <p>
                Each simulation plays out the rest of the regular season and the bracket. Weekly team scores come from each roster&apos;s optimal projected lineup (current injuries
                removed), with week-to-week noise, league-wide high/low weeks and uncertainty in each team&apos;s true strength. Ties use this league&apos;s tiebreakers and seeding rules.
                {hasRemaining && leverageWeek !== null ? ` Week ${leverageWeek} swing = playoff odds with a win minus odds with a loss.` : ""}
              </p>
            </div>
          </>
        ) : (
          <div className="p-3">
            <EmptyState title="Odds haven't been calculated yet">
              They refresh every morning once the season is under way{ctx.isCommish ? " — or run them now." : "."}
              {recompute && <div className="mt-3 flex justify-center">{recompute}</div>}
            </EmptyState>
          </div>
        )}
      </Panel>

      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <Panel title="Seed distribution" subtitle={`Chance of finishing as each seed${view.schedule.plan.byes ? ` · gold seeds get byes` : ""}`}>
            <SeedHeatmap rows={rows} playoffTeams={playoffTeams} byes={view.schedule.plan.byes} myTeamId={myTeamId} simulations={latest?.simulations ?? 0} />
          </Panel>
          <Panel title="Odds trend" subtitle="After each week's results">
            <OddsTrendChart
              teams={[...view.teams.values()].map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev }))}
              history={history}
              initial={initialTrend}
              byes={view.schedule.plan.byes}
            />
            {history.length > 1 && <p className="mt-2 text-[11px] text-muted">Weeks before daily tracking began are reconstructed from results and points-per-game at the time.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}
