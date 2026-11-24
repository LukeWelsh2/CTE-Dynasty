// Read models for /draft/results: rookie draft picks and auction sales (AuctionLot rows, or — for imported
// auctions without lots, like the startup auction — the AUCTION transactions of that draft).
import type { Draft, Player, Team } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizePosition } from "@/lib/settings/stat-catalog";

type P = Pick<Player, "id" | "fullName" | "position" | "team" | "college" | "injuryStatus">;
const PLAYER = { id: true, fullName: true, position: true, team: true, college: true, injuryStatus: true } as const;

export interface RookieResultRow {
  overall: number;
  round: number;
  pickInRound: number;
  team: Team;
  via: Team | null;
  player: P;
  salary: number;
  contractYears: number;
  isAutopick: boolean;
  madeAt: Date;
  nowWith: Team | null;
}

export async function rookieResults(draft: Draft): Promise<RookieResultRow[]> {
  const sels = await db.draftSelection.findMany({
    where: { draftId: draft.id },
    orderBy: { overall: "asc" },
    include: { team: true, player: { select: PLAYER }, pick: { include: { originalTeam: true } } },
  });
  const spots = await db.rosterSpot.findMany({ where: { leagueId: draft.leagueId, playerId: { in: sels.map((s) => s.playerId) } }, include: { team: true } });
  const spotBy = new Map(spots.map((s) => [s.playerId, s.team]));
  return sels.map((s) => ({
    overall: s.overall,
    round: s.round,
    pickInRound: s.pickInRound,
    team: s.team,
    via: s.pick && s.pick.originalTeamId !== s.teamId ? s.pick.originalTeam : null,
    player: s.player,
    salary: s.salary,
    contractYears: s.contractYears,
    isAutopick: s.isAutopick,
    madeAt: s.madeAt,
    nowWith: spotBy.get(s.playerId) ?? null,
  }));
}

export interface AuctionResultRow {
  key: string;
  sequence: number | null;
  player: P;
  position: string;
  team: Team;
  nominatedBy: Team | null;
  price: number;
  years: number | null;
  bids: { team: string; amount: number }[];
  at: Date;
}

export async function auctionResults(draft: Draft, leagueSeason: number): Promise<{ rows: AuctionResultRow[]; source: "LOTS" | "TRANSACTIONS"; passed: number }> {
  const lots = await db.auctionLot.findMany({
    where: { draftId: draft.id, status: { in: ["SOLD", "PASSED"] } },
    include: { player: { select: PLAYER }, winner: true, nominatedBy: true, bids: { orderBy: { createdAt: "asc" }, include: { team: { select: { abbrev: true } } } } },
    orderBy: { sequence: "asc" },
  });
  if (lots.length) {
    const rows = lots
      .filter((l) => l.status === "SOLD" && l.winner)
      .map((l) => ({
        key: l.id,
        sequence: l.sequence,
        player: l.player,
        position: normalizePosition(l.player.position),
        team: l.winner!,
        nominatedBy: l.nominatedBy,
        price: l.currentBid,
        years: l.contractYears,
        bids: l.bids.map((b) => ({ team: b.team.abbrev, amount: b.amount })),
        at: l.soldAt ?? l.createdAt,
      }));
    return { rows, source: "LOTS", passed: lots.filter((l) => l.status === "PASSED").length };
  }
  // imported / offline auction: derive from the AUCTION transactions recorded for that season
  const until = draft.completedAt ? new Date(draft.completedAt.getTime() + 36 * 3600_000) : undefined;
  const from = draft.startTime ? new Date(draft.startTime.getTime() - 36 * 3600_000) : undefined;
  const txs = await db.transaction.findMany({
    where: { leagueId: draft.leagueId, season: draft.season, type: "AUCTION", playerId: { not: null }, teamId: { not: null }, createdAt: { ...(until ? { lte: until } : {}), ...(from ? { gte: from } : {}) } },
    include: { player: { select: PLAYER }, team: true },
    orderBy: { createdAt: "asc" },
  });
  const spots = await db.rosterSpot.findMany({ where: { leagueId: draft.leagueId, playerId: { in: txs.map((t) => t.playerId!) } }, select: { playerId: true, contractYears: true, contractStart: true, acquiredVia: true } });
  const spotBy = new Map(spots.map((s) => [s.playerId, s]));
  const rows = txs
    .filter((t) => t.player && t.team && !(t.details as Record<string, unknown>)?.lotId)
    .map((t) => {
      const s = spotBy.get(t.playerId!);
      const years = s && s.contractStart === draft.season ? s.contractYears + Math.max(0, leagueSeason - draft.season) : null;
      return {
        key: t.id,
        sequence: null,
        player: t.player!,
        position: normalizePosition(t.player!.position),
        team: t.team!,
        nominatedBy: null,
        price: t.salary ?? 0,
        years,
        bids: [],
        at: t.createdAt,
      };
    });
  return { rows, source: "TRANSACTIONS", passed: 0 };
}

export const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];

/** Per-team spending by position: { teamId: { pos: { amount, count } } } */
export function spendingByPosition(rows: { team: Team; position: string; price: number }[]) {
  const out = new Map<string, { team: Team; byPos: Record<string, { amount: number; count: number }>; total: number; count: number }>();
  for (const r of rows) {
    const e = out.get(r.team.id) ?? { team: r.team, byPos: {}, total: 0, count: 0 };
    const p = (e.byPos[r.position] ??= { amount: 0, count: 0 });
    p.amount += r.price;
    p.count += 1;
    e.total += r.price;
    e.count += 1;
    out.set(r.team.id, e);
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
}
