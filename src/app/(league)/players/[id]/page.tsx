import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { NFL_TEAM_BY_ABBR } from "@/lib/nfl/teams";
import { STAT_BY_KEY, STAT_CATALOG, normalizePosition, type StatGroup } from "@/lib/settings/stat-catalog";
import { Alert, Badge, EmptyState, InjuryTag, NflLogo, Panel, PlayerHeadshot, PosBadge, TabLinks } from "@/components/ui/core";
import { PlayerActionButton, WatchStar } from "@/components/players/player-actions";
import { PointsChart } from "@/components/players/points-chart";
import { GameLogTable } from "@/components/players/game-log-table";
import { NewsCard } from "@/components/players/news-card";
import { Pagination } from "@/components/players/pagination";
import { GameCell, OwnerTag, PracticeTag } from "@/components/players/tags";
import { fmtCalendarDate, fmtDate, fmtDateTime } from "@/lib/players/format";
import { fmtStat, injuryGroup, normalizeInjuryStatus, practiceFromText, statLabel } from "@/lib/players/logic";
import { playerNews } from "@/lib/players/news";
import { loadPlayerProfile, type ProfileData } from "@/lib/players/profile";
import { cn, fmtPts, heightDisplay, ordinal, timeAgo } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "gamelog", label: "Game Log" },
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
  const nfl = p.team ? NFL_TEAM_BY_ABBR[p.team] : undefined;

  return (
    <div className="space-y-4">
      <nav className="text-xs text-muted">
        <Link href="/players" className="link">
          Players
        </Link>{" "}
        / {p.fullName}
      </nav>

      <ProfileHeader data={data} accent={nfl?.primary ?? "#163070"} />

      <TabLinks tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/players/${p.id}${t.key === "overview" ? "" : `?tab=${t.key}`}` }))} active={tab} className="mb-0" />

      {tab === "overview" && <OverviewTab ctx={ctx} data={data} />}
      {tab === "gamelog" && (
        <Panel title={`${ctx.season} game log`} subtitle="League scoring · tap the points for the scoring breakdown" noPad>
          <GameLogTable rows={data.gameLog} columns={data.statColumns} totals={data.totals} games={data.games} />
        </Panel>
      )}
      {tab === "stats" && <StatsTab data={data} />}
      {tab === "projections" && <ProjectionsTab data={data} />}
      {tab === "news" && <NewsTab ctx={ctx} playerId={p.id} page={Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1} tz={tz} />}
      {tab === "transactions" && <TransactionsTab ctx={ctx} playerId={p.id} tz={tz} />}
      {!f.owner && f.action === null && !ctx.myTeam && <p className="text-xs text-muted">You don&apos;t manage a team in this league, so roster actions are unavailable.</p>}
    </div>
  );
}

// ───────────────────────────── Header ─────────────────────────────

function ProfileHeader({ data, accent }: { data: ProfileData; accent: string }) {
  const p = data.player;
  const f = data.fantasy;
  const inj = data.injury;
  const tw = f.thisWeek;
  const isDef = p.position === "DEF";
  const nflTeam = p.team ? NFL_TEAM_BY_ABBR[p.team] : undefined;
  const exp = p.yearsExp === 0 ? "Rookie" : p.yearsExp !== null ? `${ordinal(p.yearsExp + 1)} season` : "—";
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-panel">
      <div className="h-2" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}cc 60%, #f5b301)` }} />
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
          <div className="relative shrink-0 self-start">
            <PlayerHeadshot player={p} size={112} className="ring-2" />
            {p.team && !isDef && (
              <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-1 shadow ring-1 ring-line">
                <NflLogo abbr={p.team} size={28} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-3xl font-extrabold uppercase leading-none tracking-wide sm:text-4xl">{p.fullName}</h1>
              <InjuryTag status={inj.status} className="h-5 px-1.5 text-[11px]" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
              <PosBadge pos={p.position} />
              {p.number !== null && <span className="font-semibold text-ink">#{p.number}</span>}
              <span>{p.teamName}</span>
              {p.depthChartPosition && p.depthChartOrder && <Badge tone="brand">Depth: {p.depthChartPosition} #{p.depthChartOrder}</Badge>}
              {p.status && p.status !== "Active" && <Badge tone="amber">{p.status}</Badge>}
            </div>
            {isDef ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                <Bio label="Conference">{nflTeam ? nflTeam.conference : "—"}</Bio>
                <Bio label="Division">{nflTeam ? `${nflTeam.conference} ${nflTeam.division}` : "—"}</Bio>
                <Bio label="Bye week">{f.byeWeek ?? "—"}</Bio>
              </dl>
            ) : (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                <Bio label="Age">
                  {p.age ?? "—"}
                  {p.birthDate && <span className="text-muted"> · {fmtCalendarDate(p.birthDate, { year: true })}</span>}
                </Bio>
                <Bio label="Ht / Wt">
                  {heightDisplay(p.height)}
                  {p.weight ? ` · ${p.weight} lbs` : ""}
                </Bio>
                <Bio label="College">{p.college ?? "—"}</Bio>
                <Bio label="Experience">
                  {exp}
                  {p.rookieYear ? <span className="text-muted"> · drafted {p.rookieYear}</span> : null}
                </Bio>
                <Bio label="Bye week">{f.byeWeek ?? "—"}</Bio>
                <Bio label="Status">{p.status ?? "—"}</Bio>
              </dl>
            )}
            {inj.status ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/30">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-loss">{inj.status}</b>
                  {inj.bodyPart && <span>{inj.bodyPart}</span>}
                  {inj.returnDate && <span className="text-muted">· est. return {fmtCalendarDate(inj.returnDate)}</span>}
                  {(p.practiceParticipation ?? practiceFromText(inj.note)) && <PracticeTag value={p.practiceParticipation ?? practiceFromText(inj.note)} />}
                  {inj.updatedAt && <span className="text-xs text-muted">· updated {timeAgo(inj.updatedAt)}</span>}
                </div>
                {inj.note && <p className="mt-1 text-muted">{inj.note}</p>}
                {p.practiceDescription && <p className="mt-1 text-xs text-muted">Practice: {p.practiceDescription}</p>}
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PlayerActionButton playerId={p.id} playerName={p.fullName} action={f.action} blockedReason={f.blockedReason} pendingClaim={f.pendingClaim} ownerTeamId={f.owner?.teamId} size="sm" />
              <WatchStar playerId={p.id} watched={f.watched} playerName={p.fullName} className="rounded-md border border-line p-1.5" />
              <span className="text-xs text-muted">{f.watched ? "On your watch list" : "Watch"}</span>
            </div>
          </div>
        </div>

        <aside className="rounded-lg border border-line bg-sunken/60 p-3" aria-label="Fantasy summary">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Fantasy</span>
            {f.owner ? (
              <OwnerTag owner={f.owner} full />
            ) : f.waiver ? (
              <Badge tone="amber">On waivers</Badge>
            ) : (
              <Badge tone="green">Free agent</Badge>
            )}
          </div>
          {f.owner ? (
            <p className="text-sm">
              <b>${f.owner.salary}</b> · {f.owner.contractYears} yr{f.owner.contractYears === 1 ? "" : "s"} <span className="text-muted">(thru {f.owner.thru})</span>
              {f.owner.isRookieContract && <Badge className="ml-1">Rookie deal</Badge>}
              {f.owner.status !== "ACTIVE" && <Badge className="ml-1">{f.owner.status}</Badge>}
              <span className="block text-xs text-muted">
                Acquired via {f.owner.acquiredVia.replace("_", " ").toLowerCase()} · {fmtDate(f.owner.acquiredAt, data.timezone, { year: true })}
              </span>
            </p>
          ) : f.waiver ? (
            <p className="text-sm text-muted">{f.waiver.processAtLabel ? `Claims process ${f.waiver.processAtLabel}.` : f.waiver.reason}</p>
          ) : (
            <p className="text-sm text-muted">Available to add now.</p>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Kpi label="Season pts" value={fmtPts(f.seasonPts, 1)} />
            <Kpi label="Avg" value={fmtPts(f.avg, 1)} />
            <Kpi label="Last 3" value={fmtPts(f.last3, 1)} />
            <Kpi label="Pos rank" value={f.posRank ? `${f.posRank.pos}${f.posRank.rank}` : "—"} sub={f.posRank ? `of ${f.posRank.of}` : undefined} />
            <Kpi label="Games" value={String(f.games)} />
            <Kpi label={`Wk ${tw.week} proj`} value={fmtPts(tw.proj, 1)} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 py-2 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted">Week {tw.week}</span>
            {tw.bye ? (
              <b>BYE</b>
            ) : tw.game ? (
              <span className="text-right">
                <GameCell game={tw.game} kickoffLabel={tw.game.kickoffLabel} />
                {(tw.game.spread || tw.game.overUnder) && (
                  <span className="block text-[10px] text-muted">
                    {tw.game.spread ? `Spread ${tw.game.spread}` : ""}
                    {tw.game.overUnder ? ` · O/U ${tw.game.overUnder}` : ""}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted">No game</span>
            )}
          </div>
          {tw.pts !== null && tw.game?.state !== "pre" && (
            <p className="mt-1 text-right text-xs text-muted">
              Week {tw.week} actual: <b className="text-ink">{fmtPts(tw.pts, 2)}</b>
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

function Bio({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate font-medium">{children}</dd>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-panel px-1 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="font-display text-lg font-bold leading-tight tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  );
}

// ───────────────────────────── Overview ─────────────────────────────

async function OverviewTab({ ctx, data }: { ctx: Awaited<ReturnType<typeof getLeagueContext>>; data: ProfileData }) {
  const p = data.player;
  const [news, reports] = await Promise.all([
    playerNews(ctx, p.id, 3),
    db.injuryReport.findMany({ where: { playerId: p.id }, orderBy: { reportedAt: "desc" }, take: 3 }),
  ]);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel title="Fantasy points by week" subtitle={`League scoring · projections through week ${data.rosRange.to}`}>
          {data.chart.some((c) => c.pts !== null || c.proj !== null) ? (
            <PointsChart data={data.chart} currentWeek={ctx.week} />
          ) : (
            <EmptyState title="No points or projections yet">This player hasn&apos;t recorded stats or projections this season.</EmptyState>
          )}
        </Panel>
        <Panel
          title="Latest news"
          actions={
            news.total > 3 ? (
              <Link href={`/players/${p.id}?tab=news`} className="link text-xs">
                All {news.total} items
              </Link>
            ) : undefined
          }
        >
          {news.entries.length ? (
            <div className="space-y-2">
              {news.entries.map((e) => (
                <NewsCard key={e.item.id} item={e.item} players={e.players.filter((x) => x.id !== p.id)} tz={data.timezone} compact />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No news for {p.fullName} yet. Player notes arrive automatically from ESPN every few minutes.</p>
          )}
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Injury report">
          {data.injury.status ? (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <InjuryTag status={data.injury.status} />
                <b>{data.injury.status}</b>
                {data.injury.bodyPart && <span className="text-muted">· {data.injury.bodyPart}</span>}
              </div>
              {data.injury.returnDate && <p className="text-xs text-muted">Estimated return: {fmtCalendarDate(data.injury.returnDate, { year: true })}</p>}
              {data.injury.detail && <p className="text-xs leading-relaxed text-muted">{data.injury.detail}</p>}
            </div>
          ) : (
            <p className="text-sm text-win">No current injury designation.</p>
          )}
          {reports.length > 0 && (
            <ul className="mt-3 space-y-2 border-t border-line pt-2 text-xs">
              {reports.map((r) => (
                <li key={r.id}>
                  <span className="font-semibold">{normalizeInjuryStatus(r.status) === "Active" ? "Active" : normalizeInjuryStatus(r.status)}</span>
                  <span className="text-muted"> · {fmtDateTime(r.reportedAt, data.timezone)}</span>
                  {r.shortComment && <p className="text-muted">{r.shortComment}</p>}
                </li>
              ))}
            </ul>
          )}
          <Link href={`/players/${p.id}?tab=news`} className="link mt-2 inline-block text-xs">
            Full injury history
          </Link>
        </Panel>
        <Panel title={`${ctx.season} season`} subtitle={`${data.games} games · ${fmtPts(data.fantasy.seasonPts, 1)} pts`}>
          <div className="grid grid-cols-3 gap-1.5">
            {data.seasonLine.map((s) => (
              <div key={s.key} className="rounded border border-line px-2 py-1 text-center" title={s.label}>
                <div className="text-[10px] uppercase text-muted">{s.short}</div>
                <div className="font-bold tabular-nums">{fmtStat(s.value)}</div>
              </div>
            ))}
          </div>
          <Link href={`/players/${p.id}?tab=stats`} className="link mt-2 inline-block text-xs">
            All stats
          </Link>
        </Panel>
        <Panel title="Upcoming">
          {data.projections.length ? (
            <table className="tbl tbl-compact text-xs">
              <tbody>
                {data.projections.slice(0, 4).map((r) => (
                  <tr key={r.week}>
                    <td className="font-semibold">Wk {r.week}</td>
                    <td>{r.bye ? "BYE" : (r.opp ?? "—")}</td>
                    <td className="text-muted">{r.kickoffLabel ?? ""}</td>
                    <td className="num font-semibold">{fmtPts(r.pts, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">No remaining games this season.</p>
          )}
          <Link href={`/players/${p.id}?tab=projections`} className="link mt-2 inline-block text-xs">
            Rest-of-season projections
          </Link>
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
      <div className="grid grid-cols-3 gap-2 sm:max-w-md">
        <Kpi label="Fantasy pts" value={fmtPts(totalPts, 1)} />
        <Kpi label="Per game" value={g ? fmtPts(totalPts / g, 1) : "—"} />
        <Kpi label="Games" value={String(g)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const stats = STAT_CATALOG.filter((s) => s.group === group && ((data.totals[s.key] ?? 0) !== 0 || s.positions?.includes(pos)));
          return (
            <Panel key={group} title={group} noPad>
              {stats.length ? (
                <table className="tbl text-[13px]">
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
                <p className="p-3 text-sm text-muted">No {group.toLowerCase()} stats recorded.</p>
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
    <Panel
      title="Rest-of-season projections"
      subtitle={`Weeks ${data.rosRange.from}–${data.rosRange.to} (fantasy season) · league scoring`}
      actions={
        <span className="font-display text-lg font-bold tabular-nums">
          {fmtPts(data.rosTotal, 1)} <span className="text-xs font-semibold text-muted">ROS pts</span>
        </span>
      }
      noPad
    >
      <div className="scroll-thin overflow-x-auto">
        <table className="tbl text-[13px]">
          <thead>
            <tr>
              <th>Wk</th>
              <th>Opp</th>
              <th>Kickoff</th>
              {cols.map((c) => (
                <th key={c} className="num" title={STAT_BY_KEY[c]?.label}>
                  {statLabel(c, STAT_BY_KEY[c])}
                </th>
              ))}
              <th className="num">Proj pts</th>
            </tr>
          </thead>
          <tbody>
            {data.projections.map((r) => (
              <tr key={r.week} className={cn(!r.inFantasySeason && "text-muted opacity-70")}>
                <td className="font-semibold">
                  {r.week}
                  {!r.inFantasySeason && <span className="ml-1 text-[10px] font-normal">(after fantasy season)</span>}
                </td>
                <td className="whitespace-nowrap">{r.bye ? <b>BYE</b> : (r.opp ?? "—")}</td>
                <td className="whitespace-nowrap text-muted">{r.kickoffLabel ?? ""}</td>
                {cols.map((c) => (
                  <td key={c} className="num">
                    {r.stats ? Number(r.stats[c] ?? 0).toFixed(1) : "—"}
                  </td>
                ))}
                <td className="num font-bold">{fmtPts(r.pts, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ───────────────────────────── News + injury history ─────────────────────────────

async function NewsTab({ ctx, playerId, page, tz }: { ctx: Awaited<ReturnType<typeof getLeagueContext>>; playerId: string; page: number; tz: string }) {
  const per = 20;
  const [news, reports] = await Promise.all([playerNews(ctx, playerId, per, (Math.max(1, page) - 1) * per), db.injuryReport.findMany({ where: { playerId }, orderBy: { reportedAt: "desc" }, take: 60 })]);
  const pages = Math.max(1, Math.ceil(news.total / per));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-2 lg:col-span-2">
        {news.entries.length ? (
          <>
            {news.entries.map((e) => (
              <NewsCard key={e.item.id} item={e.item} players={e.players.filter((x) => x.id !== playerId)} tz={tz} />
            ))}
            <Pagination page={Math.min(page, pages)} pages={pages} total={news.total} perPage={per} href={(n) => `/players/${playerId}?tab=news${n > 1 ? `&page=${n}` : ""}`} />
          </>
        ) : (
          <EmptyState title="No news yet">News and fantasy notes for this player will appear here as soon as they are published.</EmptyState>
        )}
      </div>
      <Panel title="Injury history" subtitle="ESPN injury reports">
        {reports.length ? (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {reports.map((r) => {
              const st = normalizeInjuryStatus(r.status);
              const grp = injuryGroup(st);
              return (
                <li key={r.id} className="relative text-sm">
                  <span
                    className={cn(
                      "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-panel",
                      st === "Active" ? "bg-win" : grp === "QUESTIONABLE" ? "bg-amber-500" : grp === "DOUBTFUL" ? "bg-orange-600" : "bg-loss",
                    )}
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <b>{st === "Active" ? "Active / healthy" : st}</b>
                    {r.bodyPart && <span className="text-muted">· {r.bodyPart}</span>}
                  </div>
                  <div className="text-[11px] text-muted">
                    {fmtDateTime(r.reportedAt, tz)}
                    {r.returnDate && ` · est. return ${fmtCalendarDate(r.returnDate)}`}
                  </div>
                  {r.shortComment && <p className="mt-0.5 text-xs">{r.shortComment}</p>}
                  {r.longComment && <p className="mt-0.5 text-xs text-muted">{r.longComment}</p>}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted">No injury reports on file.</p>
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
  AUCTION: "gold",
  ROOKIE_DRAFT: "purple",
  KEEPER: "amber",
};

async function TransactionsTab({ ctx, playerId, tz }: { ctx: Awaited<ReturnType<typeof getLeagueContext>>; playerId: string; tz: string }) {
  const [txs, claims] = await Promise.all([
    db.transaction.findMany({
      where: { leagueId: ctx.league.id, playerId },
      include: { team: { select: { id: true, name: true, abbrev: true } }, relatedTeam: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
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
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl text-[13px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Team</th>
                  <th>Details</th>
                  <th className="num">Salary</th>
                  <th className="num">FAB</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap text-muted">
                      {fmtDate(t.createdAt, tz, { year: true })}
                      <span className="block text-[10px]">{t.week > 0 ? `Week ${t.week}` : "Preseason"}</span>
                    </td>
                    <td>
                      <Badge tone={TX_TONES[t.type] ?? "neutral"}>{t.type.replace("_", " ")}</Badge>
                    </td>
                    <td className="whitespace-nowrap">
                      {t.team ? (
                        <Link href={`/teams/${t.team.id}`} className="link font-semibold">
                          {t.team.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {t.description}
                      {t.tradeId && (
                        <Link href={`/trades/${t.tradeId}`} className="link ml-1 text-xs">
                          View trade
                        </Link>
                      )}
                    </td>
                    <td className="num">{t.salary !== null ? `$${t.salary}` : "—"}</td>
                    <td className="num">{t.faabAmount !== null ? `$${t.faabAmount}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-3 text-sm text-muted">This player has never been on a roster in {ctx.league.name}.</p>
        )}
      </Panel>
    </div>
  );
}
