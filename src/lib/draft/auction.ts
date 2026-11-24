// Live salary auction engine: nominations, concurrency-safe bids, proxy auto-bids, lot closing.
import type { AuctionLot, Draft, Prisma } from "@prisma/client";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { addPlayerToTeam, broadcastTransaction } from "@/lib/roster-ops";
import { computeStandings } from "@/lib/standings";
import { postSystemMessage } from "@/lib/chat-system";
import { clampYears, extendEndsAt, lastIndexOfTeam, maxBidFor, maxYearsUnderLimits, minNextBid, nextNominator, openRosterSpots, resolveProxyBids, shuffle } from "@/lib/draft/logic";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { activeRosterLimit, bindingCapRoom } from "@/lib/roster-rules";
import { auctionEligibleWhere, auctionRules, auctionYearOptions, getAdpMap, leagueRosterSnapshot, type AuctionDraftRules } from "@/lib/draft/data";
import { DraftError, audit, draftOrderIds, emit, loadDraft, notifyTeam, txWeekFor } from "@/lib/draft/shared";

const AUCTION_URL = (id: string) => `/draft/auction?id=${id}`;

export interface AuctionTeamBudget {
  teamId: string;
  spent: number;
  won: number;
  remaining: number;
  maxBid: number;
  openSpots: number;
  /**
   * Room under the payroll ceiling that limits bids (bindingCapRoom: capLimit for the draft season's cap, enforced
   * per capEnforcement for the league phase). null when the cap doesn't limit bids: cap off, not enforced right now
   * (in-season enforcement off, or offseason enforcement only warning), or a soft cap without a max overage.
   */
  capSpace: number | null;
  /** active-roster limit the open spots are counted against (activeRosterLimit for the league phase) */
  maxActive: number;
  activeCount: number;
  wonByPosition: Record<string, number>;
  spentByPosition: Record<string, number>;
  /** longest contract this team may still sign (settings.contracts.lengthLimits) */
  maxYears: number;
}

/**
 * Cap room that limits a team's auction bids: the payroll ceiling for the draft season (capLimit of that season's
 * cap — salaryCap.cap plus annualCapIncrease per season ahead) minus its committed salary and dead money, when the
 * cap is enforced in the league's current phase (capEnforcement BLOCK); null when the cap doesn't limit bids.
 */
export function auctionCapSpace(
  snap: { committed: number; deadMoney: number },
  settings: LeagueSettings,
  ctx: { seasonOffset: number; phase: string | null | undefined; now?: Date },
): number | null {
  if (!settings.salaryCap.enabled) return null;
  const seasonCap = settings.salaryCap.cap + Math.max(0, ctx.seasonOffset) * (settings.salaryCap.annualCapIncrease ?? 0);
  return bindingCapRoom(snap.committed + snap.deadMoney, settings, { phase: ctx.phase, now: ctx.now, cap: seasonCap });
}

/**
 * Budget, max bid and open roster spots for every team in an auction (batched).
 * remaining = min(auction budget − spent in this draft, cap room under the ceiling while the cap is enforced:
 * auctionCapSpace); max bid keeps minBid for every other open spot (BUDGET_MINUS_OPEN_SLOTS) and never exceeds the
 * league max salary. Open spots are counted against activeRosterLimit for the league phase.
 */
