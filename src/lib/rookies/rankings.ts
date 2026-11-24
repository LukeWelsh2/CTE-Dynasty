// League rookie rankings: auto-scored from Sleeper search rank, dynasty ADP, position value (superflex aware),
// age and NFL draft capital; commissioner-pinned rows keep their manual rank. Snapshotted once per day.
import type { Prisma, RookieRanking } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { getAdpMap } from "@/lib/draft/data";
import { searchName } from "@/lib/utils";
import { autoTiers, draftCapitalFromMetadata, hasTePremium, isSuperflex, mergeRanks, rankingKey, rookieAutoScore } from "@/lib/rookies/logic";

/** Max auto-ranked players per class (commissioner rows are always kept). */
export const AUTO_LIMIT = 150;

export const excludeKey = (leagueId: string, classYear: number) => `rookie-exclude:${leagueId}:${classYear}`;

export async function excludedPlayers(leagueId: string, classYear: number): Promise<Set<string>> {
  const row = await db.keyValue.findUnique({ where: { key: excludeKey(leagueId, classYear) } });
  const v = (row?.value ?? []) as unknown;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
}

export async function setExcludedPlayers(leagueId: string, classYear: number, ids: Set<string>) {
  const value = [...ids] as Prisma.InputJsonValue;
  await db.keyValue.upsert({ where: { key: excludeKey(leagueId, classYear) }, create: { key: excludeKey(leagueId, classYear), value }, update: { value } });
}

export function rankablePositions(settings: LeagueSettings): string[] {
  const base = ["QB", "RB", "WR", "TE"];
  if (settings.roster.idpEnabled) base.push("DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "MLB", "DB", "CB", "S", "SS", "FS");
  return base;
}

/** Players in a rookie class: rookieYear == classYear, plus (for the current season) yearsExp 0 rookies without a rookie year. */
export function rookieClassWhere(classYear: number, currentSeason: number, settings: LeagueSettings): Prisma.PlayerWhereInput {
  const or: Prisma.PlayerWhereInput[] = [{ rookieYear: classYear }];
  if (classYear === currentSeason) or.push({ yearsExp: 0, active: true, rookieYear: null });
  return { position: { in: rankablePositions(settings) }, OR: or };
}

/** Rank movement baseline: ranks from the latest snapshot taken before today (UTC). */
async function baselineRanks(leagueId: string, classYear: number): Promise<Map<string, number> | null> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const snap = await db.rookieRankingSnapshot.findFirst({ where: { leagueId, classYear, takenAt: { lt: today } }, orderBy: { takenAt: "desc" } });
  if (!snap) return null;
  const map = new Map<string, number>();
  for (const r of (snap.data as { rank: number; playerId?: string | null; prospectName?: string | null; position: string }[]) ?? []) map.set(rankingKey(r), r.rank);
  return map;
}

export interface RankingDraftRow {
  playerId: string | null;
  prospectName: string | null;
  position: string;
  college: string | null;
  nflTeam: string | null;
  draftRound: number | null;
  draftPick: number | null;
  tier: number;
  autoScore: number | null;
  notes: string | null;
  source: "AUTO" | "COMMISSIONER";
}

/** Rewrite every rank for a class safely (delete + createMany in one transaction) with movement + daily snapshot. */
export async function writeRankings(leagueId: string, classYear: number, rows: RankingDraftRow[], existing: RookieRanking[]) {
  const baseline = await baselineRanks(leagueId, classYear);
  const prevByKey = new Map(existing.map((r) => [rankingKey(r), r]));
  const data: Prisma.RookieRankingCreateManyInput[] = rows.map((r, i) => {
    const key = rankingKey(r);
    const prior = prevByKey.get(key);
    const previousRank = baseline ? baseline.get(key) ?? null : prior ? prior.previousRank ?? prior.rank : null;
    return {
      leagueId, classYear, playerId: r.playerId, prospectName: r.prospectName, position: r.position, college: r.college, nflTeam: r.nflTeam,
      draftRound: r.draftRound, draftPick: r.draftPick, rank: i + 1, tier: Math.max(1, r.tier), previousRank, autoScore: r.autoScore, notes: r.notes, source: r.source,
    };
  });
  await db.$transaction([db.rookieRanking.deleteMany({ where: { leagueId, classYear } }), db.rookieRanking.createMany({ data })]);
  await snapshotIfDue(leagueId, classYear, data);
}

async function snapshotIfDue(leagueId: string, classYear: number, rows: Prisma.RookieRankingCreateManyInput[], force = false) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const snapData = rows.map((r) => ({ rank: r.rank, playerId: r.playerId ?? null, prospectName: r.prospectName ?? null, position: r.position })) as Prisma.InputJsonValue;
  const existing = await db.rookieRankingSnapshot.findFirst({ where: { leagueId, classYear, takenAt: { gte: today } }, orderBy: { takenAt: "desc" } });
  if (existing) {
    // keep one snapshot per day, always reflecting the day's latest ranks
    await db.rookieRankingSnapshot.update({ where: { id: existing.id }, data: { data: snapData } });
    return false;
  }
  if (!rows.length && !force) return false;
  await db.rookieRankingSnapshot.create({ data: { leagueId, classYear, data: snapData } });
  return true;
}

