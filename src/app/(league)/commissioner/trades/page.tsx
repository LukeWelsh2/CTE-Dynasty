import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Badge, ButtonLink, EmptyState, PageHeader, Panel, StatTile } from "@/components/ui/core";
import { TradesNav, TradeRulesStrip } from "@/components/trades/trade-nav";
import { StatusBadge, TradeCard } from "@/components/trades/trade-card";
import { CommishTradeButton, TradeLiveRefresh } from "@/components/trades/trade-actions";
import { loadTradeViews, tradeViewInclude } from "@/lib/trades/views";
import { rulesSummary } from "@/lib/trades/assets";
import { fmtWhen, timeLeft } from "@/lib/trades/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Trade Review" };

const ACTION_LABEL: Record<string, string> = {
  "trade.approve": "Approved trade",
  "trade.veto": "Vetoed trade",
  "trade.force_complete": "Force-completed trade",
  "trade.reverse": "Reversed trade",
  "trade.cancel": "Cancelled trade",
  "trade.block_remove": "Removed trade block entry",
};

export default async function CommissionerTradesPage() {
  const ctx = await requireCommissioner();
  const { league, settings, myTeam } = ctx;
  const tz = settings.general.timezone;
  const rules = rulesSummary(settings, league.phase, ctx.week, ctx.season);
  const [reviewRows, openRows, completedRows, audit, counts] = await Promise.all([
    db.trade.findMany({ where: { leagueId: league.id, status: "ACCEPTED" }, include: tradeViewInclude, orderBy: { acceptedAt: "asc" } }),
    db.trade.findMany({ where: { leagueId: league.id, status: "PROPOSED" }, include: tradeViewInclude, orderBy: { createdAt: "desc" } }),
    db.trade.findMany({ where: { leagueId: league.id, status: { in: ["COMPLETED", "REVERSED"] } }, include: tradeViewInclude, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }], take: 25 }),
    db.auditLog.findMany({ where: { leagueId: league.id, action: { startsWith: "trade." } }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.trade.groupBy({ by: ["status"], where: { leagueId: league.id, season: ctx.season }, _count: true }),
  ]);
  const [review, open, completed] = await Promise.all([
    loadTradeViews(league.id, reviewRows, { settings, season: ctx.season, viewerTeamId: myTeam?.id }),
    loadTradeViews(league.id, openRows, { settings, season: ctx.season, viewerTeamId: myTeam?.id }),
    loadTradeViews(league.id, completedRows, { settings, season: ctx.season, viewerTeamId: myTeam?.id }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <div>
      <TradeLiveRefresh leagueId={league.id} />
      <PageHeader
        kicker="Commissioner"
        title="Trade Review"
        subtitle="Approve or veto accepted trades, force or cancel offers, and reverse completed deals. Every action is logged."
        actions={
          <ButtonLink href="/commissioner/settings" variant="secondary" size="sm">
            Trade settings
          </ButtonLink>
        }
      />
      <TradesNav active="commish" showBlock={settings.trades.showTradeBlock} isCommish />
      <TradeRulesStrip rules={rules} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Awaiting review" value={review.length} tone={review.length ? "bad" : undefined} sub={settings.trades.reviewType === "COMMISSIONER" ? "needs your approval" : settings.trades.reviewType === "LEAGUE_VOTE" ? "league vote running" : "no review step"} />
        <StatTile label="Open offers" value={open.length} sub="between managers" />
        <StatTile label={`${ctx.season} completed`} value={count("COMPLETED")} sub={`${count("REVERSED")} reversed`} />
        <StatTile label={`${ctx.season} vetoed`} value={count("VETOED")} sub={`${count("REJECTED")} rejected · ${count("EXPIRED")} expired`} />
      </div>

      <section className="mb-6">
        <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wide text-ink">Pending review</h2>
        {review.length ? (
          <div className="space-y-3">
            {review.map((t) => (
              <TradeCard
                key={t.id}
                trade={t}
                tz={tz}
                viewerTeamId={myTeam?.id}
                actions={
                  <>
                    {t.reviewEndsAt && (
                      <span className="text-xs text-muted">
                        League vote: <b className="text-ink">{t.votes.veto}</b>/{t.votes.required} vetoes, {t.votes.approve} approvals · {timeLeft(t.reviewEndsAt)}
                      </span>
                    )}
                    {myTeam && t.teams.some((x) => x.teamId === myTeam.id) && <Badge tone="amber">Your own trade</Badge>}
                    <span className="ml-auto flex flex-wrap gap-2">
                      <CommishTradeButton tradeId={t.id} kind="approve" />
                      <CommishTradeButton tradeId={t.id} kind="veto" />
                      <CommishTradeButton tradeId={t.id} kind="cancel" />
                    </span>
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No trades waiting for review">Accepted trades show up here {settings.trades.reviewType === "COMMISSIONER" ? "for your approval" : "while the review period runs"}.</EmptyState>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-display text-lg font-bold uppercase tracking-wide text-ink">Open offers</h2>
        {open.length ? (
          <div className="space-y-3">
            {open.map((t) => (
              <TradeCard
                key={t.id}
                trade={t}
                tz={tz}
                viewerTeamId={myTeam?.id}
                actions={
                  <span className="ml-auto flex flex-wrap gap-2">
                    <CommishTradeButton tradeId={t.id} kind="force" />
                    <CommishTradeButton tradeId={t.id} kind="veto" />
                    <CommishTradeButton tradeId={t.id} kind="cancel" />
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No open offers">Offers between managers appear here until they're accepted, rejected or expire.</EmptyState>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Completed trades" subtitle="Reverse moves every player, pick and FAB dollar back" noPad>
          {completed.length ? (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Processed</th>
                    <th>Trade</th>
                    <th className="num hidden sm:table-cell">Fair</th>
                    <th className="hidden text-right sm:table-cell">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-xs">
                        <StatusBadge status={t.status} />
                        <div className="mt-0.5 text-muted">
                          {fmtWhen(t.completedAt, tz)} · wk {t.week}
                        </div>
                      </td>
                      <td className="text-xs sm:min-w-[260px]">
                        {t.teams.map((tm) => (
                          <div key={tm.teamId}>
                            <b className="text-ink">{tm.name}</b> gets{" "}
                            <span className="text-muted">
                              {t.assets
                                .filter((a) => a.toTeamId === tm.teamId)
                                .map((a) => a.label)
                                .join(", ") || "nothing"}
                            </span>
                          </div>
                        ))}
                        {/* phones: actions under the summary instead of an off-screen column */}
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                          {t.evaluation && <span className="text-muted">Fairness {Math.round(t.evaluation.fairness * 100)}% ·</span>}
                          <ButtonLink href={`/trades/${t.id}`} variant="secondary" size="xs">
                            Details
                          </ButtonLink>
                          {t.status === "COMPLETED" && <CommishTradeButton tradeId={t.id} kind="reverse" size="xs" />}
                        </span>
                      </td>
                      <td className={cn("num hidden text-xs font-semibold sm:table-cell", t.evaluation?.verdictTone === "lopsided" ? "text-loss" : t.evaluation?.verdictTone === "slight" ? "text-amber-600" : "text-win")}>
                        {t.evaluation ? `${Math.round(t.evaluation.fairness * 100)}%` : "—"}
                      </td>
                      <td className="hidden text-right sm:table-cell">
                        <span className="inline-flex flex-wrap justify-end gap-1.5">
                          <ButtonLink href={`/trades/${t.id}`} variant="ghost" size="xs">
                            Details
                          </ButtonLink>
                          {t.status === "COMPLETED" && <CommishTradeButton tradeId={t.id} kind="reverse" size="xs" />}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-3">
              <EmptyState title="No completed trades yet" />
            </div>
          )}
        </Panel>
        <Panel title="Trade audit log" subtitle="Commissioner trade actions" noPad>
          {audit.length ? (
            <ul className="divide-y divide-line">
              {audit.map((a) => {
                const d = (a.details ?? {}) as { note?: string | null; headline?: string };
                return (
                  <li key={a.id} className="px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink">{ACTION_LABEL[a.action] ?? a.action}</span>
                      <span className="shrink-0 text-muted">{fmtWhen(a.createdAt, tz)}</span>
                    </div>
                    <div className="text-muted">
                      by {a.actor?.name ?? "system"}
                      {a.targetType === "trade" && a.targetId && a.action !== "trade.block_remove" && (
                        <>
                          {" "}
                          ·{" "}
                          <Link href={`/trades/${a.targetId}`} className="link">
                            view trade
                          </Link>
                        </>
                      )}
                    </div>
                    {d.headline && <div className="mt-0.5 text-ink">{d.headline}</div>}
                    {d.note && <div className="mt-0.5 italic text-muted">“{d.note}”</div>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-3 text-sm text-muted">No commissioner trade actions yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
