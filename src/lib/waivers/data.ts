// Read models for /waivers and /waivers/fab/[teamId]. Batched queries (no per-team / per-claim lookups).
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { groupByPlayer, groupRuns } from "@/lib/waivers/logic";

const playerSelect = { id: true, fullName: true, position: true, team: true, injuryStatus: true } as const;
const teamSelect = { id: true, name: true, abbrev: true, logoUrl: true, primaryColor: true, secondaryColor: true } as const;

export async function loadMyClaims(teamId: string) {
  return db.waiverClaim.findMany({
    where: { teamId, status: "PENDING" },
    include: { addPlayer: { select: playerSelect }, dropPlayer: { select: playerSelect } },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

export interface FabRow {
  team: { id: string; name: string; abbrev: string; logoUrl: string | null; primaryColor: string; secondaryColor: string };
  waiverPriority: number;
  budget: number;
  spent: number;
  tradeIn: number;
  tradeOut: number;
  adjustments: number;
  remaining: number;
  cached: number;
  claimsWon: number;
}

/** FAB budget table for every team this season (FaabLedger is the source of truth). */
export async function loadFabTable(leagueId: string, season: number): Promise<FabRow[]> {
  const [teams, ledger, won] = await Promise.all([
    db.team.findMany({ where: { leagueId }, select: { ...teamSelect, waiverPriority: true, faabBalance: true }, orderBy: [{ waiverPriority: "asc" }, { name: "asc" }] }),
    db.faabLedger.findMany({ where: { leagueId, season }, select: { teamId: true, amount: true, reason: true } }),
    db.waiverClaim.groupBy({ by: ["teamId"], where: { leagueId, season, status: "WON" }, _count: { _all: true } }),
  ]);
  const wonBy = new Map(won.map((w) => [w.teamId, w._count._all]));
  return teams.map((t) => {
    const rows = ledger.filter((l) => l.teamId === t.id);
    const sum = (f: (l: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, l) => a + l.amount, 0);
    const budget = sum((l) => l.reason === "SEASON_START");
    const spent = -sum((l) => l.reason === "WAIVER");
    const tradeIn = sum((l) => l.reason === "TRADE" && l.amount > 0);
    const tradeOut = -sum((l) => l.reason === "TRADE" && l.amount < 0);
    const adjustments = sum((l) => !["SEASON_START", "WAIVER", "TRADE"].includes(l.reason));
    const { faabBalance, waiverPriority, ...team } = t;
    return { team, waiverPriority, budget, spent, tradeIn, tradeOut, adjustments, remaining: budget - spent + tradeIn - tradeOut + adjustments, cached: faabBalance, claimsWon: wonBy.get(t.id) ?? 0 };
  });
}

/** Unrostered players whose waiver period hasn't ended yet. */
export async function loadPlayersOnWaivers(leagueId: string, now = new Date()) {
  const states = await db.leaguePlayerState.findMany({
    where: { leagueId, waiverClearsAt: { gt: now }, player: { rosterSpots: { none: { leagueId } } } },
    include: { player: { select: { ...playerSelect, searchRank: true } } },
    orderBy: { waiverClearsAt: "asc" },
    take: 100,
  });
  const teamIds = [...new Set(states.map((s) => s.lastDroppedById).filter((x): x is string => !!x))];
  const teams = teamIds.length ? await db.team.findMany({ where: { id: { in: teamIds } }, select: teamSelect }) : [];
  const byId = new Map(teams.map((t) => [t.id, t]));
  return states.map((s) => ({ player: s.player, clearsAt: s.waiverClearsAt!, droppedAt: s.lastDroppedAt, droppedBy: s.lastDroppedById ? (byId.get(s.lastDroppedById) ?? null) : null }));
}

export async function loadRecentResults(leagueId: string, opts: { runs?: number; season?: number } = {}) {
  const claims = await db.waiverClaim.findMany({
    where: { leagueId, status: { in: ["WON", "LOST", "INVALID"] }, processedAt: { not: null }, ...(opts.season ? { season: opts.season } : {}) },
    include: { addPlayer: { select: playerSelect }, dropPlayer: { select: playerSelect }, team: { select: teamSelect } },
    orderBy: { processedAt: "desc" },
    take: 400,
  });
  return groupRuns(claims)
    .slice(0, opts.runs ?? 6)
    .map((r) => ({ at: r.at, players: groupByPlayer(r.claims), total: r.claims.length }));
}

export type RecentRun = Awaited<ReturnType<typeof loadRecentResults>>[number];

/** Ledger detail for one team (all seasons, newest first) with references resolved. */
export async function loadFabLedger(leagueId: string, teamId: string) {
  const raw = await db.faabLedger.findMany({ where: { leagueId, teamId }, orderBy: [{ season: "desc" }, { createdAt: "asc" }] });
  // the season budget opens each season's running balance, whatever its timestamp
  const rows = [...raw].sort((a, b) => b.season - a.season || (a.reason === "SEASON_START" ? 0 : 1) - (b.reason === "SEASON_START" ? 0 : 1) || a.createdAt.getTime() - b.createdAt.getTime());
  const isTradeRef = (t: string | null) => t === "trade" || t === "trade_reversal";
  const claimIds = rows.filter((r) => r.refType === "waiverClaim" && r.refId).map((r) => r.refId!);
  const tradeIds = rows.filter((r) => isTradeRef(r.refType) && r.refId).map((r) => r.refId!);
  const [claims, trades] = await Promise.all([
    claimIds.length ? db.waiverClaim.findMany({ where: { id: { in: claimIds } }, include: { addPlayer: { select: playerSelect } } }) : Promise.resolve([]),
    tradeIds.length ? db.trade.findMany({ where: { id: { in: tradeIds } }, include: { teams: { include: { team: { select: { id: true, name: true } } } } } }) : Promise.resolve([]),
  ]);
  const claimMap = new Map(claims.map((c) => [c.id, c]));
  const tradeMap = new Map(trades.map((t) => [t.id, t]));
  const bySeason = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!bySeason.has(r.season)) bySeason.set(r.season, []);
    bySeason.get(r.season)!.push(r);
  }
  return [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([season, list]) => {
      let running = 0;
      const entries = list.map((r) => {
        running += r.amount;
        const claim = r.refType === "waiverClaim" && r.refId ? claimMap.get(r.refId) : undefined;
        const trade = isTradeRef(r.refType) && r.refId ? tradeMap.get(r.refId) : undefined;
        return {
          id: r.id,
          at: r.createdAt,
          reason: r.reason,
          amount: r.amount,
          balance: running,
          refType: r.refType,
          player: claim?.addPlayer ?? null,
          trade: trade ? { id: trade.id, partners: trade.teams.filter((t) => t.teamId !== teamId).map((t) => t.team.name), reversal: r.refType === "trade_reversal" } : null,
          carryover: r.refType === "carryover",
        };
      });
      return { season, entries: entries.reverse(), balance: running };
    });
}

export function waiverOrderRelevant(settings: LeagueSettings): boolean {
  return settings.waivers.type !== "FAB" || settings.waivers.tiebreaker === "PRIORITY";
}
