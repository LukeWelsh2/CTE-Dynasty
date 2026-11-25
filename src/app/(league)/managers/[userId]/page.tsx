// Manager profile + in-depth stats. Main question: "Who is this manager and how good are they?"
// Summary: season record · points for · all-time record · titles. Primary: this season (weekly scoring vs the league
// average, high / low / all-play / luck). Secondary (cut down, details behind a tap): lineup efficiency (week by week
// collapsed), head-to-head (5 + more; phones expand a row for PF / PA / playoffs / streak / last meeting), season by
// season, best & worst weeks, moves & trades, salary by position. Rail: about, team, all-time.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown, ExternalLink, Mail, Pencil, Phone, Trophy, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { NFL_TEAM_BY_ABBR } from "@/lib/nfl/teams";
import { loadLeagueHistory, managerStats } from "@/lib/stats/load";
import { gameWeekLabel, type GameRow } from "@/lib/stats/manager-stats";
import { socialLinks } from "@/lib/profiles/schema";
import {
  Avatar,
  Badge,
  ButtonLink,
  Collapsible,
  EmptyState,
  ListRow,
  Meter,
  MoreLink,
  NflLogo,
  Panel,
  RankBar,
  RankList,
  StatGrid,
  StatRow,
  SummaryStrip,
  TeamLogo,
} from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { PosPill } from "@/components/ui/fantasy";
import { LeagueTabs, ManagerChip, ResultPill, SectionNav, fmtRecord, pct3, signed } from "@/components/community/bits";
import { RichText } from "@/components/community/rich-text";
import { DmButton } from "@/components/community/dm-button";
import { WeeklyScoresChart } from "@/components/community/manager-charts";
import { cn, fmtMoney, fmtPct, fmtPts, ordinal } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ userId: string }> }): Promise<Metadata> {
  const { userId } = await params;
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, profile: { select: { displayName: true } } } });
  return { title: u ? `${u.profile?.displayName || u.name} — Manager` : "Manager" };
}