/** Recompute one class for one league. */
export async function refreshRookieRankings(leagueId: string, classYear: number) {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const opts = { superflex: isSuperflex(settings), tePremium: hasTePremium(settings) };
  const [existing, candidates, excluded, adp] = await Promise.all([
    db.rookieRanking.findMany({ where: { leagueId, classYear }, orderBy: { rank: "asc" } }),
    db.player.findMany({
      where: rookieClassWhere(classYear, league.season, settings),
      select: { id: true, fullName: true, searchName: true, position: true, team: true, college: true, age: true, searchRank: true, metadata: true, active: true },
    }),
    excludedPlayers(leagueId, classYear),
    getAdpMap(Math.min(classYear, league.season)),
  ]);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const scoreOf = (c: (typeof candidates)[number]) => {
    const cap = draftCapitalFromMetadata(c.metadata);
    return { cap, score: rookieAutoScore({ searchRank: c.searchRank, adp: adp.get(c.id), draftRound: cap.round, draftPick: cap.pick, position: normalizePosition(c.position), age: c.age }, opts) };
  };

  // commissioner rows keep their rank; link pre-draft prospects to real players once they appear
  const pinned = existing.filter((r) => r.source === "COMMISSIONER");
  const pinnedPlayerIds = new Set(pinned.map((r) => r.playerId).filter(Boolean) as string[]);
  for (const r of pinned) {
    if (r.playerId || !r.prospectName) continue;
    const sn = searchName(r.prospectName);
    const match = candidates.find((c) => c.searchName === sn && normalizePosition(c.position) === normalizePosition(r.position) && !pinnedPlayerIds.has(c.id));
    if (match) {
      r.playerId = match.id;
      pinnedPlayerIds.add(match.id);
    }
  }
  const notesByKey = new Map(existing.map((r) => [rankingKey(r), r.notes]));

  const auto = candidates
    .filter((c) => !pinnedPlayerIds.has(c.id) && !excluded.has(c.id) && (c.searchRank !== null && c.searchRank < 9_999_999 ? true : adp.has(c.id)))
    .map((c) => ({ c, ...scoreOf(c) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, AUTO_LIMIT);

  const rowsByKey = new Map<string, RankingDraftRow>();
  for (const r of pinned) {
    const c = r.playerId ? byId.get(r.playerId) : undefined;
    const s = c ? scoreOf(c) : null;
    rowsByKey.set(`pin:${r.id}`, {
      playerId: r.playerId, prospectName: r.playerId ? null : r.prospectName, position: c ? normalizePosition(c.position) : r.position,
      college: c?.college ?? r.college, nflTeam: c?.team ?? r.nflTeam, draftRound: s?.cap.round ?? r.draftRound, draftPick: s?.cap.pick ?? r.draftPick,
      tier: r.tier, autoScore: s?.score ?? r.autoScore, notes: r.notes, source: "COMMISSIONER",
    });
  }
  for (const a of auto) {
    rowsByKey.set(`auto:${a.c.id}`, {
      playerId: a.c.id, prospectName: null, position: normalizePosition(a.c.position), college: a.c.college, nflTeam: a.c.team,
      draftRound: a.cap.round, draftPick: a.cap.pick, tier: 1, autoScore: a.score, notes: notesByKey.get(`p:${a.c.id}`) ?? null, source: "AUTO",
    });
  }
  const order = mergeRanks(
    pinned.map((r) => ({ key: `pin:${r.id}`, rank: r.rank })),
    auto.map((a) => ({ key: `auto:${a.c.id}`, score: a.score })),
  );
  const rows = order.map((k) => rowsByKey.get(k)!).filter(Boolean);
  // auto tiers from the scores in final order; commissioner rows keep their own tier
  const tiers = autoTiers(rows.map((r, i) => r.autoScore ?? rows[Math.max(0, i - 1)]?.autoScore ?? 0));
  rows.forEach((r, i) => {
    if (r.source === "AUTO") r.tier = tiers[i];
  });
  await writeRankings(leagueId, classYear, rows, existing);
  return { count: rows.length, pinned: pinned.length, auto: auto.length };
}

/** Every league, current rookie class (league.season) and the next class (season + 1). */
export async function refreshAllRookieRankings(): Promise<string> {
  const leagues = await db.league.findMany({ select: { id: true, slug: true, season: true } });
  const out: string[] = [];
  for (const l of leagues) {
    for (const classYear of [l.season, l.season + 1]) {
      const r = await refreshRookieRankings(l.id, classYear);
      out.push(`${l.slug} ${classYear}: ${r.count} (${r.pinned} pinned)`);
    }
  }
  return out.join("; ") || "no leagues";
}
