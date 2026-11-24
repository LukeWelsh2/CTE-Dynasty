// Data loading for manager insights (server only). Pure analysis lives in ./engine.ts.
import "server-only";
import type { Player } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { lastFantasyWeek } from "@/lib/league-week";
import { isLocked, isOnBye, optimalLineup, weekGamesByTeam } from "@/lib/lineup";
import { restOfSeasonProjection } from "@/lib/points";
import { POSITION_SD, teamWeekScore, winProbability } from "@/lib/scoreboard";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { byeWeeksByTeam, POSITION_ORDER } from "@/lib/team/format";
import { alignToCurrent, isUnavailableStatus, keepCurrentWhereEmpty, slotId, toAssignment, toList, type Assignment, type LineupAssignmentLite } from "@/lib/team/lineup-model";
import { lineupWeekState } from "@/lib/team/roster-rules";
import {
  ageByPosition,
  byePlanner,
  contractYearsHistogram,
  defenseVsPosition,
  difficultyFor,
  efficiencyTable,
  positionNeeds,
  positionStrength,
  startersByPosition,
  startSitAnalysis,
  waiverUpgrades,
  weekEfficiency,
  type DvpTable,
  type StartSitPlayer,
  type WeekEfficiency,
} from "@/lib/insights/engine";

// ───────────────────────────── Defense vs position (cached) ─────────────────────────────

export function fantasyPositions(settings: LeagueSettings): string[] {
  const set = new Set<string>();
  for (const s of settings.roster.slots) for (const p of s.eligible) set.add(p);
  if (!settings.roster.idpEnabled) for (const p of ["DL", "LB", "DB"]) set.delete(p);
  return POSITION_ORDER.filter((p) => set.has(p));
}

const g = globalThis as unknown as { __cteDvp?: Map<string, { at: number; table: DvpTable }> };
const DVP_TTL = 15 * 60_000;

