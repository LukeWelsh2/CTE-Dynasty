// Season schedule — "Who do I play, when, and how have I done?" (docs/DESIGN.md §4). Team view: summary strip
// (record · PF · PA · remaining strength of schedule), then one row per week (opponent, date, result or projection +
// odds), the current week marked; key dates in the rail. League view: every week's matchups as MatchupRows, past
// weeks collapsed, my next opponents and key dates in the rail.
import { CalendarClock, CalendarDays, Flag, Trophy } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { loadSchedule, type ScheduleGame, type WeekInfo } from "@/lib/live/schedule";
import { fmtScore, wpPercent } from "@/lib/live/format";
import { Badge, EmptyState, ListRow, MatchupRow, MoreLink, PageHeader, Panel, ResultPill, SegmentedLinks, SummaryStrip, TeamLogo, type SummaryItem } from "@/components/ui/core";
import { ScheduleSelect } from "@/components/scoring/schedule-select";
import { WeekPills } from "@/components/scoring/bits";
import { countGames, gameResultFor, gameStateShort, legLabel } from "@/components/scoring/playoff-game";
import { cn, fmtPts, ordinal } from "@/lib/utils";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

export const metadata = { title: "Schedule" };

function md(d: string | null, tz: string) {
  return d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(new Date(d)) : null;
}

function weekRange(w: WeekInfo | undefined, tz: string) {
  if (!w?.start) return "";
  const a = md(w.start, tz);
  const b = md(w.end, tz);
  return a === b || !b ? a! : `${a} – ${b}`;
}

