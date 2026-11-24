import Link from "next/link";
import { CalendarDays, Swords, Trophy } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { loadBigPlays, loadScoreboard } from "@/lib/live/queries";
import { maintainSimulation, simAvailability, simStatusEvent, SIM_SPEEDS } from "@/lib/live/simulate";
import { playoffWeekInfo } from "@/lib/live/format";
import { db } from "@/lib/db";
import { Alert, ButtonLink, EmptyState, PageHeader, Panel, SummaryStrip, type SummaryItem } from "@/components/ui/core";
import { fmtPoints } from "@/components/ui/fantasy";
import { wpPercent } from "@/lib/live/format";
import type { GameLite } from "@/lib/live/types";
import { LiveScoreboard, type LiveCard } from "@/components/scoring/live-scoreboard";
import { NflGamesRail } from "@/components/scoring/nfl-games-rail";
import { BigPlaysFeed } from "@/components/scoring/big-plays-feed";
import { SimControls } from "@/components/scoring/sim-controls";
import { WeekPills } from "@/components/scoring/bits";

export const metadata = { title: "Scoreboard" };

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
    cards.length === 0 ? "No matchups scheduled" : `${cards.length} matchup${cards.length === 1 ? "" : "s"}${live ? ` · ${live} live` : ""}${final ? ` · ${final} final` : ""}`;
  const summary = cards.length ? scoreboardSummary(cards, games, tz, ctx.myTeam?.id ?? null) : [];

  return (
    <div>
      <PageHeader
        kicker={`${ctx.season} · Week ${week}${playoff ? ` · ${playoff.label}` : ""}`}
        title="Scoreboard"
        subtitle={subtitle}
        actions={
          <>
            {myCard && (
              <ButtonLink href={`/scoring/${myCard.id}`}>
                <Swords size={15} aria-hidden /> My matchup
              </ButtonLink>
            )}
            <ButtonLink href="/schedule" variant="secondary">
              <CalendarDays size={15} aria-hidden /> Schedule
            </ButtonLink>
          </>
        }
      />
      <WeekPills weeks={Array.from({ length: maxWeek - firstWeek + 1 }, (_, i) => firstWeek + i)} active={week} current={ctx.week} hrefFor={(w) => (w === ctx.week ? "/scoring" : `/scoring?week=${w}`)} markers={markers} />

      {sim && sim.week === week && (
        <Alert tone="warn" className="mb-3">
          <strong>Simulated week</strong> · scores, clocks and plays come from the commissioner&apos;s simulation
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          {summary.length > 0 && <SummaryStrip items={summary} />}
          {cards.length ? (
            <LiveScoreboard leagueId={ctx.league.id} week={week} cards={cards} />
          ) : (
            <EmptyState title={playoff ? `${playoff.label} matchups aren't set yet` : `No matchups in week ${week}`} icon={<Trophy size={22} />}>
              {playoff ? (
                "They appear once the regular season ends and seeds are locked."
              ) : (
                <>
                  See the full <Link href="/schedule" className="link">season schedule</Link>.
                </>
              )}
            </EmptyState>
          )}
        </div>
        {/* phones: NFL games and big plays under the matchups, the commissioner's simulation last */}
        <aside className="flex min-w-0 flex-col gap-4">
          {simPanel && <div className="order-last lg:order-none">{simPanel}</div>}
          <Panel title="NFL games" info={<p>Kickoff times are in the league&apos;s timezone ({tz.replace(/_/g, " ")}). Lines are the spread and over/under before kickoff.</p>} noPad>
            <NflGamesRail leagueId={ctx.league.id} season={ctx.season} week={week} tz={tz} games={games} />
          </Panel>
          <Panel title="Big plays" info={<p>Touchdowns, long gains, 50+ yard field goals and takeaways by rostered players, newest first.</p>} noPad>
            <BigPlaysFeed leagueId={ctx.league.id} plays={plays} teams={teamMap} live={week === (sim?.week ?? ctx.week) || week === ctx.week} emptyText="None yet" />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** The scoreboard's three numbers: where the week stands, my odds (or result), and the week's top score. */
function scoreboardSummary(cards: LiveCard[], games: GameLite[], tz: string, myTeamId: string | null): SummaryItem[] {
  const live = cards.filter((c) => c.status === "LIVE").length;
  const final = cards.filter((c) => c.status === "FINAL").length;
  const started = live + final > 0;
  const items: SummaryItem[] = [];
  const first = games.filter((g) => g.state === "pre").map((g) => g.startTime).sort()[0];
  if (live) items.push({ label: "Live", value: String(live), tone: "live", sub: `${final} final · ${cards.length - live - final} to go` });
  else if (final === cards.length) items.push({ label: "Status", value: "Final", sub: `${cards.length} matchups` });
  else if (!started && first)
    items.push({
      label: "Kickoff",
      value: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(first)).replace(":00", ""),
      sub: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(first)),
      title: `First kickoff ${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(first))}`,
    });
  else items.push({ label: "Final", value: `${final}/${cards.length}`, sub: "matchups" });

  const mine = cards.find((c) => c.isMine);
  const homeIsMe = !!mine?.home && mine.home.team.id === myTeamId;
  const me = mine ? (homeIsMe ? mine.home : mine.away) : null;
  const opp = mine ? (homeIsMe ? mine.away : mine.home) : null;
  if (mine && me && opp) {
    const decided = mine.game ? mine.game.status === "FINAL" : mine.status === "FINAL";
    const p = homeIsMe ? mine.homeWinProb : 1 - mine.homeWinProb;
    if (decided) {
      // a decided playoff game names its winner; otherwise the stored odds settle to 1 / 0 (tiebreaks included)
      const won = mine.game ? mine.game.winnerTeamId === me.team.id : p > 0.5 || (p === 0.5 && me.score > opp.score);
      const tied = !mine.game && p === 0.5 && me.score === opp.score;
      items.push({
        label: "My result",
        value: `${tied ? "T" : won ? "W" : "L"} ${fmtPoints(me.score)}`,
        tone: tied ? undefined : won ? "good" : "bad",
        sub: `vs ${opp.team.abbrev} ${fmtPoints(opp.score)}`,
        href: `/scoring/${mine.id}`,
      });
    } else {
      const pct = wpPercent(p);
      items.push({ label: "My odds", value: `${pct}%`, tone: pct > 50 ? "good" : pct < 50 ? "bad" : undefined, sub: `vs ${opp.team.abbrev}`, href: `/scoring/${mine.id}`, title: "My chance to win this week" });
    }
  }

  const sides = cards.flatMap((c) => [c.home, c.away]).filter((s): s is NonNullable<typeof s> => !!s);
  if (sides.length) {
    const top = [...sides].sort((a, b) => (started ? b.score - a.score : b.projected - a.projected))[0]!;
    items.push(started ? { label: "High score", value: fmtPoints(top.score), sub: top.team.abbrev, title: top.team.name } : { label: "Top proj", value: top.projected.toFixed(1), sub: top.team.abbrev, title: top.team.name });
  }
  return items;
}
