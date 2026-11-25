// Weekly recap archive — "What happened each week?". Summary strip (recaps · latest · season high · emailed) → the
// latest recap as a white feature card (headline, intro, award rows, one blue button) → every earlier week as one
// tappable row (headline + the week's top award). Each week's full awards, matchup of the week and finals live on
// its recap page, one tap away. Completed weeks without a recap can still be opened (generated on demand).
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronRight, Hourglass, Mail, Newspaper } from "lucide-react";
import { Alert, ButtonLink, EmptyState, PageHeader, Panel, SegmentedLinks, SummaryStrip } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
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

/** Award rows: icon · short award name · team · value. */
function AwardList({ card, limit }: { card: ArchiveCard; limit: number }) {
  if (!card.awards.length) return null;
  return (
    <ShowMore as="ul" initial={limit} className="divide-y divide-line/70" moreLabel={card.awards.length > limit ? `${card.awards.length - limit} more award${card.awards.length - limit === 1 ? "" : "s"}` : undefined}>
      {card.awards.map((a) => {
        const t = teamOf(card.teams, a.teamId);
        return (
          <li key={a.key} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <AwardIcon k={a.key} size={15} />
            <span className="min-w-0 flex-1">
              <span className="eyebrow block truncate" title={a.title}>
                {AWARD_SHORT[a.key] ?? a.title}
              </span>
              <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm" title={t.name}>
                {t.name}
              </span>
            </span>
            <span className="numeral shrink-0 text-[15px] font-semibold text-ink">{a.value}</span>
          </li>
        );
      })}
    </ShowMore>
  );
}