export default async function ManagerProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const ctx = await getLeagueContext();
  const { season, settings } = ctx;
  const [user, member, stats, history] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, include: { profile: true } }),
    db.leagueMember.findUnique({ where: { leagueId_userId: { leagueId: ctx.league.id, userId } } }),
    managerStats(ctx, userId),
    loadLeagueHistory(ctx.league.id, season),
  ]);
  if (!user || !stats) notFound();
  const p = user.profile;
  const name = p?.displayName?.trim() || user.name;
  const me = userId === ctx.user.id;
  const team = stats.identity.team;
  const nfl = p?.favoriteNflTeam ? NFL_TEAM_BY_ABBR[p.favoriteNflTeam] : null;
  const socials = socialLinks(p?.socials);
  const tz = settings.general.timezone;
  const memberSince = member?.joinedAt ?? user.createdAt;
  const teamName = (id: string) => history.teamById.get(id)?.name ?? "Unknown";
  const s = stats.standing;
  const played = stats.current.games > 0;
  const roleLabel = member?.role === "COMMISSIONER" ? "Commissioner" : member?.role === "CO_COMMISSIONER" ? "Co-commissioner" : null;

  // player names for "best player left on the bench" hints
  const missedIds = [...new Set(stats.efficiency?.weeks.flatMap((w) => w.missed.slice(0, 1).map((x) => x.playerId)) ?? [])];
  const missedPlayers = missedIds.length ? await db.player.findMany({ where: { id: { in: missedIds } }, select: { id: true, fullName: true, position: true } }) : [];
  const playerById = new Map(missedPlayers.map((x) => [x.id, x]));

  const weekly = stats.weekly.map((w) => ({ week: w.week, pts: w.pts, leagueAvg: w.leagueAvg, opp: w.opp, oppName: teamName(w.oppTeamId), result: w.result, isPlayoff: w.isPlayoff }));
  const beatAvg = stats.weekly.filter((w) => w.pts > w.leagueAvg).length;
  const trophy = settings.general.championTrophyName || "Championship";
  const champSeasons = stats.finishes.filter((f) => f.champion).map((f) => f.season);
  const since = memberSince.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: tz });
  const division = s?.team.division ? (settings.general.divisions.find((d) => d.id === s.team.division)?.name ?? s.team.division) : null;
  const teamMotto = team ? history.teamById.get(team.id)?.motto : null;

  const sections = [
    { id: "season", label: `${season} season` },
    { id: "lineups", label: "Lineups" },
    { id: "h2h", label: "Head-to-head" },
    { id: "history", label: "Seasons" },
    { id: "weeks", label: "Best & worst" },
    { id: "moves", label: "Moves" },
    { id: "salary", label: "Salary" },
    { id: "about", label: "About" },
  ];

  const eff = stats.efficiency;
  const salary = stats.salary;
  const topSalary = salary ? Math.max(1, ...salary.slices.map((x) => x.salary)) : 1;

  return (
    <div>
      <LeagueTabs active="managers" />

      {/* ── Identity ── */}
      <section className="card overflow-hidden">
        {p?.coverUrl && (
          // the manager's own cover photo (user content), kept as a thin band
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.coverUrl} alt="" className="h-24 w-full object-cover sm:h-32" />
        )}
        <div className="flex items-center gap-4 px-4 pb-3 pt-4">
          <Avatar name={name} src={user.avatarUrl} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]" title={name}>
              {name}
            </h1>
            {team ? (
              <Link href={`/teams/${team.id}`} className="mt-0.5 flex min-h-6 min-w-0 items-center gap-1.5 text-[15px] font-semibold text-ink hover:underline" title={team.name}>
                <TeamLogo team={team} size={18} className="shrink-0" /> <span className="truncate">{team.name}</span>
              </Link>
            ) : (
              !member && <Badge className="mt-1">Former manager</Badge>
            )}
            <p className="truncate text-[13px] text-muted">{[roleLabel, name !== user.name ? user.name : null, p?.managerStyle, `Since ${since}`].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        {p?.motto && <p className="max-w-[70ch] px-4 pb-3 text-[15px] italic text-muted">“{p.motto}”</p>}
        <div className="flex flex-wrap gap-2 border-t border-line/70 px-4 py-3">
          {me ? (
            <ButtonLink href="/settings/profile" size="md" variant="secondary" className="flex-1 sm:flex-none">
              <Pencil size={15} /> Edit profile
            </ButtonLink>
          ) : (
            member && <DmButton userId={userId} size="md" variant="primary" className="flex-1 sm:flex-none" />
          )}
          {team && (
            <ButtonLink href={me ? "/team" : `/teams/${team.id}`} size="md" variant="secondary" className="flex-1 sm:flex-none">
              Roster
            </ButtonLink>
          )}
          {team && !me && member && (
            <ButtonLink href={`/trades/new?team=${team.id}`} size="md" variant="secondary" className="flex-1 sm:flex-none">
              Trade
            </ButtonLink>
          )}
        </div>
      </section>

      {/* ── Summary ── */}
      <SummaryStrip
        className="mt-3"
        items={[
          {
            label: `${season}`,
            value: s ? fmtRecord(s.wins, s.losses, s.ties) : "—",
            sub: s && played ? `${ordinal(s.rank)} of ${history.teams.length}` : "No games yet",
            title: s && played ? `${season} record · ${ordinal(s.rank)} of ${history.teams.length}${s.streak ? ` · streak ${s.streak}` : ""}` : undefined,
          },
          {
            label: "Points",
            value: played ? fmtPts(stats.current.pf, 0) : "—",
            sub: played ? `${fmtPts(stats.current.avgPf, 1)} / wk` : undefined,
            title: played ? `Points for this season: ${fmtPts(stats.current.pf, 1)}` : undefined,
          },
          {
            label: "All-time",
            value: fmtRecord(stats.allTime.regular.wins, stats.allTime.regular.losses, stats.allTime.regular.ties),
            sub: pct3(stats.allTime.regular.pct),
            title: "All-time regular-season record",
          },
          {
            label: "Titles",
            value: (
              <span className="inline-flex items-center gap-1">
                {champSeasons.length > 0 && <Trophy size={18} className="text-gold-700 dark:text-gold-400" aria-hidden />}
                {stats.allTime.championships}
              </span>
            ),
            sub: `${stats.allTime.playoffApps} playoff${stats.allTime.playoffApps === 1 ? "" : "s"}`,
            title: `${stats.allTime.championships} × ${trophy} · ${stats.allTime.playoffApps} playoff trip${stats.allTime.playoffApps === 1 ? "" : "s"} · ${stats.allTime.regular.seasons} season${stats.allTime.regular.seasons === 1 ? "" : "s"}`,
          },
        ]}
      />

      <SectionNav items={sections} className="mt-4" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* ── This season ── */}
          <Panel
            id="season"
            title={`${season} season`}
            subtitle={played ? `Beat the league average in ${beatAvg} of ${stats.weekly.length} weeks` : undefined}
            className="scroll-mt-16"
            info={
              <div className="space-y-2">
                <p>Weekly score against the league&apos;s average score that week. Dots show wins (green) and losses (red).</p>
                <p>
                  <b>All-play</b>: the record if this team had played every other team every week. <b>Luck</b>: actual wins minus all-play expected wins — positive
                  means more wins than the scores deserved.
                </p>
              </div>
            }
          >
            {weekly.length ? (
              <>
                <WeeklyScoresChart data={weekly} teamLabel={team?.name ?? name} />
                <StatGrid
                  className="mt-4 border-t border-line/70 pt-4 sm:grid-cols-3"
                  cols={2}
                  items={[
                    { label: "High", value: stats.current.high ? fmtPts(stats.current.high.pf) : "—", sub: stats.current.high ? gameWeekLabel(stats.current.high) : undefined },
                    { label: "Low", value: stats.current.low ? fmtPts(stats.current.low.pf) : "—", sub: stats.current.low ? gameWeekLabel(stats.current.low) : undefined },
                    { label: "Against", value: fmtPts(stats.current.pa, 1), sub: `${fmtPts(stats.current.avgPa, 1)} / wk` },
                    { label: "Win %", value: pct3(stats.current.pct), sub: `${fmtRecord(stats.current.wins, stats.current.losses, stats.current.ties)} H2H${s?.streak ? ` · ${s.streak}` : ""}` },
                    {
                      label: "All-play",
                      value: stats.allPlayRow ? fmtRecord(stats.allPlayRow.wins, stats.allPlayRow.losses, stats.allPlayRow.ties) : "—",
                      sub: stats.allPlayRow ? `${pct3(stats.allPlayRow.pct)} · ${stats.allPlayRow.expectedWins.toFixed(1)} exp. wins` : undefined,
                    },
                    {
                      label: "Luck",
                      value: stats.luck ? signed(stats.luck.value, 1) : "—",
                      tone: stats.luck ? (stats.luck.value > 0.5 ? "good" : stats.luck.value < -0.5 ? "bad" : undefined) : undefined,
                      sub: stats.luck ? luckRankLabel(stats.luck) : undefined,
                    },
                  ]}
                />
              </>
            ) : (
              <EmptyState title="No completed games yet">Weekly scoring appears once Week {settings.general.firstWeek} is final.</EmptyState>
            )}
          </Panel>

          {/* ── Lineup efficiency ── */}
          <Panel
            id="lineups"
            title="Lineup efficiency"
            className="scroll-mt-16"
            info={<p>Points started vs the best possible lineup from that week&apos;s roster (actual points). 100% = a perfect lineup.</p>}
          >
            {eff ? (
              <>
                <Meter
                  value={eff.summary.efficiency}
                  max={1}
                  size="md"
                  tone={eff.summary.efficiency >= 0.9 ? "good" : eff.summary.efficiency >= 0.75 ? "brand" : "warn"}
                  caption="Season efficiency"
                  valueText={fmtPct(eff.summary.efficiency, 1)}
                />
                <StatGrid
                  className="mt-4"
                  cols={3}
                  items={[
                    { label: "On bench", value: fmtPts(eff.summary.benchLeft, 1), sub: "pts left" },
                    { label: "Perfect", value: String(eff.summary.perfectWeeks), sub: `of ${eff.weeks.length} weeks` },
                    { label: "Rank", value: ordinal(eff.rank), sub: `of ${eff.of}` },
                  ]}
                />
                <div className="mt-3 border-t border-line/70">
                  <Collapsible summary="Week by week" meta={`${eff.weeks.length} weeks`}>
                    <ul className="divide-y divide-line/70">
                      {eff.weeks.map((w) => {
                        const miss = w.missed[0];
                        const pl = miss ? playerById.get(miss.playerId) : undefined;
                        return (
                          <li key={w.week} className="py-2">
                            <div className="flex items-center gap-3">
                              <span className="numeral w-11 shrink-0 text-[15px] font-semibold sm:text-sm">Wk {w.week}</span>
                              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.07] dark:bg-white/[0.08]" aria-hidden>
                                <span
                                  className={cn("block h-full rounded-full", w.efficiency >= 0.9 ? "bg-win" : w.efficiency >= 0.75 ? "bg-brand-600 dark:bg-brand-400" : "bg-amber-500")}
                                  style={{ width: `${Math.round(w.efficiency * 100)}%` }}
                                />
                              </span>
                              <span className="numeral w-11 shrink-0 text-right text-[15px] font-semibold sm:text-sm">{fmtPct(w.efficiency, 0)}</span>
                            </div>
                            <p className="ml-14 mt-0.5 truncate text-[13px] text-muted">
                              <span className="numeral">
                                {fmtPts(w.actual)} of {fmtPts(w.optimal)} ·{" "}
                                <span className={cn(w.benchLeft > 25 && "font-semibold text-loss")}>{fmtPts(w.benchLeft, 1)} on bench</span>
                              </span>
                              {pl && miss ? (
                                <>
                                  {" · "}
                                  <Link href={`/players/${pl.id}`} className="text-brand-600 hover:underline dark:text-brand-400">
                                    {pl.fullName}
                                  </Link>{" "}
                                  ({pl.position}, {fmtPts(miss.points, 1)})
                                </>
                              ) : (
                                " · Perfect lineup"
                              )}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </Collapsible>
                </div>
              </>
            ) : (
              <EmptyState title="No completed weeks yet">Efficiency is measured after each week is final.</EmptyState>
            )}
          </Panel>

          {/* ── Head-to-head ── */}
          <Panel id="h2h" title="Head-to-head" subtitle="All seasons, incl. playoffs" className="scroll-mt-16" noPad>
            {stats.h2h.length ? (
              <>
                {/* phones: record + avg margin; tap a row for the rest */}
                <div className="border-t border-line/70 md:hidden">
                  <ShowMore as="ul" initial={5} className="divide-y divide-line/70">
                    {stats.h2h.map((r) => (
                      <li key={r.oppKey}>
                        <details className="group">
                          <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
                            <Avatar name={r.opp.name} src={r.opp.avatarUrl} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold leading-5 text-ink" title={r.opp.name}>
                                {r.opp.name}
                              </span>
                              {r.opp.team && <span className="block truncate text-[13px] leading-[18px] text-muted">{r.opp.team.name}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="numeral block text-[15px] font-semibold leading-5 text-ink">{fmtRecord(r.wins, r.losses, r.ties)}</span>
                              <span className={cn("numeral block text-[12px] leading-4", r.avgMargin > 0 ? "text-win" : r.avgMargin < 0 ? "text-loss" : "text-muted")}>
                                {signed(r.avgMargin, 1)} avg
                              </span>
                            </span>
                            <ChevronDown size={16} className="-mr-1 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
                          </summary>
                          <div className="bg-sunken px-4 pb-3 pt-3">
                            <StatGrid
                              cols={3}
                              items={[
                                { label: "Win %", value: pct3(r.pct), tone: r.pct > 0.5 ? "good" : r.pct < 0.5 ? "bad" : undefined },
                                { label: "PF", value: fmtPts(r.pf, 1) },
                                { label: "PA", value: fmtPts(r.pa, 1) },
                                { label: "Playoffs", value: r.playoffWins + r.playoffLosses ? fmtRecord(r.playoffWins, r.playoffLosses) : "—" },
                                { label: "Streak", value: r.streak || "—" },
                                {
                                  label: "Last",
                                  value: r.last ? (
                                    <span className="inline-flex items-center gap-1">
                                      <ResultPill result={r.last.result} /> {fmtPts(r.last.pf, 1)}
                                    </span>
                                  ) : (
                                    "—"
                                  ),
                                  sub: r.last ? `${r.last.season} ${gameWeekLabel(r.last)} · ${fmtPts(r.last.pa, 1)}` : undefined,
                                },
                              ]}
                            />
                            {r.opp.userId && (
                              <div className="mt-2">
                                <MoreLink href={`/managers/${r.opp.userId}`}>Profile</MoreLink>
                              </div>
                            )}
                          </div>
                        </details>
                      </li>
                    ))}
                  </ShowMore>
                </div>
                {/* tablet / desktop: the full table */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th>Opponent</th>
                        <th className="num">Record</th>
                        <th className="num">Win %</th>
                        <th className="num">PF</th>
                        <th className="num">PA</th>
                        <th className="num">Avg margin</th>
                        <th className="num">Playoffs</th>
                        <th>Streak</th>
                        <th className="hidden lg:table-cell">Last meeting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.h2h.map((r) => (
                        <tr key={r.oppKey}>
                          <td className="min-w-[180px]">
                            <ManagerChip m={r.opp} size={24} />
                          </td>
                          <td className="num font-semibold">{fmtRecord(r.wins, r.losses, r.ties)}</td>
                          <td className={cn("num", r.pct > 0.5 ? "text-win" : r.pct < 0.5 ? "text-loss" : "")}>{pct3(r.pct)}</td>
                          <td className="num">{fmtPts(r.pf, 1)}</td>
                          <td className="num">{fmtPts(r.pa, 1)}</td>
                          <td className={cn("num", r.avgMargin > 0 ? "text-win" : r.avgMargin < 0 ? "text-loss" : "")}>{signed(r.avgMargin, 1)}</td>
                          <td className="num">{r.playoffWins + r.playoffLosses ? fmtRecord(r.playoffWins, r.playoffLosses) : "—"}</td>
                          <td>{r.streak || "—"}</td>
                          <td className="hidden whitespace-nowrap text-xs lg:table-cell">
                            {r.last && (
                              <span className="inline-flex items-center gap-1.5">
                                <ResultPill result={r.last.result} />
                                {fmtPts(r.last.pf, 1)}–{fmtPts(r.last.pa, 1)}{" "}
                                <span className="text-muted">
                                  ({r.last.season} {gameWeekLabel(r.last)})
                                </span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="px-4 pb-4">
                <EmptyState title="No head-to-head games yet" />
              </div>
            )}
          </Panel>

          {/* ── Season by season ── */}
          <Panel id="history" title="Season by season" className="scroll-mt-16" noPad>
            {stats.finishes.length ? (
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {stats.finishes.map((f) => (
                  <li key={`${f.season}-${f.teamId}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                    <span className="numeral w-12 shrink-0 text-[15px] font-semibold sm:text-sm">{f.season}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold leading-5 sm:text-sm" title={f.teamName}>
                        {f.teamName}
                      </span>
                      <span className="numeral block truncate text-[13px] leading-[18px] text-muted">
                        PF {fmtPts(f.pointsFor, 1)} · PA {fmtPts(f.pointsAgainst, 1)}
                        {f.regularSeasonRank ? ` · ${ordinal(f.regularSeasonRank)} reg.` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="numeral block text-[15px] font-semibold leading-5">{fmtRecord(f.wins, f.losses, f.ties)}</span>
                      <span className="block text-[12px] leading-4">
                        {f.inProgress ? (
                          <span className="text-muted">In progress</span>
                        ) : f.champion ? (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-gold-700 dark:text-gold-400">
                            <Trophy size={11} aria-hidden /> Champion
                          </span>
                        ) : f.runnerUp ? (
                          <span className="text-muted">Runner-up</span>
                        ) : f.finalRank ? (
                          <span className="text-muted">
                            {ordinal(f.finalRank)}
                            {f.madePlayoffs ? " · playoffs" : ""}
                          </span>
                        ) : (
                          <span className="text-muted">{f.madePlayoffs ? "Playoffs" : "—"}</span>
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 pb-4">
                <EmptyState title="No completed seasons yet" />
              </div>
            )}
          </Panel>

          {/* ── Best & worst ── */}
          <div id="weeks" className="grid scroll-mt-16 grid-cols-1 gap-4 md:grid-cols-2">
            <WeeksList title="Best weeks" rows={stats.best} teamName={teamName} />
            <WeeksList title="Worst weeks" rows={stats.worst} teamName={teamName} />
          </div>

          {/* ── Moves ── */}
          <Panel
            id="moves"
            title="Moves & trades"
            subtitle="All-time · this season under each"
            className="scroll-mt-16"
            actions={<MoreLink href={team ? `/transactions?team=${team.id}` : "/transactions"}>Log</MoreLink>}
          >
            <StatGrid
              cols={3}
              className="sm:grid-cols-6"
              items={[
                { label: "Adds", value: String(stats.moves.adds), sub: `${stats.moves.seasonCounts.adds} in ${season}` },
                { label: "Claims", value: String(stats.moves.waivers), sub: `${stats.moves.seasonCounts.waivers} in ${season}` },
                { label: "Drops", value: String(stats.moves.drops), sub: `${stats.moves.seasonCounts.drops} in ${season}` },
                { label: "Trades", value: String(stats.moves.trades), sub: `${stats.moves.seasonCounts.trades} in ${season}` },
                { label: "FAB spent", value: fmtMoney(stats.moves.faabSpent), sub: `${fmtMoney(stats.moves.faabSpentSeason)} in ${season}` },
                ...(stats.moves.faabBalance !== null && settings.waivers.type === "FAB" ? [{ label: "FAB left", value: fmtMoney(stats.moves.faabBalance), sub: "this season" }] : []),
              ]}
            />
            <div className="mt-4 border-t border-line/70 pt-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="eyebrow">Trade partners</h3>
                <MoreLink href="/trades/history">Trade history</MoreLink>
              </div>
              {stats.moves.partners.length ? (
                <ul className="flex flex-wrap gap-2">
                  {stats.moves.partners.map((x) => (
                    <li key={x.opp.key} className="flex items-center gap-2 rounded-full bg-sunken py-1 pl-1 pr-3">
                      <ManagerChip m={x.opp} size={24} showTeam={false} className="text-[14px]" />
                      <span className="numeral text-[13px] text-muted">× {x.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[15px] text-muted sm:text-sm">No completed trades yet.</p>
              )}
            </div>
          </Panel>

          {/* ── Salary ── */}
          <Panel
            id="salary"
            title="Salary by position"
            subtitle={team ? `${team.name} · current roster` : undefined}
            className="scroll-mt-16"
            noPad
            actions={team ? <MoreLink href={me ? "/team/contracts" : `/teams/${team.id}`}>Contracts</MoreLink> : undefined}
          >
            {salary && salary.slices.length ? (
              <>
                <div className="px-4 pb-3">
                  {salary.enabled && (
                    <Meter
                      value={salary.committed}
                      max={salary.cap}
                      size="md"
                      tone={salary.space < 0 ? "bad" : "brand"}
                      caption="Cap used"
                      valueText={`${fmtMoney(salary.committed)} / ${fmtMoney(salary.cap)}`}
                    />
                  )}
                  <StatGrid
                    className="mt-3"
                    cols={3}
                    items={[
                      ...(salary.enabled ? [{ label: "Cap space", value: fmtMoney(salary.space), tone: salary.space < 0 ? ("bad" as const) : ("good" as const) }] : []),
                      ...(salary.enabled && salary.deadMoney > 0 ? [{ label: "Dead money", value: fmtMoney(salary.deadMoney), tone: "bad" as const }] : []),
                      { label: "Payroll", value: fmtMoney(salary.totalSalary) },
                    ]}
                  />
                </div>
                <RankList className="border-t border-line/70">
                  {salary.slices.map((x) => (
                    <RankBar
                      key={x.position}
                      leading={<PosPill pos={x.position} className="w-10 justify-center" />}
                      title={`${x.count} player${x.count === 1 ? "" : "s"}`}
                      value={x.salary}
                      max={topSalary}
                      display={fmtMoney(x.salary)}
                      valueSub={`${fmtPct(x.share)} of pay`}
                    />
                  ))}
                </RankList>
              </>
            ) : (
              <div className="px-4 pb-4">
                <EmptyState title="No players under contract" />
              </div>
            )}
          </Panel>
        </div>

        {/* ── Rail ── */}
        <aside className="min-w-0 space-y-4">
          <Panel id="about" title="About" className="scroll-mt-16" actions={me ? <MoreLink href="/settings/profile">Edit</MoreLink> : undefined}>
            {p?.bio ? (
              <div className="max-w-[70ch] text-[15px] leading-relaxed sm:text-sm">
                <RichText text={p.bio} />
              </div>
            ) : (
              <p className="text-[15px] text-muted sm:text-sm">{me ? "Add a bio from Edit profile." : `${name} hasn't written a bio yet.`}</p>
            )}
            <div className="mt-2 divide-y divide-line/70">
              {p?.yearsPlaying !== null && p?.yearsPlaying !== undefined && <StatRow label="Playing fantasy" value={`${p.yearsPlaying} yr${p.yearsPlaying === 1 ? "" : "s"}`} />}
              {p?.managerStyle && <StatRow label="Style" value={p.managerStyle} />}
              {nfl && (
                <StatRow
                  label="Favorite team"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <NflLogo abbr={nfl.abbr} size={18} /> {nfl.city} {nfl.name}
                    </span>
                  }
                />
              )}
              {p?.favoritePlayer && <StatRow label="Favorite player" value={p.favoritePlayer} />}
              {p?.location && <StatRow label="Location" value={<span className="block max-w-[180px] truncate">{p.location}</span>} />}
              <StatRow label="In the league since" value={since} />
            </div>
            {(socials.length > 0 || (p?.showEmail && user.email) || (p?.showPhone && user.phone)) && (
              <div className="mt-3 border-t border-line/70 pt-3">
                <h3 className="eyebrow mb-1">Contact</h3>
                <ul>
                  {p?.showEmail && (
                    <li>
                      <a href={`mailto:${user.email}`} className="flex min-h-10 items-center gap-2 break-all text-[15px] text-brand-600 hover:underline sm:text-sm dark:text-brand-400">
                        <Mail size={15} className="shrink-0" /> {user.email}
                      </a>
                    </li>
                  )}
                  {p?.showPhone && user.phone && (
                    <li>
                      <a href={`tel:${user.phone}`} className="flex min-h-10 items-center gap-2 text-[15px] text-brand-600 hover:underline sm:text-sm dark:text-brand-400">
                        <Phone size={15} className="shrink-0" /> {user.phone}
                      </a>
                    </li>
                  )}
                  {socials.map((x) => (
                    <li key={x.key}>
                      <a
                        href={x.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="flex min-h-10 min-w-0 items-center gap-2 text-[15px] text-brand-600 hover:underline sm:text-sm dark:text-brand-400"
                      >
                        <ExternalLink size={15} className="shrink-0" /> <span className="shrink-0 text-muted">{x.label}</span> <span className="truncate">{x.value}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {me && !p?.showEmail && !p?.showPhone && <p className="mt-3 text-[13px] text-muted">Your email and phone are hidden from the league.</p>}
          </Panel>

          {team && (
            <Panel title="Team" noPad>
              <ul className="border-t border-line/70">
                <ListRow
                  href={`/teams/${team.id}`}
                  leading={<TeamLogo team={team} size={40} round />}
                  title={team.name}
                  subtitle={[s ? `${fmtRecord(s.wins, s.losses, s.ties)} · ${ordinal(s.rank)}` : null, division].filter(Boolean).join(" · ") || "—"}
                  chevron
                />
              </ul>
              {teamMotto && <p className="px-4 pb-3 text-[15px] italic text-muted sm:text-sm">“{teamMotto}”</p>}
            </Panel>
          )}

          <Panel title="All-time" noPad actions={<MoreLink href="/history">Records</MoreLink>}>
            <div className="border-t border-line/70">
              <ShowMore initial={6} className="divide-y divide-line/70 px-4">
                <StatRow label="Regular season" value={`${fmtRecord(stats.allTime.regular.wins, stats.allTime.regular.losses, stats.allTime.regular.ties)} (${pct3(stats.allTime.regular.pct)})`} />
                <StatRow label="Playoffs" value={stats.allTime.playoffs.wins + stats.allTime.playoffs.losses ? fmtRecord(stats.allTime.playoffs.wins, stats.allTime.playoffs.losses, stats.allTime.playoffs.ties) : "—"} />
                <StatRow label="Championships" value={champSeasons.length ? `${champSeasons.length} (${champSeasons.join(", ")})` : "0"} />
                <StatRow label="Playoff trips" value={String(stats.allTime.playoffApps)} />
                <StatRow label="Points for" value={fmtPts(stats.allTime.regular.pf, 1)} />
                <StatRow label="Avg score" value={stats.allTime.games.games ? fmtPts(stats.allTime.games.avgPf) : "—"} />
                <StatRow label="Points against" value={fmtPts(stats.allTime.regular.pa, 1)} />
                <StatRow
                  label="Highest week"
                  value={stats.allTime.games.high ? fmtPts(stats.allTime.games.high.pf) : "—"}
                  sub={stats.allTime.games.high ? `${stats.allTime.games.high.season} ${gameWeekLabel(stats.allTime.games.high)}` : undefined}
                />
                <StatRow
                  label="Lowest week"
                  value={stats.allTime.games.low ? fmtPts(stats.allTime.games.low.pf) : "—"}
                  sub={stats.allTime.games.low ? `${stats.allTime.games.low.season} ${gameWeekLabel(stats.allTime.games.low)}` : undefined}
                />
                <StatRow label="Longest win streak" value={String(stats.allTime.longestWin)} />
                <StatRow label="Longest losing streak" value={String(stats.allTime.longestLoss)} />
                <StatRow label="Runner-up" value={String(stats.allTime.runnerUps)} />
                <StatRow label="Best finish" value={stats.allTime.bestFinish ? ordinal(stats.allTime.bestFinish) : "—"} />
              </ShowMore>
            </div>
          </Panel>

          {!member && (
            <Panel title="Former manager">
              <p className="flex items-start gap-2 text-[15px] text-muted sm:text-sm">
                <UserRound size={15} className="mt-0.5 shrink-0" /> {name} is no longer in the league. Their history stays in the record books.
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function WeeksList({ title, rows, teamName }: { title: string; rows: Pick<GameRow, "matchupId" | "season" | "week" | "weeks" | "leg" | "pf" | "pa" | "result" | "oppTeamId" | "isPlayoff">[]; teamName: (id: string) => string }) {
  return (
    <Panel title={title} noPad>
      {rows.length ? (
        <div className="border-t border-line/70">
          <ShowMore as="ul" initial={3} className="divide-y divide-line/70">
            {rows.map((g) => (
              <ListRow
                key={g.matchupId}
                leading={<ResultPill result={g.result} />}
                title={
                  <>
                    {g.season} · {gameWeekLabel(g)}
                    {g.isPlayoff && (
                      <Badge className="ml-1.5 align-middle">
                        Playoffs
                      </Badge>
                    )}
                  </>
                }
                titleText={`${g.season} ${gameWeekLabel(g)}`}
                subtitle={`${fmtPts(g.pa)} vs ${teamName(g.oppTeamId)}`}
                value={fmtPts(g.pf)}
              />
            ))}
          </ShowMore>
        </div>
      ) : (
        <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No games yet.</p>
      )}
    </Panel>
  );
}

/** "Luckiest in the league", "4th luckiest of 12", "2nd unluckiest of 12" (rank 1 = luckiest). */
function luckRankLabel(l: { value: number; rank: number; of: number }): string {
  if (l.value >= 0) return l.rank === 1 ? `Luckiest of ${l.of}` : `${ordinal(l.rank)} luckiest of ${l.of}`;
  const u = l.of - l.rank + 1;
  return u === 1 ? `Unluckiest of ${l.of}` : `${ordinal(u)} unluckiest of ${l.of}`;
}
