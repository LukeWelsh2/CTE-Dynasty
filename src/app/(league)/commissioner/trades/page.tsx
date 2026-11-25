import Link from "next/link";
import { db } from "@/lib/db";
import { requireCommissioner } from "@/lib/league";
import { Badge, ButtonLink, EmptyState, MoreLink, PageHeader, Panel, SectionHeader, SummaryStrip } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { TradesNav, TradeRulesStrip } from "@/components/trades/trade-nav";
import { StatusBadge, TradeCard } from "@/components/trades/trade-card";
import { CommishTradeButton, TradeLiveRefresh } from "@/components/trades/trade-actions";
import { loadTradeViews, tradeViewInclude } from "@/lib/trades/views";
import { rulesSummary, tradeLocksFor, withViewerLocks } from "@/lib/trades/assets";
import { draftHeldSeasons, rookieDraftsText } from "@/lib/trades/execute";
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
  // league-wide locks only (no viewer team: this is the commissioner's view): pick seasons whose rookie draft is under way
  const rules = withViewerLocks(rulesSummary(settings, league.phase, ctx.week, ctx.season), await tradeLocksFor({ id: league.id, season: ctx.season, phase: league.phase }, settings, null, []));
  const lockedSeasons = (rules.lockedPickSeasons ?? []).map((l) => l.season);
  const now = Date.now();
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
  // accepted trades with a pick of a rookie draft that is under way wait for the draft (approval is refused until then)
  const draftNote = (t: (typeof review)[number]) => {
    const held = draftHeldSeasons(t.assets, lockedSeasons);
    if (!held.length) return null;
    const inReview = !!t.reviewEndsAt && t.reviewEndsAt.getTime() > now;
    return (
      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
        {inReview ? `Includes ${held.join(" and ")} picks, locked while ${rookieDraftsText(held)} ${held.length === 1 ? "is" : "are"} under way` : `Waiting for ${rookieDraftsText(held)} to finish`}
      </span>
    );
  };

  return (
    <div>
      <TradeLiveRefresh leagueId={league.id} />
      <PageHeader title="Trade review" subtitle="Every action is logged" actions={<MoreLink href="/commissioner/settings?tab=trades">Settings</MoreLink>} />
      <TradesNav active="commish" showBlock={settings.trades.showTradeBlock} isCommish />
      <TradeRulesStrip rules={rules} />
      <SummaryStrip
        className="mb-4"
        items={[
          {
            label: "Review",
            value: review.length,
            tone: review.length ? "bad" : undefined,
            sub: settings.trades.reviewType === "COMMISSIONER" ? "need you" : settings.trades.reviewType === "LEAGUE_VOTE" ? "in vote" : "no review",
            href: "#review",
            title: settings.trades.reviewType === "COMMISSIONER" ? "Accepted trades that need your approval" : settings.trades.reviewType === "LEAGUE_VOTE" ? "League vote running" : "No review step",
          },
          { label: "Open", value: open.length, sub: "offers", href: "#open" },
          { label: "Done", value: count("COMPLETED"), sub: `${count("REVERSED")} reversed`, href: "#completed", title: `${ctx.season} completed trades` },
          { label: "Vetoed", value: count("VETOED"), sub: `${count("REJECTED") + count("EXPIRED")} other`, title: `${ctx.season}: ${count("VETOED")} vetoed · ${count("REJECTED")} rejected · ${count("EXPIRED")} expired` },
        ]}
      />

      <section id="review" className="mb-6 scroll-mt-4">
        <SectionHeader title="Pending review" sub={review.length ? `${review.length} accepted trade${review.length === 1 ? "" : "s"}` : undefined} />
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
                      <span className="text-[13px] text-muted">
                        League vote: <b className="text-ink">{t.votes.veto}</b>/{t.votes.required} vetoes, {t.votes.approve} approvals · {timeLeft(t.reviewEndsAt)}
                      </span>
                    )}
                    {myTeam && t.teams.some((x) => x.teamId === myTeam.id) && <Badge tone="amber">Your own trade</Badge>}
                    {draftNote(t)}
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

      <section id="open" className="mb-6 scroll-mt-4">
        <SectionHeader title="Open offers" sub={open.length ? `${open.length} between managers` : undefined} />
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
        <Panel id="completed" title="Completed trades" subtitle={`Last ${completed.length}`} info={<p>Reverse moves every player, pick and FAB dollar back. A trade can&apos;t be reversed while the rookie draft for one of its picks is under way.</p>} noPad className="scroll-mt-4">
          {completed.length ? (
            <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
              {completed.map((t) => {
                // a completed trade can't be reversed while its picks' rookie draft is under way (reverseTrade)
                const held = t.status === "COMPLETED" ? draftHeldSeasons(t.assets, lockedSeasons) : [];
                return (
                  <li key={t.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                      <StatusBadge status={t.status} />
                      <span>
                        {fmtWhen(t.completedAt, tz)} · wk {t.week}
                      </span>
                      {t.evaluation && (
                        <span className={cn("ml-auto font-semibold", t.evaluation.verdictTone === "lopsided" ? "text-loss" : t.evaluation.verdictTone === "slight" ? "text-amber-700 dark:text-amber-300" : "text-win")}>
                          Fair {Math.round(t.evaluation.fairness * 100)}%
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1 text-[14px] leading-snug sm:text-[13px]">
                      {t.teams.map((tm) => (
                        <li key={tm.teamId}>
                          <b className="text-ink">{tm.name}</b> <span className="text-muted">gets</span>{" "}
                          <span className="text-ink">
                            {t.assets
                              .filter((x) => x.toTeamId === tm.teamId)
                              .map((x) => x.label)
                              .join(", ") || "nothing"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2">
                      <ButtonLink href={`/trades/${t.id}`} variant="secondary" size="sm">
                        Details
                      </ButtonLink>
                      {held.length ? (
                        <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">
                          Can&apos;t be reversed while {rookieDraftsText(held)} {held.length === 1 ? "is" : "are"} under way
                        </span>
                      ) : t.status === "COMPLETED" ? (
                        <CommishTradeButton tradeId={t.id} kind="reverse" size="sm" />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ShowMore>
          ) : (
            <div className="px-4 pb-4">
              <EmptyState title="No completed trades yet" />
            </div>
          )}
        </Panel>
        <Panel title="Trade log" subtitle="Commissioner trade actions" noPad>
          {audit.length ? (
            <ShowMore as="ul" initial={5} className="divide-y divide-line/70 border-t border-line/70">
              {audit.map((a) => {
                const d = (a.details ?? {}) as { note?: string | null; headline?: string };
                return (
                  <li key={a.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-semibold text-ink sm:text-sm">{ACTION_LABEL[a.action] ?? a.action}</span>
                      <span className="shrink-0 text-[12px] text-muted">{fmtWhen(a.createdAt, tz)}</span>
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
            </ShowMore>
          ) : (
            <p className="border-t border-line/70 px-4 py-4 text-[15px] text-muted sm:text-sm">No commissioner trade actions yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
