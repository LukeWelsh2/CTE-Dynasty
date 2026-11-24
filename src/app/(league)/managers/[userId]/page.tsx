// Manager profile + in-depth stats: season & all-time record, head-to-head, all-play/luck, lineup efficiency,
// weekly scoring vs league average, finishes, best/worst weeks, transactions, trade partners and salary mix.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, ExternalLink, Mail, MapPin, Pencil, Phone, Star, Trophy, UserRound } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { NFL_TEAM_BY_ABBR } from "@/lib/nfl/teams";
import { loadLeagueHistory, managerStats } from "@/lib/stats/load";
import { socialLinks } from "@/lib/profiles/schema";
import { Avatar, Badge, ButtonLink, EmptyState, NflLogo, Panel, StatTile, TeamLogo } from "@/components/ui/core";
import { LeagueTabs, ManagerChip, ResultPill, SectionNav, fmtRecord, pct3, signed } from "@/components/community/bits";
import { RichText } from "@/components/community/rich-text";
import { DmButton } from "@/components/community/dm-button";
import { SalaryByPositionChart, WeeklyScoresChart } from "@/components/community/manager-charts";
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

  // player names for "should have started" hints
  const missedIds = [...new Set(stats.efficiency?.weeks.flatMap((w) => w.missed.slice(0, 1).map((x) => x.playerId)) ?? [])];
  const missedPlayers = missedIds.length ? await db.player.findMany({ where: { id: { in: missedIds } }, select: { id: true, fullName: true, position: true } }) : [];
  const playerById = new Map(missedPlayers.map((x) => [x.id, x]));

  const weekly = stats.weekly.map((w) => ({ week: w.week, pts: w.pts, leagueAvg: w.leagueAvg, opp: w.opp, oppName: teamName(w.oppTeamId), result: w.result, isPlayoff: w.isPlayoff }));
  const beatAvg = stats.weekly.filter((w) => w.pts > w.leagueAvg).length;
  const trophy = settings.general.championTrophyName || "Championship";
  const champSeasons = stats.finishes.filter((f) => f.champion).map((f) => f.season);

  const sections = [
    { id: "season", label: `${season} season` },
    { id: "lineups", label: "Lineup efficiency" },
    { id: "h2h", label: "Head-to-head" },
    { id: "history", label: "Season history" },
    { id: "weeks", label: "Best & worst" },
    { id: "moves", label: "Moves & trades" },
    { id: "salary", label: "Salary" },
  ];

  return (
    <div>
      <LeagueTabs active="managers" />

      {/* ── Hero ── */}
      <section className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
        <div className="relative h-32 sm:h-44">
          {p?.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className="h-full w-full"
              style={{ background: `linear-gradient(115deg, ${team?.primaryColor ?? "#163070"} 0%, ${team?.primaryColor ?? "#163070"} 58%, ${team?.secondaryColor ?? "#f5b301"} 58%, ${team?.secondaryColor ?? "#f5b301"} 66%, ${team?.primaryColor ?? "#163070"} 66%)` }}
            />
          )}
          {champSeasons.length > 0 && (
            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold text-gold-300">
              <Trophy size={13} /> {champSeasons.length}× {trophy}
            </div>
          )}
        </div>
        <div className="relative flex flex-col gap-3 px-4 pb-4 sm:flex-row sm:items-end">
          <div className="-mt-12 shrink-0 self-start rounded-full ring-4 ring-panel sm:-mt-14">
            <Avatar name={name} src={user.avatarUrl} size={104} />
          </div>
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">{name}</h1>
              {member && (member.role === "COMMISSIONER" || member.role === "CO_COMMISSIONER") && <Badge tone="gold">{member.role === "COMMISSIONER" ? "Commissioner" : "Co-commissioner"}</Badge>}
              {!member && <Badge>Former manager</Badge>}
              {p?.managerStyle && <Badge tone="brand">{p.managerStyle}</Badge>}
            </div>
            {name !== user.name && <div className="text-sm text-muted">{user.name}</div>}
            {p?.motto && <p className="mt-0.5 text-sm italic text-muted">“{p.motto}”</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              {team && (
                <Link href={`/teams/${team.id}`} className="inline-flex items-center gap-1.5 font-semibold text-ink hover:underline">
                  <TeamLogo team={team} size={18} /> {team.name}
                </Link>
              )}
              {p?.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} /> {p.location}
                </span>
              )}
              {nfl && (
                <span className="inline-flex items-center gap-1">
                  <NflLogo abbr={nfl.abbr} size={16} /> {nfl.city} {nfl.name} fan
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} /> In the league since {memberSince.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: tz })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {me ? (
              <ButtonLink href="/settings/profile" size="sm" variant="secondary">
                <Pencil size={14} /> Edit profile
              </ButtonLink>
            ) : (
              member && <DmButton userId={userId} />
            )}
          </div>
        </div>
      </section>

      {/* ── Headline tiles ── */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label={`${season} record`} value={s ? fmtRecord(s.wins, s.losses, s.ties) : "—"} sub={s && played ? `${ordinal(s.rank)} of ${history.teams.length} · ${s.streak || "—"}` : "No games yet"} />
        <StatTile label="Points for" value={played ? fmtPts(stats.current.pf, 1) : "—"} sub={played ? `${fmtPts(stats.current.avgPf, 1)} per game` : undefined} />
        <StatTile
          label="All-play"
          value={stats.allPlayRow ? fmtRecord(stats.allPlayRow.wins, stats.allPlayRow.losses, stats.allPlayRow.ties) : "—"}
          sub={stats.allPlayRow ? `${pct3(stats.allPlayRow.pct)} · ${stats.allPlayRow.expectedWins.toFixed(1)} expected wins` : undefined}
        />
        <StatTile
          label="Luck index"
          value={stats.luck ? signed(stats.luck.value, 1) : "—"}
          tone={stats.luck ? (stats.luck.value > 0.5 ? "good" : stats.luck.value < -0.5 ? "bad" : "neutral") : undefined}
          sub={stats.luck ? `${stats.luck.value >= 0 ? "Luckiest" : "Unluckiest"} rank ${stats.luck.value >= 0 ? stats.luck.rank : stats.luck.of - stats.luck.rank + 1} of ${stats.luck.of}` : undefined}
        />
        <StatTile
          label="Lineup efficiency"
          value={stats.efficiency ? fmtPct(stats.efficiency.summary.efficiency, 1) : "—"}
          sub={stats.efficiency ? `${ordinal(stats.efficiency.rank)} of ${stats.efficiency.of} · ${fmtPts(stats.efficiency.summary.benchLeft, 0)} pts on bench` : undefined}
        />
        <StatTile label="Titles" value={stats.allTime.championships} sub={`${stats.allTime.playoffApps} playoff trip${stats.allTime.playoffApps === 1 ? "" : "s"} · ${stats.allTime.regular.seasons} season${stats.allTime.regular.seasons === 1 ? "" : "s"}`} />
      </div>

      <div className="mt-4">
        <SectionNav items={sections} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* ── Season ── */}
          <Panel id="season" title={`${season} weekly scoring`} subtitle={played ? `Beat the league average in ${beatAvg} of ${stats.weekly.length} weeks` : undefined} className="scroll-mt-14">
            {weekly.length ? (
              <>
                <WeeklyScoresChart data={weekly} teamLabel={team?.name ?? name} />
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="High" value={stats.current.high ? fmtPts(stats.current.high.pf) : "—"} sub={stats.current.high ? `Week ${stats.current.high.week}` : undefined} />
                  <MiniStat label="Low" value={stats.current.low ? fmtPts(stats.current.low.pf) : "—"} sub={stats.current.low ? `Week ${stats.current.low.week}` : undefined} />
                  <MiniStat label="Points against" value={fmtPts(stats.current.pa, 1)} sub={`${fmtPts(stats.current.avgPa, 1)} per game`} />
                  <MiniStat label="Win %" value={pct3(stats.current.pct)} sub={`${fmtRecord(stats.current.wins, stats.current.losses, stats.current.ties)} head-to-head`} />
                </div>
              </>
            ) : (
              <EmptyState title="No completed games yet">Weekly scoring appears once Week {settings.general.firstWeek} is final.</EmptyState>
            )}
          </Panel>

          {/* ── Lineup efficiency ── */}
          <Panel
            id="lineups"
            title="Lineup efficiency"
            subtitle="Started vs best possible lineup from that week’s roster (actual points)"
            className="scroll-mt-14"
            noPad
          >
            {stats.efficiency ? (
              <>
                <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
                  <Cell label="Season efficiency" value={fmtPct(stats.efficiency.summary.efficiency, 1)} />
                  <Cell label="League rank" value={`${ordinal(stats.efficiency.rank)} / ${stats.efficiency.of}`} />
                  <Cell label="Left on bench" value={fmtPts(stats.efficiency.summary.benchLeft, 1)} />
                  <Cell label="Perfect weeks" value={String(stats.efficiency.summary.perfectWeeks)} />
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <table className="tbl tbl-compact">
                    <thead className="sticky top-0 z-[1]">
                      <tr>
                        <th>Wk</th>
                        <th className="num">Started</th>
                        <th className="num">Optimal</th>
                        <th className="w-[30%]">Efficiency</th>
                        <th className="num">Bench</th>
                        <th className="hidden sm:table-cell">Best player left on bench</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.efficiency.weeks.map((w) => {
                        const miss = w.missed[0];
                        const pl = miss ? playerById.get(miss.playerId) : undefined;
                        return (
                          <tr key={w.week}>
                            <td className="font-semibold">{w.week}</td>
                            <td className="num">{fmtPts(w.actual)}</td>
                            <td className="num text-muted">{fmtPts(w.optimal)}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                                  <div className={cn("h-full rounded-full", w.efficiency >= 0.9 ? "bg-win" : w.efficiency >= 0.75 ? "bg-brand-500" : "bg-amber-500")} style={{ width: `${Math.round(w.efficiency * 100)}%` }} />
                                </div>
                                <span className="w-11 text-right text-xs tabular-nums">{fmtPct(w.efficiency, 0)}</span>
                              </div>
                            </td>
                            <td className={cn("num", w.benchLeft > 25 && "font-semibold text-loss")}>{fmtPts(w.benchLeft, 1)}</td>
                            <td className="hidden text-xs sm:table-cell">
                              {pl && miss ? (
                                <Link href={`/players/${pl.id}`} className="link">
                                  {pl.fullName} <span className="text-muted">({pl.position}, {fmtPts(miss.points, 1)})</span>
                                </Link>
                              ) : (
                                <span className="text-muted">Perfect lineup</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-3">
                <EmptyState title="No completed weeks yet">Efficiency is measured after each week is final, using the lineup that was set and the players on the roster that week.</EmptyState>
              </div>
            )}
          </Panel>

          {/* ── Head-to-head ── */}
          <Panel id="h2h" title="Head-to-head" subtitle="Every meeting, all seasons incl. playoffs" className="scroll-mt-14" noPad>
            {stats.h2h.length ? (
              <div className="overflow-x-auto">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Opponent</th>
                      <th className="num">Record</th>
                      <th className="num">Win %</th>
                      <th className="num hidden sm:table-cell">PF</th>
                      <th className="num hidden sm:table-cell">PA</th>
                      <th className="num">Avg margin</th>
                      <th className="num hidden md:table-cell">Playoffs</th>
                      <th className="hidden md:table-cell">Streak</th>
                      <th className="hidden lg:table-cell">Last meeting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.h2h.map((r) => (
                      <tr key={r.oppKey}>
                        <td className="min-w-[160px]">
                          <ManagerChip m={r.opp} size={24} />
                        </td>
                        <td className="num font-semibold">{fmtRecord(r.wins, r.losses, r.ties)}</td>
                        <td className={cn("num", r.pct > 0.5 ? "text-win" : r.pct < 0.5 ? "text-loss" : "")}>{pct3(r.pct)}</td>
                        <td className="num hidden sm:table-cell">{fmtPts(r.pf, 1)}</td>
                        <td className="num hidden sm:table-cell">{fmtPts(r.pa, 1)}</td>
                        <td className={cn("num", r.avgMargin > 0 ? "text-win" : r.avgMargin < 0 ? "text-loss" : "")}>{signed(r.avgMargin, 1)}</td>
                        <td className="num hidden md:table-cell">{r.playoffWins + r.playoffLosses ? fmtRecord(r.playoffWins, r.playoffLosses) : "—"}</td>
                        <td className="hidden md:table-cell">{r.streak || "—"}</td>
                        <td className="hidden text-xs lg:table-cell">
                          {r.last && (
                            <span className="inline-flex items-center gap-1.5">
                              <ResultPill result={r.last.result} />
                              {fmtPts(r.last.pf, 1)}–{fmtPts(r.last.pa, 1)} <span className="text-muted">({r.last.season} wk {r.last.week})</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-3">
                <EmptyState title="No head-to-head games yet" />
              </div>
            )}
          </Panel>

          {/* ── Season history ── */}
          <Panel id="history" title="Season by season" className="scroll-mt-14" noPad>
            {stats.finishes.length ? (
              <div className="overflow-x-auto">
                <table className="tbl tbl-compact">
                  <thead>
                    <tr>
                      <th>Season</th>
                      <th>Team</th>
                      <th className="num">Record</th>
                      <th className="num">PF</th>
                      <th className="num hidden sm:table-cell">PA</th>
                      <th className="num">Reg. rank</th>
                      <th>Finish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.finishes.map((f) => (
                      <tr key={`${f.season}-${f.teamId}`}>
                        <td className="font-semibold">{f.season}</td>
                        <td className="max-w-[180px] truncate">{f.teamName}</td>
                        <td className="num">{fmtRecord(f.wins, f.losses, f.ties)}</td>
                        <td className="num">{fmtPts(f.pointsFor, 1)}</td>
                        <td className="num hidden sm:table-cell">{fmtPts(f.pointsAgainst, 1)}</td>
                        <td className="num">{f.regularSeasonRank ? ordinal(f.regularSeasonRank) : "—"}</td>
                        <td>
                          {f.inProgress ? (
                            <Badge tone="live">In progress</Badge>
                          ) : f.champion ? (
                            <Badge tone="gold">
                              <Trophy size={10} /> Champion
                            </Badge>
                          ) : f.runnerUp ? (
                            <Badge tone="brand">Runner-up</Badge>
                          ) : f.finalRank ? (
                            <span className="text-sm">
                              {ordinal(f.finalRank)}
                              {f.madePlayoffs ? <span className="text-xs text-muted"> · playoffs</span> : null}
                            </span>
                          ) : f.madePlayoffs ? (
                            "Playoffs"
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-3">
                <EmptyState title="No completed seasons yet" />
              </div>
            )}
          </Panel>

          {/* ── Best & worst ── */}
          <div id="weeks" className="grid scroll-mt-14 grid-cols-1 gap-4 md:grid-cols-2">
            <WeeksTable title="Best weeks" rows={stats.best} teamName={teamName} />
            <WeeksTable title="Worst weeks" rows={stats.worst} teamName={teamName} />
          </div>

          {/* ── Moves ── */}
          <Panel id="moves" title="Transactions & trades" subtitle="All seasons (this season in brackets)" className="scroll-mt-14">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <MiniStat label="Free-agent adds" value={String(stats.moves.adds)} sub={`(${stats.moves.seasonCounts.adds})`} />
              <MiniStat label="Waiver claims" value={String(stats.moves.waivers)} sub={`(${stats.moves.seasonCounts.waivers})`} />
              <MiniStat label="Drops" value={String(stats.moves.drops)} sub={`(${stats.moves.seasonCounts.drops})`} />
              <MiniStat label="Trades" value={String(stats.moves.trades)} sub={`(${stats.moves.seasonCounts.trades})`} />
              <MiniStat
                label="FAB spent"
                value={fmtMoney(stats.moves.faabSpent)}
                sub={`(${fmtMoney(stats.moves.faabSpentSeason)})${stats.moves.faabBalance !== null && settings.waivers.type === "FAB" ? ` · ${fmtMoney(stats.moves.faabBalance)} left` : ""}`}
              />
            </div>
            <div className="mt-3">
              <div className="label">Trade partners</div>
              {stats.moves.partners.length ? (
                <ul className="flex flex-wrap gap-2">
                  {stats.moves.partners.map((x) => (
                    <li key={x.opp.key} className="flex items-center gap-2 rounded-full border border-line bg-sunken/50 py-1 pl-1 pr-3">
                      <ManagerChip m={x.opp} size={22} showTeam={false} className="text-sm" />
                      <span className="text-xs tabular-nums text-muted">
                        {x.count} trade{x.count === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No completed trades yet.</p>
              )}
              <div className="mt-2 flex gap-3 text-xs">
                <Link href={team ? `/transactions?team=${team.id}` : "/transactions"} className="link">
                  Transaction log →
                </Link>
                <Link href="/trades/history" className="link">
                  Trade history →
                </Link>
              </div>
            </div>
          </Panel>

          {/* ── Salary ── */}
          <Panel id="salary" title="Salary by position" subtitle={team ? `${team.name} · current roster` : undefined} className="scroll-mt-14">
            {stats.salary && stats.salary.slices.length ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                <SalaryByPositionChart data={stats.salary.slices.map((x) => ({ position: x.position, salary: x.salary, count: x.count, share: x.share }))} cap={stats.salary.enabled ? stats.salary.cap : null} />
                <div className="space-y-2 text-sm">
                  {stats.salary.enabled && (
                    <>
                      <Row label="Cap" value={fmtMoney(stats.salary.cap)} />
                      <Row label="Committed" value={fmtMoney(stats.salary.committed)} />
                      {stats.salary.deadMoney > 0 && <Row label="Dead money" value={fmtMoney(stats.salary.deadMoney)} tone="bad" />}
                      <Row label="Cap space" value={fmtMoney(stats.salary.space)} tone={stats.salary.space < 0 ? "bad" : "good"} />
                    </>
                  )}
                  <Row label="Total payroll" value={fmtMoney(stats.salary.totalSalary)} />
                  <table className="tbl tbl-compact mt-2">
                    <thead>
                      <tr>
                        <th>Pos</th>
                        <th className="num">#</th>
                        <th className="num">Salary</th>
                        <th className="num">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.salary.slices.map((x) => (
                        <tr key={x.position}>
                          <td className="font-semibold">{x.position}</td>
                          <td className="num">{x.count}</td>
                          <td className="num">{fmtMoney(x.salary)}</td>
                          <td className="num">{fmtPct(x.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {team && (
                    <Link href={me ? "/team/contracts" : `/teams/${team.id}`} className="link inline-block text-xs">
                      Full contracts →
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState title="No players under contract" />
            )}
          </Panel>
        </div>

        {/* ── Aside ── */}
        <aside className="space-y-4">
          <Panel title="About">
            {p?.bio ? (
              <div className="text-sm leading-relaxed">
                <RichText text={p.bio} />
              </div>
            ) : (
              <p className="text-sm text-muted">{me ? "Tell the league about yourself — add a bio from Edit profile." : `${name} hasn't written a bio yet.`}</p>
            )}
            <dl className="mt-3 space-y-1.5 text-sm">
              {p?.yearsPlaying !== null && p?.yearsPlaying !== undefined && <Detail label="Playing fantasy" value={`${p.yearsPlaying} year${p.yearsPlaying === 1 ? "" : "s"}`} />}
              {p?.managerStyle && <Detail label="Style" value={p.managerStyle} />}
              {nfl && (
                <Detail
                  label="Favorite team"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <NflLogo abbr={nfl.abbr} size={18} /> {nfl.city} {nfl.name}
                    </span>
                  }
                />
              )}
              {p?.favoritePlayer && (
                <Detail
                  label="Favorite player"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <Star size={12} className="text-gold-500" /> {p.favoritePlayer}
                    </span>
                  }
                />
              )}
              {p?.location && <Detail label="Location" value={p.location} />}
            </dl>
            {(socials.length > 0 || (p?.showEmail && user.email) || (p?.showPhone && user.phone)) && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="label">Contact & socials</div>
                <ul className="space-y-1 text-sm">
                  {p?.showEmail && (
                    <li>
                      <a href={`mailto:${user.email}`} className="link inline-flex items-center gap-1.5 break-all">
                        <Mail size={13} /> {user.email}
                      </a>
                    </li>
                  )}
                  {p?.showPhone && user.phone && (
                    <li>
                      <a href={`tel:${user.phone}`} className="link inline-flex items-center gap-1.5">
                        <Phone size={13} /> {user.phone}
                      </a>
                    </li>
                  )}
                  {socials.map((x) => (
                    <li key={x.key}>
                      <a href={x.href} target="_blank" rel="noopener noreferrer nofollow" className="link inline-flex items-center gap-1.5 break-all">
                        <ExternalLink size={13} /> <span className="text-muted">{x.label}:</span> {x.value}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {me && !p?.showEmail && !p?.showPhone && (
              <p className="mt-3 text-xs text-muted">Your email and phone are hidden. You can share them with the league from Edit profile.</p>
            )}
          </Panel>

          {team && (
            <Panel title="Team">
              <Link href={`/teams/${team.id}`} className="flex items-center gap-3 rounded-md p-1 hover:bg-sunken">
                <TeamLogo team={team} size={48} />
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg font-bold">{team.name}</span>
                  <span className="text-xs text-muted">
                    {s ? `${fmtRecord(s.wins, s.losses, s.ties)} · ${ordinal(s.rank)} place` : "—"}
                    {s?.team.division ? ` · ${settings.general.divisions.find((d) => d.id === s.team.division)?.name ?? s.team.division}` : ""}
                  </span>
                </span>
              </Link>
              {history.teamById.get(team.id)?.motto && <p className="mt-2 text-sm italic text-muted">“{history.teamById.get(team.id)?.motto}”</p>}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <ButtonLink href={`/teams/${team.id}`} size="sm" variant="secondary">
                  Roster
                </ButtonLink>
                <ButtonLink href={`/trades/new?team=${team.id}`} size="sm" variant="secondary" className={me ? "hidden" : ""}>
                  Propose trade
                </ButtonLink>
              </div>
            </Panel>
          )}

          <Panel title="All-time">
            <dl className="space-y-1.5 text-sm">
              <Detail label="Regular season" value={`${fmtRecord(stats.allTime.regular.wins, stats.allTime.regular.losses, stats.allTime.regular.ties)} (${pct3(stats.allTime.regular.pct)})`} />
              <Detail label="Playoffs" value={stats.allTime.playoffs.wins + stats.allTime.playoffs.losses ? fmtRecord(stats.allTime.playoffs.wins, stats.allTime.playoffs.losses, stats.allTime.playoffs.ties) : "—"} />
              <Detail label="Points for" value={fmtPts(stats.allTime.regular.pf, 1)} />
              <Detail label="Points against" value={fmtPts(stats.allTime.regular.pa, 1)} />
              <Detail label="Avg score" value={stats.allTime.games.games ? fmtPts(stats.allTime.games.avgPf) : "—"} />
              <Detail label="Highest week" value={stats.allTime.games.high ? `${fmtPts(stats.allTime.games.high.pf)} (${stats.allTime.games.high.season} wk ${stats.allTime.games.high.week})` : "—"} />
              <Detail label="Lowest week" value={stats.allTime.games.low ? `${fmtPts(stats.allTime.games.low.pf)} (${stats.allTime.games.low.season} wk ${stats.allTime.games.low.week})` : "—"} />
              <Detail label="Longest win streak" value={String(stats.allTime.longestWin)} />
              <Detail label="Longest losing streak" value={String(stats.allTime.longestLoss)} />
              <Detail label="Playoff appearances" value={String(stats.allTime.playoffApps)} />
              <Detail label="Championships" value={champSeasons.length ? `${champSeasons.length} (${champSeasons.join(", ")})` : "0"} />
              <Detail label="Runner-up" value={String(stats.allTime.runnerUps)} />
              <Detail label="Best finish" value={stats.allTime.bestFinish ? ordinal(stats.allTime.bestFinish) : "—"} />
            </dl>
            <Link href="/history" className="link mt-2 inline-block text-xs">
              League history & records →
            </Link>
          </Panel>

          {!member && (
            <Panel title="Former manager">
              <p className="flex items-start gap-2 text-sm text-muted">
                <UserRound size={15} className="mt-0.5 shrink-0" /> {name} is no longer in the league. Their history stays in the record books.
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-sunken/40 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 pb-1">
      <span className="text-muted">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone === "good" && "text-win", tone === "bad" && "text-loss")}>{value}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function WeeksTable({ title, rows, teamName }: { title: string; rows: { matchupId: string; season: number; week: number; pf: number; pa: number; result: "W" | "L" | "T"; oppTeamId: string; isPlayoff: boolean }[]; teamName: (id: string) => string }) {
  return (
    <Panel title={title} noPad>
      {rows.length ? (
        <table className="tbl tbl-compact">
          <thead>
            <tr>
              <th>Week</th>
              <th className="num">Score</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.matchupId}>
                <td className="whitespace-nowrap">
                  {g.season} · Wk {g.week}
                  {g.isPlayoff && <span className="ml-1 text-[10px] font-bold uppercase text-gold-600">PO</span>}
                </td>
                <td className="num font-semibold">{fmtPts(g.pf)}</td>
                <td className="text-xs">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <ResultPill result={g.result} />
                    <span className="truncate">
                      {fmtPts(g.pa)} vs {teamName(g.oppTeamId)}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-3 text-sm text-muted">No games yet.</div>
      )}
    </Panel>
  );
}
