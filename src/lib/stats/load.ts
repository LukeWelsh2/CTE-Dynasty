// Manager & league statistics: database loading (batched) on top of the pure helpers in ./manager-stats.ts.
import "server-only";
import { cache } from "react";
import type { Matchup, Team, TeamSeason } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import type { LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { optimalLineup } from "@/lib/lineup";
import { computeStandings, type StandingRow } from "@/lib/standings";
import { capHit, capSummary } from "@/lib/roster";
import {
  allPlay,
  bestAndWorst,
  gamesFromMatchups,
  headToHead,
  inactiveAtWeekEnd,
  luckIndex,
  rankOf,
  rosterAtWeekEnd,
  rosterEventsFor,
  salaryByPosition,
  streaks,
  summarizeGames,
  weekEfficiency,
  weeklyScores,
  weeklyVsLeague,
  winPct,
  type GameRow,
  type H2HRow,
  type OwnerOf,
  type RecordSummary,
  type SalarySlice,
  type StatusEvent,
  type TradeAssetLike,
  type WeekEfficiency,
} from "@/lib/stats/manager-stats";

export interface ManagerIdentity {
  key: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
  isMember: boolean;
  team: Pick<Team, "id" | "name" | "abbrev" | "logoUrl" | "primaryColor" | "secondaryColor"> | null;
}

export interface LeagueHistory {
  teams: Team[];
  teamById: Map<string, Team>;
  teamSeasons: TeamSeason[];
  matchups: Matchup[];
  ownerOf: OwnerOf;
  games: GameRow[];
  managers: Map<string, ManagerIdentity>;
  /** seasons with any data, newest first */
  seasons: number[];
}

/** Every team, archived season, matchup and manager identity for a league (memoized per request). */
export const loadLeagueHistory = cache(async (leagueId: string, currentSeason: number): Promise<LeagueHistory> => {
  const [teams, teamSeasons, matchups, members] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } }),
    db.teamSeason.findMany({ where: { leagueId }, orderBy: [{ season: "desc" }, { finalRank: "asc" }] }),
    db.matchup.findMany({ where: { leagueId, status: "FINAL" }, orderBy: [{ season: "asc" }, { week: "asc" }] }),
    db.leagueMember.findMany({ where: { leagueId }, include: { user: { select: { id: true, name: true, avatarUrl: true, profile: { select: { displayName: true } } } } } }),
  ]);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const tsOwner = new Map(teamSeasons.map((ts) => [`${ts.teamId}:${ts.season}`, ts.ownerId]));
  const ownerOf: OwnerOf = (teamId, season) => {
    const k = `${teamId}:${season}`;
    if (tsOwner.has(k)) return tsOwner.get(k) ?? teamById.get(teamId)?.ownerId ?? null;
    return teamById.get(teamId)?.ownerId ?? null;
  };
  const games = gamesFromMatchups(matchups, ownerOf);

  const managers = new Map<string, ManagerIdentity>();
  const teamOfUser = new Map<string, Team>();
  for (const t of teams) if (t.ownerId) teamOfUser.set(t.ownerId, t);
  for (const m of members) {
    const team = (m.teamId ? teamById.get(m.teamId) : undefined) ?? teamOfUser.get(m.userId) ?? null;
    managers.set(m.userId, { key: m.userId, userId: m.userId, name: m.user.profile?.displayName?.trim() || m.user.name, avatarUrl: m.user.avatarUrl, isMember: true, team });
  }
  // former managers referenced by archived seasons or old matchups
  const missing = new Set<string>();
  for (const ts of teamSeasons) if (ts.ownerId && !managers.has(ts.ownerId)) missing.add(ts.ownerId);
  for (const g of games) if (!g.ownerKey.startsWith("team:") && !managers.has(g.ownerKey)) missing.add(g.ownerKey);
  if (missing.size) {
    const users = await db.user.findMany({ where: { id: { in: [...missing] } }, select: { id: true, name: true, avatarUrl: true, profile: { select: { displayName: true } } } });
    for (const u of users) {
      const last = teamSeasons.find((ts) => ts.ownerId === u.id);
      managers.set(u.id, { key: u.id, userId: u.id, name: u.profile?.displayName?.trim() || u.name, avatarUrl: u.avatarUrl, isMember: false, team: last ? teamById.get(last.teamId) ?? null : null });
    }
  }
  for (const g of games) {
    if (g.ownerKey.startsWith("team:") && !managers.has(g.ownerKey)) {
      const t = teamById.get(g.teamId);
      managers.set(g.ownerKey, { key: g.ownerKey, userId: null, name: t?.name ?? "Unknown team", avatarUrl: null, isMember: false, team: t ?? null });
    }
  }
  const seasons = [...new Set([currentSeason, ...teamSeasons.map((t) => t.season), ...matchups.map((m) => m.season)])].sort((a, b) => b - a);
  return { teams, teamById, teamSeasons, matchups, ownerOf, games, managers, seasons };
});

