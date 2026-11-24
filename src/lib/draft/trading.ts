// Draft-driven transaction locks: pick trading while a rookie draft is running (settings.draft.rookie.tradingDuringDraft)
// and players held for the auction pool until the season's salary auction is complete
// (settings.keepers.releasedPlayersReturnTo). Light module (no notify/web-push/server-only imports) so the trades,
// players and waivers modules (and background jobs) can call it from their validation.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { auctionPoolHold, isRolloverRelease } from "@/lib/players/logic";

type Client = Prisma.TransactionClient | typeof db;

/** Can draft picks of `season` be traded right now? (false while that season's rookie draft is live/paused and the league forbids it) */
export async function pickTradingOpen(leagueId: string, season: number, settings: LeagueSettings, client: Client = db): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!settings.trades.enabled || !settings.trades.allowDraftPickTrading) return { ok: false, reason: "Draft pick trading is turned off in this league." };
  if (settings.draft.rookie.tradingDuringDraft) return { ok: true };
  const live = await client.draft.findFirst({ where: { leagueId, season, type: "ROOKIE", status: { in: ["LIVE", "PAUSED"] } }, select: { name: true } });
  return live ? { ok: false, reason: `${season} picks can't be traded while the ${live.name} is under way.` } : { ok: true };
}

/** Seasons whose picks are locked right now because their rookie draft is running (empty when trading during drafts is allowed). */
export async function lockedPickSeasons(leagueId: string, settings: LeagueSettings, client: Client = db): Promise<number[]> {
  if (settings.draft.rookie.tradingDuringDraft) return [];
  const live = await client.draft.findMany({ where: { leagueId, type: "ROOKIE", status: { in: ["LIVE", "PAUSED"] } }, select: { season: true } });
  return [...new Set(live.map((d) => d.season))];
}

/** Has `season`'s salary auction (startup or free-agent auction) been completed? */
export async function seasonAuctionComplete(leagueId: string, season: number, client: Client = db): Promise<boolean> {
  return !!(await client.draft.findFirst({ where: { leagueId, season, type: "AUCTION", status: "COMPLETE" }, select: { id: true } }));
}

/**
 * Players held for the auction pool (settings.keepers.releasedPlayersReturnTo = AUCTION_POOL): released at the
 * rollover into `season` (Transaction type KEEPER with details.rolloverRelease) while no auction of `season` is
 * complete. Pass `playerIds` to check only those players. Empty (no queries) when the league sends released
 * players straight to free agency.
 */
export async function auctionPoolPlayerIds(leagueId: string, season: number, settings: LeagueSettings, opts: { playerIds?: string[]; client?: Client } = {}): Promise<Set<string>> {
  const out = new Set<string>();
  if (settings.keepers.releasedPlayersReturnTo !== "AUCTION_POOL") return out;
  if (opts.playerIds && !opts.playerIds.length) return out;
  const client = opts.client ?? db;
  const [auctionComplete, releases] = await Promise.all([
    seasonAuctionComplete(leagueId, season, client),
    client.transaction.findMany({
      where: { leagueId, season, type: "KEEPER", playerId: opts.playerIds ? { in: opts.playerIds } : { not: null }, details: { path: ["rolloverRelease"], equals: true } },
      select: { playerId: true, type: true, details: true },
    }),
  ]);
  for (const r of releases) {
    if (r.playerId && auctionPoolHold(settings, { releasedAtRollover: isRolloverRelease(r) }, { auctionComplete })) out.add(r.playerId);
  }
  return out;
}