export async function auctionBudgets(
  draft: Pick<Draft, "id" | "leagueId" | "season" | "settings">,
  settings: LeagueSettings,
  rules?: AuctionDraftRules,
  opts: { leagueSeason?: number; leaguePhase?: string; now?: Date } = {},
): Promise<Map<string, AuctionTeamBudget>> {
  const r = rules ?? auctionRules(draft, settings);
  const league =
    opts.leagueSeason !== undefined && opts.leaguePhase !== undefined
      ? { season: opts.leagueSeason, phase: opts.leaguePhase }
      : await db.league.findUnique({ where: { id: draft.leagueId }, select: { season: true, phase: true } });
  const leagueSeason = opts.leagueSeason ?? league?.season ?? draft.season;
  const phase = opts.leaguePhase ?? league?.phase ?? null;
  const now = opts.now ?? new Date();
  const maxActive = activeRosterLimit(settings, { phase, now });
  const [sold, snapshot] = await Promise.all([
    db.auctionLot.findMany({ where: { draftId: draft.id, status: "SOLD" }, select: { winnerTeamId: true, currentBid: true, player: { select: { position: true } } } }),
    leagueRosterSnapshot(draft.leagueId, draft.season, settings, { leagueSeason }),
  ]);
  const yearOptions = auctionYearOptions(r, settings);
  const limits = settings.contracts.enabled ? settings.contracts.lengthLimits ?? [] : [];
  const out = new Map<string, AuctionTeamBudget>();
  for (const [teamId, snap] of snapshot) {
    out.set(teamId, {
      teamId, spent: 0, won: 0, remaining: 0, maxBid: 0, openSpots: 0, activeCount: snap.active, maxActive,
      capSpace: auctionCapSpace(snap, settings, { seasonOffset: draft.season - leagueSeason, phase, now }),
      wonByPosition: {}, spentByPosition: {}, maxYears: maxYearsUnderLimits(yearOptions, snap.contractYears, limits),
    });
  }
  for (const lot of sold) {
    const b = lot.winnerTeamId ? out.get(lot.winnerTeamId) : null;
    if (!b) continue;
    const pos = normalizePosition(lot.player.position);
    b.spent += lot.currentBid;
    b.won += 1;
    b.wonByPosition[pos] = (b.wonByPosition[pos] ?? 0) + 1;
    b.spentByPosition[pos] = (b.spentByPosition[pos] ?? 0) + lot.currentBid;
  }
  for (const b of out.values()) {
    b.openSpots = openRosterSpots({ rosterSpotsToFill: r.rosterSpotsToFill, wonInDraft: b.won, maxActiveRoster: b.maxActive, activeCount: b.activeCount });
    const mb = maxBidFor({ budget: r.budget, spent: b.spent, capSpace: b.capSpace, openSpots: b.openSpots, minBid: r.minBid, rule: r.maxBidRule, maxSalary: settings.salaryCap.maxSalary });
    b.remaining = mb.remaining;
    b.maxBid = mb.maxBid;
  }
  return out;
}

export const canNominate = (b: AuctionTeamBudget | undefined, minBid: number) => !!b && b.openSpots > 0 && b.maxBid >= Math.max(1, minBid);

/** Nomination order per settings.draft.auction.nominationOrder. */
export async function auctionNominationOrder(leagueId: string, season: number, method: AuctionDraftRules["nominationOrder"], settings: LeagueSettings): Promise<string[]> {
  const teams = await db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const ids = teams.map((t) => t.id);
  if (method === "RANDOM") return shuffle(ids, () => crypto.randomInt(0, 1_000_000) / 1_000_000);
  if (method === "REVERSE_STANDINGS") {
    let standings = await computeStandings(leagueId, season, settings);
    if (!standings.some((s) => s.wins + s.losses + s.ties > 0)) standings = await computeStandings(leagueId, season - 1, settings);
    if (standings.some((s) => s.wins + s.losses + s.ties > 0)) return [...standings].reverse().map((s) => s.team.id);
  }
  return ids;
}

export async function createAuctionDraft(input: {
  leagueId: string;
  season: number;
  name: string;
  kind: "STARTUP" | "FREE_AGENT";
  nominationOrder: AuctionDraftRules["nominationOrder"];
  startTime: Date | null;
  actorId: string | null;
}): Promise<Draft> {
  const league = await db.league.findUniqueOrThrow({ where: { id: input.leagueId } });
  const settings = resolveSettings(league.settings);
  const open = await db.draft.findFirst({ where: { leagueId: league.id, type: "AUCTION", status: { in: ["SCHEDULED", "LIVE", "PAUSED"] } } });
  if (open) throw new DraftError(`"${open.name}" is still open — complete or delete it before creating another auction.`);
  const order = await auctionNominationOrder(league.id, input.season, input.nominationOrder, settings);
  const draft = await db.draft.create({
    data: {
      leagueId: league.id,
      season: input.season,
      type: "AUCTION",
      status: "SCHEDULED",
      name: input.name,
      startTime: input.startTime,
      settings: { kind: input.kind, nominationOrder: input.nominationOrder } as Prisma.InputJsonValue,
      order,
    },
  });
  await audit(league.id, input.actorId, "draft.create", draft.id, { type: "AUCTION", kind: input.kind, season: input.season, order });
  return draft;
}

