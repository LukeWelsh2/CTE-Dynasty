// /history — League history & records. Main question: "Who has won, and what are the league's records?"
// Summary: seasons · games · record high score · latest champion. Three views (segmented): Overview (champions by
// season, trophy case, all-time standings), Records (the records book, top 3 each + more) and Seasons (final or live
// standings for one season). Phones get lists with tap-to-expand rows; md+ keep the full tables.
import type { Metadata } from "next";
import Link from "next/link";
import { Crown, Flame, Medal, Trophy } from "lucide-react";
import { getLeagueContext } from "@/lib/league";
import { currentPlayoffTeams, identityFor, loadLeagueHistory, loadStandings, seasonFinishes } from "@/lib/stats/load";
import { gameWeekLabel, recordsBook, seasonPointRecords, streakRecords, type GameRow } from "@/lib/stats/manager-stats";
import { allTimeStandings, seasonSummaries, seasonTotals, weeklyTopScores } from "@/lib/stats/history";
import { playoffEndWeek } from "@/lib/commissioner/settings-validate";
import { playoffSchedule } from "@/lib/playoffs/structure";
import { Avatar, Badge, EmptyState, ListRow, MoreLink, PageHeader, Panel, SegmentedLinks, StatGrid, SummaryStrip, TeamLogo } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { ExpandRow, LeagueTabs, ManagerChip, fmtRecord, pct3 } from "@/components/community/bits";
import { cn, fmtPts, ordinal } from "@/lib/utils";

export const metadata: Metadata = { title: "History & Records" };
export const dynamic = "force-dynamic";

