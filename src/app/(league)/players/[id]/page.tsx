// Player profile — "How good is this player, and can I get him?" Identity (headshot with NFL badge, name, position
// pill, team, depth), who owns him + the one action (add / claim / drop / trade) and watch, a summary strip (season
// points with position rank, average, last 3, this week's projection), then tabs: Overview (points chart, news,
// injury, season stats, upcoming), Game log, Stats, Projections, News, Transactions. Bio and injury details sit
// behind taps; every table scrolls inside its card with a sticky first column.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { NFL_TEAM_BY_ABBR } from "@/lib/nfl/teams";
import { STAT_BY_KEY, STAT_CATALOG, normalizePosition, type StatGroup } from "@/lib/settings/stat-catalog";
import { Alert, Badge, Collapsible, EmptyState, MoreLink, Panel, StatGrid, SummaryStrip, TabLinks } from "@/components/ui/core";
import { HeadshotBadge, InjuryLetter, PosPill } from "@/components/ui/fantasy";
import { PlayerActionButton, WatchStar } from "@/components/players/player-actions";
import { PointsChart } from "@/components/players/points-chart";
import { GameLogTable } from "@/components/players/game-log-table";
import { NewsCard } from "@/components/players/news-card";
import { Pagination } from "@/components/players/pagination";
import { OwnerTag, PracticeTag } from "@/components/players/tags";
import { fmtCalendarDate, fmtDate, fmtDateTime } from "@/lib/players/format";
import { fmtStat, injuryGroup, normalizeInjuryStatus, practiceFromText, statLabel } from "@/lib/players/logic";
import { playerNews } from "@/lib/players/news";
import { loadPlayerProfile, playerTransactionHistory, type ProfileData } from "@/lib/players/profile";
import { cn, fmtPts, heightDisplay, ordinal, timeAgo } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "gamelog", label: "Game log" },
  { key: "stats", label: "Stats" },
  { key: "projections", label: "Projections" },
  { key: "news", label: "News" },
  { key: "transactions", label: "Transactions" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await db.player.findUnique({ where: { id }, select: { fullName: true } });
  return { title: p?.fullName ?? "Player" };
}