export async function setAuctionOrder(draftId: string, teamIds: string[], actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.type !== "AUCTION") throw new DraftError("Not an auction");
  const lots = await db.auctionLot.count({ where: { draftId } });
  if (lots > 0) throw new DraftError("Nominations have started — the order can no longer change.");
  const teams = await db.team.findMany({ where: { leagueId: draft.leagueId }, select: { id: true } });
  const valid = teamIds.filter((id, i) => teams.some((t) => t.id === id) && teamIds.indexOf(id) === i);
  const full = [...valid, ...teams.map((t) => t.id).filter((id) => !valid.includes(id))];
  await db.draft.update({ where: { id: draftId }, data: { order: full, currentIndex: 0 } });
  await audit(draft.leagueId, actorId, "draft.order", draftId, { order: full });
  emit(draftId, "draft.order");
}

/** The auction's player pool (settings.draft.auction.includesRookies decides whether first-year players are in it). */
export function auctionPoolWhere(draft: Pick<Draft, "leagueId" | "season">, settings: LeagueSettings, rules: Pick<AuctionDraftRules, "includesRookies">) {
  return auctionEligibleWhere(draft.leagueId, settings, { season: draft.season, includesRookies: rules.includesRookies });
}

/** Contract years for a lot: the bidder's choice (WINNER_CHOOSES) within the league range and their length limits. */
function lotYears(rules: AuctionDraftRules, settings: LeagueSettings, requested: number | null | undefined, budget: AuctionTeamBudget | undefined): number {
  if (rules.contractYearsMode === "FIXED") return rules.fixedContractYears;
  const options = auctionYearOptions(rules, settings);
  const years = clampYears(requested ?? settings.contracts.defaultFreeAgentYears, options[0], options[options.length - 1]);
  if (budget && years > budget.maxYears) {
    throw new DraftError(`League limit on long contracts: this team can sign for at most ${budget.maxYears} year${budget.maxYears === 1 ? "" : "s"}.`);
  }
  return years;
}

async function assertPlayerNominatable(draft: Draft, playerId: string, settings: LeagueSettings, rules: AuctionDraftRules) {
  const player = await db.player.findFirst({ where: { id: playerId, ...auctionPoolWhere(draft, settings, rules) } });
  if (!player) throw new DraftError("That player is already rostered or can't be nominated.");
  const lot = await db.auctionLot.findUnique({ where: { draftId_playerId: { draftId: draft.id, playerId } } });
  if (lot) throw new DraftError(`${player.fullName} was already nominated in this auction.`);
  return player;
}