export function identityFor(history: LeagueHistory, key: string): ManagerIdentity {
  return history.managers.get(key) ?? { key, userId: null, name: key.startsWith("team:") ? history.teamById.get(key.slice(5))?.name ?? "Unknown" : "Former manager", avatarUrl: null, isMember: false, team: null };
}

export const loadStandings = cache(async (leagueId: string, season: number, settings: LeagueSettings): Promise<StandingRow[]> => computeStandings(leagueId, season, settings));

// ───────────────────────────── Lineup efficiency ─────────────────────────────

/**
 * Lineup efficiency for every team and completed week of a season. Rosters for past weeks are rebuilt from
 * the transaction log (adds, drops, trades, IR / taxi moves), so bench points reflect who was actually there.
 */
export const leagueLineupEfficiency = cache(async (leagueId: string, season: number, settings: LeagueSettings): Promise<Map<string, WeekEfficiency[]>> => {
  const finals = await db.matchup.findMany({ where: { leagueId, season, status: "FINAL" }, select: { week: true, homeTeamId: true, awayTeamId: true } });
  const played = new Map<string, Set<number>>();
  for (const m of finals) for (const t of [m.homeTeamId, m.awayTeamId]) if (t) (played.get(t) ?? played.set(t, new Set()).get(t)!).add(m.week);
  const weeks = [...new Set(finals.map((m) => m.week))];
  const out = new Map<string, WeekEfficiency[]>();
  if (!weeks.length) return out;

  const [slots, roster, txs] = await Promise.all([
    db.lineupSlot.findMany({ where: { leagueId, season, week: { in: weeks } }, select: { teamId: true, week: true, playerId: true } }),
    db.rosterSpot.findMany({ where: { leagueId }, select: { teamId: true, playerId: true, status: true } }),
    db.transaction.findMany({
      where: { leagueId, season },
      select: { id: true, type: true, week: true, season: true, createdAt: true, teamId: true, playerId: true, tradeId: true, description: true, details: true },
    }),
  ]);
  const tradeIds = [...new Set(txs.map((t) => t.tradeId).filter((x): x is string => !!x))];
  const assets = tradeIds.length ? await db.tradeAsset.findMany({ where: { tradeId: { in: tradeIds }, type: "PLAYER" }, select: { tradeId: true, type: true, playerId: true, fromTeamId: true, toTeamId: true } }) : [];
  const assetsByTrade = new Map<string, TradeAssetLike[]>();
  for (const a of assets) (assetsByTrade.get(a.tradeId) ?? assetsByTrade.set(a.tradeId, []).get(a.tradeId)!).push(a);

  const taxiCanStart = settings.roster.taxiPlayersCanStart;
  const startersBy = new Map<string, string[]>();
  for (const s of slots) {
    if (!s.playerId) continue;
    const k = `${s.teamId}:${s.week}`;
    (startersBy.get(k) ?? startersBy.set(k, []).get(k)!).push(s.playerId);
  }
  const poolBy = new Map<string, Set<string>>();
  const allIds = new Set<string>();
  for (const teamId of played.keys()) {
    const current = roster.filter((r) => r.teamId === teamId);
    const events = rosterEventsFor(teamId, season, txs, assetsByTrade);
    const statusEvents: StatusEvent[] = txs
      .filter((t) => t.teamId === teamId && t.playerId && (t.type === "IR" || t.type === "ACTIVATE" || (t.type === "TAXI" && !taxiCanStart)))
      .map((t) => ({ at: t.createdAt.getTime(), week: t.week, playerId: t.playerId!, type: t.type }));
    const inactiveNow = current.filter((r) => r.status === "IR" || (r.status === "TAXI" && !taxiCanStart)).map((r) => r.playerId);
    for (const w of played.get(teamId)!) {
      const starters = startersBy.get(`${teamId}:${w}`) ?? [];
      const onRoster = rosterAtWeekEnd(
        current.map((r) => r.playerId),
        events,
        w,
      );
      const inactive = inactiveAtWeekEnd(inactiveNow, statusEvents, w);
      const pool = new Set([...onRoster].filter((id) => !inactive.has(id)));
      for (const id of starters) pool.add(id);
      poolBy.set(`${teamId}:${w}`, pool);
      for (const id of pool) allIds.add(id);
    }
  }
  if (!allIds.size) return out;
  const ids = [...allIds];
  const [players, stats] = await Promise.all([
    db.player.findMany({ where: { id: { in: ids } }, select: { id: true, position: true } }),
    db.playerWeekStat.findMany({ where: { season, seasonType: "REG", week: { in: weeks }, playerId: { in: ids } }, select: { playerId: true, week: true, stats: true } }),
  ]);
  const posById = new Map(players.map((p) => [p.id, p.position]));
  const ptsByWeek = new Map<number, Map<string, number>>();
  for (const s of stats) {
    const pos = posById.get(s.playerId);
    if (!pos) continue;
    (ptsByWeek.get(s.week) ?? ptsByWeek.set(s.week, new Map()).get(s.week)!).set(s.playerId, calcPoints(s.stats as StatMap, pos, settings.scoring).points);
  }
  const optimize = (ps: { id: string; position: string }[], value: Map<string, number>) => optimalLineup(ps, value, settings);
  for (const [teamId, ws] of played) {
    const list: WeekEfficiency[] = [];
    for (const w of [...ws].sort((a, b) => a - b)) {
      const pool = poolBy.get(`${teamId}:${w}`) ?? new Set<string>();
      const cands = [...pool].filter((id) => posById.has(id)).map((id) => ({ id, position: posById.get(id)! }));
      list.push(weekEfficiency(season, w, startersBy.get(`${teamId}:${w}`) ?? [], cands, ptsByWeek.get(w) ?? new Map(), optimize));
    }
    out.set(teamId, list);
  }
  return out;
});