type Data = Awaited<ReturnType<typeof loadSchedule>>;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ team?: string; view?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const data = await loadSchedule(ctx);
  const tz = ctx.settings.general.timezone;
  const myId = ctx.myTeam?.id ?? null;
  const teamParam = sp.team && data.standings.has(sp.team) ? sp.team : null;
  const leagueView = sp.view === "league" || (!teamParam && !myId);
  const teamId = leagueView ? null : (teamParam ?? myId);
  const subject = teamId ? data.standings.get(teamId) : undefined;
  // a multi-week playoff game is one game
  const counts = countGames(data.games);
  const views = [
    ...(myId ? [{ key: "mine", label: "My team", href: "/schedule" }] : []),
    { key: "league", label: "League", href: "/schedule?view=league" },
  ];
  const activeView = leagueView ? "league" : teamId === myId ? "mine" : "team";

  return (
    <div>
      <PageHeader
        kicker={`${ctx.season} season · Week ${ctx.week}`}
        title="Schedule"
        subtitle={
          leagueView
            ? `${counts.played} of ${counts.total} games played`
            : subject
              ? `${subject.team.name} · ${subject.wins}-${subject.losses}${subject.ties ? `-${subject.ties}` : ""} · ${ordinal(subject.rank)}`
              : undefined
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedLinks ariaLabel="Schedule view" options={views} active={activeView} />
        <ScheduleSelect value={leagueView ? "league" : teamId!} myTeamId={myId} teams={data.teams} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div className="min-w-0 space-y-4">
          {data.games.length === 0 ? (
            <EmptyState title="No schedule yet" icon={<CalendarDays size={22} />}>
              The commissioner hasn&apos;t generated this season&apos;s schedule.
            </EmptyState>
          ) : leagueView ? (
            <LeagueSchedule games={data.games} weeks={data.weeks} currentWeek={ctx.week} myId={myId} tz={tz} />
          ) : (
            <TeamSchedule teamId={teamId!} games={data.games} weeks={data.weeks} currentWeek={ctx.week} tz={tz} data={data} isMine={teamId === myId} />
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          {leagueView && myId && <UpcomingPanel subjectId={myId} data={data} tz={tz} />}
          <KeyDates data={data} currentWeek={ctx.week} tz={tz} />
        </aside>
      </div>
    </div>
  );
}

/** My next three opponents (league view; the team view's rows already show them). */
function UpcomingPanel({ subjectId, data, tz }: { subjectId: string; data: Data; tz: string }) {
  const weekBy = new Map(data.weeks.map((w) => [w.week, w]));
  const upcoming = data.games.filter((g) => g.status !== "FINAL" && (g.home?.team.id === subjectId || g.away?.team.id === subjectId)).slice(0, 3);
  return (
    <Panel title="My next games" noPad actions={<MoreLink href="/schedule">All</MoreLink>}>
      {upcoming.length ? (
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {upcoming.map((g) => {
            const home = g.home?.team.id === subjectId;
            const opp = home ? g.away : g.home;
            const wp = g.homeWinProb === null ? null : home ? g.homeWinProb : 1 - g.homeWinProb;
            const pct = wp === null ? null : wpPercent(wp);
            return (
              <ListRow
                key={g.id}
                href={`/scoring/${g.id}`}
                leading={opp ? <TeamLogo team={opp.team} size={28} /> : undefined}
                title={`${home ? "vs" : "@"} ${opp?.team.name ?? "Bye"}`}
                titleText={opp?.team.name}
                subtitle={[`Wk ${g.week}`, md(weekBy.get(g.week)?.start ?? null, tz), opp?.team.record, g.game && g.home && g.away ? gameStateShort(g.game, { homeId: g.home.team.id, home: g.home.team.abbrev, away: g.away.team.abbrev }) : null].filter(Boolean).join(" · ")}
                value={pct === null ? undefined : `${pct}%`}
                valueTone={pct === null ? undefined : pct > 50 ? "good" : pct < 50 ? "bad" : undefined}
                valueSub={pct === null ? undefined : g.status === "LIVE" ? "live" : g.game ? "game" : "win"}
              />
            );
          })}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-[13px] text-muted">No games left.</p>
      )}
    </Panel>
  );
}

function KeyDates({ data, currentWeek, tz }: { data: Data; currentWeek: number; tz: string }) {
  return (
    <Panel title="Key dates" info={<p>From the league settings. Times are in the league&apos;s timezone ({tz.replace(/_/g, " ")}).</p>} noPad>
      <ul className="divide-y divide-line/70 border-t border-line/70">
        {data.keyDates.map((k) => {
          const past = k.week < currentWeek;
          const now = k.week === currentWeek;
          const when = k.start ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(k.start)) : null;
          return (
            <li key={k.key} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sunken", k.key === "championship" ? "text-gold-700 dark:text-gold-400" : past ? "text-faint" : "text-muted")} aria-hidden>
                {k.key === "championship" ? <Trophy size={15} /> : k.key === "trade" ? <CalendarClock size={15} /> : <Flag size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-2 text-[15px] font-semibold leading-5 sm:text-sm", past ? "text-muted" : "text-ink")}>
                  <span className="truncate">{k.label}</span>
                  {now && <Badge tone="brand">This week</Badge>}
                </span>
                <span className="block truncate text-[13px] leading-[18px] text-muted" title={k.detail}>
                  {[`Wk ${k.week}`, when, k.detail !== `Week ${k.week}` ? k.detail : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              {past && <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">Passed</span>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** "W" / "L" / "T" for one team in a single-week game (decided playoff tiebreaks win over the scores). */
function resultFor(g: ScheduleGame, teamId: string): "W" | "L" | "T" | null {
  const home = g.home?.team.id === teamId;
  const me = home ? g.home : g.away;
  const opp = home ? g.away : g.home;
  if (!me || !opp || g.status !== "FINAL") return null;
  if (g.winnerTeamId) return g.winnerTeamId === teamId ? "W" : "L";
  return me.score > opp.score ? "W" : me.score < opp.score ? "L" : "T";
}

/** The right side of a team-schedule row: result + score, live score, or projection + odds. */
function RowResult({ g, teamId }: { g: ScheduleGame; teamId: string }) {
  const home = g.home?.team.id === teamId;
  const me = home ? g.home : g.away;
  const opp = home ? g.away : g.home;
  if (!me || !opp) return null;
  const wp = g.homeWinProb === null ? null : home ? g.homeWinProb : 1 - g.homeWinProb;
  // a week of a multi-week playoff game: the game's result on the combined score once decided, else where it stands
  if (g.game) {
    const game = g.game;
    const [mine, theirs] = home ? [game.homeTotal, game.awayTotal] : [game.awayTotal, game.homeTotal];
    const res = gameResultFor(game, teamId);
    const started = game.parts.some((p) => p.status !== "UPCOMING");
    return (
      <span className="flex items-center gap-2.5">
        {res && <ResultPill result={res} />}
        <span className="text-right">
          {started ? (
            <span className="numeral block text-[15px] font-semibold leading-5 text-ink">
              {fmtScore(mine)}
              <span className="font-normal text-muted">–{fmtScore(theirs)}</span>
            </span>
          ) : wp !== null ? (
            <span className={cn("numeral block text-[15px] font-semibold leading-5", wp >= 0.5 ? "text-win" : "text-loss")}>{wpPercent(wp)}%</span>
          ) : null}
          <span className="block whitespace-nowrap text-[12px] leading-4 text-muted">{res ? `${game.legs}-wk total` : `${legLabel(game)}${g.status === "LIVE" ? " · live" : ""}`}</span>
        </span>
      </span>
    );
  }
  if (g.status === "FINAL" || g.status === "LIVE") {
    const res = resultFor(g, teamId);
    return (
      <span className="flex items-center gap-2.5">
        {res ? <ResultPill result={res} /> : <Badge tone="live">Live</Badge>}
        <span className="text-right">
          <span className={cn("numeral block text-[15px] leading-5", res === "L" ? "font-medium text-muted" : "font-semibold text-ink")}>{fmtScore(me.score)}</span>
          <span className="numeral block text-[13px] leading-4 text-muted">{fmtScore(opp.score)}</span>
        </span>
      </span>
    );
  }
  if (me.projected === null || opp.projected === null) return <span className="text-[13px] text-faint">—</span>;
  const pct = wp === null ? null : wpPercent(wp);
  return (
    <span className="text-right">
      {pct !== null && <span className={cn("numeral block text-[15px] font-semibold leading-5", pct > 50 ? "text-win" : pct < 50 ? "text-loss" : "text-ink")}>{pct}%</span>}
      <span className="numeral block whitespace-nowrap text-[12px] leading-4 text-muted" title="Projected">
        {fmtScore(me.projected, 1)}–{fmtScore(opp.projected, 1)}
      </span>
    </span>
  );
}

function TeamSchedule({ teamId, games, weeks, currentWeek, tz, data, isMine }: { teamId: string; games: ScheduleGame[]; weeks: WeekInfo[]; currentWeek: number; tz: string; data: Data; isMine: boolean }) {
  const s = data.standings.get(teamId)!;
  const mine = games.filter((g) => g.home?.team.id === teamId || g.away?.team.id === teamId);
  const byWeek = new Map<number, ScheduleGame[]>();
  for (const g of mine) byWeek.set(g.week, [...(byWeek.get(g.week) ?? []), g]);
  const weeksWithLeagueGames = new Set(games.map((g) => g.week));
  const remaining = mine.filter((g) => g.status !== "FINAL" && !g.isPlayoff);
  const oppPcts = remaining
    .map((g) => (g.home?.team.id === teamId ? g.away : g.home))
    .filter(Boolean)
    .map((o) => data.standings.get(o!.team.id)?.pct ?? 0);
  const sos = oppPcts.length ? oppPcts.reduce((a, b) => a + b, 0) / oppPcts.length : null;
  const pf = data.pfRank.get(teamId);
  const paRank = [...data.standings.values()].sort((a, b) => a.pointsAgainst - b.pointsAgainst).findIndex((x) => x.team.id === teamId) + 1;
  const regular = weeks.filter((w) => w.isRegular);
  const playoffs = weeks.filter((w) => !w.isRegular);
  const summary: SummaryItem[] = [
    { label: "Record", value: `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`, sub: `${ordinal(s.rank)}${s.streak ? ` · ${s.streak}` : ""}` },
    { label: "PF", value: fmtPts(s.pointsFor, 0), sub: pf ? ordinal(pf) : undefined, title: `Points for ${fmtScore(s.pointsFor)}` },
    { label: "PA", value: fmtPts(s.pointsAgainst, 0), sub: paRank ? `${ordinal(paRank)} fewest` : undefined, title: `Points against ${fmtScore(s.pointsAgainst)}` },
    {
      label: "SOS",
      value: sos === null ? "—" : sos.toFixed(3).replace(/^0/, ""),
      sub: sos === null ? "done" : `${remaining.length} left`,
      title: "Remaining strength of schedule: the average win % of the opponents still to play",
    },
  ];

  const row = (w: WeekInfo) => {
    const list = byWeek.get(w.week) ?? [];
    const current = w.week === currentWeek;
    const wk = (
      <span className="w-7 shrink-0 text-center">
        <span className={cn("numeral block text-[17px] font-semibold leading-5", current ? "text-brand-600 dark:text-brand-400" : "text-ink")}>{w.week}</span>
        {current && <span className="block text-[11px] font-semibold uppercase leading-3 tracking-[0.04em] text-brand-600 dark:text-brand-400">Now</span>}
      </span>
    );
    if (!list.length) {
      const msg = w.isRegular ? "Bye week" : weeksWithLeagueGames.has(w.week) ? "No game" : "Set after seeding";
      return (
        <li key={w.week} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
          {wk}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-5 text-muted sm:text-sm">{w.playoffLabel ?? msg}</span>
            <span className="block truncate text-[13px] leading-[18px] text-muted">{[w.playoffLabel ? msg : null, weekRange(w, tz)].filter(Boolean).join(" · ")}</span>
          </span>
        </li>
      );
    }
    return list.map((g) => {
      const home = g.home?.team.id === teamId;
      const opp = home ? g.away : g.home;
      const sub = [g.label, opp ? `${opp.team.record} · PF ${opp.pfRank ? ordinal(opp.pfRank) : "—"}` : null, md(w.start, tz)].filter(Boolean).join(" · ");
      return (
        <li key={g.id}>
          <Link
            href={`/scoring/${g.id}`}
            aria-label={`Week ${w.week} ${home ? "vs" : "at"} ${opp?.team.name ?? "bye"} — box score`}
            className={cn("flex min-h-[60px] items-center gap-3 px-4 py-2 transition-colors hover:bg-sunken/70 active:bg-sunken", current && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}
          >
            {wk}
            {opp ? <TeamLogo team={opp.team} size={28} /> : <span className="w-7" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm" title={opp?.team.name}>
                <span className="font-medium text-muted">{home ? "vs" : "@"}</span> {opp?.seed ? <span className="text-[13px] text-muted">#{opp.seed} </span> : null}
                {opp?.team.name ?? "Bye"}
              </span>
              <span className="block truncate text-[13px] leading-[18px] text-muted">{sub}</span>
            </span>
            <RowResult g={g} teamId={teamId} />
          </Link>
        </li>
      );
    });
  };

  return (
    <>
      <SummaryStrip items={summary} />
      <Panel title={isMine ? "My schedule" : `${s.team.name}`} subtitle={isMine ? undefined : "Schedule"} noPad info={<p>Tap a week for its box score. Projections and win odds come from each lineup&apos;s projected points; PF rank is the opponent&apos;s points-for rank.</p>}>
        <h3 className="eyebrow border-y border-line/70 bg-sunken/60 px-4 py-1.5">Regular season</h3>
        <ul className="divide-y divide-line/70">{regular.map(row)}</ul>
        {playoffs.length > 0 && (
          <>
            <h3 className="eyebrow border-y border-line/70 bg-sunken/60 px-4 py-1.5">Playoffs</h3>
            <ul className="divide-y divide-line/70">{playoffs.map(row)}</ul>
          </>
        )}
      </Panel>
    </>
  );
}

function LeagueSchedule({ games, weeks, currentWeek, myId, tz }: { games: ScheduleGame[]; weeks: WeekInfo[]; currentWeek: number; myId: string | null; tz: string }) {
  const byWeek = new Map<number, ScheduleGame[]>();
  for (const g of games) byWeek.set(g.week, [...(byWeek.get(g.week) ?? []), g]);
  const markers = Object.fromEntries(weeks.filter((w) => w.playoffLabel).map((w) => [w.week, w.playoffLabel!]));
  return (
    <>
      <WeekPills weeks={weeks.map((w) => w.week)} active={currentWeek} current={currentWeek} hrefFor={(w) => `#week-${w}`} markers={markers} hash label="Jump to week" />
      {weeks.map((w) => {
        const list = byWeek.get(w.week) ?? [];
        const current = w.week === currentWeek;
        const past = w.week < currentWeek;
        const done = list.length > 0 && list.every((g) => g.status === "FINAL");
        const body = list.length ? (
          <ul className="divide-y divide-line/70 border-t border-line/70">
            {list.map((g) => {
              const decided = g.game ? g.game.status === "FINAL" : g.status === "FINAL";
              const both = g.home && g.away;
              const side = (sd: ScheduleGame["home"]) => (sd ? { team: sd.team, score: sd.score, projected: sd.projected ?? 0, record: sd.team.record } : null);
              const mine = g.home?.team.id === myId || g.away?.team.id === myId;
              // a future week without projections yet: just the two teams
              if (g.status === "UPCOMING" && (g.home?.projected == null || g.away?.projected == null))
                return (
                  <li key={g.id}>
                    <TeamsOnlyRow g={g} myId={myId} mine={mine} />
                  </li>
                );
              return (
                <li key={g.id}>
                  <MatchupRow
                    href={`/scoring/${g.id}`}
                    away={side(g.away)}
                    home={side(g.home)}
                    status={g.status}
                    homeWinProb={both && !decided ? g.homeWinProb : null}
                    winnerTeamId={decided ? g.winnerTeamId : null}
                    label={g.label}
                    mine={mine}
                    myTeamId={myId}
                    logo={(t) => <TeamLogo team={t} size={24} />}
                    note={g.game && both ? gameStateShort(g.game, { homeId: g.home!.team.id, home: g.home!.team.abbrev, away: g.away!.team.abbrev }) : undefined}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">{w.playoffLabel ? "Matchups are set after seeding." : "No games this week."}</p>
        );
        const head = (
          <>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[17px] font-bold leading-6 tracking-[-0.01em] text-ink">Week {w.week}</span>
                {w.playoffLabel && <Badge tone="neutral">{w.playoffLabel}</Badge>}
                {current && <Badge tone="brand">This week</Badge>}
              </span>
              <span className="block truncate text-[13px] text-muted">
                {[weekRange(w, tz), done ? (myLine(list, myId) ?? "Final") : null].filter(Boolean).join(" · ")}
              </span>
            </span>
          </>
        );
        // past weeks fold away (tap to open); the current and coming weeks stay open
        return past ? (
          <details key={w.week} id={`week-${w.week}`} className="card group scroll-mt-4 overflow-hidden">
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/60 [&::-webkit-details-marker]:hidden">
              {head}
              <ChevronDown size={18} className="shrink-0 text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            {body}
          </details>
        ) : (
          <section key={w.week} id={`week-${w.week}`} className="card scroll-mt-4 overflow-hidden" aria-label={`Week ${w.week}`}>
            <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              {head}
              <Link href={current ? "/scoring" : `/scoring?week=${w.week}`} className="-mr-1.5 inline-flex min-h-10 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[13px] font-semibold text-brand-600 hover:bg-brand-600/[0.08] dark:text-brand-400">
                Scores <ChevronRight size={14} aria-hidden />
              </Link>
            </div>
            {body}
          </section>
        );
      })}
    </>
  );
}

/** "W 130.60–111.06 vs H2H" — my result in a finished week (for its folded header). */
function myLine(list: ScheduleGame[], myId: string | null): string | null {
  if (!myId) return null;
  const g = list.find((x) => x.home?.team.id === myId || x.away?.team.id === myId);
  if (!g || !g.home || !g.away) return null;
  const home = g.home.team.id === myId;
  const [me, opp] = home ? [g.home, g.away] : [g.away, g.home];
  if (g.game) {
    const res = gameResultFor(g.game, myId);
    return `${res ? `${res} · ` : ""}${legLabel(g.game)} vs ${opp.team.abbrev}`;
  }
  const res = resultFor(g, myId);
  return `${res ?? ""} ${fmtScore(me.score)}–${fmtScore(opp.score)} vs ${opp.team.abbrev}`.trim();
}

/** A scheduled game with no projections yet: two team lines and the round label. */
function TeamsOnlyRow({ g, myId, mine }: { g: ScheduleGame; myId: string | null; mine: boolean }) {
  const line = (sd: ScheduleGame["home"], key: string) =>
    sd ? (
      <span key={key} className="flex h-7 min-w-0 items-center gap-2.5">
        <TeamLogo team={sd.team} size={24} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span title={sd.team.name} className={cn("truncate text-[15px] font-semibold leading-5 sm:text-sm", sd.team.id === myId ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
            {sd.team.name}
          </span>
          <span className="numeral shrink-0 text-[12px] text-muted">{sd.team.record}</span>
        </span>
      </span>
    ) : (
      <span key={key} className="flex h-7 items-center text-[13px] font-semibold text-muted">
        Bye
      </span>
    );
  return (
    <Link
      href={`/scoring/${g.id}`}
      aria-label={`${g.away?.team.name ?? "Bye"} vs ${g.home?.team.name ?? "Bye"}`}
      className={cn("relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/70 active:bg-sunken", mine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]")}
    >
      <span className="min-w-0 flex-1">
        {line(g.away, "a")}
        {line(g.home, "h")}
      </span>
      {g.label && <span className="shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">{g.label}</span>}
    </Link>
  );
}
