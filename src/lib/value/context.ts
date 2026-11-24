// Loads everything the value model needs for one league (projections, season points, replacement levels,
// standings-based pick slots, team outlooks) and caches it briefly in memory. Safe to import from jobs.
import type { DraftPick, Player } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { computeStandings, type StandingRow } from "@/lib/standings";
import { getNflState } from "@/lib/nfl/state";
import { lastFantasyWeek, leagueWeekFor } from "@/lib/league-week";
import { firstOpenDraftSeason } from "@/lib/picks";
import {
  blendedPpg,
  classifyOutlooks,
  faabValue,
  gamesPerSeason,
  marketDollarsPerPoint,
  pickValue,
  playerValue,
  replacementLevels,
  type AssetValue,
  type PickValueResult,
  type PlayerValueInput,
  type PlayerValueResult,
  type TeamOutlook,
  type ValueEnv,
  type ValueMode,
} from "@/lib/value/model";

const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const IDP_POSITIONS = ["DL", "LB", "DB", "DE", "DT", "CB", "S"];
const CACHE_TTL_MS = 90_000;

export interface ValuedPlayer {
  input: PlayerValueInput;
  player: Pick<Player, "id" | "fullName" | "position" | "team" | "age" | "yearsExp" | "injuryStatus">;
  teamId: string | null;
  seasonPoints: number;
  rosPoints: number;
}

export interface LeagueValueData {
  leagueId: string;
  settings: LeagueSettings;
  season: number;
  week: number;
  phase: string;
  env: ValueEnv;
  players: Map<string, ValuedPlayer>;
  outlooks: Record<string, TeamOutlook>;
  standings: StandingRow[];
  loadedAt: number;
}

type CacheEntry = { at: number; key: string; promise: Promise<LeagueValueData> };
const g = globalThis as unknown as { __cteValueCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = g.__cteValueCache ?? new Map();
g.__cteValueCache = cache;

/** Drop cached valuations for a league (call after trades / roster changes). */
export function invalidateLeagueValues(leagueId: string) {
  cache.delete(leagueId);
}

export async function getLeagueValues(leagueId: string): Promise<LeagueValueData> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settingsVersion: true, season: true, phase: true, weekOverride: true, updatedAt: true } });
  const key = `${league.settingsVersion}:${league.season}:${league.phase}:${league.weekOverride ?? ""}:${league.updatedAt.getTime()}`;
  const hit = cache.get(leagueId);
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
  const promise = loadLeagueValues(leagueId);
  cache.set(leagueId, { at: Date.now(), key, promise });
  promise.catch(() => cache.delete(leagueId));
  return promise;
}

