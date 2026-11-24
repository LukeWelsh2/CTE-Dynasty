// Room state builders (server): everything a draft room client renders, as plain JSON.
import type { Player, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { rookieSalary, nextNominator } from "@/lib/draft/logic";
import { auctionEligibleWhere, auctionRules, auctionYearOptions, getAdpMap, isRookieFor, positionFilters, rawPositionsFor, rookieEligibleWhere, rookieRules } from "@/lib/draft/data";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { auctionBudgets, canNominate } from "@/lib/draft/auction";
import { draftOrderIds } from "@/lib/draft/shared";
import type { AuctionLotView, AuctionRoomState, RoomPlayer, RoomTeam, RookieBoardPick, RookieRoomState } from "@/lib/draft/types";

export const ROOM_PLAYER_SELECT = {
  id: true,
  fullName: true,
  position: true,
  team: true,
  college: true,
  age: true,
  injuryStatus: true,
  rookieYear: true,
  yearsExp: true,
  searchRank: true,
} satisfies Prisma.PlayerSelect;

type RoomPlayerRow = Pick<Player, keyof typeof ROOM_PLAYER_SELECT>;

export interface Viewer {
  teamId: string | null;
  isCommish: boolean;
}

const AVAILABLE_LIMIT = 400;

export function toRoomPlayer(p: RoomPlayerRow, season: number, extra: { rank?: number | null; tier?: number | null; adp?: number | null; boardRank?: number | null } = {}): RoomPlayer {
  return {
    id: p.id,
    fullName: p.fullName,
    position: normalizePosition(p.position),
    team: p.team,
    college: p.college,
    age: p.age,
    injuryStatus: p.injuryStatus,
    isRookie: isRookieFor(p, season),
    rank: extra.rank ?? null,
    tier: extra.tier ?? null,
    adp: extra.adp ?? null,
    boardRank: extra.boardRank ?? null,
    searchRank: p.searchRank,
  };
}

async function roomTeams(leagueId: string, slotOrder: string[]): Promise<RoomTeam[]> {
  const teams = await db.team.findMany({ where: { leagueId }, include: { owner: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  const pos = (id: string) => {
    const i = slotOrder.indexOf(id);
    return i === -1 ? 999 : i;
  };
  return teams
    .sort((a, b) => pos(a.id) - pos(b.id))
    .map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, logoUrl: t.logoUrl, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor, ownerName: t.owner?.name ?? null }));
}

/** League rookie rank lookups for a draft class (falls back to the previous class for not-yet-ranked classes). */
export async function rookieRankMap(leagueId: string, classYear: number): Promise<Map<string, { rank: number; tier: number }>> {
  const rows = await db.rookieRanking.findMany({
    where: { leagueId, classYear: { in: [classYear, classYear - 1] }, playerId: { not: null } },
    select: { playerId: true, rank: true, tier: true, classYear: true },
    orderBy: [{ classYear: "asc" }],
  });
  const map = new Map<string, { rank: number; tier: number }>();
  for (const r of rows) map.set(r.playerId!, { rank: r.rank, tier: r.tier }); // classYear asc → the draft class wins
  return map;
}

export async function getRookieRoomState(draftId: string, viewer: Viewer): Promise<RookieRoomState | null> {
  const draft = await db.draft.findUnique({ where: { id: draftId }, include: { league: true } });
  if (!draft || draft.type !== "ROOKIE") return null;
  const settings = resolveSettings(draft.league.settings);
  const rules = rookieRules(draft, settings);
  const order = draftOrderIds(draft);
  const myTeamId = viewer.teamId;
  const [teams, picks, selections, eligible, ranks, board, queue, adp] = await Promise.all([
    roomTeams(draft.leagueId, rules.teamOrder),
    db.draftPick.findMany({ where: { id: { in: order } } }),
    db.draftSelection.findMany({ where: { draftId }, include: { player: { select: ROOM_PLAYER_SELECT } } }),
    db.player.findMany({ where: rookieEligibleWhere(draft.leagueId, draft.season, settings, rules.eligibility), select: ROOM_PLAYER_SELECT }),
    rookieRankMap(draft.leagueId, draft.season),
    myTeamId ? db.bigBoardEntry.findMany({ where: { teamId: myTeamId, classYear: draft.season }, select: { playerId: true, rank: true } }) : Promise.resolve([]),
    myTeamId ? db.draftQueueEntry.findMany({ where: { draftId, teamId: myTeamId }, orderBy: { rank: "asc" }, select: { playerId: true } }) : Promise.resolve([]),
    getAdpMap(draft.season),
  ]);
  const boardRank = new Map(board.map((b) => [b.playerId, b.rank]));
  const pickById = new Map(picks.map((p) => [p.id, p]));
  const selByPick = new Map(selections.filter((s) => s.pickId).map((s) => [s.pickId!, s]));
  const boardPicks: RookieBoardPick[] = order
    .map((id, index) => {
      const p = pickById.get(id);
      if (!p) return null;
      const s = selByPick.get(id);
      const pickInRound = p.pickInRound ?? index + 1;
      return {
        pickId: p.id,
        index,
        overall: p.overall ?? index + 1,
        round: p.round,
        pickInRound,
        ownerTeamId: p.ownerTeamId,
        originalTeamId: p.originalTeamId,
        salary: rookieSalary(settings.contracts.rookieScale, p.round, pickInRound, settings.salaryCap.minSalary),
        selection: s
          ? { playerId: s.playerId, fullName: s.player.fullName, position: s.player.position, team: s.player.team, college: s.player.college, salary: s.salary, contractYears: s.contractYears, isAutopick: s.isAutopick, madeAt: s.madeAt.toISOString() }
          : null,
      } satisfies RookieBoardPick;
    })
    .filter((x): x is RookieBoardPick => !!x);
  const mk = (p: RoomPlayerRow) => toRoomPlayer(p, draft.season, { rank: ranks.get(p.id)?.rank, tier: ranks.get(p.id)?.tier, adp: adp.get(p.id), boardRank: boardRank.get(p.id) });
  const all = eligible.map(mk).sort(
    (a, b) => (a.rank ?? 1e6) - (b.rank ?? 1e6) || (a.adp ?? 1e6) - (b.adp ?? 1e6) || (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9) || a.fullName.localeCompare(b.fullName),
  );
  const eligibleById = new Map(all.map((p) => [p.id, p]));
  const s = (draft.settings ?? {}) as Record<string, unknown>;
  return {
    kind: "ROOKIE",
    serverNow: new Date().toISOString(),
    draft: {
      id: draft.id,
      name: draft.name,
      season: draft.season,
      status: draft.status,
      currentIndex: draft.currentIndex,
      pickDeadline: draft.pickDeadline?.toISOString() ?? null,
      startTime: draft.startTime?.toISOString() ?? null,
      completedAt: draft.completedAt?.toISOString() ?? null,
      pickTimerMinutes: rules.pickTimerMinutes,
      pausedRemainingMs: typeof s.pausedRemainingMs === "number" ? s.pausedRemainingMs : null,
      rounds: rules.rounds,
      style: rules.style,
      eligibility: rules.eligibility,
      autopickSource: rules.autopickSource,
      rookieContractYears: settings.contracts.rookieContractYears,
    },
    teams,
    picks: boardPicks,
    myTeamId,
    isCommish: viewer.isCommish,
    available: all.slice(0, AVAILABLE_LIMIT),
    availableTotal: all.length,
    queue: queue.map((q) => eligibleById.get(q.playerId)).filter((p): p is RoomPlayer => !!p),
    positions: positionFilters(settings, { includeDef: rules.eligibility === "ROOKIES_AND_FREE_AGENTS" }),
    timezone: settings.general.timezone,
  };
}

function lotView(
  lot: { id: string; sequence: number; status: string; nominatedByTeamId: string; currentBid: number; currentBidTeamId: string | null; winnerTeamId: string | null; contractYears: number; endsAt: Date | null; soldAt: Date | null; player: RoomPlayerRow; bids?: { teamId: string; amount: number; createdAt: Date }[] },
  season: number,
  adp: Map<string, number>,
): AuctionLotView {
  return {
    id: lot.id,
    sequence: lot.sequence,
    status: lot.status as AuctionLotView["status"],
    player: toRoomPlayer(lot.player, season, { adp: adp.get(lot.player.id) }),
    nominatedByTeamId: lot.nominatedByTeamId,
    currentBid: lot.currentBid,
    currentBidTeamId: lot.currentBidTeamId,
    winnerTeamId: lot.winnerTeamId,
    contractYears: lot.contractYears,
    endsAt: lot.endsAt?.toISOString() ?? null,
    soldAt: lot.soldAt?.toISOString() ?? null,
    bids: (lot.bids ?? []).map((b) => ({ teamId: b.teamId, amount: b.amount, at: b.createdAt.toISOString() })),
  };
}

export async function getAuctionRoomState(draftId: string, viewer: Viewer): Promise<AuctionRoomState | null> {
  const draft = await db.draft.findUnique({ where: { id: draftId }, include: { league: true } });
  if (!draft || draft.type !== "AUCTION") return null;
  const settings = resolveSettings(draft.league.settings);
  const rules = auctionRules(draft, settings);
  const order = draftOrderIds(draft);
  const myTeamId = viewer.teamId;
  const [teams, openLot, recent, soldCount, lotted, budgets, targets, adp] = await Promise.all([
    roomTeams(draft.leagueId, order),
    db.auctionLot.findFirst({ where: { draftId, status: "OPEN" }, include: { player: { select: ROOM_PLAYER_SELECT }, bids: { orderBy: { createdAt: "desc" }, take: 25 } } }),
    db.auctionLot.findMany({ where: { draftId, status: { in: ["SOLD", "PASSED"] } }, orderBy: { sequence: "desc" }, take: 20, include: { player: { select: ROOM_PLAYER_SELECT } } }),
    db.auctionLot.count({ where: { draftId, status: "SOLD" } }),
    db.auctionLot.findMany({ where: { draftId }, select: { playerId: true, status: true } }),
    auctionBudgets(draft, settings, rules),
    myTeamId ? db.draftQueueEntry.findMany({ where: { draftId, teamId: myTeamId }, orderBy: { rank: "asc" }, include: { player: { select: ROOM_PLAYER_SELECT } } }) : Promise.resolve([]),
    getAdpMap(draft.season),
  ]);
  const lotStatus = new Map(lotted.map((l) => [l.playerId, l.status]));
  const nominator = draft.status === "COMPLETE" ? null : nextNominator(order, draft.currentIndex, (t) => canNominate(budgets.get(t), rules.minBid));
  const upNext: string[] = [];
  if (nominator) {
    for (let k = 1; k <= order.length && upNext.length < 5; k++) {
      const t = order[(nominator.index + k) % order.length];
      if (canNominate(budgets.get(t), rules.minBid) && t !== nominator.teamId) upNext.push(t);
    }
  }
  // best available: everything with an ADP plus the most relevant players by search rank
  const adpIds = [...adp.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).filter((id) => !lotStatus.has(id)).slice(0, 500);
  const eligibleWhere = auctionEligibleWhere(draft.leagueId, settings);
  const [byAdp, bySearch, targetRostered] = await Promise.all([
    db.player.findMany({ where: { ...eligibleWhere, id: { in: adpIds } }, select: ROOM_PLAYER_SELECT }),
    db.player.findMany({ where: { ...eligibleWhere, searchRank: { not: null }, id: { notIn: [...lotStatus.keys()] } }, orderBy: { searchRank: "asc" }, take: 200, select: ROOM_PLAYER_SELECT }),
    targets.length ? db.rosterSpot.findMany({ where: { leagueId: draft.leagueId, playerId: { in: targets.map((t) => t.playerId) } }, select: { playerId: true } }) : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const pool: RoomPlayer[] = [];
  for (const p of [...byAdp, ...bySearch]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    pool.push(toRoomPlayer(p, draft.season, { adp: adp.get(p.id) }));
  }
  pool.sort((a, b) => (a.adp ?? 1e6) - (b.adp ?? 1e6) || (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9));
  const rostered = new Set(targetRostered.map((r) => r.playerId));
  const yearOptions = auctionYearOptions(rules, settings);
  const s = (draft.settings ?? {}) as Record<string, unknown>;
  return {
    kind: "AUCTION",
    serverNow: new Date().toISOString(),
    draft: {
      id: draft.id,
      name: draft.name,
      season: draft.season,
      status: draft.status,
      auctionKind: rules.kind,
      pickDeadline: draft.pickDeadline?.toISOString() ?? null,
      startTime: draft.startTime?.toISOString() ?? null,
      completedAt: draft.completedAt?.toISOString() ?? null,
      pausedRemainingMs: typeof s.pausedRemainingMs === "number" ? s.pausedRemainingMs : null,
      budget: rules.budget,
      minBid: Math.max(1, rules.minBid),
      bidIncrement: rules.bidIncrement,
      nominationSeconds: rules.nominationSeconds,
      bidSeconds: rules.bidSeconds,
      resetSecondsOnBid: rules.resetSecondsOnBid,
      nominationOrder: rules.nominationOrder,
      maxBidRule: rules.maxBidRule,
      rosterSpotsToFill: rules.rosterSpotsToFill,
      contractYearsMode: rules.contractYearsMode,
      yearOptions,
      defaultYears: Math.min(yearOptions[yearOptions.length - 1], Math.max(yearOptions[0], settings.contracts.defaultFreeAgentYears)),
      capEnabled: settings.salaryCap.enabled,
    },
    teams,
    order,
    nominatorTeamId: nominator?.teamId ?? null,
    nominatorIndex: nominator?.index ?? null,
    upNext,
    openLot: openLot ? lotView(openLot, draft.season, adp) : null,
    recent: recent.map((l) => lotView(l, draft.season, adp)),
    budgets: teams.map((t) => {
      const b = budgets.get(t.id)!;
      return { teamId: t.id, spent: b.spent, won: b.won, remaining: b.remaining, maxBid: b.maxBid, openSpots: b.openSpots, capSpace: b.capSpace, wonByPosition: b.wonByPosition };
    }),
    myTeamId,
    isCommish: viewer.isCommish,
    targets: targets.map((t) => ({
      player: toRoomPlayer(t.player, draft.season, { adp: adp.get(t.playerId) }),
      rank: t.rank,
      maxBid: t.maxBid,
      status: lotStatus.get(t.playerId) === "OPEN" ? "ON_BLOCK" : lotStatus.has(t.playerId) || rostered.has(t.playerId) ? "GONE" : "AVAILABLE",
    })),
    bestAvailable: pool.slice(0, 200),
    soldCount,
    positions: positionFilters(settings),
  };
}

/** Player search inside a draft's eligible pool (for players beyond the preloaded lists). */
export async function searchDraftPlayers(draftId: string, q: string, position: string | null, viewer: Viewer): Promise<RoomPlayer[]> {
  const draft = await db.draft.findUnique({ where: { id: draftId }, include: { league: true } });
  if (!draft) return [];
  const settings = resolveSettings(draft.league.settings);
  const term = q.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (term.length < 2) return [];
  const base = draft.type === "AUCTION" ? auctionEligibleWhere(draft.leagueId, settings) : rookieEligibleWhere(draft.leagueId, draft.season, settings, rookieRules(draft, settings).eligibility);
  const lotted = draft.type === "AUCTION" ? (await db.auctionLot.findMany({ where: { draftId }, select: { playerId: true } })).map((l) => l.playerId) : [];
  const players = await db.player.findMany({
    where: { AND: [base, { searchName: { contains: term } }, ...(position ? [{ position: { in: rawPositionsFor(position) } }] : []), ...(lotted.length ? [{ id: { notIn: lotted } }] : [])] },
    orderBy: [{ searchRank: "asc" }],
    take: 40,
    select: ROOM_PLAYER_SELECT,
  });
  const [adp, ranks, board] = await Promise.all([
    getAdpMap(draft.season),
    draft.type === "ROOKIE" ? rookieRankMap(draft.leagueId, draft.season) : Promise.resolve(new Map<string, { rank: number; tier: number }>()),
    viewer.teamId && draft.type === "ROOKIE" ? db.bigBoardEntry.findMany({ where: { teamId: viewer.teamId, classYear: draft.season }, select: { playerId: true, rank: true } }) : Promise.resolve([]),
  ]);
  const br = new Map(board.map((b) => [b.playerId, b.rank]));
  return players.map((p) => toRoomPlayer(p, draft.season, { adp: adp.get(p.id), rank: ranks.get(p.id)?.rank, tier: ranks.get(p.id)?.tier, boardRank: br.get(p.id) }));
}
