// Trade history — "What has the league traded, and how has each side worked out?"
// Summary strip (trades · players · picks · FAB moved), filters, trade cards with results so far, and every team's
// trade activity as ranked rows (top 5, the rest behind "Show more").
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { ButtonLink, EmptyState, ListRow, PageHeader, Panel, SummaryStrip, TeamLogo, buttonClass } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { TradesNav } from "@/components/trades/trade-nav";
import { TradeCard } from "@/components/trades/trade-card";
import { FilterSelect } from "@/components/trades/filter-select";
import { loadTradeViews, tradeViewInclude } from "@/lib/trades/views";
import { tradeResults } from "@/lib/trades/results";
import { fmtPts } from "@/lib/utils";

export const metadata = { title: "Trade history" };

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
    tradeResults(league.id, rows.filter((r) => r.status === "COMPLETED").map((r) => ({ id: r.id, season: r.season, week: r.week, assets: r.assets })), settings),
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
  const moved = { players: 0, picks: 0, faab: 0 };
  for (const tr of allCompleted)
    for (const a of tr.assets) {
      if (a.type === "PLAYER") moved.players++;
      else if (a.type === "PICK") moved.picks++;
      else if (a.type === "FAAB") moved.faab += a.faabAmount ?? 0;
    }
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
      <PageHeader title="Trade history" />
      <TradesNav active="history" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />

      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Trades", value: allCompleted.length, sub: seasonFilter ? `in ${seasonFilter}` : "all seasons" },
          { label: "Players", value: moved.players, sub: "moved" },
          { label: "Picks", value: moved.picks, sub: "moved" },
          { label: "FAB", value: `$${moved.faab}`, sub: "moved" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <form method="get" className="card grid grid-cols-2 gap-x-3 gap-y-2 p-3 sm:grid-cols-4">
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
          <div className="flex min-h-8 items-center justify-between gap-3 px-1 text-[13px] text-muted">
            <span className="min-w-0 truncate">
              {total} trade{total === 1 ? "" : "s"}
              {teamFilter ? ` · ${teamName.get(teamFilter)}` : ""}
              {seasonFilter ? ` · ${seasonFilter}` : ""}
            </span>
            {(teamFilter || seasonFilter || assetFilter || statusFilter) && (
              <Link href="/trades/history" className="-my-1 inline-flex min-h-8 shrink-0 items-center font-semibold text-brand-600 dark:text-brand-400">
                Clear filters
              </Link>
            )}
          </div>
          {views.length ? (
            views.map((t) => {
              const perTeam: Record<string, React.ReactNode> = {};
              // results only make sense for trades that stood (vetoed / reversed trades never changed hands for long)
              if (t.status === "COMPLETED") {
                for (const tm of t.teams) {
                  const incoming = t.assets.filter((a) => a.toTeamId === tm.teamId && a.type !== "FAAB");
                  if (!incoming.length) continue;
                  perTeam[tm.teamId] = (
                    <div className="mb-3 rounded-lg bg-sunken px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="eyebrow">Results so far</span>
                        <span className="numeral text-[13px] font-semibold text-ink">{fmtPts(results.teamTotals.get(`${t.id}:${tm.teamId}`) ?? 0, 1)} starter pts</span>
                      </div>
                      <ul className="mt-1 space-y-1 text-[13px] leading-[18px]">
                        {incoming.map((a) => {
                          if (a.type === "PLAYER" && a.player) {
                            const r = results.players.get(`${t.id}:${a.player.id}`);
                            return (
                              <li key={a.id} className="flex items-baseline justify-between gap-2">
                                <span className="min-w-0 truncate text-ink" title={a.player.fullName}>
                                  {a.player.fullName}
                                </span>
                                <span className="numeral shrink-0 text-muted">
                                  <b className="text-ink">{fmtPts(r?.started ?? 0, 1)}</b> · {r?.startedWeeks ?? 0} start{r?.startedWeeks === 1 ? "" : "s"} · {fmtPts(r?.total ?? 0, 1)} total
                                  {r && r.currentTeamId !== tm.teamId && <> · {r.currentTeamId ? `now ${teams.find((x) => x.id === r.currentTeamId)?.abbrev ?? "elsewhere"}` : "released"}</>}
                                </span>
                              </li>
                            );
                          }
                          const pk = a.pick ? results.picks.get(a.pick.id) : undefined;
                          return (
                            <li key={a.id} className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate text-ink" title={a.label}>
                                {a.label}
                              </span>
                              <span className="shrink-0 text-muted">
                                {pk?.used && pk.player ? (
                                  <>
                                    {pk.slot ? `${pk.slot} → ` : "→ "}
                                    <Link href={`/players/${pk.player.id}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">
                                      {pk.player.fullName}
                                    </Link>
                                  </>
                                ) : (
                                  "not used yet"
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
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
                <ButtonLink href={qs(page - 1)} variant="secondary">
                  Newer
                </ButtonLink>
              )}
              <span className="text-[13px] text-muted">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <ButtonLink href={qs(page + 1)} variant="secondary">
                  Older
                </ButtonLink>
              )}
            </nav>
          )}
        </div>

        <aside className="min-w-0">
          <Panel
            title="By team"
            subtitle={seasonFilter ? `${seasonFilter} completed trades` : "All completed trades"}
            info={<p>Players and picks in / out, net FAB and the most frequent partner for each team. Tap a team to see its trades.</p>}
            noPad
          >
            <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70" moreLabel="Show all teams">
              {statRows.map((r, i) => {
                const top = [...r.partners.entries()].sort((a, b) => b[1] - a[1])[0];
                const fab = r.faabNet > 0 ? ` · FAB +$${r.faabNet}` : r.faabNet < 0 ? ` · FAB −$${-r.faabNet}` : "";
                return (
                  <ListRow
                    key={r.team.id}
                    leading={
                      <span className="flex items-center gap-3">
                        <span className="numeral w-5 text-center text-[15px] font-semibold text-muted">{i + 1}</span>
                        <TeamLogo team={r.team} size={28} />
                      </span>
                    }
                    title={r.team.name}
                    subtitle={`+${r.playersIn}/−${r.playersOut} plyr · +${r.picksIn}/−${r.picksOut} picks${fab}${top ? ` · most with ${teams.find((t) => t.id === top[0])?.abbrev ?? "?"}` : ""}`}
                    value={r.trades}
                    valueSub={r.trades === 1 ? "trade" : "trades"}
                    mine={r.team.id === myTeam?.id}
                    href={`/trades/history?team=${r.team.id}`}
                  />
                );
              })}
            </ShowMore>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