async function loadLeagueValues(leagueId: string): Promise<LeagueValueData> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const settings = resolveSettings(league.settings);
  const nfl = await getNflState();
  const week = leagueWeekFor(league, settings, nfl);
  const season = league.season;
  const phase = league.phase;
  const lastWeek = lastFantasyWeek(settings);
  const inSeason = phase === "REGULAR" || phase === "PLAYOFFS";
  const fromWeek = inSeason ? week : lastWeek + 1;

  const [teams, spots] = await Promise.all([
    db.team.findMany({ where: { leagueId }, select: { id: true } }),
    db.rosterSpot.findMany({ where: { leagueId }, include: { player: true } }),
  ]);
  const positions = settings.roster.idpEnabled ? [...FANTASY_POSITIONS, ...IDP_POSITIONS] : FANTASY_POSITIONS;
  const rosteredIds = new Set(spots.map((s) => s.playerId));
  const notRostered = [...rosteredIds];
  const [freeAgents, freeStreamers] = await Promise.all([
    db.player.findMany({
      where: { active: true, position: { in: positions.filter((p) => p !== "DEF" && p !== "K") }, id: { notIn: notRostered }, searchRank: { not: null } },
      orderBy: { searchRank: "asc" },
      take: 240,
    }),
    // team defenses and kickers are streamed: every unrostered one sets the replacement level
    db.player.findMany({ where: { position: { in: ["DEF", "K"] }, active: true, id: { notIn: notRostered }, ...(settings.roster.slots.some((s) => s.eligible.includes("DEF")) ? {} : { position: "K" }) }, take: 120 }),
  ]);
  const pool: Player[] = [...spots.map((s) => s.player), ...freeAgents, ...freeStreamers];
  const ids = pool.map((p) => p.id);
  const posById = new Map(pool.map((p) => [p.id, p.position]));

  // season-to-date points (this season; in the preseason fall back to last season)
  const statSeason = phase === "PRESEASON" ? season - 1 : season;
  const [statRows, projRows, games] = await Promise.all([
    db.playerWeekStat.findMany({ where: { season: statSeason, seasonType: "REG", playerId: { in: ids }, week: { lte: lastWeek } }, select: { playerId: true, stats: true } }),
    fromWeek <= lastWeek
      ? db.playerWeekProjection.findMany({ where: { season, seasonType: "REG", playerId: { in: ids }, week: { gte: fromWeek, lte: lastWeek } }, select: { playerId: true, stats: true } })
      : Promise.resolve([] as { playerId: string; stats: unknown }[]),
    fromWeek <= lastWeek
      ? db.nflGame.findMany({ where: { season, seasonType: "REG", week: { gte: fromWeek, lte: lastWeek } }, select: { homeTeam: true, awayTeam: true } })
      : Promise.resolve([] as { homeTeam: string; awayTeam: string }[]),
  ]);
  const season$ = new Map<string, { total: number; games: number }>();
  for (const r of statRows) {
    const st = r.stats as StatMap;
    const pts = calcPoints(st, posById.get(r.playerId) ?? "WR", settings.scoring).points;
    const o = season$.get(r.playerId) ?? { total: 0, games: 0 };
    o.total += pts;
    if ((Number(st.gp ?? st.gms_active ?? 0) || 0) > 0 || pts !== 0) o.games += 1;
    season$.set(r.playerId, o);
  }
  const ros = new Map<string, { pts: number; games: number }>();
  for (const r of projRows) {
    const pts = calcPoints(r.stats as StatMap, posById.get(r.playerId) ?? "WR", settings.scoring).points;
    const o = ros.get(r.playerId) ?? { pts: 0, games: 0 };
    o.pts += pts;
    if (pts > 0.5) o.games += 1;
    ros.set(r.playerId, o);
  }
  const scheduled = new Map<string, number>();
  for (const gm of games) {
    scheduled.set(gm.homeTeam, (scheduled.get(gm.homeTeam) ?? 0) + 1);
    scheduled.set(gm.awayTeam, (scheduled.get(gm.awayTeam) ?? 0) + 1);
  }
  const remainingWeeks = Math.max(0, lastWeek - fromWeek + 1);
  const spotById = new Map(spots.map((s) => [s.playerId, s]));

  const players = new Map<string, ValuedPlayer>();
  for (const p of pool) {
    const sp = spotById.get(p.id);
    const st = season$.get(p.id) ?? { total: 0, games: 0 };
    const pr = ros.get(p.id) ?? { pts: 0, games: 0 };
    const sched = p.position === "DEF" ? scheduled.get(p.id) ?? remainingWeeks : p.team ? scheduled.get(p.team) ?? 0 : 0;
    const input: PlayerValueInput = {
      id: p.id,
      position: p.position,
      age: p.age,
      yearsExp: p.yearsExp,
      injuryStatus: p.injuryStatus,
      rosPoints: pr.pts,
      rosGames: pr.games,
      scheduledGames: Math.max(sched, pr.games),
      seasonPpg: st.games ? st.total / st.games : 0,
      gamesPlayed: st.games,
      salary: sp ? sp.salary : null,
      contractYears: sp ? sp.contractYears : null,
      isRookieContract: sp?.isRookieContract ?? false,
    };
    players.set(p.id, {
      input,
      player: { id: p.id, fullName: p.fullName, position: p.position, team: p.team, age: p.age, yearsExp: p.yearsExp, injuryStatus: p.injuryStatus },
      teamId: sp?.teamId ?? null,
      seasonPoints: Math.round(st.total * 100) / 100,
      rosPoints: Math.round(pr.pts * 100) / 100,
    });
  }

  // replacement levels + market $ per point
  const poolArr = [...players.values()].map((v) => ({ position: normalizePosition(v.player.position), ppg: blendedPpg(v.input) }));
  const { replacement, starterIdx } = replacementLevels(poolArr, settings.roster.slots, Math.max(2, teams.length));
  const envBase: ValueEnv = {
    settings,
    teams: Math.max(2, teams.length),
    remainingWeeks,
    seasonWeeks: Math.max(1, lastWeek - settings.general.firstWeek + 1),
    remainingRegularWeeks: inSeason ? Math.max(0, settings.general.firstWeek + settings.general.regularSeasonWeeks - week) : 0,
    replacement,
    dollarsPerPoint: 1,
    scale: 1,
    nextDraftSeason: firstOpenDraftSeason(season, phase),
    projectedSlots: {},
    slotConfidence: 0,
  };
  const gps = gamesPerSeason(envBase);
  let starterPar = 0;
  poolArr.forEach((p, i) => {
    if (starterIdx.has(i)) starterPar += Math.max(0, p.ppg - (replacement[p.position] ?? 0)) * gps;
  });
  envBase.dollarsPerPoint = marketDollarsPerPoint(settings, starterPar);

  // standings → projected rookie draft slots + team outlooks
  const standingsSeason = phase === "PRESEASON" ? season - 1 : season;
  const standings = await computeStandings(leagueId, standingsSeason, settings);
  const gamesPlayed = Math.max(0, ...standings.map((r) => r.wins + r.losses + r.ties));
  const orderMethod = settings.draft.rookie.orderMethod;
  const ordered = [...standings].sort((a, b) =>
    orderMethod === "REVERSE_MAX_PF" || orderMethod === "REVERSE_POTENTIAL_POINTS" ? a.pointsFor - b.pointsFor : b.rank - a.rank,
  );
  const projectedSlots: Record<string, number> = {};
  const lotteryTeams = orderMethod === "LOTTERY" ? Math.min(ordered.length, settings.draft.rookie.lottery.teams) : 0;
  ordered.forEach((r, i) => {
    const slot = i + 1;
    projectedSlots[r.team.id] = slot <= lotteryTeams ? (slot + (lotteryTeams + 1) / 2) / 2 : slot;
  });
  envBase.projectedSlots = projectedSlots;
  envBase.slotConfidence = phase === "REGULAR" ? Math.min(1, gamesPlayed / Math.max(1, settings.general.regularSeasonWeeks)) : standings.length && gamesPlayed > 0 ? 1 : 0;

  const odds = await db.playoffOddsSnapshot.findFirst({ where: { leagueId, season }, orderBy: { computedAt: "desc" } });
  const oddsById = new Map<string, number>();
  if (odds && phase === "REGULAR") for (const o of (odds.data as { teamId: string; playoffPct: number }[]) ?? []) oddsById.set(o.teamId, o.playoffPct > 1 ? o.playoffPct / 100 : o.playoffPct);
  let outlooks: Record<string, TeamOutlook>;
  if (phase === "REGULAR" || phase === "PLAYOFFS") {
    outlooks = classifyOutlooks(
      standings.map((r) => ({ teamId: r.team.id, rank: r.rank, playoffPct: oddsById.has(r.team.id) ? oddsById.get(r.team.id)! : null })),
      { playoffTeams: settings.playoffs.teams, gamesPlayed },
    );
  } else {
    // offseason: rank rosters by the production of their best players
    const strength = new Map<string, number>();
    for (const v of players.values()) if (v.teamId) strength.set(v.teamId, (strength.get(v.teamId) ?? 0) + Math.max(0, blendedPpg(v.input) - (replacement[normalizePosition(v.player.position)] ?? 0)));
    const ranked = teams.map((t) => t.id).sort((a, b) => (strength.get(b) ?? 0) - (strength.get(a) ?? 0));
    outlooks = classifyOutlooks(ranked.map((id, i) => ({ teamId: id, rank: i + 1 })), { playoffTeams: settings.playoffs.teams, gamesPlayed: 99 });
  }

  // display scale: the most valuable rostered player = 100
  let maxRaw = 0;
  for (const v of players.values()) {
    if (!v.teamId) continue;
    const r = playerValue(v.input, envBase, "balanced").value;
    if (r > maxRaw) maxRaw = r;
  }
  envBase.scale = maxRaw > 0 ? 100 / maxRaw : 1;

  return { leagueId, settings, season, week, phase, env: envBase, players, outlooks, standings, loadedAt: Date.now() };
}