export function efficiencySummary(weeks: WeekEfficiency[]) {
  const actual = weeks.reduce((a, w) => a + w.actual, 0);
  const optimal = weeks.reduce((a, w) => a + w.optimal, 0);
  return {
    weeks: weeks.length,
    efficiency: optimal > 0 ? actual / optimal : weeks.length ? 1 : 0,
    benchLeft: Math.round(weeks.reduce((a, w) => a + w.benchLeft, 0) * 100) / 100,
    perfectWeeks: weeks.filter((w) => w.benchLeft < 0.01).length,
  };
}

// ───────────────────────────── Manager profile stats ─────────────────────────────

export interface SeasonFinish {
  season: number;
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  regularSeasonRank: number | null;
  finalRank: number | null;
  madePlayoffs: boolean;
  champion: boolean;
  runnerUp: boolean;
  inProgress: boolean;
}

/** Season-by-season finishes for every owner: archived TeamSeason rows plus the live current season. */
export function seasonFinishes(history: LeagueHistory, standings: StandingRow[], currentSeason: number, playoffTeamIds: Set<string>): Map<string, SeasonFinish[]> {
  const out = new Map<string, SeasonFinish[]>();
  const push = (key: string, f: SeasonFinish) => (out.get(key) ?? out.set(key, []).get(key)!).push(f);
  const archived = new Set<string>();
  for (const ts of history.teamSeasons) {
    archived.add(`${ts.teamId}:${ts.season}`);
    push(ts.ownerId ?? history.ownerOf(ts.teamId, ts.season) ?? `team:${ts.teamId}`, {
      season: ts.season,
      teamId: ts.teamId,
      teamName: ts.teamName,
      wins: ts.wins,
      losses: ts.losses,
      ties: ts.ties,
      pointsFor: ts.pointsFor,
      pointsAgainst: ts.pointsAgainst,
      regularSeasonRank: ts.regularSeasonRank,
      finalRank: ts.finalRank,
      madePlayoffs: ts.madePlayoffs,
      champion: ts.champion,
      runnerUp: ts.runnerUp,
      inProgress: false,
    });
  }
  for (const r of standings) {
    if (archived.has(`${r.team.id}:${currentSeason}`)) continue;
    if (r.wins + r.losses + r.ties === 0 && !playoffTeamIds.size) continue;
    push(history.ownerOf(r.team.id, currentSeason) ?? `team:${r.team.id}`, {
      season: currentSeason,
      teamId: r.team.id,
      teamName: r.team.name,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      regularSeasonRank: r.rank,
      finalRank: null,
      madePlayoffs: playoffTeamIds.has(r.team.id),
      champion: false,
      runnerUp: false,
      inProgress: true,
    });
  }
  for (const list of out.values()) list.sort((a, b) => b.season - a.season);
  return out;
}

