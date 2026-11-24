import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { ButtonLink, EmptyState, PageHeader, Panel, TeamLogo, buttonClass } from "@/components/ui/core";
import { TradesNav } from "@/components/trades/trade-nav";
import { TradeCard } from "@/components/trades/trade-card";
import { FilterSelect } from "@/components/trades/filter-select";
import { loadTradeViews, tradeViewInclude } from "@/lib/trades/views";
import { tradeResults } from "@/lib/trades/results";
import { fmtPts } from "@/lib/utils";

export const metadata = { title: "Trade History" };

const PAGE_SIZE = 15;
type SP = { team?: string; season?: string; asset?: string; status?: string; page?: string };

export default async function TradeHistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam } = ctx;
  const tz = settings.general.timezone;
  const teams = await db.team.findMany({ where: { leagueId: league.id }, select: { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true }, orderBy: { name: "asc" } });
  const teamFilter = teams.some((t) => t.id === sp.team) ? sp.team! : "";
  const seasonRows = await db.trade.findMany({ where: { leagueId: league.id, status: { in: ["COMPLETED", "VETOED", "REVERSED"] } }, distinct: ["season"], select: { season: true }, orderBy: { season: "desc" } });
  const seasons = seasonRows.map((s) => s.season);
  const seasonFilter = seasons.includes(Number(sp.season)) ? Number(sp.season) : null;
  const assetFilter = ["PLAYER", "PICK", "FAAB"].includes(sp.asset ?? "") ? sp.asset! : "";
  const statusFilter = ["COMPLETED", "VETOED", "REVERSED"].includes(sp.status ?? "") ? (sp.status as "COMPLETED" | "VETOED" | "REVERSED") : null;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));

  const where: Prisma.TradeWhereInput = {
    leagueId: league.id,
    status: statusFilter ? statusFilter : { in: ["COMPLETED", "VETOED", "REVERSED"] },
    ...(teamFilter ? { teams: { some: { teamId: teamFilter } } } : {}),
    ...(seasonFilter ? { season: seasonFilter } : {}),
    ...(assetFilter ? { assets: { some: { type: assetFilter } } } : {}),
  };
  const [total, rows, allCompleted] = await Promise.all([
    db.trade.count({ where }),
    db.trade.findMany({ where, include: tradeViewInclude, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.trade.findMany({ where: { leagueId: league.id, status: "COMPLETED", ...(seasonFilter ? { season: seasonFilter } : {}) }, select: { id: true, teams: { select: { teamId: true } }, assets: { select: { type: true, fromTeamId: true, toTeamId: true, faabAmount: true } } } }),
  ]);
  const [views, results] = await Promise.all([
    loadTradeViews(league.id, rows, { settings, season: ctx.season, viewerTeamId: myTeam?.id }),
    tradeResults(league.id, rows.filter((r) => r.status !== "VETOED").map((r) => ({ id: r.id, season: r.season, week: r.week, assets: r.assets })), settings),
  ]);

  // team-level trade stats
  const stats = new Map<string, { trades: number; partners: Map<string, number>; playersIn: number; playersOut: number; picksIn: number; picksOut: number; faabNet: number }>();
  for (const t of teams) stats.set(t.id, { trades: 0, partners: new Map(), playersIn: 0, playersOut: 0, picksIn: 0, picksOut: 0, faabNet: 0 });
  for (const tr of allCompleted) {
    for (const tt of tr.teams) {
      const s = stats.get(tt.teamId);
      if (!s) continue;
      s.trades++;
      for (const o of tr.teams) if (o.teamId !== tt.teamId) s.partners.set(o.teamId, (s.partners.get(o.teamId) ?? 0) + 1);
    }
    for (const a of tr.assets) {
      const to = stats.get(a.toTeamId);
      const from = stats.get(a.fromTeamId);
      if (a.type === "PLAYER") {
        if (to) to.playersIn++;
        if (from) from.playersOut++;
      } else if (a.type === "PICK") {
        if (to) to.picksIn++;
        if (from) from.picksOut++;
      } else if (a.type === "FAAB") {
        if (to) to.faabNet += a.faabAmount ?? 0;
        if (from) from.faabNet -= a.faabAmount ?? 0;
      }
    }
  }
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const statRows = teams.map((t) => ({ team: t, ...stats.get(t.id)! })).sort((a, b) => b.trades - a.trades || a.team.name.localeCompare(b.team.name));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const q = new URLSearchParams();
    if (teamFilter) q.set("team", teamFilter);
    if (seasonFilter) q.set("season", String(seasonFilter));
    if (assetFilter) q.set("asset", assetFilter);
    if (statusFilter) q.set("status", statusFilter);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `/trades/history?${s}` : "/trades/history";
  };

  return (
    <div>
      <PageHeader kicker="Trades" title="Trade History" subtitle="Every completed, vetoed and reversed trade — with how each side has worked out since." />
      <TradesNav active="history" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <form method="get" className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel p-3 shadow-panel sm:grid-cols-4">
            <FilterSelect name="team" label="Team" value={teamFilter} options={[{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />
            <FilterSelect name="season" label="Season" value={seasonFilter ? String(seasonFilter) : ""} options={[{ value: "", label: "All seasons" }, ...seasons.map((s) => ({ value: String(s), label: String(s) }))]} />
            <FilterSelect
              name="asset"
              label="Includes"
              value={assetFilter}
              options={[
                { value: "", label: "Any assets" },
                { value: "PLAYER", label: "Players" },
                { value: "PICK", label: "Draft picks" },
                { value: "FAAB", label: "FAB" },
              ]}
            />
            <FilterSelect
              name="status"
              label="Result"
              value={statusFilter ?? ""}
              options={[
                { value: "", label: "All results" },
                { value: "COMPLETED", label: "Completed" },
                { value: "VETOED", label: "Vetoed" },
                { value: "REVERSED", label: "Reversed" },
              ]}
            />
            <noscript>
              <button type="submit" className={buttonClass("secondary", "sm")}>
                Apply
              </button>
            </noscript>
          </form>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {total} trade{total === 1 ? "" : "s"}
              {teamFilter ? ` involving ${teamName.get(teamFilter)}` : ""}
              {seasonFilter ? ` in ${seasonFilter}` : ""}
            </span>
            {(teamFilter || seasonFilter || assetFilter || statusFilter) && (
              <Link href="/trades/history" className="link">
                Clear filters
              </Link>
            )}
          </div>
          {views.length ? (
            views.map((t) => {
              const perTeam: Record<string, React.ReactNode> = {};
              if (t.status !== "VETOED") {
                for (const tm of t.teams) {
                  const incoming = t.assets.filter((a) => a.toTeamId === tm.teamId && a.type !== "FAAB");
                  if (!incoming.length) continue;
                  perTeam[tm.teamId] = (
                    <div className="mt-2 rounded-md bg-sunken px-2 py-1.5 text-[11px]">
                      <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted">Results so far</div>
                      <ul className="space-y-0.5">
                        {incoming.map((a) => {
                          if (a.type === "PLAYER" && a.player) {
                            const r = results.players.get(`${t.id}:${a.player.id}`);
                            return (
                              <li key={a.id} className="flex justify-between gap-2">
                                <span className="truncate">{a.player.fullName}</span>
                                <span className="shrink-0 tabular-nums text-ink">
                                  <b>{fmtPts(r?.started ?? 0, 1)}</b> pts · {r?.startedWeeks ?? 0} start{r?.startedWeeks === 1 ? "" : "s"}
                                  <span className="text-muted"> ({fmtPts(r?.total ?? 0, 1)} total)</span>
                                  {r && r.currentTeamId !== tm.teamId && <span className="text-muted"> · {r.currentTeamId ? `now ${teamName.get(r.currentTeamId) ?? "elsewhere"}` : "released"}</span>}
                                </span>
                              </li>
                            );
                          }
                          const pk = a.pick ? results.picks.get(a.pick.id) : undefined;
                          return (
                            <li key={a.id} className="flex justify-between gap-2">
                              <span className="truncate">{a.label}</span>
                              <span className="shrink-0 text-ink">
                                {pk?.used && pk.player ? (
                                  <>
                                    {pk.slot ? `${pk.slot} → ` : "→ "}
                                    <Link href={`/players/${pk.player.id}`} className="link">
                                      {pk.player.fullName}
                                    </Link>
                                  </>
                                ) : (
                                  <span className="text-muted">not used yet</span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-1 border-t border-line pt-1 text-right font-semibold text-ink">{fmtPts(results.teamTotals.get(`${t.id}:${tm.teamId}`) ?? 0, 1)} starter pts total</div>
                    </div>
                  );
                }
              }
              return <TradeCard key={t.id} trade={t} tz={tz} viewerTeamId={myTeam?.id} results={perTeam} />;
            })
          ) : (
            <EmptyState title="No trades match">{total === 0 && !teamFilter && !seasonFilter && !assetFilter && !statusFilter ? "This league hasn't completed a trade yet." : "Try different filters."}</EmptyState>
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-center gap-2" aria-label="Pages">
              {page > 1 && (
                <ButtonLink href={qs(page - 1)} variant="secondary" size="sm">
                  Newer
                </ButtonLink>
              )}
              <span className="text-xs text-muted">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <ButtonLink href={qs(page + 1)} variant="secondary" size="sm">
                  Older
                </ButtonLink>
              )}
            </nav>
          )}
        </div>

        <aside>
          <Panel title="Team trade stats" subtitle={seasonFilter ? `${seasonFilter} completed trades` : "All completed trades"} noPad>
            <div className="overflow-x-auto">
              <table className="tbl tbl-compact">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th className="num">Trades</th>
                    <th className="num" title="Players in / out">Plyr</th>
                    <th className="num" title="Picks in / out">Picks</th>
                    <th className="num" title="Net FAB">FAB</th>
                  </tr>
                </thead>
                <tbody>
                  {statRows.map((r) => {
                    const top = [...r.partners.entries()].sort((a, b) => b[1] - a[1])[0];
                    return (
                      <tr key={r.team.id}>
                        <td className="max-w-[150px]">
                          <Link href={`/trades/history?team=${r.team.id}`} className="flex items-start gap-1.5 hover:underline">
                            <TeamLogo team={r.team} size={18} className="mt-px" />
                            <span className="font-semibold leading-tight">{r.team.name}</span>
                          </Link>
                          {top && (
                            <div className="pl-6 text-[10px] text-muted">
                              {r.partners.size} partner{r.partners.size === 1 ? "" : "s"} · most with {teams.find((t) => t.id === top[0])?.abbrev ?? "?"}
                            </div>
                          )}
                        </td>
                        <td className="num font-bold">{r.trades}</td>
                        <td className="num text-xs">
                          +{r.playersIn}/−{r.playersOut}
                        </td>
                        <td className="num text-xs">
                          +{r.picksIn}/−{r.picksOut}
                        </td>
                        <td className={`num text-xs ${r.faabNet > 0 ? "text-win" : r.faabNet < 0 ? "text-loss" : ""}`}>{r.faabNet > 0 ? `+$${r.faabNet}` : r.faabNet < 0 ? `−$${-r.faabNet}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
