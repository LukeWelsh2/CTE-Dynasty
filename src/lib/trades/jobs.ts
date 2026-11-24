// Background job "trade-review" (every 5 minutes): completes league-vote trades whose review period ended
// without enough vetoes, expires stale offers and cancels offers whose assets have moved. Trades that can't be
// processed yet (a player already played this week under lockedPlayersPolicy BLOCK, or a pick whose rookie draft
// is under way) stay ACCEPTED and are retried on every run until the lock clears.
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { voteTally } from "@/lib/trades/rules";
import { cancelStaleTrades, completeTrade, loadTrade, notifyTeams, publishTradeEvent, tradeHeadline, transitionTrade, vetoTrade, commissionerUserIds } from "@/lib/trades/execute";
import { notify } from "@/lib/notify";

export type ReviewOutcome = "completed" | "vetoed" | "held-week" | "held-draft" | "failed" | "skipped";

/**
 * Settle one ACCEPTED league-vote trade whose review period ended: veto it, complete it, hold it (it stays
 * ACCEPTED and is retried on the next run) or cancel it with the reason when it can't be processed.
 */
export async function settleReviewedTrade(t: { id: string; votes: { vote: string }[]; league: { settings: unknown } }): Promise<ReviewOutcome> {
  const settings = resolveSettings(t.league.settings);
  if (voteTally(t.votes, settings.trades.vetoVotesRequired).vetoed) {
    const r = await vetoTrade(t.id, { byCommissioner: false, note: "Vetoed by league vote" });
    return r.ok ? "vetoed" : "skipped";
  }
  const r = await completeTrade(t.id, { note: "Review period ended without a veto" });
  if (r.ok) return "completed";
  if (r.code === "LOCKED") return "held-week"; // lockedPlayersPolicy BLOCK: retried on a later run once the week is over
  if (r.code === "DRAFT_LOCKED") return "held-draft"; // draft.rookie.tradingDuringDraft off: retried once the draft is over
  const ok = await transitionTrade(t.id, ["ACCEPTED"], { status: "CANCELLED", resolutionNote: `Could not be processed: ${r.error}` });
  if (ok) {
    const full = await loadTrade(t.id);
    if (full) {
      publishTradeEvent(full.leagueId, full.id, "CANCELLED");
      await notifyTeams(full, full.teams.map((x) => x.teamId), "TRADE_CANCELLED", "Trade could not be processed", `${tradeHeadline(full)} — ${r.error}`);
      await notify({ userIds: await commissionerUserIds(full.leagueId), leagueId: full.leagueId, type: "TRADE_REVIEW", title: "A trade failed to process", body: `${tradeHeadline(full)} — ${r.error}`, url: `/trades/${full.id}` }).catch(() => null);
    }
  }
  return "failed";
}

export async function processTradeReviews(): Promise<string> {
  const now = new Date();
  let completed = 0;
  let vetoed = 0;
  let expired = 0;
  let failed = 0;
  let cancelled = 0;
  let heldWeek = 0;
  let heldDraft = 0;

  // 1. Review periods that ended (league vote). Commissioner-review trades have no reviewEndsAt.
  const due = await db.trade.findMany({ where: { status: "ACCEPTED", reviewEndsAt: { lte: now } }, include: { votes: true, league: { select: { settings: true } } } });
  for (const t of due) {
    const out = await settleReviewedTrade(t);
    if (out === "completed") completed++;
    else if (out === "vetoed") vetoed++;
    else if (out === "held-week") heldWeek++;
    else if (out === "held-draft") heldDraft++;
    else if (out === "failed") failed++;
  }

  // 2. Offers past their expiration
  const stale = await db.trade.findMany({ where: { status: "PROPOSED", expiresAt: { lte: now } }, select: { id: true } });
  for (const s of stale) {
    const ok = await transitionTrade(s.id, ["PROPOSED"], { status: "EXPIRED", resolutionNote: "Offer expired" });
    if (!ok) continue;
    expired++;
    const full = await loadTrade(s.id);
    if (full) {
      publishTradeEvent(full.leagueId, full.id, "EXPIRED");
      await notifyTeams(full, full.teams.map((x) => x.teamId), "TRADE_CANCELLED", "Trade offer expired", tradeHeadline(full));
    }
  }

  // 3. Offers whose players / picks / FAB are no longer available
  const leagues = await db.trade.findMany({ where: { status: { in: ["PROPOSED", "ACCEPTED"] } }, distinct: ["leagueId"], select: { leagueId: true } });
  for (const l of leagues) cancelled += await cancelStaleTrades(l.leagueId);

  const held = [heldWeek ? `held until the week ends ${heldWeek}` : "", heldDraft ? `held until the rookie draft ends ${heldDraft}` : ""].filter(Boolean);
  return `completed ${completed}, vetoed ${vetoed}, expired ${expired}, auto-cancelled ${cancelled}, failed ${failed}${held.length ? `, ${held.join(", ")}` : ""}`;
}