/** Nominate a player with an opening bid (by the nominator, the commissioner on their behalf, or the clock). */
export async function nominatePlayer(input: {
  draftId: string;
  playerId: string;
  openingBid: number;
  years?: number | null;
  actorTeamId: string | null;
  actorId: string | null;
  isCommish: boolean;
  system?: boolean;
}) {
  const now = new Date();
  const draft = await loadDraft(input.draftId);
  if (draft.type !== "AUCTION") throw new DraftError("Not an auction");
  if (draft.status !== "LIVE") throw new DraftError(draft.status === "PAUSED" ? "The auction is paused." : "The auction is not live.");
  const settings = draft.settingsResolved;
  const rules = auctionRules(draft, settings);
  const openLot = await db.auctionLot.findFirst({ where: { draftId: draft.id, status: "OPEN" } });
  if (openLot) throw new DraftError("A player is already on the block.");
  const budgets = await auctionBudgets(draft, settings, rules, { leagueSeason: draft.league.season, leaguePhase: draft.league.phase });
  const order = draftOrderIds(draft);
  const nominator = nextNominator(order, draft.currentIndex, (t) => canNominate(budgets.get(t), rules.minBid));
  if (!nominator) throw new DraftError("No team has roster spots or budget left to nominate.");
  if (!input.system && !input.isCommish && input.actorTeamId !== nominator.teamId) throw new DraftError("It's not your turn to nominate.");
  const player = await assertPlayerNominatable(draft, input.playerId, settings, rules);
  const budget = budgets.get(nominator.teamId)!;
  const opening = rules.nominatorOpeningBid === "MIN_BID" ? rules.minBid : Math.round(input.openingBid);
  if (opening < rules.minBid) throw new DraftError(`Opening bid must be at least $${rules.minBid}.`);
  if (opening > budget.maxBid) throw new DraftError(`Opening bid can't exceed the nominator's max bid ($${budget.maxBid}).`);
  const years = lotYears(rules, settings, input.years ?? Math.min(budget.maxYears, settings.contracts.defaultFreeAgentYears), budget);

  const lot = await db.$transaction(async (tx) => {
    const upd = await tx.draft.updateMany({ where: { id: draft.id, status: "LIVE", currentIndex: draft.currentIndex }, data: { currentIndex: nominator.index + 1, pickDeadline: null } });
    if (upd.count !== 1) throw new DraftError("A nomination was just made — refreshing.");
    const stillOpen = await tx.auctionLot.count({ where: { draftId: draft.id, status: "OPEN" } });
    if (stillOpen) throw new DraftError("A player is already on the block.");
    const sequence = (await tx.auctionLot.count({ where: { draftId: draft.id } })) + 1;
    const created = await tx.auctionLot.create({
      data: {
        draftId: draft.id, playerId: player.id, nominatedByTeamId: nominator.teamId, status: "OPEN", currentBid: opening, currentBidTeamId: nominator.teamId,
        contractYears: years, endsAt: new Date(now.getTime() + rules.bidSeconds * 1000), sequence,
      },
    });
    await tx.auctionBid.create({ data: { lotId: created.id, teamId: nominator.teamId, amount: opening } });
    return created;
  });
  if (input.isCommish && !input.system && input.actorTeamId !== nominator.teamId) {
    await audit(draft.leagueId, input.actorId, "draft.nominate_on_behalf", draft.id, { teamId: nominator.teamId, playerId: player.id, opening });
  }
  emit(draft.id, "auction.lot", { lotId: lot.id, playerId: player.id, amount: opening, teamId: nominator.teamId, endsAt: lot.endsAt?.toISOString() ?? null, message: `${player.fullName} nominated at $${opening}` });
  await applyProxyBids(lot.id, settings, rules);
  return lot;
}

/** Place a bid. Concurrency-safe: conditional update on the lot's current bid + bidder. */
export async function placeBid(input: { draftId: string; lotId: string; teamId: string; amount: number; years?: number | null; actorId: string | null }) {
  const now = new Date();
  const draft = await loadDraft(input.draftId);
  if (draft.type !== "AUCTION") throw new DraftError("Not an auction");
  if (draft.status !== "LIVE") throw new DraftError(draft.status === "PAUSED" ? "The auction is paused." : "The auction is not live.");
  const settings = draft.settingsResolved;
  const rules = auctionRules(draft, settings);
  const lot = await db.auctionLot.findUnique({ where: { id: input.lotId }, include: { player: true } });
  if (!lot || lot.draftId !== draft.id || lot.status !== "OPEN") throw new DraftError("Bidding on that player has closed.");
  if (lot.endsAt && lot.endsAt <= now) throw new DraftError("Too late — the clock ran out.");
  if (lot.currentBidTeamId === input.teamId) throw new DraftError("You're already the high bidder.");
  const amount = Math.round(input.amount);
  const min = minNextBid(lot.currentBid, rules.bidIncrement);
  if (amount < min) throw new DraftError(`Bid must be at least $${min}.`);
  const budget = (await auctionBudgets(draft, settings, rules, { leagueSeason: draft.league.season, leaguePhase: draft.league.phase })).get(input.teamId);
  if (!budget || budget.openSpots <= 0) throw new DraftError("Your roster has no open spots.");
  if (amount > budget.maxBid) throw new DraftError(`Your max bid is $${budget.maxBid}.`);
  const years = lotYears(rules, settings, input.years ?? Math.min(lot.contractYears, budget.maxYears), budget);
  const endsAt = extendEndsAt(lot.endsAt, now, rules.resetSecondsOnBid);
  const previousLeader = lot.currentBidTeamId;

  await db.$transaction(async (tx) => {
    const upd = await tx.auctionLot.updateMany({
      where: { id: lot.id, status: "OPEN", currentBid: lot.currentBid, currentBidTeamId: lot.currentBidTeamId, endsAt: { gt: now } },
      data: { currentBid: amount, currentBidTeamId: input.teamId, contractYears: years, endsAt },
    });
    if (upd.count !== 1) throw new DraftError("Another bid came in first — check the new price and try again.");
    await tx.auctionBid.create({ data: { lotId: lot.id, teamId: input.teamId, amount } });
  });
  emit(draft.id, "auction.bid", { lotId: lot.id, playerId: lot.playerId, amount, teamId: input.teamId, endsAt: endsAt.toISOString(), auto: false });
  const res = await applyProxyBids(lot.id, settings, rules);
  const leaderNow = res?.leaderTeamId ?? input.teamId;
  // the previous leader lost the lead (to this bid or to a proxy); a proxy beating this bid notifies the bidder itself
  if (previousLeader && previousLeader !== leaderNow) outbid(previousLeader, draft, lot.player.fullName, res?.price ?? amount);
  return { amount: res?.price ?? amount, leaderTeamId: leaderNow };
}

