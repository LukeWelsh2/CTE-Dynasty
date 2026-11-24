import Link from "next/link";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { computeStandings } from "@/lib/standings";
import { record } from "@/lib/utils";
import { TopBar } from "./top-bar";
import { MainNav } from "./main-nav";
import { ScoreTicker, type TickerMatchup } from "./score-ticker";
import { MobileTabBar } from "./mobile-tab-bar";
import { PushPrompt } from "./push-prompt";

export async function AppShell({ ctx, children }: { ctx: LeagueContext; children: React.ReactNode }) {
  const { league, settings, season, week, user, myTeam } = ctx;
  const hiddenHrefs = settings.standings.showPowerRankings === false ? ["/standings/power"] : [];
  const [matchups, unread, standings] = await Promise.all([
    db.matchup.findMany({ where: { leagueId: league.id, season, week }, include: { homeTeam: true, awayTeam: true }, orderBy: { id: "asc" } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    computeStandings(league.id, season, settings),
  ]);
  const recordById = new Map(standings.map((s) => [s.team.id, record(s.wins, s.losses, s.ties)]));
  const ticker: TickerMatchup[] = matchups.map((m) => ({
    id: m.id,
    week: m.week,
    status: m.status,
    homeWinProb: m.homeWinProb,
    label: m.label,
    home: m.homeTeam
      ? { id: m.homeTeam.id, abbrev: m.homeTeam.abbrev, name: m.homeTeam.name, primaryColor: m.homeTeam.primaryColor, score: m.homeScore, projected: m.homeProjected, record: recordById.get(m.homeTeam.id) }
      : null,
    away: m.awayTeam
      ? { id: m.awayTeam.id, abbrev: m.awayTeam.abbrev, name: m.awayTeam.name, primaryColor: m.awayTeam.primaryColor, score: m.awayScore, projected: m.awayProjected, record: recordById.get(m.awayTeam.id) }
      : null,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        user={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
        league={{ id: league.id, name: league.name, season, logoUrl: league.logoUrl }}
        leagues={ctx.memberships.map((m) => ({ id: m.league.id, name: m.league.name }))}
        myTeam={myTeam ? { id: myTeam.id, name: myTeam.name, abbrev: myTeam.abbrev, logoUrl: myTeam.logoUrl, primaryColor: myTeam.primaryColor, secondaryColor: myTeam.secondaryColor, record: recordById.get(myTeam.id) } : null}
        unread={unread}
        isCommish={ctx.isCommish}
        hiddenHrefs={hiddenHrefs}
      />
      <MainNav isCommish={ctx.isCommish} hiddenHrefs={hiddenHrefs} />
      <ScoreTicker leagueId={league.id} week={week} matchups={ticker} myTeamId={myTeam?.id} />
      <PushPrompt />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-4 md:pb-8">{children}</main>
      <footer className="hidden border-t border-line/70 py-5 text-center text-xs text-muted md:block">
        <span className="font-semibold text-ink">{league.name}</span> · {season} season ·{" "}
        <Link href="/rules" className="link">
          League rules
        </Link>{" "}
        ·{" "}
        <Link href="/settings/notifications" className="link">
          Phone alerts
        </Link>
      </footer>
      <MobileTabBar />
    </div>
  );
}
