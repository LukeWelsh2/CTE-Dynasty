// Weekly recap archive: the latest recap as a feature card, then one card per completed week with its
// headline and award winners. Completed weeks without a recap can still be opened (generated on demand).
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Hourglass, Mail, Newspaper } from "lucide-react";
import { Badge, ButtonLink, EmptyState, PageHeader } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { getLeagueContext } from "@/lib/league";
import { loadRecapArchive, type ArchiveCard } from "@/lib/recap/queries";
import { AWARD_SHORT, AwardIcon, fmtWhen, pts, RecapLogo, teamOf } from "./_components/bits";
import { BackfillRecapsButton } from "./_components/backfill-button";

export const metadata: Metadata = { title: "Weekly Recaps" };

const DAY_NAMES: Record<string, string> = { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };

function hourText(h: number) {
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:00 ${h < 12 ? "AM" : "PM"}`;
}

function AwardList({ card, limit }: { card: ArchiveCard; limit: number }) {
  if (!card.awards.length) return null;
  return (
    <ul className="space-y-1.5">
      {card.awards.slice(0, limit).map((a) => {
        const t = teamOf(card.teams, a.teamId);
        return (
          <li key={a.key} className="flex items-center gap-2 text-[13px]">
            <AwardIcon k={a.key} size={12} />
            <span className="w-[96px] shrink-0 truncate text-[11px] font-bold uppercase tracking-normal text-muted sm:w-[104px] sm:tracking-wide" title={a.title}>
              {AWARD_SHORT[a.key] ?? a.title}
            </span>
            {/* the logo yields its room to the team name on phones */}
            <span className="hidden shrink-0 sm:inline-flex">
              <RecapLogo team={t} size={20} />
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">{t.name}</span>
            <span className="shrink-0 font-bold tabular-nums">{a.value}</span>
          </li>
        );
      })}
      {card.awards.length > limit && <li className="text-xs text-muted">+{card.awards.length - limit} more award{card.awards.length - limit === 1 ? "" : "s"}</li>}
    </ul>
  );
}

function MotwLine({ card, decimals }: { card: ArchiveCard; decimals: number }) {
  const m = card.matchupOfWeek;
  if (!m) return null;
  const a = teamOf(card.teams, m.awayId);
  const h = teamOf(card.teams, m.homeId);
  return (
    <div className="rounded-md border border-line bg-sunken/50 px-2.5 py-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gold-600 dark:text-gold-400">{m.reasonLabel}</div>
      {[
        { t: a, s: m.awayScore },
        { t: h, s: m.homeScore },
      ].map(({ t, s }) => (
        <div key={t.id} className="flex items-center gap-2 text-[13px]">
          <RecapLogo team={t} size={20} />
          <span className={cn("min-w-0 flex-1 truncate", m.winnerTeamId === t.id ? "font-bold text-ink" : "text-muted")}>{t.name}</span>
          <span className={cn("tabular-nums", m.winnerTeamId === t.id ? "font-bold" : "text-muted")}>{pts(s, decimals)}</span>
        </div>
      ))}
    </div>
  );
}

function WeekResults({ card, decimals, limit = 3 }: { card: ArchiveCard; decimals: number; limit?: number }) {
  if (!card.results.length) return null;
  return (
    <ul className="space-y-1">
      {card.results.slice(0, limit).map((r) => {
        const w = teamOf(card.teams, r.winnerId);
        const l = teamOf(card.teams, r.loserId);
        return (
          <li key={r.id} className="flex items-center gap-1.5 text-[13px]">
            <RecapLogo team={w} size={20} />
            <span className="min-w-0 flex-1 truncate">
              <b className="text-ink">{w.name}</b> <span className="text-muted">{r.leading ? (r.tie ? "level with" : "leads") : r.tie ? "tied" : "def."}</span> {l.name}
              {r.leading ? (
                <span className="text-muted">
                  {" "}
                  · wk {r.leading.leg} of {r.leading.legs}
                </span>
              ) : r.weeks ? (
                <span className="text-muted">
                  {" "}
                  · {r.weeks} wks{r.winnerScore === r.loserScore ? ", tiebreaker" : ""}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              <b className="text-ink">{pts(r.winnerScore, decimals)}</b>–{pts(r.loserScore, decimals)}
            </span>
          </li>
        );
      })}
      {card.results.length > limit && <li className="text-xs text-muted">+{card.results.length - limit} more final{card.results.length - limit === 1 ? "" : "s"}</li>}
    </ul>
  );
}

function recapHref(week: number, season: number, current: number) {
  return season === current ? `/recaps/${week}` : `/recaps/${week}?season=${season}`;
}

export default async function RecapsPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const [sp, ctx] = await Promise.all([searchParams, getLeagueContext()]);
  const season = sp.season && /^\d{4}$/.test(sp.season) ? Number(sp.season) : ctx.season;
  const archive = await loadRecapArchive(ctx.league.id, season, ctx.season);
  const { settings } = ctx;
  const tz = settings.general.timezone;
  const n = settings.notifications;
  const schedule = `${DAY_NAMES[n.weeklyRecapDay] ?? n.weeklyRecapDay}s at ${hourText(n.weeklyRecapHour)}`;
  const [feature, ...rest] = archive.cards;
  const d = archive.decimals;
  const missing = archive.cards.filter((c) => c.status === "PENDING").length;
  const seasonNav =
    archive.seasons.length > 1 ? (
      <nav aria-label="Season" className="flex flex-wrap gap-1">
        {archive.seasons.map((s) => (
          <Link
            key={s}
            href={s === ctx.season ? "/recaps" : `/recaps?season=${s}`}
            aria-current={s === season ? "page" : undefined}
            className={cn("rounded-md border px-2.5 py-1 text-xs font-semibold", s === season ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-panel text-ink hover:bg-sunken")}
          >
            {s}
          </Link>
        ))}
      </nav>
    ) : null;

  return (
    <div>
      <PageHeader
        kicker={`${season} season`}
        title="Weekly Recaps"
        subtitle={n.weeklyRecapEnabled ? `Awards, storylines and lineup report cards from every week · emailed ${schedule}` : "Awards, storylines and lineup report cards from every week"}
        actions={
          seasonNav || (ctx.isCommish && missing > 0) ? (
            <>
              {ctx.isCommish && missing > 0 && <BackfillRecapsButton season={season} missing={missing} />}
              {seasonNav}
            </>
          ) : null
        }
      />

      {archive.inProgressWeek && season === ctx.season && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-sm shadow-panel">
          <Hourglass size={16} className="shrink-0 text-gold-600" aria-hidden />
          <span className="min-w-0 flex-1">
            <b>Week {archive.inProgressWeek}</b> is in progress. Its recap is written once every matchup is final{n.weeklyRecapEnabled ? ` and emailed ${schedule}` : ""}.
          </span>
          <ButtonLink href={`/scoring?week=${archive.inProgressWeek}`} size="sm" variant="secondary">
            Live scoring
          </ButtonLink>
        </div>
      )}

      {!feature ? (
        season === ctx.season ? (
          <EmptyState title="No recaps yet" icon={<Newspaper size={24} />}>
            The first recap arrives after Week {settings.general.firstWeek} is final: awards, every matchup, lineup efficiency, standings movement and a preview of the next week.
          </EmptyState>
        ) : (
          <EmptyState title={`No recaps for the ${season} season`} icon={<Newspaper size={24} />}>
            The league has no completed weeks on record for {season}.
            <div className="mt-4">
              <ButtonLink href="/recaps" size="sm" variant="secondary">
                {ctx.season} recaps
              </ButtonLink>
            </div>
          </EmptyState>
        )
      ) : (
        <>
          <Link
            href={recapHref(feature.week, season, ctx.season)}
            className="group mb-5 block overflow-hidden rounded-xl border border-brand-900 bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 text-white shadow-panel"
          >
            <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gold-400">
                  Latest · {feature.weekLabel}
                  {feature.sentAt && (
                    <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] tracking-wide text-white/80">
                      <Mail size={11} aria-hidden /> Emailed {fmtWhen(feature.sentAt, tz, false)}
                    </span>
                  )}
                </div>
                <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight tracking-wide group-hover:underline sm:text-3xl">
                  {feature.headline ?? `Week ${feature.week} is final`}
                </h2>
                {feature.intro ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-white/80">{feature.intro}</p>
                ) : (
                  <p className="mt-2 text-sm text-white/80">
                    Every Week {feature.week} matchup is final.{feature.high ? ` ${teamOf(feature.teams, feature.high.teamId).name} led the league with ${pts(feature.high.score, d)}.` : ""} Open it to write the recap.
                  </p>
                )}
                <span className="mt-4 inline-flex items-center gap-1 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-bold text-brand-950">
                  Read the Week {feature.week} recap <ArrowRight size={15} aria-hidden />
                </span>
              </div>
              {feature.awards.length > 0 ? (
                <div className="min-w-0 rounded-lg border border-white/10 bg-white/95 p-3 text-ink dark:bg-panel">
                  <AwardList card={feature} limit={5} />
                </div>
              ) : feature.results.length > 0 ? (
                <div className="min-w-0 rounded-lg border border-white/10 bg-white/95 p-3 text-ink dark:bg-panel">
                  <WeekResults card={feature} decimals={d} limit={6} />
                </div>
              ) : null}
            </div>
          </Link>

          {rest.length > 0 && (
            <>
              <h2 className="mb-2 font-display text-lg font-extrabold uppercase tracking-wide">Earlier weeks</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rest.map((card) => (
                  <article key={card.week} className="flex flex-col rounded-lg border border-line bg-panel p-3 shadow-panel">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-gold-600 dark:text-gold-400">{card.weekLabel}</span>
                      {card.status === "PENDING" ? <Badge>Not written yet</Badge> : card.sentAt ? <Badge tone="brand">Emailed</Badge> : <Badge>Web only</Badge>}
                    </div>
                    <h3 className="line-clamp-2 font-display text-lg font-bold leading-snug">
                      <Link href={recapHref(card.week, season, ctx.season)} className="hover:text-brand-700 hover:underline dark:hover:text-brand-300">
                        {card.headline ?? `Week ${card.week} final`}
                      </Link>
                    </h3>
                    <div className="mt-2 flex-1 space-y-2">
                      {card.status === "READY" ? (
                        <>
                          <AwardList card={card} limit={3} />
                          <MotwLine card={card} decimals={d} />
                        </>
                      ) : (
                        <>
                          <WeekResults card={card} decimals={d} />
                          <p className="text-xs text-muted">
                            {card.high ? `${teamOf(card.teams, card.high.teamId).name} posted the top score (${pts(card.high.score, d)}). ` : ""}
                            The full recap is written the first time someone opens it.
                          </p>
                        </>
                      )}
                    </div>
                    <Link href={recapHref(card.week, season, ctx.season)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      {card.status === "READY" ? "Read recap" : "Write & read recap"} <ArrowRight size={14} aria-hidden />
                    </Link>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