export function outlookFor(data: LeagueValueData, teamId: string | null | undefined, mode: ValueMode): TeamOutlook {
  if (mode !== "auto") return mode;
  return (teamId && data.outlooks[teamId]) || "balanced";
}

/** Value a player (rostered or not). Players outside the cached pool get a fresh lightweight input. */
export async function valuePlayers(data: LeagueValueData, playerIds: string[]): Promise<Map<string, ValuedPlayer>> {
  const missing = playerIds.filter((id) => !data.players.has(id));
  if (missing.length) {
    const extra = await db.player.findMany({ where: { id: { in: missing } } });
    const spots = await db.rosterSpot.findMany({ where: { leagueId: data.leagueId, playerId: { in: missing } } });
    const spotBy = new Map(spots.map((s) => [s.playerId, s]));
    const st = await db.playerWeekStat.findMany({ where: { season: data.season, seasonType: "REG", playerId: { in: missing } }, select: { playerId: true, stats: true } });
    const pos = new Map(extra.map((p) => [p.id, p.position]));
    const agg = new Map<string, { total: number; games: number }>();
    for (const r of st) {
      const pts = calcPoints(r.stats as StatMap, pos.get(r.playerId) ?? "WR", data.settings.scoring).points;
      const o = agg.get(r.playerId) ?? { total: 0, games: 0 };
      o.total += pts;
      if (pts !== 0) o.games++;
      agg.set(r.playerId, o);
    }
    for (const p of extra) {
      const a = agg.get(p.id) ?? { total: 0, games: 0 };
      const sp = spotBy.get(p.id);
      data.players.set(p.id, {
        input: {
          id: p.id, position: p.position, age: p.age, yearsExp: p.yearsExp, injuryStatus: p.injuryStatus,
          rosPoints: 0, rosGames: 0, scheduledGames: 0, seasonPpg: a.games ? a.total / a.games : 0, gamesPlayed: a.games,
          salary: sp?.salary ?? null, contractYears: sp?.contractYears ?? null, isRookieContract: sp?.isRookieContract ?? false,
        },
        player: { id: p.id, fullName: p.fullName, position: p.position, team: p.team, age: p.age, yearsExp: p.yearsExp, injuryStatus: p.injuryStatus },
        teamId: sp?.teamId ?? null,
        seasonPoints: Math.round(a.total * 100) / 100,
        rosPoints: 0,
      });
    }
  }
  const out = new Map<string, ValuedPlayer>();
  for (const id of playerIds) {
    const v = data.players.get(id);
    if (v) out.set(id, v);
  }
  return out;
}

/** Value one player, optionally overriding the contract (e.g. the salary snapshot on a trade asset). */
export function valuePlayer(data: LeagueValueData, vp: ValuedPlayer, outlook: TeamOutlook, contract?: { salary: number | null; contractYears: number | null; isRookieContract?: boolean }): PlayerValueResult {
  const input = contract ? { ...vp.input, salary: contract.salary, contractYears: contract.contractYears, isRookieContract: contract.isRookieContract ?? vp.input.isRookieContract } : vp.input;
  return playerValue(input, data.env, outlook);
}

export function valuePick(data: LeagueValueData, pick: Pick<DraftPick, "season" | "round" | "originalTeamId" | "pickInRound">, outlook: TeamOutlook): PickValueResult {
  return pickValue({ season: pick.season, round: pick.round, originalTeamId: pick.originalTeamId, pickInRound: pick.pickInRound }, data.env, outlook);
}

export function valueFaab(data: LeagueValueData, amount: number): AssetValue {
  return faabValue(amount, data.env);
}