/** Final scores for a week whose recap isn't written yet. */
function WeekResults({ card, decimals, limit = 3 }: { card: ArchiveCard; decimals: number; limit?: number }) {
  if (!card.results.length) return null;
  return (
    <ShowMore as="ul" initial={limit} className="divide-y divide-line/70">
      {card.results.map((r) => {
        const w = teamOf(card.teams, r.winnerId);
        const l = teamOf(card.teams, r.loserId);
        return (
          <li key={r.id} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
            <RecapLogo team={w} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold leading-5 text-ink sm:text-sm">{w.name}</span>
              <span className="block truncate text-[13px] text-muted">
                {r.leading ? (r.tie ? "level with" : "leads") : r.tie ? "tied" : "def."} {l.name}
                {r.leading ? ` · wk ${r.leading.leg} of ${r.leading.legs}` : r.weeks ? ` · ${r.weeks} wks${r.winnerScore === r.loserScore ? ", tiebreaker" : ""}` : ""}
              </span>
            </span>
            <span className="numeral shrink-0 text-right text-[15px] font-semibold text-ink sm:text-sm">
              {pts(r.winnerScore, decimals)}
              <span className="block text-[12px] font-normal text-muted">{pts(r.loserScore, decimals)}</span>
            </span>
          </li>
        );
      })}
    </ShowMore>
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
  const written = archive.cards.length - missing;
  const emailed = archive.cards.filter((c) => c.sentAt).length;
  const seasonHigh = archive.cards.reduce<{ score: number; team: ReturnType<typeof teamOf>; week: number } | null>(
    (best, c) => (c.high && (!best || c.high.score > best.score) ? { score: c.high.score, team: teamOf(c.teams, c.high.teamId), week: c.week } : best),
    null,
  );

  return (
    <div>
      <PageHeader
        kicker={`${season} season`}
        title="Weekly recaps"
        subtitle={n.weeklyRecapEnabled ? `Emailed ${schedule}` : "Awards, storylines and report cards"}
        actions={ctx.isCommish && missing > 0 ? <BackfillRecapsButton season={season} missing={missing} /> : undefined}
      />

      {archive.seasons.length > 1 && (
        <SegmentedLinks
          className="mb-4"
          ariaLabel="Season"
          active={String(season)}
          options={archive.seasons.map((s) => ({ key: String(s), label: String(s), href: s === ctx.season ? "/recaps" : `/recaps?season=${s}` }))}
        />
      )}

      {archive.cards.length > 0 && (
        // 2×2 on phones so no number or subline is cut
        <SummaryStrip
          className="mb-4 grid-cols-2 sm:grid-cols-4"
          items={[
            { label: "Recaps", value: written, sub: missing ? `${missing} to write` : `${archive.cards.length} weeks` },
            { label: "Latest", value: feature ? `Wk ${feature.week}` : "—", sub: feature?.sentAt ? fmtWhen(feature.sentAt, tz, false) : "web only", href: feature ? recapHref(feature.week, season, ctx.season) : undefined, title: feature?.sentAt ? `Emailed ${fmtWhen(feature.sentAt, tz)}` : undefined },
            seasonHigh
              ? { label: "Season high", value: seasonHigh.score.toFixed(1), sub: `${seasonHigh.team.abbrev} · wk ${seasonHigh.week}`, title: `Season high: ${seasonHigh.team.name}, ${pts(seasonHigh.score, d)} in Week ${seasonHigh.week}` }
              : { label: "Season high", value: "—" },
            { label: "Emailed", value: emailed, sub: n.weeklyRecapEnabled ? "league" : "auto off", title: n.weeklyRecapEnabled ? "Recaps emailed to the league" : "Automatic recap emails are off" },
          ]}
        />
      )}

      {archive.inProgressWeek && season === ctx.season && (
        <Alert tone="info" className="mb-4 flex flex-wrap items-center gap-3">
          <Hourglass size={16} className="shrink-0 text-brand-600 dark:text-brand-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <b>Week {archive.inProgressWeek}</b> is in progress · recap when every game is final
          </span>
          <ButtonLink href={`/scoring?week=${archive.inProgressWeek}`} size="sm" variant="secondary">
            Live scoring
          </ButtonLink>
        </Alert>
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          {/* the latest recap */}
          <section className="card overflow-hidden" aria-labelledby="latest-title">
            <div className="px-4 pb-3 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">Latest · {feature.weekLabel}</span>
                {feature.sentAt && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-muted">
                    <Mail size={12} aria-hidden /> Emailed {fmtWhen(feature.sentAt, tz, false)}
                  </span>
                )}
              </div>
              <h2 id="latest-title" className="mt-1.5 text-[22px] font-bold leading-[1.2] tracking-[-0.015em] text-ink">
                <Link href={recapHref(feature.week, season, ctx.season)} className="hover:underline">
                  {feature.headline ?? `Week ${feature.week} is final`}
                </Link>
              </h2>
              {feature.intro ? (
                <p className="mt-2 line-clamp-3 max-w-[70ch] text-[15px] leading-relaxed text-muted sm:text-sm">{feature.intro}</p>
              ) : (
                <p className="mt-2 text-[15px] text-muted sm:text-sm">
                  Every Week {feature.week} game is final.{feature.high ? ` ${teamOf(feature.teams, feature.high.teamId).name} led the league with ${pts(feature.high.score, d)}.` : ""}
                </p>
              )}
            </div>
            <div className="border-t border-line/70">{feature.awards.length > 0 ? <AwardList card={feature} limit={4} /> : <WeekResults card={feature} decimals={d} limit={4} />}</div>
            <div className="border-t border-line/70 p-4">
              <ButtonLink href={recapHref(feature.week, season, ctx.season)} size="md" className="w-full sm:w-auto">
                {feature.status === "READY" ? `Read the Week ${feature.week} recap` : `Write & read Week ${feature.week}`} <ArrowRight size={15} aria-hidden />
              </ButtonLink>
            </div>
          </section>

          {rest.length > 0 && (
            <Panel title="Earlier weeks" subtitle={`${rest.length} week${rest.length === 1 ? "" : "s"}`} noPad>
              <ShowMore as="ul" initial={6} className="divide-y divide-line/70 border-t border-line/70">
                {rest.map((card) => {
                  const top = card.awards.find((a) => a.key === "TOP_SCORE") ?? card.awards[0];
                  const topTeam = top ? teamOf(card.teams, top.teamId) : card.high ? teamOf(card.teams, card.high.teamId) : null;
                  return (
                    <li key={card.week}>
                      <Link href={recapHref(card.week, season, ctx.season)} className="flex min-h-[64px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/70 active:bg-sunken">
                        <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-sunken leading-none">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted">Wk</span>
                          <span className="numeral text-[17px] font-bold text-ink">{card.week}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[15px] font-semibold leading-5 text-ink sm:text-sm">{card.headline ?? `Week ${card.week} final`}</span>
                          <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-muted">
                            <span className={cn("font-semibold", card.status === "PENDING" ? "text-amber-700 dark:text-amber-300" : card.sentAt ? "text-ink" : "text-muted")}>
                              {card.status === "PENDING" ? "Not written" : card.sentAt ? "Emailed" : "Web only"}
                            </span>
                            {topTeam ? ` · ${top ? AWARD_SHORT[top.key] ?? top.title : "Top score"}: ${topTeam.abbrev} ${top ? top.value : card.high ? pts(card.high.score, d) : ""}` : ""}
                          </span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ShowMore>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
