import Link from "next/link";
import { CalendarClock, CalendarDays, Flag, Trophy } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { loadSchedule, type ScheduleGame, type WeekInfo } from "@/lib/live/schedule";
import { fmtScore, wpPercent } from "@/lib/live/format";
import { Badge, EmptyState, PageHeader, Panel, StatTile, TeamLogo } from "@/components/ui/core";
import { ScheduleSelect } from "@/components/scoring/schedule-select";
import { MatchupStatus } from "@/components/scoring/bits";
import { ScrollRow } from "@/components/scoring/scroll-row";
import { cn, ordinal } from "@/lib/utils";

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

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ team?: string; view?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const data = await loadSchedule(ctx);
  const tz = ctx.settings.general.timezone;
  const myId = ctx.myTeam?.id ?? null;
  const teamParam = sp.team && data.standings.has(sp.team) ? sp.team : null;
  const leagueView = sp.view === "league" || (!teamParam && !myId);
  const teamId = leagueView ? null : teamParam ?? myId;
  const subjectId = teamId ?? myId; // whose upcoming opponents to show
  const weekBy = new Map(data.weeks.map((w) => [w.week, w]));
  const subject = subjectId ? data.standings.get(subjectId) : undefined;

  // ── upcoming opponents
  const upcoming = subjectId
    ? data.games.filter((g) => g.status !== "FINAL" && (g.home?.team.id === subjectId || g.away?.team.id === subjectId)).slice(0, 3)
    : [];

  return (
    <div>
      <PageHeader
        kicker={`${ctx.season} season · Week ${ctx.week}`}
        title="Schedule"
        subtitle={
          leagueView
            ? `Every matchup, week by week · ${data.games.filter((g) => g.status === "FINAL").length} of ${data.games.length} played`
            : subject
              ? `${subject.team.name} · ${subject.wins}-${subject.losses}${subject.ties ? `-${subject.ties}` : ""} · ${ordinal(subject.rank)} place`
              : undefined
        }
        actions={<ScheduleSelect value={leagueView ? "league" : teamId!} myTeamId={myId} teams={data.teams} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
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
          {subject && (
            <Panel title="Upcoming" subtitle={subjectId === myId ? "Your next opponents" : `${subject.team.name}'s next opponents`} noPad>
              {upcoming.length ? (
                <ul className="divide-y divide-line">
                  {upcoming.map((g) => {
                    const home = g.home?.team.id === subjectId;
                    const opp = home ? g.away : g.home;
                    const wp = g.homeWinProb === null ? null : home ? g.homeWinProb : 1 - g.homeWinProb;
                    return (
                      <li key={g.id}>
                        <Link href={`/scoring/${g.id}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-sunken">
                          <div className="w-12 shrink-0 text-center">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Week</div>
                            <div className="font-display text-xl font-extrabold leading-none">{g.week}</div>
                          </div>
                          {opp ? <TeamLogo team={opp.team} size={34} /> : null}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">
                              <span className="text-muted">{home ? "vs" : "@"}</span> {opp?.team.name ?? "Bye"}
                            </div>
                            <div className="text-[11px] text-muted">
                              {opp ? `${opp.team.record} · PF ${opp.pfRank ? ordinal(opp.pfRank) : "—"}` : ""}
                              {weekRange(weekBy.get(g.week), tz) ? ` · ${md(weekBy.get(g.week)!.start, tz)}` : ""}
                            </div>
                          </div>
                          {wp !== null && (
                            <div className="text-right">
                              <div className={cn("text-sm font-bold tabular-nums", wp >= 0.5 ? "text-win" : "text-loss")}>{wpPercent(wp)}%</div>
                              <div className="text-[10px] uppercase text-muted">{g.status === "LIVE" ? "live" : "win prob"}</div>
                            </div>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted">No games left on the schedule.</p>
              )}
            </Panel>
          )}

          <Panel title="Key dates" subtitle="From the league settings" noPad>
            <ul className="divide-y divide-line">
              {data.keyDates.map((k) => {
                const past = k.week < ctx.week;
                const now = k.week === ctx.week;
                return (
                  <li key={k.key} className={cn("flex items-start gap-3 px-3 py-2.5", past && "opacity-60")}>
                    <span className={cn("mt-0.5 rounded-md p-1.5", k.key === "championship" ? "bg-gold-300/30 text-gold-600" : k.key === "trade" ? "bg-red-50 text-loss dark:bg-red-900/30" : "bg-sunken text-muted")}>
                      {k.key === "championship" ? <Trophy size={14} /> : k.key === "trade" ? <CalendarClock size={14} /> : <Flag size={14} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {k.label}
                        {now && <Badge tone="live">This week</Badge>}
                        {past && <Badge>Passed</Badge>}
                      </div>
                      <div className="text-[11px] text-muted">
                        Week {k.week}
                        {k.start ? ` · ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(new Date(k.start))}` : ""} · {k.detail}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** "208.16 – 128.12" inline on wide screens; my score over theirs on phones so the table fits 390px */
function ScorePair({ mine, theirs, decimals = 2, strong = true }: { mine: number; theirs: number; decimals?: number; strong?: boolean }) {
  return (
    <span className="inline-flex flex-col whitespace-nowrap leading-tight tabular-nums sm:flex-row sm:items-baseline sm:gap-1">
      <span className={cn(strong && "font-semibold text-ink")}>{fmtScore(mine, decimals)}</span>
      <span className="hidden text-muted sm:inline">–</span>
      <span className="text-muted sm:text-inherit">{fmtScore(theirs, decimals)}</span>
    </span>
  );
}

function ResultCell({ g, teamId }: { g: ScheduleGame; teamId: string }) {
  const home = g.home?.team.id === teamId;
  const me = home ? g.home : g.away;
  const opp = home ? g.away : g.home;
  if (!me || !opp) return <span className="text-muted">Bye</span>;
  const wp = g.homeWinProb === null ? null : home ? g.homeWinProb : 1 - g.homeWinProb;
  if (g.status === "FINAL") {
    const res = g.winnerTeamId ? (g.winnerTeamId === teamId ? "W" : "L") : me.score > opp.score ? "W" : me.score < opp.score ? "L" : "T";
    return (
      <span className="inline-flex items-center gap-1.5 sm:gap-2">
        <span className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-extrabold text-white", res === "W" ? "bg-win" : res === "L" ? "bg-loss" : "bg-slate-500")}>{res}</span>
        <ScorePair mine={me.score} theirs={opp.score} />
      </span>
    );
  }
  if (g.status === "LIVE") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Badge tone="live">Live</Badge>
        <ScorePair mine={me.score} theirs={opp.score} />
        {wp !== null && <span className="text-[11px] text-muted">{wpPercent(wp)}% win</span>}
      </span>
    );
  }
  if (me.projected !== null && opp.projected !== null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted">
        <span className="text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]">Proj</span>
        <ScorePair mine={me.projected} theirs={opp.projected} decimals={1} />
        {wp !== null && <span className={cn("text-[11px] font-semibold", wp >= 0.5 ? "text-win" : "text-loss")}>{wpPercent(wp)}% win</span>}
      </span>
    );
  }
  return <span className="text-muted">—</span>;
}

function TeamSchedule({
  teamId,
  games,
  weeks,
  currentWeek,
  tz,
  data,
  isMine,
}: {
  teamId: string;
  games: ScheduleGame[];
  weeks: WeekInfo[];
  currentWeek: number;
  tz: string;
  data: Awaited<ReturnType<typeof loadSchedule>>;
  isMine: boolean;
}) {
  const s = data.standings.get(teamId)!;
  const mine = games.filter((g) => g.home?.team.id === teamId || g.away?.team.id === teamId);
  const byWeek = new Map<number, ScheduleGame[]>();
  for (const g of mine) byWeek.set(g.week, [...(byWeek.get(g.week) ?? []), g]);
  const weeksWithLeagueGames = new Set(games.map((g) => g.week));
  const remaining = mine.filter((g) => g.status !== "FINAL" && !g.isPlayoff);
  const oppPcts = remaining.map((g) => (g.home?.team.id === teamId ? g.away : g.home)).filter(Boolean).map((o) => data.standings.get(o!.team.id)?.pct ?? 0);
  const sos = oppPcts.length ? oppPcts.reduce((a, b) => a + b, 0) / oppPcts.length : null;
  const pf = data.pfRank.get(teamId);
  const regular = weeks.filter((w) => w.isRegular);
  const playoffs = weeks.filter((w) => !w.isRegular);

  const row = (w: WeekInfo) => {
    const list = byWeek.get(w.week) ?? [];
    const current = w.week === currentWeek;
    if (!list.length) {
      const msg = w.isRegular ? "Bye week" : weeksWithLeagueGames.has(w.week) ? "No game (bye or eliminated)" : `${w.playoffLabel ?? "Playoffs"} · matchups set after seeding`;
      return (
        <tr key={w.week} className={cn(current && "bg-gold-300/10")}>
          <td className="w-9 font-display text-base font-bold sm:w-14">{w.week}</td>
          <td className="hidden text-xs text-muted sm:table-cell">{weekRange(w, tz)}</td>
          <td colSpan={2} className="text-sm italic text-muted">
            {msg}
          </td>
          <td className="hidden sm:table-cell" />
        </tr>
      );
    }
    return list.map((g) => {
      const home = g.home?.team.id === teamId;
      const opp = home ? g.away : g.home;
      return (
        <tr key={g.id} className={cn(current && "bg-gold-300/10")}>
          <td className="w-9 align-top font-display text-base font-bold sm:w-14">
            {w.week}
            {current && <span className="block text-[9px] font-bold uppercase tracking-wider text-live">Now</span>}
          </td>
          <td className="hidden align-top text-xs text-muted sm:table-cell">
            {weekRange(w, tz)}
            {g.label && <span className="block font-semibold text-gold-600 dark:text-gold-400">{g.label}</span>}
          </td>
          <td>
            {opp ? (
              <div className="flex items-center gap-2 sm:gap-2.5">
                <span className="w-4 shrink-0 text-xs font-semibold text-muted sm:w-5">{home ? "vs" : "@"}</span>
                <TeamLogo team={opp.team} size={30} className="hidden shrink-0 sm:inline-flex" />
                <TeamLogo team={opp.team} size={24} className="shrink-0 sm:hidden" />
                <div className="min-w-0 max-w-[8.5rem] sm:max-w-none">
                  <Link href={`/teams/${opp.team.id}`} className="block truncate font-semibold text-ink hover:underline">
                    {opp.seed ? <span className="mr-1 text-[11px] text-muted">#{opp.seed}</span> : null}
                    {opp.team.name}
                  </Link>
                  <div className="text-[11px] text-muted">
                    {opp.team.record} · PF {opp.pfRank ? ordinal(opp.pfRank) : "—"}
                    {g.label && <span className="sm:hidden"> · {g.label}</span>}
                  </div>
                </div>
              </div>
            ) : (
              <span className="text-muted">Bye</span>
            )}
          </td>
          <td className="text-[13px] sm:text-sm">
            <Link href={`/scoring/${g.id}`} className="block" aria-label={`Week ${w.week} box score`}>
              <ResultCell g={g} teamId={teamId} />
            </Link>
          </td>
          <td className="hidden w-12 text-right sm:table-cell">
            <Link href={`/scoring/${g.id}`} className="link text-xs font-semibold">
              Box
            </Link>
          </td>
        </tr>
      );
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Record" value={`${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`} sub={`${ordinal(s.rank)} place${s.streak ? ` · ${s.streak}` : ""}`} />
        <StatTile label="Points for" value={fmtScore(s.pointsFor, 1)} sub={pf ? `${ordinal(pf)} in league` : undefined} />
        <StatTile label="Points against" value={fmtScore(s.pointsAgainst, 1)} />
        <StatTile label="Remaining SOS" value={sos === null ? "—" : sos.toFixed(3).replace(/^0/, "")} sub={sos === null ? "Regular season done" : `Opp. win % · ${remaining.length} game${remaining.length === 1 ? "" : "s"}`} />
      </div>
      <Panel title={isMine ? "My schedule" : `${s.team.name} schedule`} noPad>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10">
              <tr>
                <th>Wk</th>
                <th className="hidden sm:table-cell">Dates</th>
                <th>Opponent</th>
                <th>Result</th>
                <th className="hidden text-right sm:table-cell">
                  <span className="sr-only">Box score</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="group-row">
                <td colSpan={5}>Regular season</td>
              </tr>
              {regular.map(row)}
              {playoffs.length > 0 && (
                <tr className="group-row">
                  <td colSpan={5}>Playoffs</td>
                </tr>
              )}
              {playoffs.map(row)}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function LeagueSchedule({ games, weeks, currentWeek, myId, tz }: { games: ScheduleGame[]; weeks: WeekInfo[]; currentWeek: number; myId: string | null; tz: string }) {
  const byWeek = new Map<number, ScheduleGame[]>();
  for (const g of games) byWeek.set(g.week, [...(byWeek.get(g.week) ?? []), g]);
  return (
    <div>
      <ScrollRow label="Jump to week" className="scroll-thin relative -mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
        {weeks.map((w) => (
          <a
            key={w.week}
            href={`#week-${w.week}`}
            aria-current={w.week === currentWeek ? "page" : undefined}
            className={cn(
              "flex h-8 min-w-[2.5rem] shrink-0 items-center justify-center rounded-md border px-2 text-xs font-bold tabular-nums",
              w.week === currentWeek ? "border-brand-700 bg-brand-700 text-white" : w.playoffLabel ? "border-gold-400/70 bg-panel" : "border-line bg-panel hover:bg-sunken",
            )}
          >
            {w.week}
          </a>
        ))}
      </ScrollRow>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {weeks.map((w) => {
          const list = byWeek.get(w.week) ?? [];
          const current = w.week === currentWeek;
          return (
            <section key={w.week} id={`week-${w.week}`} className={cn("scroll-mt-4 overflow-hidden rounded-lg border bg-panel shadow-panel", current ? "border-gold-400/70 ring-1 ring-gold-400/40" : "border-line")}>
              <header className="flex items-center justify-between gap-2 border-b border-line bg-sunken/70 px-3 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="font-display text-[15px] font-bold uppercase tracking-wide">Week {w.week}</h2>
                  <span className="truncate text-xs text-muted">{weekRange(w, tz)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {w.playoffLabel && <Badge tone="gold">{w.playoffLabel}</Badge>}
                  {current && <Badge tone="live">Current</Badge>}
                  <Link href={w.week === currentWeek ? "/scoring" : `/scoring?week=${w.week}`} className="link text-xs font-semibold">
                    Scores
                  </Link>
                </div>
              </header>
              {list.length ? (
                <ul className="divide-y divide-line/70">
                  {list.map((g) => (
                    <li key={g.id}>
                      <Link href={`/scoring/${g.id}`} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-sm hover:bg-sunken", (g.home?.team.id === myId || g.away?.team.id === myId) && "bg-gold-300/10")}>
                        <div className="min-w-0 space-y-0.5">
                          {[g.away, g.home].map((sd, i) => {
                            if (!sd) return <div key={i} className="text-xs text-muted">Bye</div>;
                            const won = g.status === "FINAL" && g.winnerTeamId === sd.team.id;
                            return (
                              <div key={sd.team.id} className="flex items-center justify-between gap-2">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <TeamLogo team={sd.team} size={18} />
                                  <span className={cn("truncate", won ? "font-bold text-ink" : "text-ink/85", sd.team.id === myId && "text-brand-700 dark:text-brand-300")}>{sd.team.name}</span>
                                  <span className="hidden text-[10px] text-muted sm:inline">{sd.team.record}</span>
                                </span>
                                <span className={cn("tabular-nums", won ? "font-bold" : g.status === "UPCOMING" ? "text-muted" : "text-ink/80")}>
                                  {g.status === "UPCOMING" ? (sd.projected !== null ? fmtScore(sd.projected, 1) : "") : fmtScore(sd.score)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {g.status === "UPCOMING" ? (
                          <span className="w-16 text-right text-[10px] font-bold uppercase tracking-wider text-muted">{g.home?.projected != null ? "Proj" : "Upcoming"}</span>
                        ) : (
                          <MatchupStatus status={g.status} className="w-16 justify-end" />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-4 text-center text-sm text-muted">{w.playoffLabel ? "Matchups are set after seeding." : "No games this week."}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
