// "How it's going": fantasy points each received player has produced for his new team since the trade,
// and what became of traded picks. Batched for lists of trades (history page).
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { pointsSinceTrade } from "@/lib/trades/rules";

export interface PlayerResult {
  playerId: string;
  toTeamId: string;
  started: number;
  total: number;
  startedWeeks: number;
  weeks: number;
  /** current fantasy team (null = free agent) */
  currentTeamId: string | null;
}

export interface PickResult {
  pickId: string;
  used: boolean;
  player: { id: string; fullName: string; position: string; team: string | null } | null;
  slot: string | null;
}

export interface TradeResults {
  players: Map<string, PlayerResult>; // key `${tradeId}:${playerId}`
  picks: Map<string, PickResult>; // key pickId
  /** total started points received per team per trade: key `${tradeId}:${teamId}` */
  teamTotals: Map<string, number>;
}

export async function tradeResults(
  leagueId: string,
  trades: { id: string; season: number; week: number; assets: { type: string; playerId: string | null; pickId: string | null; toTeamId: string }[] }[],
  settings: LeagueSettings,
): Promise<TradeResults> {
  const out: TradeResults = { players: new Map(), picks: new Map(), teamTotals: new Map() };
  if (!trades.length) return out;
  const playerAssets = trades.flatMap((t) => t.assets.filter((a) => a.type === "PLAYER" && a.playerId).map((a) => ({ trade: t, playerId: a.playerId!, toTeamId: a.toTeamId })));
  const pickIds = [...new Set(trades.flatMap((t) => t.assets.filter((a) => a.type === "PICK" && a.pickId).map((a) => a.pickId!)))];
  const playerIds = [...new Set(playerAssets.map((p) => p.playerId))];
  const minSeason = Math.min(...trades.map((t) => t.season));
  const [players, stats, slots, spots, picks] = await Promise.all([
    playerIds.length ? db.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, position: true } }) : Promise.resolve([]),
    playerIds.length ? db.playerWeekStat.findMany({ where: { playerId: { in: playerIds }, seasonType: "REG", season: { gte: minSeason } }, select: { playerId: true, season: true, week: true, stats: true } }) : Promise.resolve([]),
    playerIds.length
      ? db.lineupSlot.findMany({ where: { leagueId, playerId: { in: playerIds }, season: { gte: minSeason } }, select: { teamId: true, playerId: true, season: true, week: true } })
      : Promise.resolve([]),
    playerIds.length ? db.rosterSpot.findMany({ where: { leagueId, playerId: { in: playerIds } }, select: { playerId: true, teamId: true } }) : Promise.resolve([]),
    pickIds.length ? db.draftPick.findMany({ where: { id: { in: pickIds } }, include: { player: { select: { id: true, fullName: true, position: true, team: true } } } }) : Promise.resolve([]),
  ]);
  const pos = new Map(players.map((p) => [p.id, p.position]));
  const ptsBy = new Map<string, { season: number; week: number; points: number }[]>();
  for (const s of stats) {
    const pts = calcPoints(s.stats as StatMap, pos.get(s.playerId) ?? "WR", settings.scoring).points;
    ptsBy.set(s.playerId, [...(ptsBy.get(s.playerId) ?? []), { season: s.season, week: s.week, points: pts }]);
  }
  const started = new Set(slots.map((s) => `${s.teamId}|${s.playerId}|${s.season}|${s.week}`));
  const currentTeam = new Map(spots.map((s) => [s.playerId, s.teamId]));
  for (const pa of playerAssets) {
    const weeks = (ptsBy.get(pa.playerId) ?? []).map((w) => ({ ...w, startedForTeam: started.has(`${pa.toTeamId}|${pa.playerId}|${w.season}|${w.week}`) }));
    const r = pointsSinceTrade(weeks, pa.trade);
    out.players.set(`${pa.trade.id}:${pa.playerId}`, { playerId: pa.playerId, toTeamId: pa.toTeamId, ...r, currentTeamId: currentTeam.get(pa.playerId) ?? null });
    const k = `${pa.trade.id}:${pa.toTeamId}`;
    out.teamTotals.set(k, Math.round(((out.teamTotals.get(k) ?? 0) + r.started) * 100) / 100);
  }
  for (const p of picks) {
    out.picks.set(p.id, {
      pickId: p.id,
      used: !!(p.playerId || p.usedAt),
      player: p.player,
      slot: p.pickInRound ? `${p.round}.${String(p.pickInRound).padStart(2, "0")}` : null,
    });
  }
  return out;
}
