// "Preview impact" for scoring changes: re-scores this season's real stats under current vs proposed
// rules for the top players, by position, and for every completed matchup (which results would flip).
import "server-only";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { normalizePosition } from "@/lib/settings/stat-catalog";

const RAW_POSITIONS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB", "FB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K", "PK"],
  DEF: ["DEF", "DST"],
  DL: ["DE", "DT", "NT", "DL", "EDGE"],
  LB: ["LB", "ILB", "OLB", "MLB"],
  DB: ["CB", "S", "SS", "FS", "DB"],
};
const POS_DEPTH: Record<string, number> = { QB: 24, RB: 36, WR: 48, TE: 24, K: 12, DEF: 12, DL: 24, LB: 24, DB: 24 };

export interface PreviewPlayerRow {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  fantasyTeam: string | null;
  current: number;
  proposed: number;
  delta: number;
  currentRank: number;
  proposedRank: number;
}

export interface PreviewPositionRow {
  position: string;
  depth: number;
  current: number;
  proposed: number;
  delta: number;
  pct: number;
}

export interface PreviewMatchupFlip {
  week: number;
  home: string;
  away: string;
  currentHome: number;
  currentAway: number;
  proposedHome: number;
  proposedAway: number;
}

export interface ScoringPreview {
  throughWeek: number;
  weeks: number;
  players: PreviewPlayerRow[];
  positions: PreviewPositionRow[];
  matchupsCompared: number;
  flips: PreviewMatchupFlip[];
  avgMatchupSwing: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function scoringPreview(
  leagueId: string,
  season: number,
  throughWeek: number,
  settings: LeagueSettings,
  proposed: LeagueSettings["scoring"],
): Promise<ScoringPreview> {
  const fantasyPositions = ["QB", "RB", "WR", "TE", "K", "DEF", ...(settings.roster.idpEnabled ? ["DL", "LB", "DB"] : [])];
  const raw = fantasyPositions.flatMap((p) => RAW_POSITIONS[p]);
  const players = await db.player.findMany({ where: { position: { in: raw } }, select: { id: true, fullName: true, position: true, team: true } });
  const byId = new Map(players.map((p) => [p.id, p]));
  const stats = await db.playerWeekStat.findMany({
    where: { season, seasonType: "REG", week: { lte: throughWeek }, playerId: { in: players.map((p) => p.id) } },
    select: { playerId: true, week: true, stats: true },
  });

  // per player per week points under both rule sets
  const weekly = new Map<string, { cur: number; next: number }>(); // `${pid}:${week}`
  const totals = new Map<string, { cur: number; next: number }>();
  const weeksSeen = new Set<number>();
  for (const row of stats) {
    const p = byId.get(row.playerId);
    if (!p) continue;
    weeksSeen.add(row.week);
    const st = row.stats as StatMap;
    const cur = calcPoints(st, p.position, settings.scoring).points;
    const next = calcPoints(st, p.position, proposed).points;
    weekly.set(`${row.playerId}:${row.week}`, { cur, next });
    const t = totals.get(row.playerId) ?? { cur: 0, next: 0 };
    t.cur += cur;
    t.next += next;
    totals.set(row.playerId, t);
  }

  const list = [...totals.entries()].map(([id, t]) => ({ id, cur: r2(t.cur), next: r2(t.next) }));
  const curRank = new Map([...list].sort((a, b) => b.cur - a.cur).map((x, i) => [x.id, i + 1]));
  const nextSorted = [...list].sort((a, b) => b.next - a.next);
  const nextRank = new Map(nextSorted.map((x, i) => [x.id, i + 1]));
  const top = nextSorted.slice(0, 30);
  const spots = await db.rosterSpot.findMany({ where: { leagueId, playerId: { in: top.map((t) => t.id) } }, select: { playerId: true, team: { select: { abbrev: true } } } });
  const owner = new Map(spots.map((s) => [s.playerId, s.team.abbrev]));
  const playersOut: PreviewPlayerRow[] = top.map((t) => {
    const p = byId.get(t.id)!;
    return {
      playerId: t.id,
      name: p.fullName,
      position: normalizePosition(p.position),
      nflTeam: p.team,
      fantasyTeam: owner.get(t.id) ?? null,
      current: t.cur,
      proposed: t.next,
      delta: r2(t.next - t.cur),
      currentRank: curRank.get(t.id)!,
      proposedRank: nextRank.get(t.id)!,
    };
  });

  const positions: PreviewPositionRow[] = fantasyPositions.map((pos) => {
    const depth = POS_DEPTH[pos] ?? 24;
    const group = list.filter((x) => normalizePosition(byId.get(x.id)!.position) === pos).sort((a, b) => b.cur - a.cur).slice(0, depth);
    const cur = group.length ? group.reduce((a, x) => a + x.cur, 0) / group.length : 0;
    const next = group.length ? group.reduce((a, x) => a + x.next, 0) / group.length : 0;
    return { position: pos, depth: group.length, current: r2(cur), proposed: r2(next), delta: r2(next - cur), pct: cur ? r2(((next - cur) / Math.abs(cur)) * 100) : 0 };
  });

  // completed matchups re-scored from saved lineups
  const [matchups, slots, adjustments, teams] = await Promise.all([
    db.matchup.findMany({ where: { leagueId, season, week: { lte: throughWeek }, status: "FINAL" }, select: { id: true, week: true, homeTeamId: true, awayTeamId: true } }),
    db.lineupSlot.findMany({ where: { leagueId, season, week: { lte: throughWeek } }, select: { teamId: true, week: true, playerId: true } }),
    db.scoreAdjustment.groupBy({ by: ["teamId", "week"], where: { leagueId, season, week: { lte: throughWeek } }, _sum: { points: true } }),
    db.team.findMany({ where: { leagueId }, select: { id: true, abbrev: true } }),
  ]);
  const abbrev = new Map(teams.map((t) => [t.id, t.abbrev]));
  const adj = new Map(adjustments.map((a) => [`${a.teamId}:${a.week}`, a._sum.points ?? 0]));
  const lineup = new Map<string, (string | null)[]>();
  for (const s of slots) {
    const k = `${s.teamId}:${s.week}`;
    if (!lineup.has(k)) lineup.set(k, []);
    lineup.get(k)!.push(s.playerId);
  }
  const penaltyCur = settings.lineup.emptySlotPenalty ?? 0;
  const teamScore = (teamId: string | null, week: number) => {
    if (!teamId) return null;
    const ids = lineup.get(`${teamId}:${week}`) ?? [];
    let cur = 0;
    let next = 0;
    let empty = 0;
    for (const id of ids) {
      if (!id) {
        empty++;
        continue;
      }
      const w = weekly.get(`${id}:${week}`);
      if (w) {
        cur += w.cur;
        next += w.next;
      }
    }
    const a = adj.get(`${teamId}:${week}`) ?? 0;
    return { cur: r2(cur + a - empty * penaltyCur), next: r2(next + a - empty * penaltyCur) };
  };
  const flips: PreviewMatchupFlip[] = [];
  let swing = 0;
  let compared = 0;
  for (const m of matchups) {
    const h = teamScore(m.homeTeamId, m.week);
    const a = teamScore(m.awayTeamId, m.week);
    if (!h || !a) continue;
    compared++;
    swing += Math.abs(h.next - a.next - (h.cur - a.cur));
    const curW = Math.sign(h.cur - a.cur);
    const nextW = Math.sign(h.next - a.next);
    if (curW !== nextW)
      flips.push({ week: m.week, home: abbrev.get(m.homeTeamId!) ?? "?", away: abbrev.get(m.awayTeamId!) ?? "?", currentHome: h.cur, currentAway: a.cur, proposedHome: h.next, proposedAway: a.next });
  }
  return {
    throughWeek,
    weeks: weeksSeen.size,
    players: playersOut,
    positions,
    matchupsCompared: compared,
    flips: flips.sort((x, y) => x.week - y.week),
    avgMatchupSwing: compared ? r2(swing / compared) : 0,
  };
}
