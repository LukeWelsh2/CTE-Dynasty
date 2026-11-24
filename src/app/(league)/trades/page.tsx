// Trade center — "Do I have offers to act on, and what is the league trading?"
// Summary strip (received · sent · in review · season trades, each a link to its list), the trading window with the
// rules behind an ⓘ, a Received / Sent / Review / League switch, then trade cards (actions in the card footer).
import Link from "next/link";
import { db } from "@/lib/db";
import { getLeagueContext } from "@/lib/league";
import { Alert, EmptyState, PageHeader, SeeAll, SegmentedLinks, SummaryStrip } from "@/components/ui/core";
import { TradesNav, TradeRulesStrip } from "@/components/trades/trade-nav";
import { TradeCard } from "@/components/trades/trade-card";
import { CancelOfferButton, CommishTradeButton, RespondButtons, TradeLiveRefresh, VoteButtons } from "@/components/trades/trade-actions";
import { loadTradeViews, tradeViewInclude, type TradeView } from "@/lib/trades/views";
import { acceptInfoFor, type AcceptInfo } from "@/lib/trades/respond";
import { rulesSummary, tradeLocksFor, withViewerLocks } from "@/lib/trades/assets";
import { draftHeldSeasons, rookieDraftsText } from "@/lib/trades/execute";
import { timeLeft } from "@/lib/trades/format";
import { canVoteOnTrade } from "@/lib/trades/rules";

export const metadata = { title: "Trades" };

type Tab = "received" | "sent" | "review" | "recent";

