// League Home: a personal dashboard for the current week. Every module loads in parallel (shared lookups
// are started once in createShared) and fails independently. Desktop: main column + right rail; mobile:
// one column ordered by importance (the column wrappers use `display: contents` below lg so `order-*` can
// interleave rail cards between main-column cards).
import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { ChatPreview } from "@/components/home/chat-preview";
import { createShared, loadChat, loadFeed, loadHero, loadLineupAlert, loadMyMatchup, loadNews, loadPulse, loadScoreboard, loadStandings, loadUpcoming, settle } from "@/components/home/data";
import { Hero } from "@/components/home/hero";
import { PowerTop3, RecapTeaser, RuleVotes } from "@/components/home/league-pulse";
import { LineupAlert } from "@/components/home/lineup-alert";
import { ModuleError } from "@/components/home/bits";
import { MyMatchupCard } from "@/components/home/my-matchup";
import { MyNews } from "@/components/home/my-news";
import { StandingsSnapshot } from "@/components/home/standings-snapshot";
import { TransactionsFeed } from "@/components/home/transactions-feed";
import { Upcoming } from "@/components/home/upcoming";
import { WeekScoreboard } from "@/components/home/week-scoreboard";

export const metadata: Metadata = { title: "League Home" };

export default async function HomePage() {
  const ctx = await getLeagueContext();
  const sh = createShared(ctx);
  const [hero, matchup, lineup, scoreboard, standings, upcoming, feed, news, chat, pulse] = await Promise.all([
    settle("hero", () => loadHero(sh)),
    settle("matchup", () => loadMyMatchup(sh)),
    settle("lineup", () => loadLineupAlert(sh)),
    settle("scoreboard", () => loadScoreboard(sh)),
    settle("standings", () => loadStandings(sh)),
    settle("upcoming", () => loadUpcoming(sh)),
    settle("feed", () => loadFeed(sh)),
    settle("news", () => loadNews(sh)),
    settle("chat", () => loadChat(sh)),
    settle("pulse", () => loadPulse(sh)),
  ]);
  const tz = ctx.settings.general.timezone || "America/New_York";
  const now = sh.now;
  const leagueId = ctx.league.id;
  const myTeamId = ctx.myTeam?.id ?? null;

  return (
    <div className="space-y-4">
      {hero.ok ? (
        <Hero data={hero.data} timezone={tz} now={now} />
      ) : (
        <div className="rounded-xl bg-brand-950 px-5 py-6 text-white">
          <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide">{ctx.league.name}</h1>
          <p className="text-sm text-white/70">
            {ctx.season} season · Week {ctx.week}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-start">
        {/* Main column */}
        <div className="contents lg:col-span-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {lineup.ok ? lineup.data && <LineupAlert data={lineup.data} className="order-1 lg:order-none" /> : null}
          {matchup.ok ? (
            <MyMatchupCard data={matchup.data} leagueId={leagueId} timezone={tz} className="order-2 lg:order-none" />
          ) : (
            <ModuleError title="My Matchup" className="order-2 lg:order-none" />
          )}
          {scoreboard.ok ? (
            <WeekScoreboard data={scoreboard.data} leagueId={leagueId} myTeamId={myTeamId} className="order-5 lg:order-none" />
          ) : (
            <ModuleError title="Scoreboard" className="order-5 lg:order-none" />
          )}
          {news.ok ? <MyNews data={news.data} className="order-7 lg:order-none" /> : <ModuleError title="My Players" className="order-7 lg:order-none" />}
          {feed.ok ? <TransactionsFeed entries={feed.data} className="order-8 lg:order-none" /> : <ModuleError title="Latest Transactions" className="order-8 lg:order-none" />}
          {pulse.ok ? <RecapTeaser data={pulse.data} week={ctx.week} className="order-10 lg:order-none" /> : null}
        </div>

        {/* Right rail */}
        <aside aria-label="League snapshot" className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          {standings.ok ? (
            <StandingsSnapshot data={standings.data} timezone={tz} className="order-3 lg:order-none" />
          ) : (
            <ModuleError title="Standings" className="order-3 lg:order-none" />
          )}
          {upcoming.ok ? <Upcoming data={upcoming.data} now={now} className="order-4 lg:order-none" /> : <ModuleError title="Upcoming" className="order-4 lg:order-none" />}
          {chat.ok ? <ChatPreview data={chat.data} className="order-6 lg:order-none" /> : <ModuleError title="League Chat" className="order-6 lg:order-none" />}
          {pulse.ok ? (
            <>
              <RuleVotes data={pulse.data} now={now} timezone={tz} className="order-9 lg:order-none" />
              <PowerTop3 data={pulse.data} className="order-11 lg:order-none" />
            </>
          ) : (
            <ModuleError title="League Pulse" className="order-9 lg:order-none" />
          )}
        </aside>
      </div>
    </div>
  );
}