/** Fantasy points allowed by each NFL defense to each position (weeks 1..throughWeek), cached per scoring config. */
export async function getDefenseVsPosition(season: number, throughWeek: number, settings: LeagueSettings): Promise<DvpTable | null> {
  if (throughWeek < 1) return null;
  const cache = (g.__cteDvp ??= new Map());
  const key = `${season}:${throughWeek}:${JSON.stringify(settings.scoring)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DVP_TTL) return hit.table;
  const positions = fantasyPositions(settings);
  const rows = await db.playerWeekStat.findMany({
    where: { season, seasonType: "REG", week: { lte: throughWeek }, opponent: { not: null } },
    select: { week: true, opponent: true, stats: true, player: { select: { position: true } } },
  });
  const table = defenseVsPosition(
    rows.map((r) => {
      const pos = normalizePosition(r.player.position);
      return { pos, opponent: r.opponent!, week: r.week, points: positions.includes(pos) ? calcPoints(r.stats as StatMap, r.player.position, settings.scoring).points : 0 };
    }),
    positions,
  );
  if (cache.size > 20) cache.clear();
  cache.set(key, { at: Date.now(), table });
  return table;
}

export async function seasonByeWeeks(season: number): Promise<Map<string, number[]>> {
  const games = await db.nflGame.findMany({ where: { season, seasonType: "REG" }, select: { week: true, homeTeam: true, awayTeam: true } });
  return byeWeeksByTeam(games);
}

// ───────────────────────────── Insights payload ─────────────────────────────

export interface PlayerBrief {
  id: string;
  name: string;
  position: string;
  pos: string;
  team: string | null;
  injuryStatus: string | null;
}

const brief = (p: Player): PlayerBrief => ({ id: p.id, name: p.fullName, position: p.position, pos: normalizePosition(p.position), team: p.team, injuryStatus: p.injuryStatus });

export interface InsightsData {
  week: number;
  editable: boolean;
  readOnlyReason: string | null;
  startSit: {
    currentProj: number;
    optimalProj: number;
    gain: number;
    winNow: number | null;
    winOptimal: number | null;
    opponent: { id: string; name: string; projected: number } | null;
    optimalLineup: LineupAssignmentLite[];
    swaps: {
      in: PlayerBrief & { projected: number };
      out: (PlayerBrief & { projected: number }) | null;
      slotLabel: string;
      gain: number;
      winAfter: number | null;
      lineup: LineupAssignmentLite[];
    }[];
  };
  alerts: {
    kind: "injury" | "doubtful" | "bye" | "empty";
    slotLabel: string;
    player: (PlayerBrief & { projected: number }) | null;
    bench: (PlayerBrief & { projected: number; lineup: LineupAssignmentLite[] }) | null;
    freeAgent: (PlayerBrief & { projected: number }) | null;
  }[];
  difficulty: {
    slotLabel: string;
    player: PlayerBrief;
    opponent: string | null;
    home: boolean;
    rank: number | null;
    of: number;
    perGame: number | null;
    tone: "easy" | "avg" | "tough" | null;
  }[];
  dvp: { positions: string[]; teams: { team: string; cells: Record<string, { rank: number; perGame: number; tone: "easy" | "avg" | "tough" }> }[]; throughWeek: number } | null;
  waivers: {
    needs: { pos: string; mine: number; leagueAvg: number; rank: number; of: number; diff: number }[];
    targets: { pos: string; rank: number; of: number; players: { player: PlayerBrief & { age: number | null }; ros: number; weekProj: number; upgrade: number; replaces: string | null }[] }[];
    fromWeek: number;
    toWeek: number;
  };
  efficiency: {
    weeks: WeekEfficiency[];
    mine: { actual: number; optimal: number; left: number; pct: number; rank: number } | null;
    league: { teamId: string; name: string; abbrev: string; pct: number; left: number; rank: number }[];
  };
  byes: { week: number; onBye: (PlayerBrief & { starter: boolean })[]; startersOnBye: number; short: { pos: string; have: number; need: number }[] }[];
  roster: {
    ages: { pos: string; mine: number | null; league: number | null; count: number }[];
    avgAge: number | null;
    leagueAvgAge: number | null;
    expiring: { player: PlayerBrief; salary: number; isRookie: boolean }[];
    expiringTotal: number;
    histogram: { years: number; count: number }[];
    rookieCount: number;
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function loadInsights(ctx: LeagueContext, teamId: string, week: number): Promise<InsightsData> {
  const { league, settings, season } = ctx;
  const slots = expandSlots(settings);
  const slotLabel = new Map(slots.map((s) => [slotId(s.key, s.index), s.label]));
  const games = await weekGamesByTeam(season, week);
  const lastWeek = lastFantasyWeek(settings);
  const state = lineupWeekState(settings, league.phase, ctx.week, week);

  const [score, matchup, leagueSpots, teams, dvp, byes] = await Promise.all([
    teamWeekScore(teamId, league.id, season, week, settings, { games }),
    db.matchup.findFirst({ where: { leagueId: league.id, season, week, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] }, include: { homeTeam: true, awayTeam: true } }),
    db.rosterSpot.findMany({ where: { leagueId: league.id }, include: { player: true } }),
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "asc" } }),
    getDefenseVsPosition(season, Math.min(ctx.week, week) - 1, settings),
    seasonByeWeeks(season),
  ]);
  const mySpots = leagueSpots.filter((s) => s.teamId === teamId);
  const players = new Map<string, Player>(mySpots.map((s) => [s.playerId, s.player]));
  for (const l of score.starters) if (l.player) players.set(l.player.id, l.player);
  const lines = new Map([...score.starters, ...score.bench].filter((l) => l.player).map((l) => [l.player!.id, l]));

  // ── (a) Start/Sit ──
  const current = toAssignment(score.starters.map((s) => ({ slot: s.slot, slotIndex: s.slotIndex, playerId: s.player?.id ?? null })), slots);
  const activeSpots = mySpots.filter((s) => s.status === "ACTIVE");
  const lockedOf = (p: Player | null | undefined) => !!p && isLocked(p.team, games, settings);
  const lockedSlots = new Map<string, string>();
  for (const [k, pid] of Object.entries(current)) if (pid && lockedOf(players.get(pid))) lockedSlots.set(k, pid);
  const excluded = new Set<string>();
  for (const s of activeSpots) {
    const locked = lockedOf(s.player);
    const starter = Object.values(current).includes(s.playerId);
    if ((locked && !starter) || isUnavailableStatus(s.player.injuryStatus) || isOnBye(s.player.team, games)) excluded.add(s.playerId);
  }
  for (const pid of lockedSlots.values()) excluded.delete(pid);
  const projValue = new Map(activeSpots.map((s) => [s.playerId, lines.get(s.playerId)?.liveProjected ?? 0]));
  const optimalList = state.editable ? optimalLineup(activeSpots.map((s) => s.player), projValue, settings, { locked: lockedSlots, excluded }) : toList(current, slots);
  const optimal = alignToCurrent(
    keepCurrentWhereEmpty(toAssignment(optimalList, slots), current),
    current,
    slots,
    new Map([...players.values()].map((p) => [p.id, normalizePosition(p.position)])),
    new Set(lockedSlots.keys()),
  );
  const ssPlayers = new Map<string, StartSitPlayer>();
  for (const [id, l] of lines) {
    const p = l.player!;
    const sd = POSITION_SD[normalizePosition(p.position)] ?? 6;
    ssPlayers.set(id, { id, name: p.fullName, pos: normalizePosition(p.position), projected: l.projected, liveProjected: l.liveProjected, variance: sd * sd * l.remainingFraction, locked: lockedOf(p) });
  }
  const empties = score.starters.filter((s) => !s.player).length;
  const base = { liveProjected: score.adjustments - empties * (settings.lineup.emptySlotPenalty ?? 0), variance: 0 };
  const ss = startSitAnalysis({ slots, current, optimal, players: ssPlayers, base });
  const oppId = matchup ? (matchup.homeTeamId === teamId ? matchup.awayTeamId : matchup.homeTeamId) : null;
  const oppTeam = matchup ? (matchup.homeTeamId === teamId ? matchup.awayTeam : matchup.homeTeam) : null;
  const opp = oppId ? await teamWeekScore(oppId, league.id, season, week, settings, { games }) : null;
  const wp = (t: { liveProjected: number; variance: number }) => (opp ? winProbability(t, opp) : null);
  const withProj = (id: string) => ({ ...brief(players.get(id)!), projected: round2(ssPlayers.get(id)?.liveProjected ?? 0) });

  // ── (b) Injury / bye alerts with replacements ──
  const starterIds = new Set(Object.values(current).filter((x): x is string => !!x));
  const healthyBench = activeSpots.filter((s) => !starterIds.has(s.playerId) && !excluded.has(s.playerId) && !lockedOf(s.player));
  const alertSlots = slots
    .map((s) => ({ s, id: slotId(s.key, s.index), pid: current[slotId(s.key, s.index)] }))
    .map(({ s, id, pid }) => {
      const p = pid ? players.get(pid) : undefined;
      if (p && lockedOf(p)) return null;
      const kind: InsightsData["alerts"][number]["kind"] | null = !p
        ? "empty"
        : isUnavailableStatus(p.injuryStatus)
          ? "injury"
          : isOnBye(p.team, games)
            ? "bye"
            : (p.injuryStatus ?? "").toLowerCase().startsWith("doubt")
              ? "doubtful"
              : null;
      return kind ? { s, id, p, kind } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  // top free agents for every position involved in an alert (one query)
  const alertPositions = [...new Set(alertSlots.flatMap((a) => a.s.eligible))];
  const faWeekRows = alertPositions.length
    ? await db.playerWeekProjection.findMany({
        where: { season, week, seasonType: "REG", player: { position: { in: positionAliases(alertPositions) }, active: true, team: { not: null }, rosterSpots: { none: { leagueId: league.id } } } },
        include: { player: true },
      })
    : [];
  const faWeek = faWeekRows
    .filter((r) => !isUnavailableStatus(r.player.injuryStatus) && !isOnBye(r.player.team, games) && !isLocked(r.player.team, games, settings))
    .map((r) => ({ player: r.player, proj: calcPoints(r.stats as StatMap, r.player.position, settings.scoring).points }))
    .sort((a, b) => b.proj - a.proj);
  const usedBench = new Set<string>();
  const alerts: InsightsData["alerts"] = alertSlots.map(({ s, id, p, kind }) => {
    const curProj = p ? ssPlayers.get(p.id)?.liveProjected ?? 0 : 0;
    const bench = healthyBench
      .filter((b) => !usedBench.has(b.playerId) && s.eligible.includes(normalizePosition(b.player.position)))
      .map((b) => ({ b, proj: ssPlayers.get(b.playerId)?.liveProjected ?? 0 }))
      .filter((x) => kind !== "doubtful" || x.proj > curProj)
      .sort((a, b) => b.proj - a.proj)[0];
    if (bench) usedBench.add(bench.b.playerId);
    const fa = faWeek.find((f) => s.eligible.includes(normalizePosition(f.player.position)) && (!bench || f.proj > bench.proj));
    const fixLineup: Assignment | null = bench ? { ...current, [id]: bench.b.playerId } : null;
    return {
      kind,
      slotLabel: s.label,
      player: p ? withProj(p.id) : null,
      bench: bench && fixLineup ? { ...withProj(bench.b.playerId), lineup: toList(fixLineup, slots) } : null,
      freeAgent: fa ? { ...brief(fa.player), projected: round2(fa.proj) } : null,
    };
  });

  // ── (c) Matchup difficulty ──
  const difficulty: InsightsData["difficulty"] = score.starters
    .filter((s) => s.player)
    .map((s) => {
      const p = s.player!;
      const pos = normalizePosition(p.position);
      const game = p.team ? games.get(p.team) : undefined;
      const oppAbbr = game ? (game.homeTeam === p.team ? game.awayTeam : game.homeTeam) : null;
      const e = dvp?.get(pos, oppAbbr);
      const of = dvp?.teamCount[pos] ?? 0;
      return {
        slotLabel: s.label,
        player: brief(p),
        opponent: oppAbbr,
        home: !!game && game.homeTeam === p.team,
        rank: e?.rank ?? null,
        of,
        perGame: e?.perGame ?? null,
        tone: e ? difficultyFor(e.rank, of) : null,
      };
    });
  const dvpView: InsightsData["dvp"] = dvp
    ? {
        positions: dvp.positions,
        throughWeek: Math.min(ctx.week, week) - 1,
        teams: [...new Set(Object.values(dvp.byPos).flatMap((l) => l.map((e) => e.team)))]
          .sort()
          .map((team) => ({
            team,
            cells: Object.fromEntries(
              dvp.positions.map((pos) => {
                const e = dvp.get(pos, team)!;
                return [pos, { rank: e.rank, perGame: e.perGame, tone: difficultyFor(e.rank, dvp.teamCount[pos]) }];
              }),
            ),
          })),
      }
    : null;

  // ── (d) Waiver targets by weakest positions (rest-of-season projection) ──
  const fromWeek = Math.max(ctx.week, 1);
  const toWeek = Math.max(fromWeek, lastWeek);
  const need = startersByPosition(slots.filter((s) => fantasyPositions(settings).some((p) => s.eligible.includes(p))));
  const relevant = Object.keys(need).filter((p) => fantasyPositions(settings).includes(p));
  const rosAll = await restOfSeasonProjection(leagueSpots.map((s) => s.player), season, fromWeek, toWeek, settings);
  const strengths = teams.map((t) => ({
    teamId: t.id,
    strength: positionStrength(
      leagueSpots.filter((s) => s.teamId === t.id && s.status !== "TAXI").map((s) => ({ pos: normalizePosition(s.player.position), value: rosAll.get(s.playerId) ?? 0 })).filter((x) => relevant.includes(x.pos)),
      Object.fromEntries(relevant.map((p) => [p, need[p]])),
    ),
  }));
  const needs = positionNeeds(teamId, strengths);
  const weakest = needs.filter((n) => n.rank > Math.ceil(n.of / 3)).slice(0, 3);
  const targetPositions = (weakest.length ? weakest : needs.slice(0, 2)).map((n) => n.pos);
  const faPool = targetPositions.length
    ? await db.player.findMany({
        where: { position: { in: positionAliases(targetPositions) }, active: true, team: { not: null }, rosterSpots: { none: { leagueId: league.id } } },
        orderBy: [{ searchRank: { sort: "asc", nulls: "last" } }],
        take: 60 * targetPositions.length,
      })
    : [];
  const faRos = await restOfSeasonProjection(faPool, season, fromWeek, toWeek, settings);
  const faWeekProj = await restOfSeasonProjection(faPool, season, week, week, settings);
  const mine = mySpots.filter((s) => s.status !== "TAXI").map((s) => ({ id: s.playerId, name: s.player.fullName, pos: normalizePosition(s.player.position), value: rosAll.get(s.playerId) ?? 0 }));
  const targets = targetPositions.map((pos) => {
    const n = needs.find((x) => x.pos === pos)!;
    const ups = waiverUpgrades(
      pos,
      need[pos] ?? 1,
      mine,
      faPool.map((p) => ({ id: p.id, pos: normalizePosition(p.position), value: faRos.get(p.id) ?? 0, p })),
      5,
    );
    return {
      pos,
      rank: n.rank,
      of: n.of,
      players: ups.map((u) => ({ player: { ...brief(u.player.p), age: u.player.p.age }, ros: u.value, weekProj: round2(faWeekProj.get(u.player.id) ?? 0), upgrade: u.upgrade, replaces: u.replaces })),
    };
  });

  // ── (e) Lineup efficiency history ──
  const efficiency = await loadEfficiency(ctx, teamId, teams.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev })), leagueSpots);

  // ── (f) Bye planner ──
  const startersNow = new Set(Object.values(current).filter((x): x is string => !!x));
  const byeWeeksAhead: number[] = [];
  for (let w = Math.max(ctx.week, week); w <= Math.min(lastWeek, 18); w++) byeWeeksAhead.push(w);
  const plan = byePlanner(
    byeWeeksAhead,
    mySpots.filter((s) => s.status === "ACTIVE").map((s) => ({ id: s.playerId, name: s.player.fullName, pos: normalizePosition(s.player.position), team: s.player.team, starter: startersNow.has(s.playerId), unavailable: isUnavailableStatus(s.player.injuryStatus) })),
    byes,
    Object.fromEntries(relevant.map((p) => [p, need[p]])),
  );

  // ── (g) Roster age & contracts ──
  const positions = fantasyPositions(settings);
  const ageRows = ageByPosition(
    mySpots.map((s) => ({ pos: normalizePosition(s.player.position), age: s.player.age })),
    leagueSpots.map((s) => ({ pos: normalizePosition(s.player.position), age: s.player.age })),
    positions,
  );
  const avgAge = (list: typeof leagueSpots) => {
    const ages = list.map((s) => s.player.age).filter((a): a is number => !!a);
    return ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null;
  };
  const expiring = mySpots.filter((s) => s.contractYears <= 1).sort((a, b) => b.salary - a.salary);

  return {
    week,
    editable: state.editable,
    readOnlyReason: state.reason,
    startSit: {
      currentProj: ss.current.liveProjected,
      optimalProj: ss.optimal.liveProjected,
      gain: ss.gain,
      winNow: wp(ss.current),
      winOptimal: wp(ss.optimal),
      opponent: oppTeam && opp ? { id: oppTeam.id, name: oppTeam.name, projected: opp.liveProjected } : null,
      optimalLineup: toList(optimal, slots),
      swaps: ss.swaps.map((sw) => ({
        in: withProj(sw.inId),
        out: sw.outId ? withProj(sw.outId) : null,
        slotLabel: slotLabel.get(sw.slot) ?? sw.slot,
        gain: sw.gain,
        winAfter: wp(sw.totals),
        lineup: toList(sw.lineup, slots),
      })),
    },
    alerts,
    difficulty,
    dvp: dvpView,
    waivers: { needs, targets, fromWeek, toWeek },
    efficiency,
    byes: plan.map((p) => ({ week: p.week, onBye: p.onBye.map((b) => ({ ...brief(players.get(b.id)!), starter: b.starter })), startersOnBye: p.startersOnBye, short: p.short })),
    roster: {
      ages: ageRows,
      avgAge: avgAge(mySpots),
      leagueAvgAge: avgAge(leagueSpots),
      expiring: expiring.map((s) => ({ player: brief(s.player), salary: s.salary, isRookie: s.isRookieContract })),
      expiringTotal: expiring.reduce((a, s) => a + s.salary, 0),
      histogram: contractYearsHistogram(mySpots, settings.contracts.maxYears),
      rookieCount: mySpots.filter((s) => s.isRookieContract).length,
    },
  };
}

/** Sleeper raw positions that normalize to the given fantasy positions (for DB filters) */
function positionAliases(positions: string[]): string[] {
  const out = new Set(positions);
  if (out.has("DL")) ["DE", "DT", "NT", "EDGE"].forEach((p) => out.add(p));
  if (out.has("LB")) ["ILB", "OLB", "MLB"].forEach((p) => out.add(p));
  if (out.has("DB")) ["CB", "S", "SS", "FS"].forEach((p) => out.add(p));
  if (out.has("K")) out.add("PK");
  return [...out];
}

async function loadEfficiency(
  ctx: LeagueContext,
  teamId: string,
  teams: { id: string; name: string; abbrev: string }[],
  leagueSpots: { teamId: string; playerId: string; status: string; acquiredAt: Date; player: Player }[],
): Promise<InsightsData["efficiency"]> {
  const { league, settings, season } = ctx;
  const finals = await db.matchup.findMany({ where: { leagueId: league.id, season, status: "FINAL" }, select: { week: true }, distinct: ["week"], orderBy: { week: "asc" } });
  const weeks = finals.map((f) => f.week);
  if (!weeks.length) return { weeks: [], mine: null, league: [] };
  const [slotsRows, games] = await Promise.all([
    db.lineupSlot.findMany({ where: { leagueId: league.id, season, week: { in: weeks } }, select: { teamId: true, week: true, playerId: true } }),
    db.nflGame.findMany({ where: { season, seasonType: "REG", week: { in: weeks } }, select: { week: true, startTime: true } }),
  ]);
  const lastKick = new Map<number, number>();
  for (const gm of games) lastKick.set(gm.week, Math.max(lastKick.get(gm.week) ?? 0, gm.startTime.getTime()));
  const ids = new Set<string>([...leagueSpots.map((s) => s.playerId), ...slotsRows.map((r) => r.playerId).filter((x): x is string => !!x)]);
  const missing = [...ids].filter((id) => !leagueSpots.some((s) => s.playerId === id));
  const extra = missing.length ? await db.player.findMany({ where: { id: { in: missing } } }) : [];
  const posById = new Map<string, string>([...leagueSpots.map((s) => [s.playerId, s.player.position] as const), ...extra.map((p) => [p.id, p.position] as const)]);
  const stats = await db.playerWeekStat.findMany({ where: { season, seasonType: "REG", week: { in: weeks }, playerId: { in: [...ids] } }, select: { playerId: true, week: true, stats: true } });
  const pts = new Map<number, Map<string, number>>();
  for (const st of stats) {
    if (!pts.has(st.week)) pts.set(st.week, new Map());
    pts.get(st.week)!.set(st.playerId, calcPoints(st.stats as StatMap, posById.get(st.playerId) ?? "WR", settings.scoring).points);
  }
  const perTeam = teams.map((t) => {
    const spots = leagueSpots.filter((s) => s.teamId === t.id && s.status !== "TAXI");
    const list: WeekEfficiency[] = [];
    for (const w of weeks) {
      const starters = slotsRows.filter((r) => r.teamId === t.id && r.week === w && r.playerId).map((r) => r.playerId!);
      if (!starters.length) continue;
      const cutoff = lastKick.get(w) ?? Infinity;
      const pool = new Map<string, { id: string; position: string }>();
      for (const id of starters) pool.set(id, { id, position: posById.get(id) ?? "WR" });
      for (const s of spots) if (s.acquiredAt.getTime() <= cutoff) pool.set(s.playerId, { id: s.playerId, position: s.player.position });
      list.push(weekEfficiency(w, starters, [...pool.values()], pts.get(w) ?? new Map(), settings));
    }
    return { teamId: t.id, weeks: list };
  });
  const table = efficiencyTable(perTeam);
  const mineRow = table.find((r) => r.teamId === teamId) ?? null;
  const byId = new Map(teams.map((t) => [t.id, t]));
  return {
    weeks: perTeam.find((p) => p.teamId === teamId)?.weeks ?? [],
    mine: mineRow ? { actual: mineRow.actual, optimal: mineRow.optimal, left: mineRow.left, pct: mineRow.pct, rank: mineRow.rank } : null,
    league: table.map((r) => ({ teamId: r.teamId, name: byId.get(r.teamId)?.name ?? "", abbrev: byId.get(r.teamId)?.abbrev ?? "", pct: r.pct, left: r.left, rank: r.rank })),
  };
}