export default async function TradeCenterPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await getLeagueContext();
  const sp = await searchParams;
  const { league, settings, myTeam } = ctx;
  const tz = settings.general.timezone;
  const myId = myTeam?.id ?? null;
  const [rules, receivedRows, sentRows, reviewRows, recentRows, seasonCount] = await Promise.all([
    // league-state locks (my team out of the playoffs, pick seasons whose rookie draft is under way) applied to the strip
    db.team
      .findMany({ where: { leagueId: league.id }, select: { id: true, name: true } })
      .then((teams) => tradeLocksFor({ id: league.id, season: ctx.season, phase: league.phase }, settings, myId, teams))
      .then((locks) => withViewerLocks(rulesSummary(settings, league.phase, ctx.week, ctx.season), locks)),
    myId
      ? db.trade.findMany({ where: { leagueId: league.id, status: "PROPOSED", proposerTeamId: { not: myId }, teams: { some: { teamId: myId } } }, include: tradeViewInclude, orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    myId ? db.trade.findMany({ where: { leagueId: league.id, status: "PROPOSED", proposerTeamId: myId }, include: tradeViewInclude, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    db.trade.findMany({ where: { leagueId: league.id, status: "ACCEPTED" }, include: tradeViewInclude, orderBy: { acceptedAt: "asc" } }),
    db.trade.findMany({ where: { leagueId: league.id, status: { in: ["COMPLETED", "VETOED", "REVERSED"] } }, include: tradeViewInclude, orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }], take: 12 }),
    db.trade.count({ where: { leagueId: league.id, season: ctx.season, status: "COMPLETED" } }),
  ]);
  const counts = { received: receivedRows.length, sent: sentRows.length, review: reviewRows.length };
  const tab: Tab = (["received", "sent", "review", "recent"] as const).includes(sp.tab as Tab) ? (sp.tab as Tab) : counts.received ? "received" : counts.review ? "review" : counts.sent ? "sent" : "recent";
  const rows = tab === "received" ? receivedRows : tab === "sent" ? sentRows : tab === "review" ? reviewRows : recentRows;
  const views = await loadTradeViews(league.id, rows, { settings, season: ctx.season, viewerTeamId: myId });

  const lockedSeasons = (rules.lockedPickSeasons ?? []).map((l) => l.season);
  const now = Date.now();
  const acceptInfo = new Map<string, AcceptInfo>();
  if (tab === "received" && myId) {
    const state = { leagueId: league.id, season: ctx.season, phase: league.phase, week: ctx.week, settings };
    await Promise.all(views.map(async (v) => acceptInfo.set(v.id, await acceptInfoFor(v, myId, state))));
  }

  const actionsFor = (t: TradeView) => {
    if (tab === "received") {
      const me = t.teams.find((x) => x.teamId === myId);
      const info = acceptInfo.get(t.id);
      if (me?.accepted) return <span className="text-[13px] font-semibold text-win">You accepted — waiting on {t.teams.filter((x) => !x.accepted).map((x) => x.name).join(", ")}.</span>;
      return (
        <>
          {info?.errors.length ? <Alert tone="error" className="w-full">{info.errors.join(" ")}</Alert> : null}
          {rules.windowOpen && (
            <RespondButtons
              tradeId={t.id}
              dropsNeeded={info?.dropsNeeded ?? 0}
              capOverBy={info?.capOverBy ?? 0}
              capLimit={info?.capLimit ?? null}
              capLimitLabel={info?.capLimitLabel}
              capBefore={info?.capBefore}
              capAfter={info?.capAfter}
              candidates={info?.candidates ?? []}
            />
          )}
        </>
      );
    }
    if (tab === "sent") return <CancelOfferButton tradeId={t.id} />;
    if (tab === "review") {
      const involved = !!myId && t.teams.some((x) => x.teamId === myId);
      const canVote = canVoteOnTrade(settings, t.teams.map((x) => x.teamId), myId);
      const held = draftHeldSeasons(t.assets, lockedSeasons);
      const voteOpen = !!t.reviewEndsAt && t.reviewEndsAt.getTime() > now;
      const waiting = held.length > 0 && !voteOpen;
      return (
        <>
          {waiting && <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-300">Waiting for {rookieDraftsText(held)} to finish.</span>}
          {!!t.reviewEndsAt && !voteOpen && !held.length && <span className="text-[13px] text-muted">League review ended.</span>}
          {voteOpen && canVote && (
            <VoteButtons tradeId={t.id} mine={t.votes.mine} approve={t.votes.approve} veto={t.votes.veto} required={t.votes.required} showCounts={settings.commissioner.publicTradeVotes || ctx.isCommish} />
          )}
          {voteOpen && involved && !canVote && <span className="text-[13px] text-muted">League review in progress · {t.votes.veto}/{t.votes.required} vetoes · {timeLeft(t.reviewEndsAt)}</span>}
          {!t.reviewEndsAt && !ctx.isCommish && <span className="text-[13px] text-muted">Waiting for commissioner approval.</span>}
          {ctx.isCommish && (
            <span className="ml-auto flex gap-2">
              <CommishTradeButton tradeId={t.id} kind="approve" />
              <CommishTradeButton tradeId={t.id} kind="veto" />
            </span>
          )}
        </>
      );
    }
    return null;
  };

  const tabs = [
    { key: "received", label: "Received", href: "/trades?tab=received" },
    { key: "sent", label: "Sent", href: "/trades?tab=sent" },
    { key: "review", label: "Review", href: "/trades?tab=review" },
    { key: "recent", label: "League", href: "/trades?tab=recent" },
  ];
  const reviewLabel = settings.trades.reviewType === "LEAGUE_VOTE" ? "vote" : settings.trades.reviewType === "COMMISSIONER" ? "commish" : "none";
  const empty: Record<Tab, { title: string; body: React.ReactNode }> = {
    received: { title: "No offers waiting on you", body: "Offers sent to you show up here." },
    sent: {
      title: "No open offers",
      body: (
        <>
          Build one in{" "}
          <Link className="link" href="/trades/new">
            Propose
          </Link>{" "}
          or try ideas in the{" "}
          <Link className="link" href="/trades/calculator">
            calculator
          </Link>
          .
        </>
      ),
    },
    review: { title: "Nothing in review", body: settings.trades.reviewType === "NONE" ? "Trades process as soon as every team accepts." : settings.trades.reviewType === "COMMISSIONER" ? "Accepted trades wait here for commissioner approval." : "Accepted trades wait here for the league vote." },
    recent: { title: "No trades yet", body: "Completed league trades appear here." },
  };

  return (
    <div>
      <TradeLiveRefresh leagueId={league.id} />
      <PageHeader title="Trades" />
      <TradesNav active="center" showBlock={settings.trades.showTradeBlock} isCommish={ctx.isCommish} />
      <TradeRulesStrip rules={rules} />
      {!myTeam && <Alert tone="info" className="mb-3">You don&apos;t manage a team here, so you can follow trades but not make them.</Alert>}

      <SummaryStrip
        className="mb-4"
        items={[
          { label: "Received", value: counts.received, sub: "for you", tone: counts.received ? "brand" : undefined, href: "/trades?tab=received" },
          { label: "Sent", value: counts.sent, sub: "open", href: "/trades?tab=sent" },
          { label: "Review", value: counts.review, sub: reviewLabel, href: "/trades?tab=review" },
          { label: `${ctx.season}`, value: seasonCount, sub: "trades", href: "/trades/history" },
        ]}
      />

      <SegmentedLinks options={tabs} active={tab} full className="mb-3 sm:max-w-md" ariaLabel="Trade lists" />
      {views.length ? (
        <div className="space-y-3">
          {views.map((t) => (
            <TradeCard key={t.id} trade={t} tz={tz} viewerTeamId={myId} actions={actionsFor(t)} />
          ))}
          {tab === "recent" && (
            <div className="card overflow-hidden">
              <SeeAll href="/trades/history" className="border-t-0">
                Every league trade
              </SeeAll>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title={empty[tab].title}>{empty[tab].body}</EmptyState>
      )}
    </div>
  );
}
