// /history — League history & records: champions by season, trophy case, all-time standings by manager,
// the records book (every final matchup) and season-by-season archives.
import type { Metadata } from "next";
import Link from "next/link";
import { Crown, Flame, Medal, Trophy } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { currentPlayoffTeams, identityFor, loadLeagueHistory, loadStandings, seasonFinishes } from "@/lib/stats/load";
import { gameWeekLabel, recordsBook, seasonPointRecords, streakRecords, type GameRow } from "@/lib/stats/manager-stats";
import { allTimeStandings, seasonSummaries, seasonTotals, weeklyTopScores } from "@/lib/stats/history";
import { playoffEndWeek } from "@/lib/commissioner/settings-validate";
import { Avatar, Badge, ButtonLink, EmptyState, PageHeader, Panel, TeamLogo } from "@/components/ui/core";
import { LeagueTabs, ManagerChip, SectionNav, fmtRecord, pct3 } from "@/components/community/bits";
import { cn, fmtPts, ordinal } from "@/lib/utils";

export const metadata: Metadata = { title: "History & Records" };
export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const sp = await searchParams;
  const ctx = await getLeagueContext();
  const [history, standings] = await Promise.all([loadLeagueHistory(ctx.league.id, ctx.season), loadStandings(ctx.league.id, ctx.season, ctx.settings)]);
  const finishes = seasonFinishes(history, standings, ctx.season, currentPlayoffTeams(history, ctx.season));
  const trophy = ctx.settings.general.championTrophyName || "Championship";
  const summaries = seasonSummaries(finishes, history.games, history.seasons, ctx.settings.playoffs.championshipWeeks);
  const allTime = allTimeStandings(finishes, history.games);
  const topScores = weeklyTopScores(history.games);
  const book = recordsBook(history.games, 5);
  const streaks = streakRecords(history.games, 5);
  const seasonRecs = seasonPointRecords(seasonTotals(finishes), 5);
  const who = (key: string) => identityFor(history, key);
  const teamOf = (id: string) => history.teamById.get(id);
  const finalWeek = playoffEndWeek(ctx.settings.playoffs);

  // trophy case: anyone with a title, runner-up, regular-season crown or weekly top score
  const trophyRows = allTime
    .map((r) => ({ ...r, weeklyTops: topScores.get(r.key) ?? 0 }))
    .filter((r) => r.titles || r.runnerUps || r.regularSeasonTitles || r.weeklyTops)
    .sort((a, b) => b.titles - a.titles || b.runnerUps - a.runnerUps || b.regularSeasonTitles - a.regularSeasonTitles || b.weeklyTops - a.weeklyTops);

  const seasonSel = history.seasons.includes(Number(sp.season)) ? Number(sp.season) : history.seasons[0] ?? ctx.season;
  const archived = history.teamSeasons.filter((t) => t.season === seasonSel).sort((a, b) => (a.finalRank ?? a.regularSeasonRank ?? 99) - (b.finalRank ?? b.regularSeasonRank ?? 99));
  const isLive = seasonSel === ctx.season && !archived.length;
  const selSummary = summaries.find((s) => s.season === seasonSel);
  const anyGames = history.games.length > 0;
  const bracket = currentPlayoffTeams(history, ctx.season);

  const gameMeta = (g: GameRow) => {
    const opp = teamOf(g.oppTeamId);
    return (
      <span className="text-[11px] text-muted">
        {g.season} · {gameWeekLabel(g)}
        {opp ? ` vs ${opp.name}` : ""}
        {g.isChampionship ? " · Final" : g.isPlayoff ? (g.isConsolation ? " · Consolation" : " · Playoffs") : ""}
      </span>
    );
  };

  const RecordList = ({ title, rows, unit = "pts", empty }: { title: string; rows: { game: GameRow; value: number }[]; unit?: string; empty?: string }) => (
    <Panel title={title} noPad>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-muted">{empty ?? "No completed games yet."}</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => {
            const m = who(r.game.ownerKey);
            return (
              <li key={`${r.game.matchupId}-${r.game.teamId}`} className={cn("flex items-center gap-2.5 px-3 py-2", i === 0 && "bg-gold-300/10")}>
                <span className={cn("w-5 shrink-0 text-center font-display text-sm font-bold", i === 0 ? "text-gold-600 dark:text-gold-400" : "text-muted")}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <ManagerChip m={{ ...m, team: teamOf(r.game.teamId) ?? m.team }} size={24} showTeam={false} />
                  <div className="truncate pl-8">{gameMeta(r.game)}</div>
                </div>
                <span className="shrink-0 text-right font-display text-lg font-bold tabular-nums">
                  {fmtPts(r.value)}
                  <span className="ml-0.5 text-[10px] font-semibold uppercase text-muted">{unit}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );

  return (
    <div>
      <LeagueTabs active="history" />
      <PageHeader
        kicker={`${ctx.league.name} · est. ${Math.min(...history.seasons)}`}
        title="History & Records"
        subtitle={`${history.seasons.length} season${history.seasons.length === 1 ? "" : "s"} · ${history.completedGames} completed game${history.completedGames === 1 ? "" : "s"} · ${history.managers.size} managers all-time`}
        actions={
          <>
            <ButtonLink href="/trades/history" variant="secondary" size="sm">
              Trade history
            </ButtonLink>
            <ButtonLink href="/draft/results" variant="secondary" size="sm">
              Draft history
            </ButtonLink>
          </>
        }
      />
      <SectionNav
        items={[
          { id: "champions", label: "Champions" },
          { id: "trophies", label: "Trophy case" },
          { id: "all-time", label: "All-time standings" },
          { id: "records", label: "Records book" },
          { id: "seasons", label: "Season archive" },
        ]}
      />

      {/* ── Champions ── */}
      <section id="champions" className="mb-5 scroll-mt-14">
        <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wide">{trophy} winners</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map((s) => {
            const champ = s.champion ? who(s.champion.key) : null;
            const champTeam = s.champion ? teamOf(s.champion.teamId) : null;
            const leader = s.inProgress ? standings[0] : null;
            return (
              <article key={s.season} className={cn("relative overflow-hidden rounded-lg border bg-panel p-3 shadow-panel", champ ? "border-gold-400/70" : "border-line")}>
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl font-extrabold tabular-nums">{s.season}</span>
                  {s.inProgress ? <Badge tone="live">In progress</Badge> : champ ? <Trophy size={22} className="text-gold-500" /> : <Badge>No champion recorded</Badge>}
                </div>
                {champ && s.champion ? (
                  <div className="mt-2 flex items-center gap-3">
                    {champTeam ? <TeamLogo team={champTeam} size={44} /> : <Avatar name={champ.name} src={champ.avatarUrl} size={44} />}
                    <div className="min-w-0">
                      <div className="truncate font-display text-lg font-bold leading-tight">{s.champion.teamName || champTeam?.name}</div>
                      <div className="truncate text-sm text-muted">
                        {champ.userId ? (
                          <Link href={`/managers/${champ.userId}`} className="hover:underline">
                            {champ.name}
                          </Link>
                        ) : (
                          champ.name
                        )}
                      </div>
                    </div>
                  </div>
                ) : s.inProgress && leader ? (
                  <div className="mt-2 text-sm">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Current leader</div>
                    <div className="mt-1 flex items-center gap-2">
                      <TeamLogo team={leader.team} size={32} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{leader.team.name}</div>
                        <div className="text-xs text-muted">
                          {fmtRecord(leader.wins, leader.losses, leader.ties)} · {fmtPts(leader.pointsFor, 1)} PF
                        </div>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted">{finalWeek ? `${/^the\s/i.test(trophy) ? trophy : `The ${trophy}`} is decided in Week ${finalWeek}.` : "No playoffs are configured for this season."}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">Results for this season weren&apos;t archived.</p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-2 text-xs">
                  <div>
                    <dt className="text-muted">Runner-up</dt>
                    <dd className="truncate font-semibold">{s.runnerUp ? s.runnerUp.teamName || teamOf(s.runnerUp.teamId)?.name : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{s.inProgress ? "1st place now" : "Top seed"}</dt>
                    <dd className="truncate font-semibold">{s.topSeed ? `${s.topSeed.teamName} (${fmtRecord(s.topSeed.wins, s.topSeed.losses, s.topSeed.ties)})` : "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted">High score</dt>
                    <dd className="truncate font-semibold">{s.highScore ? `${fmtPts(s.highScore.pf)} · ${teamOf(s.highScore.teamId)?.name ?? who(s.highScore.ownerKey).name} (${gameWeekLabel(s.highScore)})` : "—"}</dd>
                  </div>
                </dl>
                <Link href={`/history?season=${s.season}#seasons`} className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  {s.inProgress ? `${s.season} standings` : `${s.season} final standings`} →
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── Trophy case ── */}
      <section id="trophies" className="mb-5 scroll-mt-14">
        <Panel title="Trophy case" subtitle={`${trophy} titles, runner-up finishes, regular-season crowns and weekly high scores`}>
          {trophyRows.length === 0 ? (
            <EmptyState title="The trophy case is empty">Trophies appear once the first games are final.</EmptyState>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {trophyRows.map((r) => {
                const m = who(r.key);
                return (
                  <div key={r.key} className="flex items-center gap-3 rounded-lg border border-line p-2.5">
                    <ManagerChip m={m} size={36} className="flex-1" />
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {r.titles > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-gold-300/30 px-1.5 py-0.5 text-xs font-bold text-gold-700 dark:text-gold-300" title={`${r.titles} × ${trophy}`}>
                          <Trophy size={13} /> {r.titles}
                        </span>
                      )}
                      {r.runnerUps > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-100" title={`${r.runnerUps} runner-up finish${r.runnerUps === 1 ? "" : "es"}`}>
                          <Medal size={13} /> {r.runnerUps}
                        </span>
                      )}
                      {r.regularSeasonTitles > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-brand-50 px-1.5 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200" title={`${r.regularSeasonTitles} regular-season title${r.regularSeasonTitles === 1 ? "" : "s"}`}>
                          <Crown size={13} /> {r.regularSeasonTitles}
                        </span>
                      )}
                      {r.weeklyTops > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-200" title={`Top score of the week ${r.weeklyTops} time${r.weeklyTops === 1 ? "" : "s"}`}>
                          <Flame size={13} /> {r.weeklyTops}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              <Trophy size={11} /> {trophy}
            </span>
            <span className="inline-flex items-center gap-1">
              <Medal size={11} /> Runner-up
            </span>
            <span className="inline-flex items-center gap-1">
              <Crown size={11} /> Regular-season #1 (completed seasons)
            </span>
            <span className="inline-flex items-center gap-1">
              <Flame size={11} /> Weekly high score
            </span>
          </p>
        </Panel>
      </section>

      {/* ── All-time standings ── */}
      <section id="all-time" className="mb-5 scroll-mt-14">
        <Panel title="All-time standings" subtitle="Regular season by manager, every season (current season included)" noPad>
          {allTime.length === 0 ? (
            <p className="p-3 text-sm text-muted">No seasons played yet.</p>
          ) : (
            <div className={cn("overflow-x-auto", allTime.length > 16 && "max-h-[75vh] overflow-y-auto")}>
              <table className="tbl w-full min-w-[820px]">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-8 !text-center">#</th>
                    <th className="text-left">Manager</th>
                    <th className="num">Seasons</th>
                    <th className="num">W-L-T</th>
                    <th className="num">Win %</th>
                    <th className="num">PF</th>
                    <th className="num">PA</th>
                    <th className="num">Avg</th>
                    <th className="num">Playoffs</th>
                    <th className="num">Playoff W-L</th>
                    <th className="num">Titles</th>
                    <th className="num">Best</th>
                  </tr>
                </thead>
                <tbody>
                  {allTime.map((r, i) => {
                    const m = who(r.key);
                    return (
                      <tr key={r.key} className={cn(m.userId === ctx.user.id && "bg-brand-50/60 dark:bg-brand-900/20")}>
                        <td className="text-center font-semibold text-muted">{i + 1}</td>
                        <td>
                          <ManagerChip m={m} size={26} />
                          {!m.isMember && <Badge className="ml-8 mt-0.5">Former</Badge>}
                        </td>
                        <td className="text-right tabular-nums">{r.seasons}</td>
                        <td className="text-right font-semibold tabular-nums">{fmtRecord(r.wins, r.losses, r.ties)}</td>
                        <td className="text-right tabular-nums">{pct3(r.pct)}</td>
                        <td className="text-right tabular-nums">{fmtPts(r.pf, 1)}</td>
                        <td className="text-right tabular-nums">{fmtPts(r.pa, 1)}</td>
                        <td className="text-right tabular-nums">{fmtPts(r.avgPf, 1)}</td>
                        <td className="text-right tabular-nums">{r.playoffApps}</td>
                        <td className="text-right tabular-nums">{r.playoffWins + r.playoffLosses ? `${r.playoffWins}-${r.playoffLosses}` : "—"}</td>
                        <td className="text-right font-bold tabular-nums">{r.titles ? <span className="inline-flex items-center gap-0.5 text-gold-600 dark:text-gold-400"><Trophy size={12} /> {r.titles}</span> : "0"}</td>
                        <td className="text-right tabular-nums">{r.bestFinish ? ordinal(r.bestFinish) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>

      {/* ── Records ── */}
      <section id="records" className="mb-5 scroll-mt-14">
        <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wide">Records book</h2>
        {!anyGames ? (
          <EmptyState title="No completed games yet">Records are set as soon as the first matchups go final.</EmptyState>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <RecordList title="Highest single-week score" rows={book.highest} />
            <RecordList title="Lowest single-week score" rows={book.lowest} />
            <RecordList title="Biggest blowouts" rows={book.blowouts} unit="margin" />
            <RecordList title="Closest games" rows={book.closest} unit="margin" />
            <RecordList title="Highest combined score" rows={book.highestCombined} unit="total" />
            <Panel title="Longest streaks" noPad>
              {streaks.length === 0 ? (
                <p className="p-3 text-sm text-muted">No streaks yet.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {[...streaks.filter((s) => s.kind === "W").slice(0, 4), ...streaks.filter((s) => s.kind === "L").slice(0, 2)].map((s) => {
                    const m = who(s.owner);
                    return (
                      <li key={`${s.owner}-${s.kind}`} className="flex items-center gap-2.5 px-3 py-2">
                        <span className={cn("inline-flex h-6 w-8 shrink-0 items-center justify-center rounded text-[11px] font-extrabold text-white", s.kind === "W" ? "bg-win" : "bg-loss")}>
                          {s.kind}
                          {s.length}
                        </span>
                        <div className="min-w-0 flex-1">
                          <ManagerChip m={m} size={22} showTeam={false} />
                          <div className="truncate pl-[30px] text-[11px] text-muted">
                            {s.kind === "W" ? "Wins" : "Losses"}: {s.from.season} {gameWeekLabel(s.from)} → {s.to.season} {gameWeekLabel(s.to)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel>
            {[
              { title: "Most points in a season", rows: seasonRecs.most },
              { title: "Fewest points in a season", rows: seasonRecs.fewest },
              { title: "Best regular-season record", rows: seasonRecs.bestRecord },
            ].map((block) => (
              <Panel key={block.title} title={block.title} noPad>
                <ol className="divide-y divide-line">
                  {block.rows.map((r, i) => {
                    const m = who(r.ownerKey);
                    const inProgress = r.season === ctx.season && !history.teamSeasons.some((t) => t.season === r.season);
                    return (
                      <li key={`${r.ownerKey}-${r.season}`} className={cn("flex items-center gap-2.5 px-3 py-2", i === 0 && "bg-gold-300/10")}>
                        <span className={cn("w-5 shrink-0 text-center font-display text-sm font-bold", i === 0 ? "text-gold-600 dark:text-gold-400" : "text-muted")}>{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <ManagerChip m={{ ...m, team: teamOf(r.teamId) ?? m.team }} size={24} showTeam={false} />
                          <div className="truncate pl-8 text-[11px] text-muted">
                            {r.season} · {r.teamName}
                            {inProgress ? " · in progress" : ""}
                          </div>
                        </div>
                        <span className="shrink-0 text-right font-display text-lg font-bold tabular-nums">{block.title.includes("record") ? fmtRecord(r.wins, r.losses, r.ties) : fmtPts(r.pointsFor, 1)}</span>
                      </li>
                    );
                  })}
                </ol>
              </Panel>
            ))}
          </div>
        )}
      </section>

      {/* ── Season archive ── */}
      <section id="seasons" className="scroll-mt-14">
        <Panel
          title={isLive ? `${seasonSel} standings` : `${seasonSel} final standings`}
          subtitle={isLive ? "Season in progress — live regular-season standings" : selSummary?.champion ? `${trophy}: ${selSummary.champion.teamName}` : undefined}
          noPad
          actions={
            history.seasons.length > 1 ? (
              <nav aria-label="Seasons" className="flex flex-wrap gap-1">
                {history.seasons.map((s) => (
                  <Link key={s} href={`/history?season=${s}#seasons`} className={cn("rounded px-2 py-0.5 text-xs font-bold", s === seasonSel ? "bg-brand-700 text-white" : "text-muted hover:bg-sunken hover:text-ink")}>
                    {s}
                  </Link>
                ))}
              </nav>
            ) : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="tbl w-full min-w-[640px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-10 !text-center">{isLive ? "Rank" : "Finish"}</th>
                  <th className="text-left">Team</th>
                  <th className="num">W-L-T</th>
                  <th className="num">PF</th>
                  <th className="num">PA</th>
                  <th className="num">{isLive ? "Streak" : "Reg. season"}</th>
                  <th className="text-left">Result</th>
                </tr>
              </thead>
              <tbody>
                {isLive
                  ? standings.map((r) => {
                      const m = who(history.ownerOf(r.team.id, ctx.season) ?? `team:${r.team.id}`);
                      const inBracket = bracket.has(r.team.id);
                      return (
                        <tr key={r.team.id}>
                          <td className="text-center font-display font-bold">{r.rank}</td>
                          <td>
                            <Link href={`/teams/${r.team.id}`} className="flex items-center gap-2 hover:underline">
                              <TeamLogo team={r.team} size={24} />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{r.team.name}</span>
                                <span className="block truncate text-[11px] text-muted">{m.name}</span>
                              </span>
                            </Link>
                          </td>
                          <td className="text-right font-semibold tabular-nums">{fmtRecord(r.wins, r.losses, r.ties)}</td>
                          <td className="text-right tabular-nums">{fmtPts(r.pointsFor, 1)}</td>
                          <td className="text-right tabular-nums">{fmtPts(r.pointsAgainst, 1)}</td>
                          <td className="text-right tabular-nums">{r.streak || "—"}</td>
                          <td>{inBracket ? <Badge tone="green">Playoffs</Badge> : <span className="text-xs text-muted">In progress</span>}</td>
                        </tr>
                      );
                    })
                  : archived.map((t) => {
                      const m = who(t.ownerId ?? history.ownerOf(t.teamId, t.season) ?? `team:${t.teamId}`);
                      const team = teamOf(t.teamId);
                      return (
                        <tr key={t.id} className={cn(t.champion && "bg-gold-300/15")}>
                          <td className="text-center font-display font-bold">{t.finalRank ? ordinal(t.finalRank) : "—"}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              {team ? <TeamLogo team={team} size={24} /> : <Avatar name={t.teamName} size={24} />}
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{t.teamName}</span>
                                <span className="block truncate text-[11px] text-muted">{m.name}</span>
                              </span>
                            </div>
                          </td>
                          <td className="text-right font-semibold tabular-nums">{fmtRecord(t.wins, t.losses, t.ties)}</td>
                          <td className="text-right tabular-nums">{fmtPts(t.pointsFor, 1)}</td>
                          <td className="text-right tabular-nums">{fmtPts(t.pointsAgainst, 1)}</td>
                          <td className="text-right tabular-nums">{t.regularSeasonRank ? ordinal(t.regularSeasonRank) : "—"}</td>
                          <td>
                            {t.champion ? (
                              <Badge tone="gold">
                                <Trophy size={10} /> Champion
                              </Badge>
                            ) : t.runnerUp ? (
                              <Badge>Runner-up</Badge>
                            ) : t.madePlayoffs ? (
                              <Badge tone="green">Playoffs</Badge>
                            ) : (
                              <span className="text-xs text-muted">—</span>
                            )}
                            {t.notes && <span className="ml-1 text-[11px] text-muted">{t.notes}</span>}
                          </td>
                        </tr>
                      );
                    })}
                {!isLive && archived.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-sm text-muted">
                      Final standings for {seasonSel} weren&apos;t archived.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </div>
  );
}