function outbid(teamId: string, draft: Pick<Draft, "id" | "leagueId">, playerName: string, price: number) {
  notifyTeam(teamId, draft.leagueId, "AUCTION_OUTBID", "You've been outbid", `${playerName} is now at $${price}.`, AUCTION_URL(draft.id));
}

/** Resolve proxy (max) bids from managers' targets for an open lot. */
export async function applyProxyBids(lotId: string, settings: LeagueSettings, rules: AuctionDraftRules) {
  if (!rules.proxyBidding) return null; // settings.draft.auction.proxyBidding
  const lot = await db.auctionLot.findUnique({ where: { id: lotId }, include: { draft: true, player: true } });
  if (!lot || lot.status !== "OPEN" || !lot.currentBidTeamId) return null;
  const entries = await db.draftQueueEntry.findMany({ where: { draftId: lot.draftId, playerId: lot.playerId, maxBid: { not: null } }, orderBy: { id: "asc" } });
  if (!entries.length) return null;
  const budgets = await auctionBudgets(lot.draft, settings, rules);
  const caps = entries
    .map((e, i) => {
      const b = budgets.get(e.teamId);
      return { teamId: e.teamId, cap: b && b.openSpots > 0 ? Math.min(e.maxBid ?? 0, b.maxBid) : 0, priority: i };
    })
    .filter((c) => c.cap > 0);
  const res = resolveProxyBids({ price: lot.currentBid, leaderTeamId: lot.currentBidTeamId, increment: rules.bidIncrement, caps });
  if (!res.bids.length || (res.price === lot.currentBid && res.leaderTeamId === lot.currentBidTeamId)) return null;
  const now = new Date();
  const yearOptions = auctionYearOptions(rules, settings);
  const winnerMaxYears = budgets.get(res.leaderTeamId)?.maxYears ?? yearOptions[yearOptions.length - 1];
  // an absent manager's proxy win signs the league's default free-agent length (within their length limits)
  const proxyYears = rules.contractYearsMode === "FIXED" ? rules.fixedContractYears : Math.min(winnerMaxYears, clampYears(settings.contracts.defaultFreeAgentYears, yearOptions[0], yearOptions[yearOptions.length - 1]));
  const endsAt = extendEndsAt(lot.endsAt, now, rules.resetSecondsOnBid);
  const ok = await db.$transaction(async (tx) => {
    const upd = await tx.auctionLot.updateMany({
      where: { id: lot.id, status: "OPEN", currentBid: lot.currentBid, currentBidTeamId: lot.currentBidTeamId },
      data: { currentBid: res.price, currentBidTeamId: res.leaderTeamId, endsAt, ...(res.leaderTeamId !== lot.currentBidTeamId ? { contractYears: proxyYears } : {}) },
    });
    if (upd.count !== 1) return false;
    await tx.auctionBid.createMany({ data: res.bids.map((b) => ({ lotId: lot.id, teamId: b.teamId, amount: b.amount })) });
    return true;
  });
  if (!ok) return null;
  emit(lot.draftId, "auction.bid", { lotId: lot.id, playerId: lot.playerId, amount: res.price, teamId: res.leaderTeamId, endsAt: endsAt.toISOString(), auto: true });
  if (res.leaderTeamId !== lot.currentBidTeamId) outbid(lot.currentBidTeamId, lot.draft, lot.player.fullName, res.price);
  return res;
}