export default async function PlayerProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getLeagueContext();
  const { id } = await params;
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab: TabKey = TABS.some((t) => t.key === tabRaw) ? (tabRaw as TabKey) : "overview";
  const data = await loadPlayerProfile(ctx, id);
  if (!data) notFound();
  const p = data.player;
  const f = data.fantasy;
  const tz = data.timezone;
  const tw = f.thisWeek;
  const twGame = tw.bye ? "BYE" : tw.game ? `${tw.game.label}${tw.game.state === "pre" && tw.game.kickoffLabel ? ` · ${tw.game.kickoffLabel}` : tw.game.state === "in" ? ` · ${tw.game.statusDetail ?? "Live"}` : tw.game.result ? ` · ${tw.game.result}` : ""}` : "No game";

  return (
    <div className="space-y-4">
      <Link href="/players" className="-my-1 inline-flex min-h-8 items-center gap-0.5 text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
        <ChevronLeft size={15} aria-hidden /> Players
      </Link>

      <ProfileHeader data={data} />

      <div>
        <SummaryStrip
          items={[
            {
              label: "Season",
              value: fmtPts(f.seasonPts, 1),
              // "RB5" (the "of 137" is in the title: it doesn't fit a 360px phone's quarter of the strip)
              sub: f.posRank ? `${f.posRank.pos}${f.posRank.rank}` : "pts",
              title: `Season fantasy points (league scoring)${f.posRank ? ` · ${f.posRank.pos}${f.posRank.rank} of ${f.posRank.of}` : ""}`,
            },
            { label: "Avg", value: fmtPts(f.avg, 1), sub: `${f.games} game${f.games === 1 ? "" : "s"}` },
            { label: "Last 3", value: fmtPts(f.last3, 1), sub: "avg" },
            {
              label: `Wk ${tw.week}`,
              value: tw.pts !== null && tw.game && tw.game.state !== "pre" ? fmtPts(tw.pts, 1) : fmtPts(tw.proj, 1),
              sub: tw.pts !== null && tw.game && tw.game.state !== "pre" ? `proj ${fmtPts(tw.proj, 1)}` : "proj",
              tone: tw.game?.state === "in" ? "live" : undefined,
              title: `Week ${tw.week}: ${twGame}`,
            },
          ]}
        />
        {/* the week is the strip's last tile ("Wk 12"), so the line is just the game */}
        <p className="mt-1.5 line-clamp-2 px-1 text-[13px] text-muted" title={`Week ${tw.week}`}>
          <b className="font-semibold text-ink">{twGame}</b>
          {tw.game?.spread ? ` · spread ${tw.game.spread}` : ""}
          {tw.game?.overUnder ? ` · O/U ${tw.game.overUnder}` : ""}
        </p>
      </div>

      <TabLinks tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/players/${p.id}${t.key === "overview" ? "" : `?tab=${t.key}`}` }))} active={tab} className="mb-0" />

      {tab === "overview" && <OverviewTab ctx={ctx} data={data} />}
      {tab === "gamelog" && (
        <Panel title={`${ctx.season} game log`} subtitle="League scoring · tap a score for details" noPad>
          <div className="border-t border-line/70">
            <GameLogTable rows={data.gameLog} columns={data.statColumns} totals={data.totals} games={data.games} />
          </div>
        </Panel>
      )}
      {tab === "stats" && <StatsTab data={data} />}
      {tab === "projections" && <ProjectionsTab data={data} />}
      {tab === "news" && (
        <NewsTab ctx={ctx} playerId={p.id} teamNews={p.position === "DEF" ? p.team : null} page={Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1} tz={tz} />
      )}
      {tab === "transactions" && <TransactionsTab ctx={ctx} playerId={p.id} tz={tz} />}
      {!f.owner && f.action === null && !ctx.myTeam && <p className="text-[13px] text-muted">You don&apos;t manage a team in this league, so roster actions are unavailable.</p>}
    </div>
  );
}

// ───────────────────────────── Header ─────────────────────────────

function ProfileHeader({ data }: { data: ProfileData }) {
  const p = data.player;
  const f = data.fantasy;
  const inj = data.injury;
  const isDef = p.position === "DEF";
  const nflTeam = p.team ? NFL_TEAM_BY_ABBR[p.team] : undefined;
  const exp = p.yearsExp === 0 ? "Rookie" : p.yearsExp !== null ? `${ordinal(p.yearsExp + 1)} season` : "—";
  const practice = p.practiceParticipation ?? practiceFromText(inj.note);
  const bioMeta = isDef ? (nflTeam ? `${nflTeam.conference} ${nflTeam.division}` : undefined) : [p.age ? `Age ${p.age}` : null, p.college].filter(Boolean).join(" · ") || undefined;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-4">
        <HeadshotBadge player={p} nflTeam={p.team} size={80} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[26px] font-bold leading-8 tracking-[-0.02em] text-ink sm:text-[30px] sm:leading-9" title={p.fullName}>
              {p.fullName}
            </h1>
            <InjuryLetter status={inj.status} className="text-[17px]" />
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted">
            <PosPill pos={p.position} />
            {p.number !== null && <span className="font-semibold text-ink">#{p.number}</span>}
            {/* a defense's name is the title already: show its division instead */}
            <span className="truncate">{isDef && nflTeam ? `${nflTeam.conference} ${nflTeam.division}` : p.teamName}</span>
          </div>
          {(p.depthChartPosition && p.depthChartOrder) || (p.status && p.status !== "Active") ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {p.depthChartPosition && p.depthChartOrder && (
                <Badge tone="neutral">
                  Depth {p.depthChartPosition} #{p.depthChartOrder}
                </Badge>
              )}
              {p.status && p.status !== "Active" && <Badge tone="amber">{p.status}</Badge>}
            </div>
          ) : null}
        </div>
      </div>

      {/* who owns him + the one action */}
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          {f.owner ? (
            <>
              <OwnerTag owner={f.owner} full className="text-[15px]" />
              <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">
                <b className="font-semibold text-ink">${f.owner.salary}</b> · {f.owner.contractYears} yr{f.owner.contractYears === 1 ? "" : "s"} (thru {f.owner.thru})
                {f.owner.isRookieContract && " · rookie deal"}
                {f.owner.status !== "ACTIVE" && ` · ${f.owner.status}`} · {f.owner.acquiredVia.replace("_", " ").toLowerCase()} {fmtDate(f.owner.acquiredAt, data.timezone, { year: true })}
              </div>
            </>
          ) : f.waiver ? (
            <>
              <Badge tone="amber">On waivers</Badge>
              <div className="mt-0.5 truncate text-[13px] text-muted">{f.waiver.processAtLabel ? `Claims process ${f.waiver.processAtLabel}` : f.waiver.reason}</div>
            </>
          ) : (
            <>
              <Badge tone="green">Free agent</Badge>
              <div className="mt-0.5 text-[13px] text-muted">Available to add now</div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PlayerActionButton playerId={p.id} playerName={p.fullName} action={f.action} blockedReason={f.blockedReason} pendingClaim={f.pendingClaim} ownerTeamId={f.owner?.teamId} size="sm" className="h-10 px-4 text-sm sm:h-9" />
          <WatchStar playerId={p.id} watched={f.watched} playerName={p.fullName} className="h-10 w-10 rounded-full bg-panel shadow-[inset_0_0_0_1px_rgb(var(--c-line))] sm:h-9 sm:w-9" />
        </div>
        {f.tradeClosedReason && <p className="w-full text-[13px] text-muted">{f.tradeClosedReason}</p>}
      </div>

      {inj.status && (
        <div className="rounded-card bg-red-500/[0.07] px-4 py-3 text-[15px] dark:bg-red-400/10 sm:text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b className="text-loss">{inj.status}</b>
            {inj.bodyPart && <span className="text-ink">{inj.bodyPart}</span>}
            {inj.returnDate && <span className="text-muted">· est. return {fmtCalendarDate(inj.returnDate)}</span>}
            {practice && <PracticeTag value={practice} />}
            {inj.updatedAt && <span className="text-[12px] text-muted">· {timeAgo(inj.updatedAt)}</span>}
          </div>
          {inj.note && <p className="mt-1 line-clamp-3 text-[13px] text-muted">{inj.note}</p>}
          {p.practiceDescription && <p className="mt-1 text-[13px] text-muted">Practice: {p.practiceDescription}</p>}
        </div>
      )}

      <div className="card px-4">
        <Collapsible summary="Bio" meta={bioMeta}>
          {isDef ? (
            <StatGrid
              cols={3}
              items={[
                { label: "Conference", value: nflTeam ? nflTeam.conference : "—" },
                { label: "Division", value: nflTeam ? `${nflTeam.conference} ${nflTeam.division}` : "—" },
                { label: "Bye", value: f.byeWeek ?? "—" },
              ]}
            />
          ) : (
            <StatGrid
              cols={3}
              items={[
                { label: "Age", value: p.age ?? "—", sub: p.birthDate ? fmtCalendarDate(p.birthDate, { year: true }) : undefined },
                { label: "Ht / Wt", value: heightDisplay(p.height), sub: p.weight ? `${p.weight} lbs` : undefined },
                { label: "College", value: <span className="text-[15px]">{p.college ?? "—"}</span> },
                { label: "Experience", value: <span className="text-[15px]">{exp}</span>, sub: p.rookieYear ? `drafted ${p.rookieYear}` : undefined },
                { label: "Bye", value: f.byeWeek ?? "—" },
                { label: "Status", value: <span className="text-[15px]">{p.status ?? "—"}</span> },
              ]}
            />
          )}
        </Collapsible>
      </div>
    </section>
  );
}

// ───────────────────────────── Overview ─────────────────────────────

async function OverviewTab({ ctx, data }: { ctx: Awaited<ReturnType<typeof getLeagueContext>>; data: ProfileData }) {
  const p = data.player;
  const [news, reports] = await Promise.all([
    playerNews(ctx, p.id, 3, 0, { teamNews: p.position === "DEF" ? p.team : null }),
    db.injuryReport.findMany({ where: { playerId: p.id }, orderBy: { reportedAt: "desc" }, take: 3 }),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <Panel title="Fantasy points by week" subtitle={`League scoring · projections through week ${data.rosRange.to}`}>
          {data.chart.some((c) => c.pts !== null || c.proj !== null) ? (
            <PointsChart data={data.chart} currentWeek={ctx.week} />
          ) : (
            <p className="text-[13px] text-muted">No points or projections yet this season.</p>
          )}
        </Panel>
        <Panel title="Latest news" noPad actions={news.total > 3 ? <MoreLink href={`/players/${p.id}?tab=news`}>All {news.total}</MoreLink> : undefined}>
          {news.entries.length ? (
            <div className="divide-y divide-line/70 border-t border-line/70">
              {news.entries.map((e) => (
                <NewsCard key={e.item.id} item={e.item} players={e.players.filter((x) => x.id !== p.id)} tz={data.timezone} compact />
              ))}
            </div>
          ) : (
            <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No news for {p.fullName} yet.</p>
          )}
        </Panel>
      </div>
      <div className="min-w-0 space-y-4">
        {p.position !== "DEF" && (
          <Panel title="Injury report" actions={<MoreLink href={`/players/${p.id}?tab=news`}>History</MoreLink>}>
            {data.injury.status ? (
              <div className="space-y-1 text-[15px] sm:text-sm">
                <div className="flex items-center gap-2">
                  <b className="text-loss">{data.injury.status}</b>
                  {data.injury.bodyPart && <span className="text-muted">· {data.injury.bodyPart}</span>}
                </div>
                {data.injury.returnDate && <p className="text-[13px] text-muted">Estimated return: {fmtCalendarDate(data.injury.returnDate, { year: true })}</p>}
                {data.injury.detail && <p className="text-[13px] leading-5 text-muted">{data.injury.detail}</p>}
              </div>
            ) : (
              <p className="text-[15px] font-semibold text-win sm:text-sm">Healthy · no designation</p>
            )}
            {reports.length > 0 && (
              <ul className="mt-3 divide-y divide-line/70 border-t border-line/70 text-[13px]">
                {reports.map((r) => (
                  <li key={r.id} className="py-2">
                    <span className="font-semibold">{normalizeInjuryStatus(r.status) === "Active" ? "Active" : normalizeInjuryStatus(r.status)}</span>
                    <span className="text-muted"> · {fmtDateTime(r.reportedAt, data.timezone)}</span>
                    {r.shortComment && <p className="text-muted">{r.shortComment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
        <Panel title={`${ctx.season} season`} subtitle={`${data.games} games · ${fmtPts(data.fantasy.seasonPts, 1)} pts`} actions={<MoreLink href={`/players/${p.id}?tab=stats`}>All stats</MoreLink>}>
          {data.seasonLine.length ? (
            <StatGrid cols={3} items={data.seasonLine.map((s) => ({ key: s.key, label: <span title={s.label}>{s.short}</span>, value: fmtStat(s.value) }))} />
          ) : (
            <p className="text-[13px] text-muted">No stats yet.</p>
          )}
        </Panel>
        <Panel title="Upcoming" noPad actions={<MoreLink href={`/players/${p.id}?tab=projections`}>All</MoreLink>}>
          {data.projections.length ? (
            <ul className="divide-y divide-line/70 border-t border-line/70">
              {data.projections.slice(0, 4).map((r) => (
                <li key={r.week} className="flex min-h-11 items-center gap-3 px-4 text-[15px] sm:text-sm">
                  <span className="w-12 shrink-0 font-semibold text-muted">Wk {r.week}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.bye ? <b>BYE</b> : <span className="font-semibold text-ink">{r.opp ?? "—"}</span>}
                    {r.kickoffLabel && <span className="text-[13px] text-muted"> · {r.kickoffLabel}</span>}
                  </span>
                  <span className="numeral shrink-0 font-semibold text-ink">{fmtPts(r.pts, 1)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No remaining games this season.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ───────────────────────────── Stats ─────────────────────────────

const GROUPS_BY_POS: Record<string, StatGroup[]> = {
  QB: ["Passing", "Rushing", "Misc Offense"],
  RB: ["Rushing", "Receiving", "Misc Offense", "Special Teams"],
  WR: ["Receiving", "Rushing", "Misc Offense", "Special Teams"],
  TE: ["Receiving", "Rushing", "Misc Offense"],
  K: ["Kicking"],
  DEF: ["Team Defense", "Special Teams"],
  DL: ["IDP"],
  LB: ["IDP"],
  DB: ["IDP"],
};

function StatsTab({ data }: { data: ProfileData }) {
  const pos = normalizePosition(data.player.position);
  const groups = GROUPS_BY_POS[pos] ?? ["Passing", "Rushing", "Receiving", "Misc Offense"];
  const g = data.games;
  const totalPts = data.gameLog.reduce((a, r) => a + (r.pts ?? 0), 0);
  return (
    <div className="space-y-4">
      <SummaryStrip
        className="sm:max-w-md"
        items={[
          { label: "Fantasy pts", value: fmtPts(totalPts, 1) },
          { label: "Per game", value: g ? fmtPts(totalPts / g, 1) : "—" },
          { label: "Games", value: g },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const stats = STAT_CATALOG.filter((s) => s.group === group && ((data.totals[s.key] ?? 0) !== 0 || s.positions?.includes(pos)));
          return (
            <Panel key={group} title={group} noPad>
              {stats.length ? (
                <table className="tbl border-t border-line/70">
                  <thead>
                    <tr>
                      <th>Stat</th>
                      <th className="num">Total</th>
                      <th className="num">Per game</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s) => {
                      const v = data.totals[s.key] ?? 0;
                      return (
                        <tr key={s.key}>
                          <td>{s.label}</td>
                          <td className="num font-semibold">{fmtStat(v)}</td>
                          <td className="num text-muted">{g ? (v / g).toFixed(1) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">No {group.toLowerCase()} stats recorded.</p>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────────── Projections ─────────────────────────────

function ProjectionsTab({ data }: { data: ProfileData }) {
  const cols = data.statColumns;
  if (!data.projections.length) return <EmptyState title="No remaining projections">The regular season is over for this player.</EmptyState>;
  return (
    <div className="space-y-4">
      <SummaryStrip
        className="sm:max-w-md"
        items={[
          { label: "ROS pts", value: fmtPts(data.rosTotal, 1), sub: `Wk ${data.rosRange.from}–${data.rosRange.to}` },
          { label: "Per week", value: fmtPts(data.rosTotal / Math.max(1, data.projections.filter((r) => r.inFantasySeason && !r.bye).length), 1), sub: "projected" },
          { label: "Byes", value: data.projections.filter((r) => r.inFantasySeason && r.bye).length, sub: "left" },
        ]}
      />
      <Panel title="Rest-of-season projections" subtitle="League scoring · weeks after the fantasy season in grey" noPad>
        <div className="scroll-thin overflow-x-auto border-t border-line/70">
          <table className="tbl text-[13px]">
            <thead>
              <tr>
                <th className="tbl-sticky">Wk</th>
                <th>Opp</th>
                <th className="num">Proj pts</th>
                <th>Kickoff</th>
                {cols.map((c) => (
                  <th key={c} className="num" title={STAT_BY_KEY[c]?.label}>
                    {statLabel(c, STAT_BY_KEY[c])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.projections.map((r) => (
                <tr key={r.week} className={cn(!r.inFantasySeason && "text-muted")}>
                  <td className="tbl-sticky font-semibold" title={!r.inFantasySeason ? "After the fantasy season" : undefined}>
                    {r.week}
                    {!r.inFantasySeason && <span className="ml-0.5 text-[12px] font-normal">*</span>}
                  </td>
                  <td className="whitespace-nowrap">{r.bye ? <b>BYE</b> : (r.opp ?? "—")}</td>
                  <td className="num font-semibold">{fmtPts(r.pts, 2)}</td>
                  <td className="whitespace-nowrap text-muted">{r.kickoffLabel ?? ""}</td>
                  {cols.map((c) => (
                    <td key={c} className="num">
                      {r.stats ? Number(r.stats[c] ?? 0).toFixed(1) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.projections.some((r) => !r.inFantasySeason) && <p className="border-t border-line/70 px-4 py-2.5 text-[12px] text-muted">* After the fantasy season (not counted in ROS points)</p>}
      </Panel>
    </div>
  );
}

// ───────────────────────────── News + injury history ─────────────────────────────

async function NewsTab({
  ctx,
  playerId,
  teamNews,
  page,
  tz,
}: {
  ctx: Awaited<ReturnType<typeof getLeagueContext>>;
  playerId: string;
  teamNews: string | null;
  page: number;
  tz: string;
}) {
  const per = 20;
  const [news, reports] = await Promise.all([
    playerNews(ctx, playerId, per, (Math.max(1, page) - 1) * per, { teamNews: teamNews ?? null }),
    db.injuryReport.findMany({ where: { playerId }, orderBy: { reportedAt: "desc" }, take: 60 }),
  ]);
  const pages = Math.max(1, Math.ceil(news.total / per));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">
        {news.entries.length ? (
          <>
            <div className="card divide-y divide-line/70 overflow-hidden">
              {news.entries.map((e) => (
                <NewsCard key={e.item.id} item={e.item} players={e.players.filter((x) => x.id !== playerId)} tz={tz} />
              ))}
            </div>
            <Pagination page={Math.min(page, pages)} pages={pages} total={news.total} perPage={per} href={(n) => `/players/${playerId}?tab=news${n > 1 ? `&page=${n}` : ""}`} />
          </>
        ) : (
          <EmptyState title="No news yet">News and fantasy notes for this player appear here as they are published.</EmptyState>
        )}
      </div>
      <Panel title="Injury history" subtitle="ESPN injury reports">
        {reports.length ? (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {reports.map((r) => {
              const st = normalizeInjuryStatus(r.status);
              const grp = injuryGroup(st);
              return (
                <li key={r.id} className="relative text-[15px] sm:text-sm">
                  <span
                    className={cn(
                      "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-panel",
                      st === "Active" ? "bg-win" : grp === "QUESTIONABLE" ? "bg-amber-500" : grp === "DOUBTFUL" ? "bg-orange-600" : "bg-loss",
                    )}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <b>{st === "Active" ? "Active / healthy" : st}</b>
                    {r.bodyPart && <span className="text-muted">· {r.bodyPart}</span>}
                  </div>
                  <div className="text-[12px] text-muted">
                    {fmtDateTime(r.reportedAt, tz)}
                    {r.returnDate && ` · est. return ${fmtCalendarDate(r.returnDate)}`}
                  </div>
                  {r.shortComment && <p className="mt-0.5 text-[13px]">{r.shortComment}</p>}
                  {r.longComment && <p className="mt-0.5 text-[13px] text-muted">{r.longComment}</p>}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-[13px] text-muted">No injury reports on file.</p>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────────── Transactions ─────────────────────────────

const TX_TONES: Record<string, "green" | "red" | "brand" | "gold" | "purple" | "neutral" | "amber"> = {
  ADD: "green",
  WAIVER: "green",
  DROP: "red",
  TRADE: "brand",
  AUCTION: "neutral",
  ROOKIE_DRAFT: "purple",
  KEEPER: "amber",
};

async function TransactionsTab({ ctx, playerId, tz }: { ctx: Awaited<ReturnType<typeof getLeagueContext>>; playerId: string; tz: string }) {
  const [txs, claims] = await Promise.all([
    playerTransactionHistory(ctx, playerId),
    ctx.myTeam ? db.waiverClaim.findMany({ where: { teamId: ctx.myTeam.id, addPlayerId: playerId, status: "PENDING" } }) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-3">
      {claims.length > 0 && (
        <Alert tone="warn">
          You have a pending claim on this player{claims[0]!.bidAmount ? ` ($${claims[0]!.bidAmount} FAB)` : ""}
          {claims[0]!.processAt ? `, processing ${fmtDateTime(claims[0]!.processAt, tz)}` : ""}.{" "}
          <Link href="/waivers" className="link">
            Manage claims
          </Link>
        </Alert>
      )}
      <Panel title="League transaction history" subtitle={ctx.league.name} noPad>
        {txs.length ? (
          <ul className="divide-y divide-line/70 border-t border-line/70">
            {txs.map((t) => (
              <li key={t.key} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={TX_TONES[t.type] ?? "neutral"}>{t.type.replace("_", " ")}</Badge>
                    {t.team ? (
                      <Link href={`/teams/${t.team.id}`} className="truncate text-[15px] font-semibold text-ink hover:underline sm:text-sm">
                        {t.team.name}
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[15px] leading-5 text-ink/90 sm:text-sm">
                    {t.description}
                    {t.tradeId && (
                      <Link href={`/trades/${t.tradeId}`} className="ml-1.5 font-semibold text-brand-600 hover:underline dark:text-brand-400">
                        View trade
                      </Link>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {fmtDate(t.at, tz, { year: true })} · {t.week > 0 ? `Week ${t.week}` : "Preseason"}
                  </p>
                </div>
                {(t.salary !== null || t.faab !== null) && (
                  <div className="shrink-0 text-right">
                    {t.salary !== null && <div className="numeral text-[15px] font-semibold text-ink">${t.salary}</div>}
                    {t.faab !== null && <div className="numeral text-[12px] text-muted">FAB {t.faab}</div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line/70 px-4 py-3 text-[13px] text-muted">This player has never been on a roster in {ctx.league.name}.</p>
        )}
      </Panel>
    </div>
  );
}