type View = "overview" | "records" | "seasons";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ season?: string; view?: string }> }) {
  const sp = await searchParams;
  const view: View = sp.view === "records" ? "records" : sp.view === "seasons" || sp.season ? "seasons" : "overview";
  const ctx = await getLeagueContext();
  const [history, standings] = await Promise.all([loadLeagueHistory(ctx.league.id, ctx.season), loadStandings(ctx.league.id, ctx.season, ctx.settings)]);
  const finishes = seasonFinishes(history, standings, ctx.season, currentPlayoffTeams(history, ctx.season));
  const trophy = ctx.settings.general.championTrophyName || "Championship";
  // a season has a champion only once every week of its final is played: the final round's real length
  // (weeksPerRound + championshipWeeks − 1 — a 2-week round with a 2-week championship is a 3-week final)
  const finalRoundWeeks = playoffSchedule(ctx.settings).roundWeeks.at(-1)?.length ?? ctx.settings.playoffs.championshipWeeks;
  const summaries = seasonSummaries(finishes, history.games, history.seasons, finalRoundWeeks);
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

  const seasonSel = history.seasons.includes(Number(sp.season)) ? Number(sp.season) : (history.seasons[0] ?? ctx.season);
  const archived = history.teamSeasons.filter((t) => t.season === seasonSel).sort((a, b) => (a.finalRank ?? a.regularSeasonRank ?? 99) - (b.finalRank ?? b.regularSeasonRank ?? 99));
  const isLive = seasonSel === ctx.season && !archived.length;
  const selSummary = summaries.find((s) => s.season === seasonSel);
  const anyGames = history.games.length > 0;
  const bracket = currentPlayoffTeams(history, ctx.season);
  const est = history.seasons.length ? Math.min(...history.seasons) : ctx.season;
  const lastChamp = summaries.find((s) => s.champion);
  const lastChampTeam = lastChamp?.champion ? teamOf(lastChamp.champion.teamId) : null;
  const high = book.highest[0];
  const myKey = [...history.managers.entries()].find(([, m]) => m.userId === ctx.user.id)?.[0];

  const gameMeta = (g: GameRow) => {
    const opp = teamOf(g.oppTeamId);
    return `${g.season} · ${gameWeekLabel(g)}${opp ? ` vs ${opp.name}` : ""}${g.isChampionship ? " · Final" : g.isPlayoff ? (g.isConsolation ? " · Consolation" : " · Playoffs") : ""}`;
  };

  const RankNum = ({ n }: { n: number }) => <span className={cn("numeral w-5 shrink-0 text-center text-[15px] font-semibold sm:text-sm", n === 1 ? "text-ink" : "text-muted")}>{n}</span>;

  const RecordList = ({ title, rows, unit = "pts", empty }: { title: string; rows: { game: GameRow; value: number }[]; unit?: string; empty?: string }) => (
    <Panel title={title} noPad>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">{empty ?? "No completed games yet."}</p>
      ) : (
        <div className="border-t border-line/70">
          <ShowMore as="ol" initial={3} className="divide-y divide-line/70">
            {rows.map((r, i) => {
              const m = who(r.game.ownerKey);
              return (
                <li key={`${r.game.matchupId}-${r.game.teamId}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                  <RankNum n={i + 1} />
                  <Avatar name={m.name} src={m.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    {m.userId ? (
                      <Link href={`/managers/${m.userId}`} className="block truncate text-[15px] font-semibold leading-5 hover:underline sm:text-sm" title={m.name}>
                        {m.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-[15px] font-semibold leading-5 sm:text-sm">{m.name}</span>
                    )}
                    <span className="block truncate text-[13px] leading-[18px] text-muted" title={gameMeta(r.game)}>
                      {gameMeta(r.game)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="numeral block text-[15px] font-semibold leading-5">{fmtPts(r.value)}</span>
                    <span className="block text-[12px] leading-4 text-muted">{unit}</span>
                  </span>
                </li>
              );
            })}
          </ShowMore>
        </div>
      )}
    </Panel>
  );

  const trophyLegend = (
    <ul className="space-y-2">
      <li className="flex items-center gap-2">
        <Trophy size={15} className="text-gold-700 dark:text-gold-400" /> {trophy} title
      </li>
      <li className="flex items-center gap-2">
        <Medal size={15} className="text-muted" /> Runner-up
      </li>
      <li className="flex items-center gap-2">
        <Crown size={15} className="text-brand-600 dark:text-brand-400" /> Regular-season #1 (completed seasons)
      </li>
      <li className="flex items-center gap-2">
        <Flame size={15} className="text-loss" /> Weekly high score
      </li>
    </ul>
  );

  return (
    <div>
      <LeagueTabs active="history" />
      <PageHeader kicker={`${ctx.league.name} · est. ${est}`} title="History & records" />

      <SummaryStrip
        items={[
          { label: "Seasons", value: String(history.seasons.length), sub: `${history.managers.size} GMs`, title: `${history.managers.size} managers all-time` },
          { label: "Games", value: String(history.completedGames), sub: "final" },
          {
            label: "Record",
            value: high ? fmtPts(high.value, 1) : "—",
            sub: high ? (teamOf(high.game.teamId)?.abbrev ?? who(high.game.ownerKey).name) : undefined,
            title: high ? `${fmtPts(high.value)} · ${who(high.game.ownerKey).name} · ${gameMeta(high.game)}` : undefined,
            href: "/history?view=records",
          },
          {
            label: "Champ",
            value: lastChampTeam?.abbrev ?? (lastChamp?.champion ? lastChamp.champion.teamName : "TBD"),
            sub: lastChamp ? String(lastChamp.season) : finalWeek ? `Wk ${finalWeek}` : undefined,
            title: lastChamp?.champion ? `${lastChamp.season} ${trophy}: ${lastChamp.champion.teamName}` : undefined,
          },
        ]}
      />

      <SegmentedLinks
        full
        className="my-4 sm:max-w-md"
        ariaLabel="History view"
        active={view}
        options={[
          { key: "overview", label: "Overview", href: "/history" },
          { key: "records", label: "Records", href: "/history?view=records" },
          { key: "seasons", label: "Seasons", href: "/history?view=seasons" },
        ]}
      />

      {view === "overview" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {/* ── Champions ── */}
            <Panel title="Champions" subtitle={`${trophy} winners by season`} noPad>
              <ul className="divide-y divide-line/70 border-t border-line/70">
                {summaries.map((s) => {
                  const champ = s.champion ? who(s.champion.key) : null;
                  const champTeam = s.champion ? teamOf(s.champion.teamId) : null;
                  const leader = s.inProgress ? standings[0] : null;
                  return (
                    <ExpandRow
                      key={s.season}
                      summary={
                        <>
                          <span className="numeral w-12 shrink-0 text-[15px] font-semibold sm:text-sm">{s.season}</span>
                          {champ && s.champion ? (
                            <>
                              {champTeam ? <TeamLogo team={champTeam} size={36} round /> : <Avatar name={champ.name} src={champ.avatarUrl} size={36} />}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold leading-5 sm:text-sm">{s.champion.teamName || champTeam?.name}</span>
                                <span className="block truncate text-[13px] leading-[18px] text-muted">{champ.name}</span>
                              </span>
                              <Trophy size={20} className="shrink-0 text-gold-700 dark:text-gold-400" aria-label={trophy} />
                            </>
                          ) : s.inProgress && leader ? (
                            <>
                              <TeamLogo team={leader.team} size={36} round />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-semibold leading-5 sm:text-sm">{leader.team.name}</span>
                                <span className="numeral block truncate text-[13px] leading-[18px] text-muted">
                                  Leader · {fmtRecord(leader.wins, leader.losses, leader.ties)} · {fmtPts(leader.pointsFor, 1)} PF
                                </span>
                              </span>
                            </>
                          ) : (
                            <span className="min-w-0 flex-1 text-[15px] text-muted sm:text-sm">Not archived</span>
                          )}
                        </>
                      }
                    >
                      <StatGrid
                        cols={3}
                        items={[
                          { label: "Runner-up", value: <span className="block truncate text-[15px]">{s.runnerUp ? s.runnerUp.teamName || teamOf(s.runnerUp.teamId)?.name : "—"}</span> },
                          {
                            label: s.inProgress ? "1st now" : "Top seed",
                            value: <span className="block truncate text-[15px]">{s.topSeed ? s.topSeed.teamName : "—"}</span>,
                            sub: s.topSeed ? fmtRecord(s.topSeed.wins, s.topSeed.losses, s.topSeed.ties) : undefined,
                          },
                          {
                            label: "Record",
                            value: s.highScore ? fmtPts(s.highScore.pf) : "—",
                            sub: s.highScore ? `${teamOf(s.highScore.teamId)?.abbrev ?? who(s.highScore.ownerKey).name} · ${gameWeekLabel(s.highScore)}` : undefined,
                          },
                        ]}
                      />
                      {s.inProgress && (
                        <p className="mt-2 text-[13px] text-muted">
                          {finalWeek ? `${/^the\s/i.test(trophy) ? trophy : `The ${trophy}`} is decided in Week ${finalWeek}.` : "No playoffs are configured for this season."}
                        </p>
                      )}
                      <div className="mt-2">
                        <MoreLink href={`/history?view=seasons&season=${s.season}`}>{s.inProgress ? `${s.season} standings` : `${s.season} final standings`}</MoreLink>
                      </div>
                    </ExpandRow>
                  );
                })}
              </ul>
            </Panel>

            {/* ── All-time standings ── */}
            <Panel title="All-time standings" subtitle="Regular season, every season" noPad>
              {allTime.length === 0 ? (
                <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No seasons played yet.</p>
              ) : (
                <>
                  {/* phones: rank · manager · record; tap for the rest */}
                  <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
                    {allTime.map((r, i) => {
                      const m = who(r.key);
                      return (
                        <ExpandRow
                          key={r.key}
                          mine={r.key === myKey}
                          summary={
                            <>
                              <RankNum n={i + 1} />
                              <Avatar name={m.name} src={m.avatarUrl} size={32} />
                              <span className="min-w-0 flex-1">
                                <span className={cn("block truncate text-[15px] font-semibold leading-5", r.key === myKey ? "text-brand-600 dark:text-brand-400" : "text-ink")}>
                                  {m.name}
                                  {r.titles > 0 && (
                                    <span className="ml-1.5 inline-flex items-center gap-0.5 align-[-2px] text-[13px] text-gold-700 dark:text-gold-400">
                                      <Trophy size={13} aria-label={`${r.titles} × ${trophy}`} />
                                      {r.titles}
                                    </span>
                                  )}
                                </span>
                                <span className="block truncate text-[13px] leading-[18px] text-muted">{m.isMember ? (m.team?.name ?? "—") : "Former manager"}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="numeral block text-[15px] font-semibold leading-5">{fmtRecord(r.wins, r.losses, r.ties)}</span>
                                <span className="numeral block text-[12px] leading-4 text-muted">{pct3(r.pct)}</span>
                              </span>
                            </>
                          }
                        >
                          <StatGrid
                            cols={3}
                            items={[
                              { label: "Seasons", value: String(r.seasons) },
                              { label: "PF", value: fmtPts(r.pf, 1) },
                              { label: "PA", value: fmtPts(r.pa, 1) },
                              { label: "Avg", value: fmtPts(r.avgPf, 1) },
                              { label: "Playoffs", value: String(r.playoffApps), sub: r.playoffWins + r.playoffLosses ? `${r.playoffWins}-${r.playoffLosses} W-L` : undefined },
                              { label: "Best", value: r.bestFinish ? ordinal(r.bestFinish) : "—", sub: `${r.titles} title${r.titles === 1 ? "" : "s"}` },
                            ]}
                          />
                          {m.userId && (
                            <div className="mt-2">
                              <MoreLink href={`/managers/${m.userId}`}>Profile</MoreLink>
                            </div>
                          )}
                        </ExpandRow>
                      );
                    })}
                  </ul>
                  {/* md+: the full table */}
                  <div className={cn("hidden overflow-x-auto md:block", allTime.length > 16 && "max-h-[75vh] overflow-y-auto")}>
                    <table className="tbl w-full">
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
                            <tr key={r.key} className={cn(r.key === myKey && "row-mine")}>
                              <td className="text-center font-semibold text-muted">{i + 1}</td>
                              <td className="min-w-[180px]">
                                <ManagerChip m={m} size={26} />
                                {!m.isMember && <Badge className="ml-8 mt-0.5">Former</Badge>}
                              </td>
                              <td className="num">{r.seasons}</td>
                              <td className="num font-semibold">{fmtRecord(r.wins, r.losses, r.ties)}</td>
                              <td className="num">{pct3(r.pct)}</td>
                              <td className="num">{fmtPts(r.pf, 1)}</td>
                              <td className="num">{fmtPts(r.pa, 1)}</td>
                              <td className="num">{fmtPts(r.avgPf, 1)}</td>
                              <td className="num">{r.playoffApps}</td>
                              <td className="num">{r.playoffWins + r.playoffLosses ? `${r.playoffWins}-${r.playoffLosses}` : "—"}</td>
                              <td className="num font-semibold">
                                {r.titles ? (
                                  <span className="inline-flex items-center gap-0.5 text-gold-700 dark:text-gold-400">
                                    <Trophy size={12} /> {r.titles}
                                  </span>
                                ) : (
                                  "0"
                                )}
                              </td>
                              <td className="num">{r.bestFinish ? ordinal(r.bestFinish) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Panel>
          </div>

          <aside className="min-w-0 space-y-4">
            {/* ── Trophy case ── */}
            <Panel title="Trophy case" info={trophyLegend} infoTitle="Trophy case" noPad>
              {trophyRows.length === 0 ? (
                <div className="px-4 pb-4">
                  <EmptyState title="The trophy case is empty">Trophies appear once the first games are final.</EmptyState>
                </div>
              ) : (
                <div className="border-t border-line/70">
                  <ShowMore as="ul" initial={5} className="divide-y divide-line/70">
                    {trophyRows.map((r) => {
                      const m = who(r.key);
                      return (
                        <li key={r.key} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                          <ManagerChip m={m} size={32} className="min-w-0 flex-1 text-[15px] sm:text-sm" />
                          <span className="numeral flex shrink-0 items-center gap-2.5 text-[15px] font-semibold sm:text-sm">
                            {r.titles > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-gold-700 dark:text-gold-400" title={`${r.titles} × ${trophy}`}>
                                <Trophy size={15} aria-hidden /> {r.titles}
                              </span>
                            )}
                            {r.runnerUps > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-muted" title={`${r.runnerUps} runner-up finish${r.runnerUps === 1 ? "" : "es"}`}>
                                <Medal size={15} aria-hidden /> {r.runnerUps}
                              </span>
                            )}
                            {r.regularSeasonTitles > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-brand-600 dark:text-brand-400" title={`${r.regularSeasonTitles} regular-season title${r.regularSeasonTitles === 1 ? "" : "s"}`}>
                                <Crown size={15} aria-hidden /> {r.regularSeasonTitles}
                              </span>
                            )}
                            {r.weeklyTops > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-loss" title={`Top score of the week ${r.weeklyTops} time${r.weeklyTops === 1 ? "" : "s"}`}>
                                <Flame size={15} aria-hidden /> {r.weeklyTops}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ShowMore>
                </div>
              )}
            </Panel>

            <Panel title="More history" noPad>
              <ul className="divide-y divide-line/70 border-t border-line/70">
                <ListRow href="/trades/history" title="Trade history" chevron />
                <ListRow href="/draft/results" title="Draft history" chevron />
                <ListRow href="/recaps" title="Weekly recaps" chevron />
              </ul>
            </Panel>
          </aside>
        </div>
      )}

      {view === "records" &&
        (!anyGames ? (
          <EmptyState title="No completed games yet">Records are set as soon as the first matchups go final.</EmptyState>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <RecordList title="Highest score" rows={book.highest} />
            <RecordList title="Lowest score" rows={book.lowest} />
            <RecordList title="Biggest blowouts" rows={book.blowouts} unit="margin" />
            <RecordList title="Closest games" rows={book.closest} unit="margin" />
            <RecordList title="Highest combined" rows={book.highestCombined} unit="total" />
            <Panel title="Longest streaks" noPad>
              {streaks.length === 0 ? (
                <p className="px-4 pb-4 text-[15px] text-muted sm:text-sm">No streaks yet.</p>
              ) : (
                <div className="border-t border-line/70">
                  <ShowMore as="ol" initial={3} className="divide-y divide-line/70">
                    {[...streaks.filter((s) => s.kind === "W").slice(0, 4), ...streaks.filter((s) => s.kind === "L").slice(0, 2)].map((s) => {
                      const m = who(s.owner);
                      const span = `${s.from.season} ${gameWeekLabel(s.from)} → ${s.to.season} ${gameWeekLabel(s.to)}`;
                      return (
                        <li key={`${s.owner}-${s.kind}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                          <span
                            className={cn(
                              "numeral inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-[6px] px-1 text-[13px] font-bold text-white",
                              s.kind === "W" ? "bg-green-700 dark:bg-green-600" : "bg-[rgb(208_31_43)]",
                            )}
                          >
                            {s.kind}
                            {s.length}
                          </span>
                          <span className="min-w-0 flex-1">
                            {m.userId ? (
                              <Link href={`/managers/${m.userId}`} className="block truncate text-[15px] font-semibold leading-5 hover:underline sm:text-sm">
                                {m.name}
                              </Link>
                            ) : (
                              <span className="block truncate text-[15px] font-semibold leading-5 sm:text-sm">{m.name}</span>
                            )}
                            <span className="block truncate text-[13px] leading-[18px] text-muted" title={span}>
                              {s.kind === "W" ? "Wins" : "Losses"} · {span}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ShowMore>
                </div>
              )}
            </Panel>
            {[
              { title: "Most points in a season", rows: seasonRecs.most },
              { title: "Fewest points in a season", rows: seasonRecs.fewest },
              { title: "Best regular season", rows: seasonRecs.bestRecord },
            ].map((block) => (
              <Panel key={block.title} title={block.title} noPad>
                <div className="border-t border-line/70">
                  <ShowMore as="ol" initial={3} className="divide-y divide-line/70">
                    {block.rows.map((r, i) => {
                      const m = who(r.ownerKey);
                      const inProgress = r.season === ctx.season && !history.teamSeasons.some((t) => t.season === r.season);
                      return (
                        <li key={`${r.ownerKey}-${r.season}`} className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                          <RankNum n={i + 1} />
                          <Avatar name={m.name} src={m.avatarUrl} size={28} />
                          <span className="min-w-0 flex-1">
                            {m.userId ? (
                              <Link href={`/managers/${m.userId}`} className="block truncate text-[15px] font-semibold leading-5 hover:underline sm:text-sm">
                                {m.name}
                              </Link>
                            ) : (
                              <span className="block truncate text-[15px] font-semibold leading-5 sm:text-sm">{m.name}</span>
                            )}
                            <span className="block truncate text-[13px] leading-[18px] text-muted">
                              {r.season} · {r.teamName}
                              {inProgress ? " · in progress" : ""}
                            </span>
                          </span>
                          <span className="numeral shrink-0 text-right text-[15px] font-semibold">{block.title.includes("regular") ? fmtRecord(r.wins, r.losses, r.ties) : fmtPts(r.pointsFor, 1)}</span>
                        </li>
                      );
                    })}
                  </ShowMore>
                </div>
              </Panel>
            ))}
          </div>
        ))}

      {view === "seasons" && (
        <>
          {history.seasons.length > 1 && (
            <SegmentedLinks
              className="mb-4"
              ariaLabel="Season"
              active={String(seasonSel)}
              options={history.seasons.map((s) => ({ key: String(s), label: String(s), href: `/history?view=seasons&season=${s}` }))}
            />
          )}
          <Panel
            title={isLive ? `${seasonSel} standings` : `${seasonSel} final standings`}
            subtitle={isLive ? "Season in progress" : selSummary?.champion ? `${trophy}: ${selSummary.champion.teamName}` : undefined}
            noPad
            actions={isLive ? <MoreLink href="/standings">Standings</MoreLink> : undefined}
          >
            {/* phones */}
            <ul className="divide-y divide-line/70 border-t border-line/70 md:hidden">
              {isLive
                ? standings.map((r) => {
                    const m = who(history.ownerOf(r.team.id, ctx.season) ?? `team:${r.team.id}`);
                    const mine = r.team.id === ctx.myTeam?.id;
                    return (
                      <ExpandRow
                        key={r.team.id}
                        mine={mine}
                        summary={
                          <>
                            <RankNum n={r.rank} />
                            <TeamLogo team={r.team} size={32} round />
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate text-[15px] font-semibold leading-5", mine ? "text-brand-600 dark:text-brand-400" : "text-ink")}>{r.team.name}</span>
                              <span className="block truncate text-[13px] leading-[18px] text-muted">{m.name}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="numeral block text-[15px] font-semibold leading-5">{fmtRecord(r.wins, r.losses, r.ties)}</span>
                              <span className={cn("block text-[12px] leading-4", bracket.has(r.team.id) ? "font-semibold text-win" : "text-muted")}>{bracket.has(r.team.id) ? "Playoffs" : "—"}</span>
                            </span>
                          </>
                        }
                      >
                        <StatGrid
                          cols={3}
                          items={[
                            { label: "PF", value: fmtPts(r.pointsFor, 1) },
                            { label: "PA", value: fmtPts(r.pointsAgainst, 1) },
                            { label: "Streak", value: r.streak || "—" },
                          ]}
                        />
                        <div className="mt-2">
                          <MoreLink href={`/teams/${r.team.id}`}>Team</MoreLink>
                        </div>
                      </ExpandRow>
                    );
                  })
                : archived.map((t) => {
                    const m = who(t.ownerId ?? history.ownerOf(t.teamId, t.season) ?? `team:${t.teamId}`);
                    const team = teamOf(t.teamId);
                    return (
                      <ExpandRow
                        key={t.id}
                        summary={
                          <>
                            <span className="numeral w-8 shrink-0 text-center text-[15px] font-semibold text-muted">{t.finalRank ? ordinal(t.finalRank) : "—"}</span>
                            {team ? <TeamLogo team={team} size={32} round /> : <Avatar name={t.teamName} size={32} />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold leading-5">{t.teamName}</span>
                              <span className="block truncate text-[13px] leading-[18px] text-muted">{m.name}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="numeral block text-[15px] font-semibold leading-5">{fmtRecord(t.wins, t.losses, t.ties)}</span>
                              <span className="block text-[12px] leading-4">
                                {t.champion ? (
                                  <span className="inline-flex items-center gap-0.5 font-semibold text-gold-700 dark:text-gold-400">
                                    <Trophy size={11} aria-hidden /> Champion
                                  </span>
                                ) : t.runnerUp ? (
                                  <span className="text-muted">Runner-up</span>
                                ) : t.madePlayoffs ? (
                                  <span className="font-semibold text-win">Playoffs</span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </span>
                            </span>
                          </>
                        }
                      >
                        <StatGrid
                          cols={3}
                          items={[
                            { label: "PF", value: fmtPts(t.pointsFor, 1) },
                            { label: "PA", value: fmtPts(t.pointsAgainst, 1) },
                            { label: "Reg. season", value: t.regularSeasonRank ? ordinal(t.regularSeasonRank) : "—" },
                          ]}
                        />
                        {t.notes && <p className="mt-2 text-[13px] text-muted">{t.notes}</p>}
                      </ExpandRow>
                    );
                  })}
              {!isLive && archived.length === 0 && <li className="px-4 py-6 text-center text-[15px] text-muted">Final standings for {seasonSel} weren&apos;t archived.</li>}
            </ul>
            {/* md+ */}
            <div className="hidden overflow-x-auto md:block">
              <table className="tbl w-full">
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
                          <tr key={r.team.id} className={cn(r.team.id === ctx.myTeam?.id && "row-mine")}>
                            <td className="text-center font-semibold">{r.rank}</td>
                            <td>
                              <Link href={`/teams/${r.team.id}`} className="flex items-center gap-2 hover:underline">
                                <TeamLogo team={r.team} size={24} />
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold">{r.team.name}</span>
                                  <span className="block truncate text-xs text-muted">{m.name}</span>
                                </span>
                              </Link>
                            </td>
                            <td className="num font-semibold">{fmtRecord(r.wins, r.losses, r.ties)}</td>
                            <td className="num">{fmtPts(r.pointsFor, 1)}</td>
                            <td className="num">{fmtPts(r.pointsAgainst, 1)}</td>
                            <td className="num">{r.streak || "—"}</td>
                            <td>{inBracket ? <Badge tone="green">Playoffs</Badge> : <span className="text-xs text-muted">In progress</span>}</td>
                          </tr>
                        );
                      })
                    : archived.map((t) => {
                        const m = who(t.ownerId ?? history.ownerOf(t.teamId, t.season) ?? `team:${t.teamId}`);
                        const team = teamOf(t.teamId);
                        return (
                          <tr key={t.id}>
                            <td className="text-center font-semibold">{t.finalRank ? ordinal(t.finalRank) : "—"}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                {team ? <TeamLogo team={team} size={24} /> : <Avatar name={t.teamName} size={24} />}
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold">{t.teamName}</span>
                                  <span className="block truncate text-xs text-muted">{m.name}</span>
                                </span>
                              </div>
                            </td>
                            <td className="num font-semibold">{fmtRecord(t.wins, t.losses, t.ties)}</td>
                            <td className="num">{fmtPts(t.pointsFor, 1)}</td>
                            <td className="num">{fmtPts(t.pointsAgainst, 1)}</td>
                            <td className="num">{t.regularSeasonRank ? ordinal(t.regularSeasonRank) : "—"}</td>
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
                              {t.notes && <span className="ml-1 text-xs text-muted">{t.notes}</span>}
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
        </>
      )}
    </div>
  );
}