/** Close an expired lot: SOLD to the high bidder (added to the roster) or PASSED if they can no longer afford it. */
export async function closeLot(lotId: string, now = new Date()): Promise<AuctionLot | null> {
  const lot = await db.auctionLot.findUnique({ where: { id: lotId }, include: { player: true, draft: { include: { league: true } } } });
  if (!lot || lot.status !== "OPEN" || !lot.endsAt || lot.endsAt > now || lot.draft.status !== "LIVE") return null;
  const draft = lot.draft;
  const settings = resolveSettings(draft.league.settings);
  const rules = auctionRules(draft, settings);
  const budgets = await auctionBudgets(draft, settings, rules, { leagueSeason: draft.league.season, leaguePhase: draft.league.phase });
  const winner = lot.currentBidTeamId ? budgets.get(lot.currentBidTeamId) : undefined;
  const sold = !!winner && winner.openSpots > 0 && winner.maxBid >= lot.currentBid;
  if (winner && sold) {
    winner.spent += lot.currentBid;
    winner.won += 1;
    winner.activeCount += 1;
    if (winner.capSpace !== null) winner.capSpace -= lot.currentBid;
    winner.openSpots = openRosterSpots({ rosterSpotsToFill: rules.rosterSpotsToFill, wonInDraft: winner.won, maxActiveRoster: winner.maxActive, activeCount: winner.activeCount });
    winner.maxBid = maxBidFor({ budget: rules.budget, spent: winner.spent, capSpace: winner.capSpace, openSpots: winner.openSpots, minBid: rules.minBid, rule: rules.maxBidRule, maxSalary: settings.salaryCap.maxSalary }).maxBid;
  }
  const order = draftOrderIds(draft);
  const next = nextNominator(order, draft.currentIndex, (t) => canNominate(budgets.get(t), rules.minBid));
  const complete = !next;
  const week = await txWeekFor(draft.league, draft.season);
  const team = lot.currentBidTeamId ? await db.team.findUnique({ where: { id: lot.currentBidTeamId } }) : null;

  const result = await db.$transaction(async (tx) => {
    const upd = await tx.auctionLot.updateMany({
      where: { id: lot.id, status: "OPEN", endsAt: { lte: now } },
      data: { status: sold ? "SOLD" : "PASSED", winnerTeamId: sold ? lot.currentBidTeamId : null, soldAt: now },
    });
    if (upd.count !== 1) return null;
    let transaction = null;
    if (sold && lot.currentBidTeamId) {
      const added = await addPlayerToTeam(tx, {
        leagueId: draft.leagueId,
        teamId: lot.currentBidTeamId,
        playerId: lot.playerId,
        season: draft.season,
        week,
        salary: lot.currentBid,
        contractYears: lot.contractYears,
        via: "AUCTION",
        txType: "AUCTION",
        description: `Won ${lot.player.fullName} (${lot.player.position}${lot.player.team ? " " + lot.player.team : ""}) at auction for $${lot.currentBid} — ${lot.contractYears} yr${lot.contractYears === 1 ? "" : "s"}`,
        details: { draftId: draft.id, lotId: lot.id },
      });
      transaction = added.transaction;
    }
    await tx.draft.update({
      where: { id: draft.id },
      data: complete ? { status: "COMPLETE", completedAt: now, pickDeadline: null } : { pickDeadline: new Date(now.getTime() + rules.nominationSeconds * 1000) },
    });
    return { transaction };
  });
  if (!result) return null;
  if (result.transaction) broadcastTransaction(draft.leagueId, result.transaction);
  emit(draft.id, "auction.sold", {
    lotId: lot.id, playerId: lot.playerId, playerName: lot.player.fullName, status: sold ? "SOLD" : "PASSED", teamId: sold ? lot.currentBidTeamId : null, amount: lot.currentBid, contractYears: lot.contractYears,
    message: sold ? `${lot.player.fullName} sold to ${team?.name ?? "?"} for $${lot.currentBid}` : `${lot.player.fullName} passed — no valid bid`,
  });
  if (sold) {
    void postSystemMessage(draft.leagueId, `Auction: ${team?.name ?? "?"} win ${lot.player.fullName} (${lot.player.position}${lot.player.team ? " " + lot.player.team : ""}) for $${lot.currentBid}, ${lot.contractYears} yr${lot.contractYears === 1 ? "" : "s"}`, {
      channel: "transactions",
      kind: "TRANSACTION",
      data: { draftId: draft.id, lotId: lot.id },
    }).catch(() => {});
  }
  if (complete) {
    emit(draft.id, "draft.status", { status: "COMPLETE", message: `${draft.name} is complete` });
    void postSystemMessage(draft.leagueId, `The ${draft.name} is complete. Full results: /draft/results?id=${draft.id}`, { channel: "general" }).catch(() => {});
  } else {
    emit(draft.id, "draft.clock", { currentIndex: draft.currentIndex, teamId: next?.teamId ?? null, deadline: new Date(now.getTime() + rules.nominationSeconds * 1000).toISOString() });
  }
  return db.auctionLot.findUnique({ where: { id: lot.id } });
}

