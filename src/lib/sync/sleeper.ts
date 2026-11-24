// Sleeper public API sync: every NFL player, weekly stats and weekly projections.
// Docs: https://docs.sleeper.com  (no API key required)
import { Prisma, SeasonType } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchJson } from "@/lib/sync/http";
import { searchName } from "@/lib/utils";

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB", "DE", "DT", "CB", "S", "SS", "FS", "OLB", "ILB", "NT", "FB"]);

type SleeperPlayer = {
  player_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  number?: number | null;
  age?: number | null;
  birth_date?: string | null;
  height?: string | null;
  weight?: string | null;
  college?: string | null;
  years_exp?: number | null;
  status?: string | null;
  active?: boolean;
  injury_status?: string | null;
  injury_body_part?: string | null;
  injury_notes?: string | null;
  injury_start_date?: string | null;
  practice_participation?: string | null;
  practice_description?: string | null;
  depth_chart_position?: string | null;
  depth_chart_order?: number | null;
  search_rank?: number | null;
  news_updated?: number | null;
  espn_id?: number | string | null;
  gsis_id?: string | null;
  yahoo_id?: number | string | null;
  metadata?: Record<string, unknown> | null;
};

function toDate(v: string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Import / refresh every NFL player. Returns number of players upserted. */
export async function syncPlayers(): Promise<number> {
  const data = await fetchJson<Record<string, SleeperPlayer>>("https://api.sleeper.app/v1/players/nfl", { timeoutMs: 120_000 });
  const rows: Prisma.PlayerCreateManyInput[] = [];
  for (const p of Object.values(data)) {
    const pos = p.position ?? p.fantasy_positions?.[0] ?? null;
    if (!pos || !FANTASY_POSITIONS.has(pos)) continue;
    // Skip long-retired players with no team that are inactive and have no relevance
    if (!p.active && !p.team && (p.years_exp ?? 0) > 3) continue;
    const isDef = pos === "DEF";
    const first = p.first_name ?? "";
    const last = p.last_name ?? "";
    const full = isDef ? `${first} ${last}`.trim() || p.player_id : p.full_name ?? `${first} ${last}`.trim();
    const rookieYear = Number((p.metadata as Record<string, string> | null)?.rookie_year) || null;
    rows.push({
      id: p.player_id,
      espnId: p.espn_id ? String(p.espn_id) : null,
      gsisId: p.gsis_id ? String(p.gsis_id).trim() : null,
      yahooId: p.yahoo_id ? String(p.yahoo_id) : null,
      firstName: first,
      lastName: last,
      fullName: full,
      searchName: searchName(full),
      position: pos,
      fantasyPositions: p.fantasy_positions ?? [pos],
      team: p.team ?? (isDef ? p.player_id : null),
      number: p.number ?? null,
      age: p.age ?? null,
      birthDate: toDate(p.birth_date),
      height: p.height ?? null,
      weight: p.weight ?? null,
      college: p.college ?? null,
      yearsExp: p.years_exp ?? null,
      rookieYear,
      status: p.status ?? null,
      active: isDef ? true : !!p.active,
      injuryStatus: p.injury_status ?? null,
      injuryBodyPart: p.injury_body_part ?? null,
      injuryNotes: p.injury_notes ?? null,
      injuryStartDate: toDate(p.injury_start_date),
      practiceParticipation: p.practice_participation ?? null,
      practiceDescription: p.practice_description ?? null,
      depthChartPosition: p.depth_chart_position ?? null,
      depthChartOrder: p.depth_chart_order ?? null,
      searchRank: p.search_rank ?? null,
      newsUpdatedAt: toDate(p.news_updated ?? null),
      metadata: (p.metadata ?? {}) as Prisma.InputJsonValue,
    });
  }

  // Upsert in chunks via INSERT ... ON CONFLICT (much faster than per-row upserts)
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const ids = chunk.map((r) => r.id);
    const existing = new Set((await db.player.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id));
    const toCreate = chunk.filter((r) => !existing.has(r.id));
    const toUpdate = chunk.filter((r) => existing.has(r.id));
    if (toCreate.length) await db.player.createMany({ data: toCreate, skipDuplicates: true });
    if (toUpdate.length) {
      await db.$transaction(
        toUpdate.map((r) => {
          const { id, ...rest } = r;
          return db.player.update({ where: { id }, data: rest });
        }),
      );
    }
  }
  await db.keyValue.upsert({
    where: { key: "sync_players" },
    create: { key: "sync_players", value: { at: new Date().toISOString(), count: rows.length } },
    update: { value: { at: new Date().toISOString(), count: rows.length } },
  });
  return rows.length;
}

