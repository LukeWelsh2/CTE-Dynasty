// Fantasy points lookups for a league (actual + projected) built on the scoring engine.
import type { Player } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { calcPoints, type PointsLine, type StatMap } from "@/lib/scoring/engine";

export interface PlayerWeekPoints {
  playerId: string;
  points: number;
  projected: number;
  stats: StatMap | null;
  projStats: StatMap | null;
  breakdown: PointsLine[];
  opponent: string | null;
  gameId: string | null;
}

/** Points for a set of players in one week. Players without stats get 0. */
export async function weekPoints(
  players: Pick<Player, "id" | "position">[],
  season: number,
  week: number,
  settings: LeagueSettings,
): Promise<Map<string, PlayerWeekPoints>> {
  const ids = players.map((p) => p.id);
  const [stats, projs] = await Promise.all([
    db.playerWeekStat.findMany({ where: { season, week, seasonType: "REG", playerId: { in: ids } } }),
    db.playerWeekProjection.findMany({ where: { season, week, seasonType: "REG", playerId: { in: ids } } }),
  ]);
  const sMap = new Map(stats.map((s) => [s.playerId, s]));
  const pMap = new Map(projs.map((p) => [p.playerId, p]));
  const out = new Map<string, PlayerWeekPoints>();
  for (const p of players) {
    const s = sMap.get(p.id);
    const pr = pMap.get(p.id);
    const actual = calcPoints((s?.stats as StatMap) ?? null, p.position, settings.scoring);
    const projected = calcPoints((pr?.stats as StatMap) ?? null, p.position, settings.scoring);
    out.set(p.id, {
      playerId: p.id,
      points: actual.points,
      projected: projected.points,
      stats: (s?.stats as StatMap) ?? null,
      projStats: (pr?.stats as StatMap) ?? null,
      breakdown: actual.breakdown,
      opponent: s?.opponent ?? pr?.opponent ?? null,
      gameId: s?.gameId ?? null,
    });
  }
  return out;
}

/** Season totals (sum of weeks 1..throughWeek) for many players. */
export async function seasonPoints(
  players: Pick<Player, "id" | "position">[],
  season: number,
  settings: LeagueSettings,
  throughWeek = 18,
): Promise<Map<string, { total: number; games: number; avg: number; byWeek: Record<number, number> }>> {
  const ids = players.map((p) => p.id);
  const posById = new Map(players.map((p) => [p.id, p.position]));
  const rows = await db.playerWeekStat.findMany({
    where: { season, seasonType: "REG", playerId: { in: ids }, week: { lte: throughWeek } },
    select: { playerId: true, week: true, stats: true },
  });
  const out = new Map<string, { total: number; games: number; avg: number; byWeek: Record<number, number> }>();
  for (const id of ids) out.set(id, { total: 0, games: 0, avg: 0, byWeek: {} });
  for (const r of rows) {
    const st = r.stats as StatMap;
    const pts = calcPoints(st, posById.get(r.playerId) ?? "WR", settings.scoring).points;
    const o = out.get(r.playerId)!;
    o.byWeek[r.week] = pts;
    o.total += pts;
    if ((st.gp ?? st.gms_active ?? 0) > 0 || pts !== 0) o.games += 1;
  }
  for (const o of out.values()) {
    o.total = Math.round(o.total * 100) / 100;
    o.avg = o.games ? Math.round((o.total / o.games) * 100) / 100 : 0;
  }
  return out;
}

/** Rest-of-season projected points (sum of weekly projections from `fromWeek` to `toWeek`). */
export async function restOfSeasonProjection(
  players: Pick<Player, "id" | "position">[],
  season: number,
  fromWeek: number,
  toWeek: number,
  settings: LeagueSettings,
): Promise<Map<string, number>> {
  const ids = players.map((p) => p.id);
  const posById = new Map(players.map((p) => [p.id, p.position]));
  const rows = await db.playerWeekProjection.findMany({
    where: { season, seasonType: "REG", playerId: { in: ids }, week: { gte: fromWeek, lte: toWeek } },
    select: { playerId: true, stats: true },
  });
  const out = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const r of rows) out.set(r.playerId, (out.get(r.playerId) ?? 0) + calcPoints(r.stats as StatMap, posById.get(r.playerId) ?? "WR", settings.scoring).points);
  return out;
}