/** Clock: when the nominator runs out of time, nominate the top of their targets list, else the best available by ADP. */
export async function autoNominate(draftId: string, now = new Date()): Promise<string | null> {
  const draft = await db.draft.findUnique({ where: { id: draftId }, include: { league: true } });
  if (!draft || draft.type !== "AUCTION" || draft.status !== "LIVE" || !draft.pickDeadline || draft.pickDeadline > now) return null;
  const open = await db.auctionLot.count({ where: { draftId, status: "OPEN" } });
  if (open) return null;
  const settings = resolveSettings(draft.league.settings);
  const rules = auctionRules(draft, settings);
  const budgets = await auctionBudgets(draft, settings, rules, { leagueSeason: draft.league.season, leaguePhase: draft.league.phase });
  const order = draftOrderIds(draft);
  const nominator = nextNominator(order, draft.currentIndex, (t) => canNominate(budgets.get(t), rules.minBid));
  if (!nominator) {
    const upd = await db.draft.updateMany({ where: { id: draft.id, status: "LIVE" }, data: { status: "COMPLETE", completedAt: now, pickDeadline: null } });
    if (upd.count) emit(draft.id, "draft.status", { status: "COMPLETE", message: `${draft.name} is complete` });
    return "auction complete";
  }
  if (!rules.autoNominateOnTimeout) {
    // settings.draft.auction.autoNominateOnTimeout = false: the nominator loses this turn
    const deadline = new Date(now.getTime() + rules.nominationSeconds * 1000);
    const upd = await db.draft.updateMany({
      where: { id: draft.id, status: "LIVE", currentIndex: draft.currentIndex, pickDeadline: { lte: now } },
      data: { currentIndex: nominator.index + 1, pickDeadline: deadline },
    });
    if (!upd.count) return null;
    const next = nextNominator(order, nominator.index + 1, (t) => canNominate(budgets.get(t), rules.minBid));
    const team = await db.team.findUnique({ where: { id: nominator.teamId }, select: { name: true } });
    emit(draft.id, "draft.clock", { currentIndex: nominator.index + 1, teamId: next?.teamId ?? null, deadline: deadline.toISOString(), message: `${team?.name ?? "The nominator"} ran out of time — turn skipped` });
    notifyTeam(nominator.teamId, draft.leagueId, "DRAFT_ON_CLOCK", "Nomination skipped", `Your nomination clock ran out in the ${draft.name}.`, AUCTION_URL(draft.id));
    if (next && next.teamId !== nominator.teamId) notifyTeam(next.teamId, draft.leagueId, "DRAFT_ON_CLOCK", "Your turn to nominate", `Nominate a player in the ${draft.name}.`, AUCTION_URL(draft.id));
    return `nomination skipped (${nominator.teamId})`;
  }
  const playerId = await bestNominationFor(draft, nominator.teamId, settings, rules);
  if (!playerId) return null;
  try {
    const lot = await nominatePlayer({ draftId, playerId, openingBid: Math.max(1, rules.minBid), years: null, actorTeamId: nominator.teamId, actorId: null, isCommish: false, system: true });
    return `auto-nominated ${lot.playerId}`;
  } catch (e) {
    if (e instanceof DraftError) return null;
    throw e;
  }
}