/** Teams in the current season's (non-consolation) playoff bracket */
export function currentPlayoffTeams(history: LeagueHistory, season: number): Set<string> {
  const ids = new Set<string>();
  for (const g of history.games) if (g.season === season && g.isPlayoff && !g.isConsolation) ids.add(g.teamId);
  return ids;
}

export interface ManagerStats {
  identity: ManagerIdentity;
  season: number;
  standing: StandingRow | null;
  currentGames: GameRow[];
  current: RecordSummary;
  allPlayRow: { wins: number; losses: number; ties: number; pct: number; expectedWins: number } | null;
  luck: { value: number; rank: number; of: number } | null;
  efficiency: { weeks: WeekEfficiency[]; summary: ReturnType<typeof efficiencySummary>; rank: number; of: number } | null;
  weekly: ReturnType<typeof weeklyVsLeague>;
  allTime: {
    regular: { wins: number; losses: number; ties: number; pct: number; pf: number; pa: number; seasons: number };
    games: RecordSummary;
    playoffs: { wins: number; losses: number; ties: number };
    playoffApps: number;
    championships: number;
    runnerUps: number;
    bestFinish: number | null;
    longestWin: number;
    longestLoss: number;
  };
  finishes: SeasonFinish[];
  h2h: (H2HRow & { opp: ManagerIdentity })[];
  best: GameRow[];
  worst: GameRow[];
  moves: {
    adds: number;
    drops: number;
    waivers: number;
    trades: number;
    faabSpent: number;
    faabSpentSeason: number;
    faabBalance: number | null;
    partners: { opp: ManagerIdentity; count: number }[];
    seasonCounts: { adds: number; drops: number; waivers: number; trades: number };
  };
  salary: { slices: SalarySlice[]; cap: number; committed: number; space: number; deadMoney: number; totalSalary: number; enabled: boolean } | null;
}

const ADD_TYPES = new Set(["ADD", "FREE_AGENT"]);