type SleeperStatRow = {
  player_id: string;
  week: number | null;
  season: string;
  team?: string | null;
  opponent?: string | null;
  game_id?: string | null;
  stats: Record<string, number>;
};

function seasonTypeParam(t: SeasonType) {
  return t === "POST" ? "post" : t === "PRE" ? "pre" : "regular";
}

async function knownPlayerIds(): Promise<Set<string>> {
  const g = globalThis as unknown as { __playerIds?: { at: number; ids: Set<string> } };
  if (g.__playerIds && Date.now() - g.__playerIds.at < 10 * 60_000) return g.__playerIds.ids;
  const ids = new Set((await db.player.findMany({ select: { id: true } })).map((p) => p.id));
  g.__playerIds = { at: Date.now(), ids };
  return ids;
}

/** Strip Sleeper's derived/ranking fields we never score on, to keep rows small */
function cleanStats(stats: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats ?? {})) {
    if (k.startsWith("pos_rank") || k.startsWith("adp_") || k.startsWith("pos_adp") || k.startsWith("fan_pts_allow")) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Pull weekly stats for every player. Returns the previous + new stat maps so callers (the live
 * scoring poller) can diff them to detect touchdowns and point changes.
 */
export async function syncWeekStats(season: number, week: number, seasonType: SeasonType = "REG") {
  const url = `https://api.sleeper.app/stats/nfl/${season}/${week}?season_type=${seasonTypeParam(seasonType)}`;
  const rows = await fetchJson<SleeperStatRow[]>(url, { timeoutMs: 45_000 });
  const ids = await knownPlayerIds();
  const previous = new Map<string, Record<string, number>>();
  const prevRows = await db.playerWeekStat.findMany({ where: { season, week, seasonType }, select: { playerId: true, stats: true } });
  for (const r of prevRows) previous.set(r.playerId, r.stats as Record<string, number>);

  const data: Prisma.PlayerWeekStatCreateManyInput[] = [];
  const next = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!ids.has(r.player_id)) continue;
    const stats = cleanStats(r.stats);
    if (!Object.keys(stats).length) continue;
    next.set(r.player_id, stats);
    data.push({ playerId: r.player_id, season, week, seasonType, team: r.team ?? null, opponent: r.opponent ?? null, gameId: r.game_id ?? null, stats });
  }
  await db.$transaction([
    db.playerWeekStat.deleteMany({ where: { season, week, seasonType } }),
    db.playerWeekStat.createMany({ data, skipDuplicates: true }),
  ]);
  return { previous, next, count: data.length };
}

export async function syncWeekProjections(season: number, week: number, seasonType: SeasonType = "REG") {
  const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=${seasonTypeParam(seasonType)}`;
  const rows = await fetchJson<SleeperStatRow[]>(url, { timeoutMs: 45_000 });
  const ids = await knownPlayerIds();
  const data: Prisma.PlayerWeekProjectionCreateManyInput[] = [];
  for (const r of rows) {
    if (!ids.has(r.player_id)) continue;
    const stats = cleanStats(r.stats);
    // keep ADP for rookie rankings / trade values
    for (const k of ["adp_dd_ppr", "pos_adp_dd_ppr"]) if (typeof r.stats?.[k] === "number") stats[k] = r.stats[k];
    if (!Object.keys(stats).length) continue;
    data.push({ playerId: r.player_id, season, week, seasonType, team: r.team ?? null, opponent: r.opponent ?? null, stats });
  }
  await db.$transaction([
    db.playerWeekProjection.deleteMany({ where: { season, week, seasonType } }),
    db.playerWeekProjection.createMany({ data, skipDuplicates: true }),
  ]);
  return data.length;
}

/** Backfill every regular-season week up to `throughWeek` (stats) and projections through `projThroughWeek`. */
export async function backfillSeason(season: number, throughWeek: number, projThroughWeek = 18) {
  let stats = 0;
  let proj = 0;
  for (let w = 1; w <= throughWeek; w++) stats += (await syncWeekStats(season, w)).count;
  for (let w = 1; w <= projThroughWeek; w++) proj += await syncWeekProjections(season, w);
  return { stats, proj };
}
