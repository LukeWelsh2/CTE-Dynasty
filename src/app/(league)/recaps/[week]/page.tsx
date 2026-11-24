// One week's recap: hero + storyline, Matchup of the Week, awards, every matchup, lineup efficiency, top
// NFL performers, standings / playoff-odds movement, transactions, next-week preview and injuries.
// Generated on demand when the week is complete but no recap exists yet.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, Hourglass } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui/core";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { renderRecapEmail } from "@/lib/recap/html";
import { loadRecapView } from "@/lib/recap/queries";
import { RecapAdminBar } from "../_components/admin-bar";
import { fmtWhen } from "../_components/bits";
import {
  AwardsGrid,
  EfficiencyTable,
  InjuriesToWatch,
  MatchupOfWeek,
  NextWeekPreview,
  PlayoffOddsMovers,
  RecapHero,
  ScoresGrid,
  SectionNav,
  StandingsMovement,
  TopPerformers,
  TransactionsBlock,
} from "../_components/recap-view";

type Params = { week: string };
type Search = { season?: string };

function parseWeek(raw: string): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 18 ? n : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { week } = await params;
  const w = parseWeek(week);
  return { title: w ? `Week ${w} Recap` : "Recap" };
}

const DAY_NAMES: Record<string, string> = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };

function hourText(h: number) {
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:00 ${h < 12 ? "AM" : "PM"}`;
}

export default async function RecapWeekPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const [{ week: rawWeek }, sp, ctx] = await Promise.all([params, searchParams, getLeagueContext()]);
  const week = parseWeek(rawWeek);
  if (!week) notFound();
  const seasonParam = sp.season && /^\d{4}$/.test(sp.season) ? Number(sp.season) : null;
  const season = seasonParam ?? ctx.season;
  const { settings } = ctx;
  const tz = settings.general.timezone;
  const view = await loadRecapView(ctx.league.id, season, week);
  const n = settings.notifications;
  const schedule = `${DAY_NAMES[n.weeklyRecapDay] ?? n.weeklyRecapDay}s at ${hourText(n.weeklyRecapHour)}`;

  if (view.state !== "READY") {
    const latest = view.weeks.length ? view.weeks[view.weeks.length - 1] : null;
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-gold-600 dark:text-gold-400">
          Week {week} recap · {season}
        </div>
        {view.state === "NOT_FINAL" ? (
          <EmptyState title={view.started ? `Week ${week} is still being played` : `Week ${week} hasn't kicked off yet`} icon={view.started ? <Hourglass size={24} /> : <CalendarClock size={24} />}>
            The recap is written once every Week {week} matchup is final{n.weeklyRecapEnabled ? `, and emailed to the league ${schedule}` : ""}.
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <ButtonLink href={`/scoring?week=${week}`} size="sm">
                {view.started ? "Live scoreboard" : "Week preview"}
              </ButtonLink>
              {latest && (
                <ButtonLink href={`/recaps/${latest}?season=${season}`} size="sm" variant="secondary">
                  Week {latest} recap
                </ButtonLink>
              )}
            </div>
          </EmptyState>
        ) : view.state === "NO_MATCHUPS" ? (
          <EmptyState title={`No Week ${week} matchups`} icon={<CalendarClock size={24} />}>
            There are no matchups scheduled for Week {week} of the {season} season.
            <div className="mt-4">
              <ButtonLink href={`/recaps?season=${season}`} size="sm" variant="secondary">
                All recaps
              </ButtonLink>
            </div>
          </EmptyState>
        ) : (
          <EmptyState title="The recap couldn't be generated" icon={<Hourglass size={24} />}>
            {view.message}
          </EmptyState>
        )}
      </div>
    );
  }

  const c = view.content;
  const idx = view.weeks.indexOf(week);
  const prev = idx > 0 ? view.weeks[idx - 1] : view.weeks.filter((w) => w < week).pop() ?? null;
  const next = idx >= 0 && idx < view.weeks.length - 1 ? view.weeks[idx + 1] : view.weeks.find((w) => w > week) ?? null;
  const myTeamId = ctx.myTeam?.id ?? null;
  const email = ctx.isCommish ? renderRecapEmail(c, c.leagueName) : null;
  const recipients = ctx.isCommish ? await db.leagueMember.count({ where: { leagueId: ctx.league.id } }) : 0;
  const teamList = Object.values(c.teams)
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <RecapHero c={c} sentAt={view.recap.sentAt} prev={prev} next={next} />
      {ctx.isCommish && email && (
        <RecapAdminBar
          season={season}
          week={week}
          sentAt={view.recap.sentAt ? fmtWhen(view.recap.sentAt, tz) : null}
          generatedAt={fmtWhen(c.generatedAt, tz)}
          emailHtml={email.html}
          emailSubject={email.subject}
          teams={teamList}
          recipients={recipients}
          recapEnabled={n.weeklyRecapEnabled}
          scheduleText={schedule}
        />
      )}
      <SectionNav c={c} />
      <MatchupOfWeek c={c} />
      <AwardsGrid c={c} isCommish={ctx.isCommish} />
      <div className="grid grid-cols-1 gap-x-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <ScoresGrid c={c} />
          <EfficiencyTable c={c} myTeamId={myTeamId} />
          <TopPerformers c={c} />
          <TransactionsBlock c={c} />
        </div>
        <aside className="min-w-0">
          <StandingsMovement c={c} myTeamId={myTeamId} />
          <PlayoffOddsMovers c={c} />
          <InjuriesToWatch c={c} myTeamId={myTeamId} />
        </aside>
      </div>
      <NextWeekPreview c={c} myTeamId={myTeamId} />
    </div>
  );
}
