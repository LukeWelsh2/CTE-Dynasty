// Playoffs: live bracket (or "if the season ended today"), side brackets, Monte Carlo odds, seed heat map
// and the odds trend. Commissioners can recompute odds / advance the bracket on demand.
import type { Metadata } from "next";
import { RefreshCw, Trophy } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, SummaryStrip, TeamLogo, type SummaryItem } from "@/components/ui/core";
import { ActionButton } from "@/components/ui/client";
import { getLeagueContext } from "@/lib/league";
import { db } from "@/lib/db";
import { loadOdds, loadOddsHistory, loadPlayoffsView, loadStandingsView, settingsSummary } from "@/lib/playoffs/view";
import { recomputePlayoffOddsAction } from "@/lib/playoffs/actions";
import { weekRangeLabel } from "@/lib/playoffs/structure";
import { fmtProb, fmtWhen, MarkerLegend, StandingsTabs } from "@/components/standings/bits";
import { BracketBoard, BracketList } from "@/components/standings/bracket";
import { OddsTable, phoneOddsRows, SeedHeatmap, type OddsRow } from "@/components/standings/odds-table";
import { OddsList } from "@/components/standings/odds-list";
import { OddsTrendChart } from "@/components/standings/odds-trend-chart";
import { LiveRefresh } from "@/components/standings/live-refresh";
import { SeedEditor } from "@/components/standings/seed-editor";
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
    <ActionButton action={recomputePlayoffOddsAction} variant="secondary" size="md" title="Advance the bracket if a round is final, then re-run 10,000 simulations">
      <RefreshCw size={15} aria-hidden /> Recompute odds
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

  // summary: my playoff, bye and title odds and the seed I'd hold today
  const myRow = myTeamId ? rows.find((r) => r.team.id === myTeamId) : undefined;
  const mySeed = myTeamId ? (standings.seedOf.get(myTeamId) ?? null) : null;
  const delta = (a: number, b: number | undefined) => (b === undefined ? 0 : Math.round((a - b) * 100));
  const summary: SummaryItem[] = myRow
    ? [
        (() => {
          const d = delta(myRow.odds.playoffPct, myRow.prev?.playoffPct);
          return {
            label: "Playoffs",
            value: fmtProb(myRow.odds.playoffPct, myRow.clinch?.playoffs),
            tone: myRow.clinch?.playoffs === "clinched" ? ("good" as const) : undefined,
            sub: d ? <span className={d > 0 ? "text-win" : "text-loss"}>{`${d > 0 ? "▲" : "▼"} ${Math.abs(d)} wk`}</span> : "odds",
          };
        })(),
        { label: "Bye", value: fmtProb(myRow.odds.byePct, myRow.clinch?.bye), sub: "odds" },
        { label: "Title", value: fmtProb(myRow.odds.champPct, myRow.clinch?.playoffs === "eliminated" ? "eliminated" : null), sub: "odds" },
        { label: "Seed", value: mySeed ? `#${mySeed}` : "—", sub: view.mode === "LIVE" ? "locked" : "today" },
      ]
    : [];
  const showDivision = settings.general.divisions.length > 0 && rows.some((r) => r.team.division);
  const bracketInfo = (
    <>
      {view.mode === "PROJECTED" && (
        <p>
          <b>If the season ended today.</b> Seeds come from the current standings
          {standings.gamesLeft ? `; the bracket locks when Week ${regularEndWeek} is final and the first round starts in Week ${view.schedule.firstWeek}.` : "; the bracket is created as soon as the regular season is final."}
          {view.settingsByesDiffer && ` A ${playoffTeams}-team bracket gives exactly ${view.schedule.plan.byes} first-round ${view.schedule.plan.byes === 1 ? "bye" : "byes"}.`}
        </p>
      )}
      <p>{view.mode === "LIVE" ? "Tap a game for its box score." : "Each team shows its chance to win the title."}</p>
      {view.medianGame && (
        <p>
          The league-median game continues in the playoffs: <b>Med W/L</b> shows each team&apos;s result against that week&apos;s median score. It doesn&apos;t decide who advances.
        </p>
      )}
      {view.stored.manual && <p>Seeds were set by the commissioner.</p>}
    </>
  );
  const bracketSub = view.mode === "LIVE" ? (view.liveGames ? "Scores update live" : view.stored.manual ? "Seeds set by the commissioner" : undefined) : "If the season ended today";

  return (
    <div className="space-y-4">
      <LiveRefresh leagueId={leagueId} scoreTicks={view.liveGames > 0} />
      <div>
        <StandingsTabs active="playoffs" showPower={settings.standings.showPowerRankings} />
        <PageHeader
          className="mb-0"
          kicker={`${season} playoffs`}
          title="Playoffs"
          subtitle={
            <>
              {settingsSummary(settings, view.schedule)} · <span className="whitespace-nowrap">{weekRangeLabel(view.schedule.roundWeeks.flat())}</span>
            </>
          }
          actions={recompute}
        />
      </div>

      {view.champion && (
        <section className="card flex items-center gap-3 p-4" aria-label={`${season} champion`}>
          <Trophy className="shrink-0 text-gold-700 dark:text-gold-400" size={32} aria-hidden />
          <TeamLogo team={view.champion} size={44} />
          <div className="min-w-0">
            <div className="eyebrow">{season} champion</div>
            <div className="truncate text-[20px] font-bold tracking-[-0.01em] text-ink">{view.champion.name}</div>
            <div className="truncate text-[13px] text-muted">Winners of {trophy}</div>
          </div>
        </section>
      )}

      {summary.length > 0 && <SummaryStrip items={summary} />}

      {/* one column (the bracket and the odds table need the width); trend + seed map side by side on wide screens */}
      <div className="space-y-4">
        <div className="min-w-0 space-y-4">
          <Panel title="Championship bracket" subtitle={bracketSub} info={bracketInfo} infoTitle="Championship bracket" noPad>
            <div className="md:hidden">
              <BracketList bracket={winners} myTeamId={myTeamId} third={view.third} />
            </div>
            <div className="hidden md:block">
              <BracketBoard bracket={winners} myTeamId={myTeamId} third={view.third} />
            </div>
          </Panel>

          {view.seeding && (
            <Panel title="Playoff seeds" actions={<Badge tone="neutral">Commissioner</Badge>}>
              <SeedEditor seeding={view.seeding} byes={view.schedule.plan.byes} />
            </Panel>
          )}

          <Panel
            title="Playoff odds"
            subtitle={latest ? `${latest.simulations.toLocaleString()} simulations · ${timeAgo(latest.computedAt)}` : undefined}
            info={
              <>
                <p>
                  Each simulation plays out the rest of the regular season and the bracket. Weekly team scores come from each roster&apos;s optimal projected lineup (current injuries
                  removed), with week-to-week noise, league-wide high/low weeks and uncertainty in each team&apos;s true strength. Ties use this league&apos;s tiebreakers and seeding rules.
                </p>
                {latest && <p>Last run {fmtWhen(latest.computedAt, tz)}{odds.previousThrough ? ` · ▲▼ compare with the odds after Week ${odds.previousThrough}` : ""}.</p>}
                {hasRemaining && leverageWeek !== null && <p>Week {leverageWeek} swing = playoff odds with a win minus odds with a loss.</p>}
                <MarkerLegend />
              </>
            }
            infoTitle="Playoff odds"
            noPad
          >
            {rows.length ? (
              <>
                <div className="md:hidden">
                  <OddsList rows={phoneOddsRows(rows, myTeamId, showDivision, hasRemaining, leverageWeek)} swingLabel={hasRemaining && leverageWeek !== null ? `Wk ${leverageWeek} swing` : null} hasRemaining={hasRemaining} />
                </div>
                <div className="hidden md:block">
                  <OddsTable rows={rows} myTeamId={myTeamId} showDivision={showDivision} hasRemaining={hasRemaining} leverageWeek={leverageWeek} />
                </div>
              </>
            ) : (
              <div className="px-4 pb-4">
                <EmptyState title="Odds haven't been calculated yet">
                  They refresh every morning once the season is under way{ctx.isCommish ? " — or run them now." : "."}
                  {recompute && <div className="mt-3 flex justify-center">{recompute}</div>}
                </EmptyState>
              </div>
            )}
          </Panel>

          {view.placement && (
            <Panel title="Placement games" subtitle={view.placementNote ?? undefined} noPad>
              <div className="md:hidden">
                <BracketList bracket={view.placement} myTeamId={myTeamId} />
              </div>
              <div className="hidden md:block">
                <BracketBoard bracket={view.placement} myTeamId={myTeamId} />
              </div>
            </Panel>
          )}

          {sides.length > 0 && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {sides.map((b) => {
                const subtitle =
                  b.kind === "CONSOLATION"
                    ? `${b.teamCount} teams · winner finishes ${ordinal(playoffTeams + 1)}`
                    : `${b.teamCount} teams · the loser advances`;
                const info =
                  b.kind === "CONSOLATION" ? undefined : (
                    <p>The loser of each game advances{lastPlace && settings.niche.tacoTrophy ? `; the last one standing takes ${lastPlace}` : "; the last one standing finishes last"}.</p>
                  );
                return (
                  <Panel key={b.kind} title={b.kind === "CONSOLATION" ? "Consolation bracket" : "Toilet Bowl"} subtitle={subtitle} info={info} noPad className={sides.length === 1 ? "xl:col-span-2" : undefined}>
                    <div className="md:hidden">
                      <BracketList bracket={b} myTeamId={myTeamId} />
                    </div>
                    <div className="hidden md:block">
                      <BracketBoard bracket={b} myTeamId={myTeamId} />
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
            <Panel title="Odds trend" info={history.length > 1 ? <p>After each week&apos;s results. Weeks before daily tracking began are reconstructed from results and points-per-game at the time.</p> : undefined}>
              <OddsTrendChart
                teams={[...view.teams.values()].map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev }))}
                history={history}
                initial={initialTrend}
                byes={view.schedule.plan.byes}
              />
            </Panel>
            <Panel
              title="Seed distribution"
              subtitle={view.schedule.plan.byes ? `Seeds 1–${view.schedule.plan.byes} get byes` : undefined}
              info={<p>The chance of finishing as each seed, from the same simulations. Blank = never in {(latest?.simulations ?? 0).toLocaleString()} simulated seasons.</p>}
            >
              <SeedHeatmap rows={rows} playoffTeams={playoffTeams} byes={view.schedule.plan.byes} myTeamId={myTeamId} simulations={latest?.simulations ?? 0} />
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}