export async function bestNominationFor(draft: Pick<Draft, "id" | "leagueId" | "season">, teamId: string, settings: LeagueSettings, rules: Pick<AuctionDraftRules, "includesRookies">): Promise<string | null> {
  const pool = auctionPoolWhere(draft, settings, rules);
  const lotted = new Set((await db.auctionLot.findMany({ where: { draftId: draft.id }, select: { playerId: true } })).map((l) => l.playerId));
  const queue = await db.draftQueueEntry.findMany({ where: { draftId: draft.id, teamId }, orderBy: { rank: "asc" }, select: { playerId: true } });
  if (queue.length) {
    const avail = await db.player.findMany({ where: { id: { in: queue.map((q) => q.playerId) }, ...pool }, select: { id: true } });
    const ok = new Set(avail.map((a) => a.id));
    const top = queue.find((q) => ok.has(q.playerId) && !lotted.has(q.playerId));
    if (top) return top.playerId;
  }
  const adp = await getAdpMap(draft.season);
  const adpIds = [...adp.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).filter((id) => !lotted.has(id));
  if (adpIds.length) {
    const avail = await db.player.findMany({ where: { id: { in: adpIds.slice(0, 600) }, ...pool }, select: { id: true } });
    const ok = new Set(avail.map((a) => a.id));
    const first = adpIds.find((id) => ok.has(id));
    if (first) return first;
  }
  const fallback = await db.player.findFirst({
    where: { ...pool, id: { notIn: [...lotted] }, searchRank: { not: null } },
    orderBy: { searchRank: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

/** Commissioner: void the open lot, or reverse the most recent closed lot (roster spot + transaction). */
export async function undoLastLot(draftId: string, actorId: string | null) {
  const draft = await loadDraft(draftId);
  if (draft.type !== "AUCTION") throw new DraftError("Not an auction");
  const settings = draft.settingsResolved;
  const rules = auctionRules(draft, settings);
  const order = draftOrderIds(draft);
  const now = new Date();
  const open = await db.auctionLot.findFirst({ where: { draftId, status: "OPEN" }, include: { player: true } });
  const target = open ?? (await db.auctionLot.findFirst({ where: { draftId, status: { in: ["SOLD", "PASSED"] } }, orderBy: { sequence: "desc" }, include: { player: true } }));
  if (!target) throw new DraftError("There is nothing to undo.");
  if (target.status === "SOLD") {
    const spot = await db.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: draft.leagueId, playerId: target.playerId } } });
    if (spot && spot.teamId !== target.winnerTeamId) throw new DraftError(`${target.player.fullName} has since moved to another team — fix the roster manually first.`);
  }
  const status = draft.status === "COMPLETE" ? "PAUSED" : draft.status;
  const index = lastIndexOfTeam(order, Math.max(0, draft.currentIndex - 1), target.nominatedByTeamId);
  await db.$transaction(async (tx) => {
    if (target.status === "SOLD") {
      const spot = await tx.rosterSpot.findUnique({ where: { leagueId_playerId: { leagueId: draft.leagueId, playerId: target.playerId } } });
      if (spot) {
        await tx.lineupSlot.updateMany({ where: { teamId: spot.teamId, playerId: target.playerId }, data: { playerId: null } });
        await tx.rosterSpot.delete({ where: { id: spot.id } });
      }
      await tx.transaction.deleteMany({ where: { leagueId: draft.leagueId, type: "AUCTION", playerId: target.playerId, details: { path: ["lotId"], equals: target.id } } });
    }
    await tx.auctionLot.delete({ where: { id: target.id } });
    await tx.draft.update({
      where: { id: draftId },
      data: {
        currentIndex: index,
        status,
        completedAt: null,
        pickDeadline: status === "LIVE" ? new Date(now.getTime() + rules.nominationSeconds * 1000) : null,
        settings: { ...((draft.settings ?? {}) as Record<string, unknown>), pausedRemainingMs: status === "PAUSED" ? rules.nominationSeconds * 1000 : null } as Prisma.InputJsonValue,
      },
    });
  });
  await audit(draft.leagueId, actorId, "draft.undo_lot", draftId, { lotId: target.id, playerId: target.playerId, status: target.status, price: target.currentBid });
  emit(draftId, "draft.undo", { message: `${target.player.fullName} (${target.status === "OPEN" ? "on the block" : target.status.toLowerCase()}) was undone by the commissioner` });
  return target;
}
