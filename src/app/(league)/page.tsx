// League Home — "How is my week going, and what do I need to do?" (docs/DESIGN.md → Reference screens → Home).
// Summary first: the week + its state and the to-do chips, my team's four numbers, then my matchup. Secondary modules
// follow, each truncated to its top rows with "All" / "Show more". Every module loads in parallel (shared lookups are
// started once in createShared) and fails independently. Desktop: main column + right rail; phones: one column ordered
// by importance (the column wrappers use `display: contents` below lg so `order-*` can interleave rail cards).
import type { Metadata } from "next";
import { getLeagueContext } from "@/lib/league";
import { ChatPreview } from "@/components/home/chat-preview";
import { createShared, loadChat, loadFeed, loadHero, loadLineupAlert, loadMyMatchup, loadNews, loadPulse, loadScoreboard, loadStandings, loadUpcoming, settle } from "@/components/home/data";
import { HomeHeader, LeagueNotes, MyTeamStrip } from "@/components/home/hero";
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
    <div className="space-y-6">
      {hero.ok ? (
        <HomeHeader data={hero.data} timezone={tz} now={now} />
      ) : (
        <div>
          <div className="eyebrow">
            {ctx.league.name} · {ctx.season}
          </div>
          <h1 className="text-[28px] font-bold leading-9 tracking-[-0.02em]">Week {ctx.week}</h1>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:items-start lg:gap-6">
        {/* Main column */}
        <div className="contents lg:col-span-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          {lineup.ok ? lineup.data && <LineupAlert data={lineup.data} className="order-1 lg:order-none" /> : null}
          {hero.ok && hero.data.myTeam && <MyTeamStrip data={hero.data} className="order-2 lg:order-none" />}
          {matchup.ok ? (
            <MyMatchupCard data={matchup.data} leagueId={leagueId} timezone={tz} className="order-3 lg:order-none" />
          ) : (
            <ModuleError title="My matchup" className="order-3 lg:order-none" />
          )}
          {scoreboard.ok ? (
            <WeekScoreboard data={scoreboard.data} leagueId={leagueId} myTeamId={myTeamId} className="order-6 lg:order-none" />
          ) : (
            <ModuleError title="Scoreboard" className="order-6 lg:order-none" />
          )}
          {news.ok ? <MyNews data={news.data} className="order-8 lg:order-none" /> : <ModuleError title="My players" className="order-8 lg:order-none" />}
          {feed.ok ? <TransactionsFeed entries={feed.data} className="order-10 lg:order-none" /> : <ModuleError title="Transactions" className="order-10 lg:order-none" />}
          {pulse.ok ? <RecapTeaser data={pulse.data} week={ctx.week} className="order-12 lg:order-none" /> : null}
        </div>

        {/* Right rail */}
        <aside aria-label="League snapshot" className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          {standings.ok ? (
            <StandingsSnapshot data={standings.data} timezone={tz} className="order-4 lg:order-none" />
          ) : (
            <ModuleError title="Standings" className="order-4 lg:order-none" />
          )}
          {hero.ok && <LeagueNotes data={hero.data} className="order-5 lg:order-none" />}
          {upcoming.ok ? <Upcoming data={upcoming.data} now={now} className="order-7 lg:order-none" /> : <ModuleError title="Upcoming" className="order-7 lg:order-none" />}
          {chat.ok ? <ChatPreview data={chat.data} className="order-9 lg:order-none" /> : <ModuleError title="League chat" className="order-9 lg:order-none" />}
          {pulse.ok ? (
            <>
              <RuleVotes data={pulse.data} now={now} timezone={tz} className="order-11 lg:order-none" />
              <PowerTop3 data={pulse.data} className="order-[13] lg:order-none" />
            </>
          ) : (
            <ModuleError title="League pulse" className="order-11 lg:order-none" />
          )}
        </aside>
      </div>
    </div>
  );
}