export async function managerStats(ctx: LeagueContext, userId: string): Promise<ManagerStats | null> {
  const { league, settings, season } = ctx;
  const history = await loadLeagueHistory(league.id, season);
  const identity = history.managers.get(userId);
  if (!identity) return null;
  const [standings, effByTeam] = await Promise.all([loadStandings(league.id, season, settings), leagueLineupEfficiency(league.id, season, settings)]);
  const team = identity.team ? history.teamById.get(identity.team.id) ?? null : null;
  const standing = team ? standings.find((s) => s.team.id === team.id) ?? null : null;

  const myGames = history.games.filter((g) => g.ownerKey === userId);
  const seasonGames = history.games.filter((g) => g.season === season);
  const currentGames = myGames.filter((g) => g.season === season);
  const current = summarizeGames(currentGames);

  // all-play + luck (regular-season head-to-head, by team)
  const ap = allPlay(weeklyScores(seasonGames));
  const luckRows = [...ap.values()].map((row) => {
    const h2h = seasonGames.filter((g) => g.teamId === row.key && !g.isPlayoff);
    const w = h2h.filter((g) => g.result === "W").length;
    const t = h2h.filter((g) => g.result === "T").length;
    return { teamId: row.key, luck: luckIndex(w, t, row.expectedWins) };
  });
  const myAp = team ? ap.get(team.id) : undefined;
  const myLuck = team ? luckRows.find((r) => r.teamId === team.id) : undefined;

  // lineup efficiency
  let eff: ManagerStats["efficiency"] = null;
  if (team && effByTeam.get(team.id)?.length) {
    const weeks = effByTeam.get(team.id)!;
    const summary = efficiencySummary(weeks);
    const all = [...effByTeam.values()].filter((w) => w.length).map((w) => efficiencySummary(w).efficiency);
    eff = { weeks, summary, rank: rankOf(all, summary.efficiency), of: all.length };
  }

  // all-time
  const playoffIds = currentPlayoffTeams(history, season);
  const finishesByOwner = seasonFinishes(history, standings, season, playoffIds);
  const finishes = finishesByOwner.get(userId) ?? [];
  const regular = finishes.reduce(
    (a, f) => ({ wins: a.wins + f.wins, losses: a.losses + f.losses, ties: a.ties + f.ties, pf: a.pf + f.pointsFor, pa: a.pa + f.pointsAgainst }),
    { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 },
  );
  const playoffGames = myGames.filter((g) => g.isPlayoff && !g.isConsolation);
  const st = streaks(myGames.filter((g) => !g.isConsolation).map((g) => g.result));
  const ranks = finishes.map((f) => f.finalRank).filter((x): x is number => x !== null);

  // head-to-head
  const h2h = headToHead(myGames).map((r) => ({ ...r, opp: identityFor(history, r.oppKey) }));
  const { best, worst } = bestAndWorst(myGames, 5);

  // transactions, FAB, trades
  const myTeamIds = [...new Set([...myGames.map((g) => g.teamId), ...(team ? [team.id] : []), ...history.teamSeasons.filter((t) => t.ownerId === userId).map((t) => t.teamId)])];
  const [txs, ledger, tradeTeams] = await Promise.all([
    myTeamIds.length ? db.transaction.findMany({ where: { leagueId: league.id, teamId: { in: myTeamIds } }, select: { type: true, season: true, teamId: true, tradeId: true, details: true } }) : [],
    myTeamIds.length ? db.faabLedger.findMany({ where: { leagueId: league.id, teamId: { in: myTeamIds }, amount: { lt: 0 }, reason: "WAIVER" }, select: { amount: true, season: true, teamId: true } }) : [],
    myTeamIds.length
      ? db.tradeTeam.findMany({ where: { teamId: { in: myTeamIds }, trade: { leagueId: league.id, status: "COMPLETED" } }, select: { teamId: true, trade: { select: { id: true, season: true, teams: { select: { teamId: true } } } } } })
      : [],
  ]);
  const mine = <T extends { teamId: string | null; season: number }>(rows: T[]) => rows.filter((r) => r.teamId && history.ownerOf(r.teamId, r.season) === userId);
  const myTx = mine(txs);
  const count = (rows: typeof myTx, pred: (t: (typeof myTx)[number]) => boolean) => rows.filter(pred).length;
  const myTrades = tradeTeams.filter((tt) => history.ownerOf(tt.teamId, tt.trade.season) === userId);
  const partnerCounts = new Map<string, number>();
  for (const tt of myTrades) {
    for (const other of tt.trade.teams) {
      if (other.teamId === tt.teamId) continue;
      const key = history.ownerOf(other.teamId, tt.trade.season) ?? `team:${other.teamId}`;
      partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1);
    }
  }
  const myLedger = mine(ledger);
  const seasonTx = myTx.filter((t) => t.season === season);

  // salary
  let salary: ManagerStats["salary"] = null;
  if (team) {
    const spots = await db.rosterSpot.findMany({ where: { teamId: team.id }, include: { player: true } });
    const cap = await capSummary(league.id, team.id, season, settings, spots);
    salary = {
      slices: salaryByPosition(spots.map((s) => ({ position: normalizePosition(s.player.position), salary: s.salary, capHit: capHit(s, settings) }))),
      cap: cap.cap,
      committed: cap.committed,
      space: cap.space,
      deadMoney: cap.deadMoney,
      totalSalary: cap.totalSalary,
      enabled: settings.salaryCap.enabled,
    };
  }

  return {
    identity,
    season,
    standing,
    currentGames,
    current,
    allPlayRow: myAp ? { wins: myAp.wins, losses: myAp.losses, ties: myAp.ties, pct: myAp.pct, expectedWins: myAp.expectedWins } : null,
    luck: myLuck ? { value: myLuck.luck, rank: rankOf(luckRows.map((r) => r.luck), myLuck.luck), of: luckRows.length } : null,
    efficiency: eff,
    weekly: weeklyVsLeague(currentGames, seasonGames),
    allTime: {
      regular: { ...regular, pf: Math.round(regular.pf * 100) / 100, pa: Math.round(regular.pa * 100) / 100, pct: winPct(regular.wins, regular.losses, regular.ties), seasons: finishes.length },
      games: summarizeGames(myGames),
      playoffs: {
        wins: playoffGames.filter((g) => g.result === "W").length,
        losses: playoffGames.filter((g) => g.result === "L").length,
        ties: playoffGames.filter((g) => g.result === "T").length,
      },
      playoffApps: finishes.filter((f) => f.madePlayoffs).length,
      championships: finishes.filter((f) => f.champion).length,
      runnerUps: finishes.filter((f) => f.runnerUp).length,
      bestFinish: ranks.length ? Math.min(...ranks) : null,
      longestWin: st.longestWin,
      longestLoss: st.longestLoss,
    },
    finishes,
    h2h,
    best,
    worst,
    moves: {
      adds: count(myTx, (t) => ADD_TYPES.has(t.type)),
      drops: count(myTx, (t) => t.type === "DROP"),
      waivers: count(myTx, (t) => t.type === "WAIVER"),
      trades: myTrades.length,
      faabSpent: -myLedger.reduce((a, l) => a + l.amount, 0),
      faabSpentSeason: -myLedger.filter((l) => l.season === season).reduce((a, l) => a + l.amount, 0),
      faabBalance: team?.faabBalance ?? null,
      partners: [...partnerCounts.entries()].map(([k, n]) => ({ opp: identityFor(history, k), count: n })).sort((a, b) => b.count - a.count || a.opp.name.localeCompare(b.opp.name)),
      seasonCounts: {
        adds: count(seasonTx, (t) => ADD_TYPES.has(t.type)),
        drops: count(seasonTx, (t) => t.type === "DROP"),
        waivers: count(seasonTx, (t) => t.type === "WAIVER"),
        trades: myTrades.filter((t) => t.trade.season === season).length,
      },
    },
    salary,
  };
}

/** Compact per-manager summary for the managers grid and league hub. */
export async function managerSummaries(ctx: LeagueContext) {
  const history = await loadLeagueHistory(ctx.league.id, ctx.season);
  const standings = await loadStandings(ctx.league.id, ctx.season, ctx.settings);
  const finishes = seasonFinishes(history, standings, ctx.season, currentPlayoffTeams(history, ctx.season));
  const out = new Map<string, { titles: number; playoffApps: number; seasons: number; allTime: { wins: number; losses: number; ties: number }; standing: StandingRow | null }>();
  for (const [key, m] of history.managers) {
    if (!m.isMember) continue;
    const f = finishes.get(key) ?? [];
    out.set(key, {
      titles: f.filter((x) => x.champion).length,
      playoffApps: f.filter((x) => x.madePlayoffs).length,
      seasons: f.length,
      allTime: f.reduce((a, x) => ({ wins: a.wins + x.wins, losses: a.losses + x.losses, ties: a.ties + x.ties }), { wins: 0, losses: 0, ties: 0 }),
      standing: m.team ? standings.find((s) => s.team.id === m.team!.id) ?? null : null,
    });
  }
  return out;
}
