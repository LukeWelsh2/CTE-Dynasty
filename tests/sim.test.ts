import { test } from "node:test";
import assert from "node:assert/strict";
import type { Matchup, Team } from "@prisma/client";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import { coinFlipDraw, divisionTiebreakChain, playoffSeeds, standingsFromMatchups, type StandingRow } from "@/lib/standings";
import { leagueSeeds } from "@/lib/playoffs/seeding";
import { playoffSchedule } from "@/lib/playoffs/structure";
import { createRng, hashString } from "@/lib/sim/rng";
import { rankAndSeed, simulatePlayoffOdds, type SimInput } from "@/lib/sim/core";
import { clinchStatus, finalClinchStatus, markerFor } from "@/lib/sim/clinch";
import { headToHead, regressedPpg, simDataFrom, toSimTeams } from "@/lib/sim/inputs";
import { powerBlurb, type PowerFacts } from "@/lib/sim/power";

const settingsWith = (patch: Record<string, unknown>): LeagueSettings => deepMerge(DEFAULT_SETTINGS, patch);

// ───────── fixtures: a 12-team league with a round-robin schedule ─────────

function makeTeams(n = 12): Team[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `team${String(i + 1).padStart(2, "0")}`,
    leagueId: "L",
    ownerId: null,
    name: `Team ${i + 1}`,
    abbrev: `T${i + 1}`,
    logoUrl: null,
    primaryColor: "#000",
    secondaryColor: "#fff",
    division: i % 2 === 0 ? "east" : "west",
    motto: null,
    waiverPriority: i,
    faabBalance: 0,
    createdAt: new Date(2026, 0, 1, 0, i),
    updatedAt: new Date(),
  }));
}

function roundRobin(teams: Team[], weeks: number): [string, string][][] {
  const ids = teams.map((t) => t.id);
  const out: [string, string][][] = [];
  const arr = [...ids];
  for (let w = 0; w < weeks; w++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < arr.length / 2; i++) pairs.push([arr[i]!, arr[arr.length - 1 - i]!]);
    out.push(pairs);
    arr.splice(1, 0, arr.pop()!);
  }
  return out;
}

function makeSeason(opts: { finalWeeks: number; totalWeeks?: number; seed?: number; strength?: (i: number) => number }) {
  const teams = makeTeams();
  const rng = createRng(opts.seed ?? 7);
  const sched = roundRobin(teams, opts.totalWeeks ?? 14);
  const strength = opts.strength ?? ((i: number) => 100 + i * 2);
  const matchups: Matchup[] = [];
  sched.forEach((pairs, wi) => {
    for (const [h, a] of pairs) {
      const final = wi < opts.finalWeeks;
      const hi = teams.findIndex((t) => t.id === h);
      const ai = teams.findIndex((t) => t.id === a);
      const hs = final ? Math.round((strength(hi) + rng.normal() * 20) * 100) / 100 : 0;
      const as = final ? Math.round((strength(ai) + rng.normal() * 20) * 100) / 100 : 0;
      matchups.push({
        id: `m${wi}-${h}`, leagueId: "L", season: 2026, week: wi + 1, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as,
        homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, status: final ? "FINAL" : "UPCOMING",
        winnerTeamId: final ? (hs > as ? h : as > hs ? a : null) : null, isPlayoff: false, isConsolation: false, isChampionship: false,
        bracketRound: null, bracketSlot: null, homeSeed: null, awaySeed: null, label: null, updatedAt: new Date(),
      });
    }
  });
  return { teams, matchups };
}

function simInputFrom(settings: LeagueSettings, finalWeeks: number, extra: Partial<SimInput> = {}): SimInput {
  const { teams, matchups } = makeSeason({ finalWeeks });
  const data = simDataFrom(teams, matchups, settings);
  const sched = playoffSchedule(settings, teams.length);
  const weeks = [...new Set(data.games.map((g) => g.week)), ...sched.roundWeeks.flat()];
  const mean: SimInput["mean"] = {};
  const sd: SimInput["sd"] = {};
  teams.forEach((t, i) => {
    mean[t.id] = Object.fromEntries(weeks.map((w) => [w, 100 + i * 2]));
    sd[t.id] = Object.fromEntries(weeks.map((w) => [w, 24]));
  });
  return {
    teams: data.simTeams,
    h2h: data.h2h,
    games: data.games,
    mean,
    sd,
    rules: {
      playoffTeams: settings.playoffs.teams,
      seeding: settings.playoffs.seeding,
      wildcardsByPoints: settings.playoffs.wildcardsByPoints,
      divisionWinnersTopSeeds: settings.standings.divisionWinnersTopSeeds,
      divisionWinnersQualify: !!settings.playoffs.divisionWinnersQualify,
      reseed: settings.playoffs.reseed,
      tiebreakers: settings.standings.tiebreakers,
      divisionTiebreakers: divisionTiebreakChain(settings),
      medianGame: settings.niche.medianGameEachWeek,
      highScoreBonus: settings.niche.weeklyHighScoreBonusWin,
      roundWeeks: sched.roundWeeks,
    },
    simulations: 4000,
    seed: 42,
    tau: 7,
    commonShockSD: 9.5,
    leverageWeek: data.games[0]?.week ?? null,
    ...extra,
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("rng is deterministic and roughly standard normal", () => {
  const a = createRng(123);
  const b = createRng(123);
  const xs = Array.from({ length: 20000 }, () => a.normal());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b.normal()));
  const mean = sum(xs) / xs.length;
  const sd = Math.sqrt(sum(xs.map((x) => (x - mean) ** 2)) / xs.length);
  assert.ok(Math.abs(mean) < 0.03, `mean ${mean}`);
  assert.ok(Math.abs(sd - 1) < 0.03, `sd ${sd}`);
  assert.notEqual(hashString("a"), hashString("b"));
});

test("sim ranking + seeding matches standingsFromMatchups/playoffSeeds across tiebreaker settings", () => {
  const configs: Record<string, unknown>[] = [
    {},
    { standings: { divisionWinnersTopSeeds: true } },
    { standings: { tiebreakers: ["POINTS_FOR", "H2H"] } },
    { standings: { tiebreakers: ["DIVISION_RECORD", "ALL_PLAY", "COIN_FLIP"] } },
    { playoffs: { wildcardsByPoints: 2 } },
    { playoffs: { seeding: "POINTS_FOR" } },
    { playoffs: { teams: 4, divisionWinnersQualify: true } },
    { playoffs: { teams: 8 } },
    { standings: { divisionTiebreakers: ["DIVISION_RECORD", "POINTS_AGAINST", "COIN_FLIP"] }, playoffs: { teams: 2, divisionWinnersQualify: true } },
    { standings: { divisionTiebreakers: ["POINTS_FOR"], divisionWinnersTopSeeds: true } },
    { standings: { divisionTiebreakers: [] }, playoffs: { teams: 3, divisionWinnersQualify: true, wildcardsByPoints: 1 } },
    { playoffs: { teams: 4, divisionWinnersQualify: true, seeding: "POINTS_FOR" } },
  ];
  for (const [ci, patch] of configs.entries()) {
    for (const seed of [1, 2, 3]) {
      const settings = settingsWith(patch);
      // low-variance scoring creates plenty of record ties to exercise the tiebreakers
      const { teams, matchups } = makeSeason({ finalWeeks: 6 + seed, seed: seed * 31 + ci, strength: () => 100 });
      const finals = matchups.filter((x) => x.status === "FINAL");
      const standings = standingsFromMatchups(teams, finals, settings);
      const sim = rankAndSeed(toSimTeams(standings, teams), headToHead(finals), {
        playoffTeams: settings.playoffs.teams,
        seeding: settings.playoffs.seeding,
        wildcardsByPoints: settings.playoffs.wildcardsByPoints,
        divisionWinnersTopSeeds: settings.standings.divisionWinnersTopSeeds,
        divisionWinnersQualify: !!settings.playoffs.divisionWinnersQualify,
        tiebreakers: settings.standings.tiebreakers,
        divisionTiebreakers: divisionTiebreakChain(settings),
      });
      assert.deepEqual(sim.order, standings.map((r) => r.team.id), `order, config ${ci} seed ${seed}`);
      assert.deepEqual(sim.divisionWinners, standings.filter((r) => r.divisionRank === 1 && r.team.division).map((r) => r.team.id), `division winners, config ${ci} seed ${seed}`);
      const expected = playoffSeeds(standings, settings).map((r) => r.team.id);
      assert.deepEqual(sim.seeds, expected, `seeds, config ${ci} seed ${seed}`);
      assert.deepEqual(leagueSeeds(standings, settings).map((r) => r.team.id), expected);
      if (settings.playoffs.divisionWinnersQualify || settings.standings.divisionWinnersTopSeeds) {
        for (const w of sim.divisionWinners) assert.ok(expected.includes(w) || expected.length < sim.divisionWinners.length, `division winner ${w} qualifies, config ${ci}`);
      }
    }
  }
});

test("division ranks use the division tiebreakers; division winners can be guaranteed a spot", () => {
  // 4 teams, 2 divisions. A and B (east) both 2-1; B has more points, A won the division game.
  const teams = makeTeams(4).map((t, i) => ({ ...t, division: i < 2 ? "east" : "west" }));
  const [A, B, C, D] = teams.map((t) => t.id) as [string, string, string, string];
  const g = (week: number, h: string, a: string, hs: number, as: number): Matchup => ({
    id: `x${week}${h}`, leagueId: "L", season: 2026, week, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as,
    homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, status: "FINAL", winnerTeamId: hs > as ? h : as > hs ? a : null,
    isPlayoff: false, isConsolation: false, isChampionship: false, bracketRound: null, bracketSlot: null, homeSeed: null, awaySeed: null, label: null, updatedAt: new Date(),
  });
  const games = [g(1, A, B, 101, 100), g(1, C, D, 90, 80), g(2, A, C, 100, 90), g(2, B, D, 150, 80), g(3, A, D, 70, 95), g(3, B, C, 150, 80)];
  const base = { standings: { tiebreakers: ["POINTS_FOR", "COIN_FLIP"], divisionTiebreakers: ["DIVISION_RECORD", "COIN_FLIP"] } };
  const st = standingsFromMatchups(teams, games, settingsWith(base));
  const by = new Map(st.map((r) => [r.team.id, r]));
  assert.equal(st[0]!.team.id, B, "overall: B first on points");
  assert.equal(by.get(A)!.divisionRank, 1, "division: A wins on division record");
  assert.equal(by.get(B)!.divisionRank, 2);
  // fallback to the overall chain when no division tiebreakers are set
  const st2 = standingsFromMatchups(teams, games, settingsWith({ standings: { tiebreakers: ["POINTS_FOR"], divisionTiebreakers: [] } }));
  assert.equal(st2.find((r) => r.team.id === B)!.divisionRank, 1);
  // west: C 1-2 vs D 1-2 → C won the head-to-head division game
  const west = standingsFromMatchups(teams, games, settingsWith({ standings: { tiebreakers: ["POINTS_FOR"], divisionTiebreakers: ["H2H"] } }));
  assert.equal(west.find((r) => r.team.id === C)!.divisionRank, 1);
  // 2-team playoff, division winners qualify: both division winners get in even though B (2-1) has a better record than C/D
  const q = settingsWith({ ...base, playoffs: { teams: 2, divisionWinnersQualify: true } });
  const sq = standingsFromMatchups(teams, games, q);
  const seeds = playoffSeeds(sq, q).map((r) => r.team.id);
  const westWinner = sq.find((r) => r.team.division === "west" && r.divisionRank === 1)!.team.id;
  assert.deepEqual(new Set(seeds), new Set([A, westWinner]));
  assert.equal(seeds[0], A, "seeded by record");
  // without the guarantee the two best records get in
  const plain = settingsWith({ ...base, playoffs: { teams: 2 } });
  assert.deepEqual(playoffSeeds(standingsFromMatchups(teams, games, plain), plain).map((r) => r.team.id), [B, A]);
});

test("simulation is deterministic for a seed and probabilities are internally consistent", () => {
  const input = simInputFrom(DEFAULT_SETTINGS, 10);
  const a = simulatePlayoffOdds(input);
  const b = simulatePlayoffOdds(input);
  assert.deepEqual(a.odds, b.odds);
  assert.equal(a.playoffTeams, 6);
  assert.equal(a.byes, 2);
  close(sum(a.odds.map((o) => o.playoffPct)), 6, 1e-6);
  close(sum(a.odds.map((o) => o.byePct)), 2, 1e-6);
  close(sum(a.odds.map((o) => o.champPct)), 1, 1e-6);
  close(sum(a.odds.map((o) => o.finalsPct)), 2, 1e-6);
  close(sum(a.odds.map((o) => o.firstPct)), 1, 1e-6);
  for (const o of a.odds) {
    close(sum(o.seedDist), o.playoffPct, 1e-6);
    assert.ok(o.champPct <= o.finalsPct + 1e-9 && o.finalsPct <= o.playoffPct + 1e-9);
    assert.ok(o.byePct <= o.playoffPct + 1e-9);
    if (o.avgSeed !== null) assert.ok(o.avgSeed >= 1 && o.avgSeed <= 6);
    // 14 regular-season games for everyone
    close(o.projWins + o.projLosses + o.projTies, 14, 1e-6);
  }
  for (let s = 0; s < 6; s++) close(sum(a.odds.map((o) => o.seedDist[s]!)), 1, 1e-6);
  const c = simulatePlayoffOdds({ ...input, seed: 43 });
  assert.notDeepEqual(c.odds, a.odds);
});

test("stronger projected teams have better odds; leverage is positive", () => {
  const r = simulatePlayoffOdds(simInputFrom(DEFAULT_SETTINGS, 8));
  const weak = r.odds[0]!; // mean 100
  const strong = r.odds[11]!; // mean 122
  assert.ok(strong.champPct > weak.champPct);
  assert.ok(strong.projPF > weak.projPF);
  for (const o of r.odds) if (o.leverage !== null) assert.ok(o.leverage >= -0.05, `leverage ${o.leverage}`);
  assert.ok(r.odds.some((o) => (o.leverage ?? 0) > 0.1));
});

test("no remaining games: playoff odds are exactly the current seeds", () => {
  const settings = DEFAULT_SETTINGS;
  const { teams, matchups } = makeSeason({ finalWeeks: 14 });
  const data = simDataFrom(teams, matchups, settings);
  const r = simulatePlayoffOdds(simInputFrom(settings, 14));
  const seeds = playoffSeeds(data.standings, settings).map((x) => x.team.id);
  for (const o of r.odds) {
    const idx = seeds.indexOf(o.teamId);
    assert.equal(o.playoffPct, idx >= 0 ? 1 : 0);
    if (idx >= 0) assert.equal(o.seedDist[idx], 1);
    assert.equal(o.byePct, idx >= 0 && idx < 2 ? 1 : 0);
  }
});

test("bracket mode respects decided games", () => {
  const input = simInputFrom(DEFAULT_SETTINGS, 14);
  const seeds = input.teams.slice(0, 6).map((t) => t.id);
  // round 1: 4v5 → 5 wins, 3v6 → 6 wins
  const r = simulatePlayoffOdds({ ...input, games: [], bracket: { seeds, advanced: { "1:2": seeds[4]!, "1:4": seeds[5]! } } });
  const by = new Map(r.odds.map((o) => [o.teamId, o]));
  assert.equal(by.get(seeds[3]!)!.champPct, 0);
  assert.equal(by.get(seeds[2]!)!.champPct, 0);
  assert.ok(by.get(seeds[4]!)!.champPct > 0);
  assert.equal(by.get(seeds[0]!)!.playoffPct, 1);
  assert.equal(by.get(seeds[0]!)!.byePct, 1);
  close(sum(r.odds.map((o) => o.champPct)), 1, 1e-6);
});

test("median game and high-score bonus add wins", () => {
  const base = simulatePlayoffOdds(simInputFrom(DEFAULT_SETTINGS, 10));
  const med = simulatePlayoffOdds(simInputFrom(settingsWith({ niche: { medianGameEachWeek: true } }), 10));
  const baseGames = sum(base.odds.map((o) => o.projWins + o.projLosses + o.projTies));
  const medGames = sum(med.odds.map((o) => o.projWins + o.projLosses + o.projTies));
  close(medGames - baseGames, 14 * 12, 1e-6); // a median game for all 12 teams in each of the 14 weeks (played + simulated)
  const hs = simulatePlayoffOdds(simInputFrom(settingsWith({ niche: { weeklyHighScoreBonusWin: true } }), 10));
  close(sum(hs.odds.map((o) => o.projWins)) - sum(base.odds.map((o) => o.projWins)), 14, 1e-6); // one bonus win per week
});

test("10,000 simulations for 12 teams run well under 5 seconds", () => {
  const t0 = Date.now();
  const r = simulatePlayoffOdds({ ...simInputFrom(DEFAULT_SETTINGS, 6), simulations: 10_000 });
  const ms = Date.now() - t0;
  assert.equal(r.simulations, 10_000);
  assert.ok(ms < 5000, `took ${ms} ms`);
});

// ───────── multi-team tiebreaks ─────────

const tm = (id: string, division: string | null = null, i = 0): Team => ({
  id, leagueId: "L", ownerId: null, name: id, abbrev: id, logoUrl: null, primaryColor: "#000", secondaryColor: "#fff", division, motto: null,
  waiverPriority: i, faabBalance: 0, createdAt: new Date(2026, 0, 1, 0, i), updatedAt: new Date(),
});
const game = (week: number, h: string, a: string, hs: number, as: number): Matchup => ({
  id: `g${week}-${h}-${a}`, leagueId: "L", season: 2026, week, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as,
  homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, status: "FINAL", winnerTeamId: hs > as ? h : as > hs ? a : null,
  isPlayoff: false, isConsolation: false, isChampionship: false, bracketRound: null, bracketSlot: null, homeSeed: null, awaySeed: null, label: null, updatedAt: new Date(),
});

/**
 * Teams `ids` play `games` ([winner, loser, winnerScore = 100, loserScore = 90]), then one-game filler teams (always
 * 1-0 or 0-1, so never part of the tie) until each team has `record`; filler scores bring points for to `pf[id]`.
 */
function tiedLeague(o: { ids: string[]; division?: Record<string, string>; games: [string, string, number?, number?][]; record: [number, number]; pf: Record<string, number> }) {
  const teams: Team[] = o.ids.map((id, i) => tm(id, o.division?.[id] ?? null, i));
  const matchups: Matchup[] = [];
  const w = new Map(o.ids.map((id) => [id, 0]));
  const l = new Map(o.ids.map((id) => [id, 0]));
  const pts = new Map(o.ids.map((id) => [id, 0]));
  let week = 1;
  for (const [win, lose, ws = 100, ls = 90] of o.games) {
    matchups.push(game(week++, win, lose, ws, ls));
    w.set(win, w.get(win)! + 1);
    l.set(lose, l.get(lose)! + 1);
    pts.set(win, pts.get(win)! + ws);
    pts.set(lose, pts.get(lose)! + ls);
  }
  let f = 0;
  for (const id of o.ids) {
    const needW = o.record[0] - w.get(id)!;
    const needL = o.record[1] - l.get(id)!;
    assert.ok(needW >= 0 && needL >= 0, `fixture record for ${id}`);
    if (needW + needL === 0) {
      assert.equal(pts.get(id), o.pf[id], `fixture points for ${id}`);
      continue;
    }
    const per = (o.pf[id]! - pts.get(id)!) / (needW + needL);
    assert.ok(per > 1 && per < 500, `fixture points for ${id}`);
    for (let k = 0; k < needW + needL; k++) {
      const filler = tm(`f${String(++f).padStart(2, "0")}`, null, 100 + f);
      teams.push(filler);
      matchups.push(k < needW ? game(week++, id, filler.id, per, 1) : game(week++, filler.id, id, 500, per));
    }
  }
  return { teams, matchups };
}

const only = (rows: StandingRow[], ids: string[]) => rows.map((r) => r.team.id).filter((id) => ids.includes(id));
const rankRules = (settings: LeagueSettings) => ({
  playoffTeams: settings.playoffs.teams,
  seeding: settings.playoffs.seeding,
  wildcardsByPoints: settings.playoffs.wildcardsByPoints,
  divisionWinnersTopSeeds: settings.standings.divisionWinnersTopSeeds,
  divisionWinnersQualify: !!settings.playoffs.divisionWinnersQualify,
  tiebreakers: settings.standings.tiebreakers,
  divisionTiebreakers: divisionTiebreakChain(settings),
});
/** Standings and the simulation's ranking of the same results must agree exactly. */
function assertParity(teams: Team[], matchups: Matchup[], settings: LeagueSettings, msg = "") {
  const st = standingsFromMatchups(teams, matchups, settings);
  const sim = rankAndSeed(toSimTeams(st, teams), headToHead(matchups), rankRules(settings));
  assert.deepEqual(sim.order, st.map((r) => r.team.id), `order ${msg}`);
  assert.deepEqual(sim.divisionWinners, st.filter((r) => r.divisionRank === 1 && r.team.division).map((r) => r.team.id), `division winners ${msg}`);
  assert.deepEqual(sim.seeds, playoffSeeds(st, settings).map((r) => r.team.id), `seeds ${msg}`);
  return st;
}
const permutations = <X,>(xs: X[]): X[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
const ABC = ["A", "B", "C"];
const chainOf = (tiebreakers: string[], divisionTiebreakers: string[] = []) => settingsWith({ standings: { tiebreakers, divisionTiebreakers } });

test("3-team tie with cyclic head-to-head (A>B, B>C, C>A): H2H is skipped for the whole group, independent of team order", () => {
  // each pair met once and every team is 1-1 among the three → H2H can't separate them → points for decides
  const { teams, matchups } = tiedLeague({ ids: ABC, games: [["A", "B", 100, 90], ["B", "C", 120, 110], ["C", "A", 130, 95]], record: [1, 1], pf: { A: 195, B: 210, C: 240 } });
  const settings = chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"]);
  for (const perm of permutations(teams)) {
    const st = assertParity(perm, matchups, settings, perm.map((t) => t.id).join(""));
    assert.deepEqual(only(st, ABC), ["C", "B", "A"], `order with teams listed ${perm.map((t) => t.id).join("")}`);
    const by = new Map(st.map((r) => [r.team.id, r]));
    assert.equal(by.get("C")!.tiebreak!.by, "POINTS_FOR");
    assert.deepEqual(by.get("C")!.tiebreak!.group, ["C", "B", "A"]);
    assert.equal(by.get("A")!.tiebreak, null, "nothing tied below A");
  }
});

test("restart: once a step splits the group, a still-tied pair goes back to plain head-to-head", () => {
  // cyclic H2H again; B and C share the most points (225) → the B/C pair restarts the chain: B beat C
  const { teams, matchups } = tiedLeague({ ids: ABC, games: [["A", "B", 100, 90], ["B", "C", 135, 110], ["C", "A", 115, 105]], record: [1, 1], pf: { A: 205, B: 225, C: 225 } });
  const st = assertParity(teams, matchups, chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"]));
  assert.deepEqual(only(st, ABC), ["B", "C", "A"]);
  const by = new Map(st.map((r) => [r.team.id, r]));
  assert.equal(by.get("B")!.tiebreak!.by, "H2H");
  assert.deepEqual(by.get("B")!.tiebreak!.group, ["B", "C"]);
  assert.deepEqual(by.get("B")!.tiebreak!.h2h, { mode: "RECORD", record: [1, 0, 0], nextRecord: [0, 1, 0] });
  assert.equal(by.get("C")!.tiebreak!.by, "POINTS_FOR");
  // with C ahead of B on points the same pair is decided by points first
  const { teams: t2, matchups: m2 } = tiedLeague({ ids: ABC, games: [["A", "B", 100, 90], ["B", "C", 120, 110], ["C", "A", 130, 95]], record: [1, 1], pf: { A: 195, B: 210, C: 240 } });
  assert.deepEqual(only(assertParity(t2, m2, chainOf(["H2H", "POINTS_FOR"])), ABC), ["C", "B", "A"]);
});

test("3-team tie with one team 2-0 against the others: combined head-to-head record beats points for", () => {
  // every pair met once: A 2-0, B 1-1, C 0-2 among the three, while points for runs the other way
  const { teams, matchups } = tiedLeague({ ids: ABC, games: [["A", "B"], ["A", "C"], ["B", "C"]], record: [3, 3], pf: { A: 500, B: 550, C: 600 } });
  for (const tb of [["H2H", "POINTS_FOR", "DIVISION_RECORD", "POINTS_AGAINST", "COIN_FLIP"], ["H2H"]]) {
    const st = assertParity(teams, matchups, chainOf(tb), tb.join());
    assert.deepEqual(only(st, ABC), ["A", "B", "C"]);
    const a = st.find((r) => r.team.id === "A")!;
    assert.equal(a.tiebreak!.by, "H2H");
    assert.deepEqual(a.tiebreak!.h2h, { mode: "RECORD", record: [2, 0, 0], nextRecord: [1, 1, 0] });
    close(a.tiebreak!.value, 1);
    close(a.tiebreak!.nextValue, 0.5);
  }
  // B and C never met: A still swept both (sweep rule); B vs C restarts — no meeting, so points for decides
  const sweep = tiedLeague({ ids: ABC, games: [["A", "B"], ["A", "C"]], record: [3, 3], pf: { A: 500, B: 550, C: 600 } });
  const st = assertParity(sweep.teams, sweep.matchups, chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"]));
  assert.deepEqual(only(st, ABC), ["A", "C", "B"]);
  assert.equal(st.find((r) => r.team.id === "A")!.tiebreak!.h2h!.mode, "SWEEP");
  assert.equal(st.find((r) => r.team.id === "C")!.tiebreak!.by, "POINTS_FOR");
  assert.deepEqual(st.find((r) => r.team.id === "C")!.tiebreak!.group, ["C", "B"]);
});

test("unequal meetings: no combined head-to-head record; only a clean sweep (top or bottom) counts", () => {
  // A beat B twice, C beat A, B beat C. A combined record would say A (2-1), C (1-1), B (1-2), but A and B met
  // twice while the other pairs met once and nobody swept → H2H is skipped → points for: B, C, A
  const uneven = tiedLeague({ ids: ABC, games: [["A", "B"], ["A", "B"], ["C", "A"], ["B", "C"]], record: [3, 3], pf: { A: 500, B: 600, C: 550 } });
  const st = assertParity(uneven.teams, uneven.matchups, chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"]));
  assert.deepEqual(only(st, ABC), ["B", "C", "A"]);
  assert.equal(st.find((r) => r.team.id === "B")!.tiebreak!.by, "POINTS_FOR");
  // A lost both meetings with B and its one meeting with C (B and C never met): A is swept → last; B vs C → points
  const bottom = tiedLeague({ ids: ABC, games: [["B", "A"], ["B", "A"], ["C", "A"]], record: [3, 3], pf: { A: 700, B: 500, C: 550 } });
  const sb = assertParity(bottom.teams, bottom.matchups, chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"]));
  assert.deepEqual(only(sb, ABC), ["C", "B", "A"]);
  const b = sb.find((r) => r.team.id === "B")!.tiebreak!;
  assert.equal(b.by, "H2H");
  assert.equal(b.h2h!.mode, "SWEEP");
  assert.deepEqual([b.value, b.nextValue], [0, -1]);
});

test("division ranks: the division chain runs on the division's tied teams only, then the overall order", () => {
  // East A/B/C and West D are all 3-3. Among A, B, C (each pair met once) B is 2-0, A 1-1, C 0-2. D's games
  // against B and C make the 4-team overall group unbalanced with no sweep → overall falls to points for.
  const lg = tiedLeague({
    ids: ["A", "B", "C", "D"],
    division: { A: "east", B: "east", C: "east", D: "west" },
    games: [["B", "A"], ["B", "C"], ["A", "C"], ["D", "B"], ["C", "D"]],
    record: [3, 3],
    pf: { A: 600, B: 550, C: 700, D: 650 },
  });
  const ids = ["A", "B", "C", "D"];
  const st = assertParity(lg.teams, lg.matchups, chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"], ["H2H", "POINTS_FOR", "COIN_FLIP"]));
  const by = new Map(st.map((r) => [r.team.id, r]));
  assert.deepEqual(only(st, ids), ["C", "D", "A", "B"], "overall: points for");
  assert.deepEqual(["B", "A", "C"].map((id) => by.get(id)!.divisionRank), [1, 2, 3], "east: B swept the division rivals");
  assert.equal(by.get("D")!.divisionRank, 1);
  assert.equal(by.get("B")!.divisionTiebreak!.by, "H2H");
  assert.deepEqual(by.get("B")!.divisionTiebreak!.group, ["B", "A", "C"]);
  // a division chain that can't separate them (equal all-play wins) falls back to the overall order: C, A, B
  const st2 = assertParity(lg.teams, lg.matchups, chainOf(["H2H", "POINTS_FOR", "COIN_FLIP"], ["ALL_PLAY"]));
  const by2 = new Map(st2.map((r) => [r.team.id, r]));
  assert.deepEqual(["C", "A", "B"].map((id) => by2.get(id)!.divisionRank), [1, 2, 3]);
  assert.equal(by2.get("C")!.divisionTiebreak!.by, "OVERALL_RANK");
  // division winners are seeded through the same ranking in the simulation
  const settings = settingsWith({ standings: { tiebreakers: ["H2H", "POINTS_FOR", "COIN_FLIP"], divisionTiebreakers: ["H2H", "POINTS_FOR"], divisionWinnersTopSeeds: true }, playoffs: { teams: 4 } });
  const s3 = assertParity(lg.teams, lg.matchups, settings);
  assert.deepEqual(playoffSeeds(s3, settings).slice(0, 2).map((r) => r.team.id).sort(), ["B", "D"]);
});

test("ties the chain can't break end in a fixed order: points for, then this season's coin flip", () => {
  // identical 1-1 records, cyclic H2H and equal points: chain ["H2H"] alone can't break it
  const { teams, matchups } = tiedLeague({ ids: ABC, games: [["A", "B"], ["B", "C"], ["C", "A"]], record: [1, 1], pf: { A: 190, B: 190, C: 190 } });
  const orders = new Set<string>();
  for (let season = 2026; season < 2036; season++) {
    const ms = matchups.map((m) => ({ ...m, season }));
    const st = assertParity(teams, ms, chainOf(["H2H"]), `season ${season}`);
    const expected = [...ABC].sort((a, b) => coinFlipDraw(season, b) - coinFlipDraw(season, a));
    assert.deepEqual(only(st, ABC), expected, `season ${season}`);
    assert.equal(st.find((r) => r.team.id === expected[0])!.tiebreak!.by, "COIN_FLIP");
    assert.equal(st.find((r) => r.team.id === "A")!.coinFlip, coinFlipDraw(season, "A"));
    orders.add(expected.join(""));
  }
  assert.ok(orders.size > 1, "the coin flip is redrawn each season");
  // points for still comes first when the chain doesn't list it
  const { teams: t2, matchups: m2 } = tiedLeague({ ids: ABC, games: [["A", "B", 100, 95], ["B", "C", 105, 80], ["C", "A", 100, 90]], record: [1, 1], pf: { A: 190, B: 200, C: 180 } });
  assert.deepEqual(only(assertParity(t2, m2, chainOf(["H2H"])), ABC), ["B", "A", "C"]);
  assert.deepEqual(only(assertParity(t2, m2, chainOf([])), ABC), ["B", "A", "C"]);
});

test("standings and the simulation rank tie-heavy seasons identically, whatever the team order", () => {
  const chains: string[][] = [
    ["H2H", "POINTS_FOR", "DIVISION_RECORD", "POINTS_AGAINST", "COIN_FLIP"],
    ["H2H"],
    ["DIVISION_RECORD", "H2H", "ALL_PLAY"],
    ["POINTS_AGAINST", "H2H", "COIN_FLIP"],
    ["ALL_PLAY", "H2H", "POINTS_FOR"],
    [],
  ];
  const divChains: string[][] = [["H2H", "DIVISION_RECORD", "POINTS_FOR", "COIN_FLIP"], ["H2H"], []];
  let multiTies = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const rng = createRng(seed * 977);
    const nTeams = seed % 2 ? 12 : 10;
    const teams = makeTeams(nTeams).map((t, i) => ({ ...t, division: seed % 3 === 0 ? null : ["east", "west", "north"][i % (seed % 3 === 1 ? 2 : 3)]! }));
    const weeks = 3 + (seed % 11);
    const matchups: Matchup[] = [];
    roundRobin(teams, weeks).forEach((pairs, wi) => {
      // integer scores in a narrow band: tied records, tied points and tied games are all common
      for (const [h, a] of pairs) matchups.push(game(wi + 1, h, a, 1 + Math.floor(rng.next() * 3), 1 + Math.floor(rng.next() * 3)));
    });
    for (const [ci, tiebreakers] of chains.entries()) {
      const settings = settingsWith({
        standings: { tiebreakers, divisionTiebreakers: divChains[(seed + ci) % divChains.length], divisionWinnersTopSeeds: ci % 2 === 1 },
        playoffs: { teams: 4 + (ci % 3) * 2, divisionWinnersQualify: ci === 4 },
        niche: { medianGameEachWeek: ci === 3 },
      });
      const st = assertParity(teams, matchups, settings, `seed ${seed} chain ${ci}`);
      const groups = new Map<number, number>();
      for (const r of st) groups.set(r.pct, (groups.get(r.pct) ?? 0) + 1);
      if ([...groups.values()].some((c) => c >= 3)) multiTies++;
      // a total order: listing the teams differently changes nothing
      const shuffled = [...teams].sort(() => rng.next() - 0.5);
      const again = assertParity(shuffled, matchups, settings, `seed ${seed} chain ${ci} shuffled`);
      assert.deepEqual(again.map((r) => r.team.id), st.map((r) => r.team.id), `seed ${seed} chain ${ci}: order depends on team listing`);
      assert.deepEqual(again.map((r) => [r.team.id, r.divisionRank]).sort(), st.map((r) => [r.team.id, r.divisionRank]).sort());
    }
  }
  assert.ok(multiTies > 50, `exercised ${multiTies} seasons with 3+ team ties`);
});

test("simulated seasons rank exactly like the standings: no games left → odds equal the standings' seeds and division winners", () => {
  const lg = tiedLeague({
    ids: ["A", "B", "C", "D"],
    division: { A: "east", B: "east", C: "east", D: "west" },
    games: [["B", "A"], ["B", "C"], ["A", "C"], ["D", "B"], ["C", "D"]],
    record: [3, 3],
    pf: { A: 600, B: 550, C: 700, D: 650 },
  });
  for (const patch of [{ standings: { tiebreakers: ["H2H", "POINTS_FOR", "COIN_FLIP"] } }, { standings: { tiebreakers: ["H2H"], divisionTiebreakers: ["ALL_PLAY"] }, playoffs: { teams: 4, divisionWinnersQualify: true } }]) {
    const settings = settingsWith(patch);
    const data = simDataFrom(lg.teams, lg.matchups, settings);
    const sched = playoffSchedule(settings, lg.teams.length);
    const r = simulatePlayoffOdds({
      teams: data.simTeams, h2h: data.h2h, games: [], mean: {}, sd: {}, simulations: 200, seed: 9, tau: 6, commonShockSD: 9.5,
      rules: { ...rankRules(settings), reseed: false, medianGame: false, highScoreBonus: false, roundWeeks: sched.roundWeeks },
    });
    const seeds = playoffSeeds(data.standings, settings).map((x) => x.team.id);
    const winners = new Set(data.standings.filter((x) => x.divisionRank === 1 && x.team.division).map((x) => x.team.id));
    for (const o of r.odds) {
      assert.equal(o.playoffPct, seeds.includes(o.teamId) ? 1 : 0, `playoffs ${o.teamId}`);
      if (seeds.includes(o.teamId)) assert.equal(o.seedDist[seeds.indexOf(o.teamId)], 1, `seed ${o.teamId}`);
      assert.equal(o.divisionPct, winners.has(o.teamId) ? 1 : 0, `division ${o.teamId}`);
      assert.equal(o.firstPct, o.teamId === data.standings[0]!.team.id ? 1 : 0);
      assert.equal(o.lastPct, o.teamId === data.standings[data.standings.length - 1]!.team.id ? 1 : 0);
    }
  }
});

// ───────── clinch math ─────────

const ct = (id: string, wins: number, losses: number, remaining: number, division: string | null = null) => ({ id, division, wins, losses, ties: 0, remaining, bonusWeeks: 0 });
const rules = { playoffTeams: 2, byes: 1, wildcardsByPoints: 0, seeding: "RECORD" as const, divisionWinnersTopSeeds: false };

test("clinchStatus: clinch, elimination, bye", () => {
  const s = clinchStatus([ct("a", 10, 0, 2), ct("b", 6, 4, 2), ct("c", 5, 5, 2), ct("d", 2, 8, 2)], rules);
  assert.equal(s.get("a")!.playoffs, "clinched"); // worst 10-2; only b can reach 8
  assert.equal(s.get("a")!.bye, "clinched");
  assert.equal(markerFor(s.get("a")), "z");
  assert.equal(s.get("b")!.playoffs, null);
  assert.equal(s.get("d")!.playoffs, "eliminated"); // best 4-8 < a (10) and b (6) minimums
  assert.equal(markerFor(s.get("d")), "e");
  assert.equal(s.get("c")!.playoffs, null);
});

test("clinchStatus: division logic and conservative ties", () => {
  const teams = [ct("a", 9, 1, 1, "east"), ct("b", 7, 3, 1, "east"), ct("c", 8, 2, 1, "west"), ct("d", 1, 9, 1, "west")];
  const s = clinchStatus(teams, { ...rules, divisionWinnersTopSeeds: true, playoffTeams: 2, byes: 0 });
  assert.equal(s.get("a")!.division, "clinched");
  assert.equal(s.get("a")!.playoffs, "clinched");
  assert.equal(markerFor(s.get("a")), "y");
  assert.equal(s.get("c")!.division, "clinched");
  assert.equal(s.get("b")!.playoffs, "eliminated");
  // tie on worst/best case is not a clinch
  const tie = clinchStatus([ct("a", 5, 5, 1), ct("b", 5, 5, 1), ct("c", 4, 6, 1)], { ...rules, playoffTeams: 1 });
  assert.equal(tie.get("a")!.playoffs, null);
  assert.equal(tie.get("c")!.playoffs, null, "c can still tie at 5-6");
});

test("clinchStatus is sound: brute force over every remaining-game outcome (record seeding)", () => {
  // 8 teams, 2 weeks (8 games) left → 256 outcomes; ties counted against the team (worst case)
  const rng = createRng(2024);
  for (let trial = 0; trial < 40; trial++) {
    const ids = Array.from({ length: 8 }, (_, i) => `t${i}`);
    const div = (i: number) => (i % 2 ? "west" : "east");
    const wins = ids.map(() => Math.floor(rng.next() * 9));
    const played = 10;
    const games: [number, number][] = [];
    for (let w = 0; w < 2; w++) {
      const perm = [...ids.keys()].sort(() => rng.next() - 0.5);
      for (let k = 0; k < 8; k += 2) games.push([perm[k]!, perm[k + 1]!]);
    }
    const left = ids.map((_, i) => games.filter(([a, b]) => a === i || b === i).length);
    const N = 2 + Math.floor(rng.next() * 4);
    const B = Math.floor(rng.next() * Math.min(3, N));
    const teams = ids.map((id, i) => ({ id, division: div(i), wins: wins[i]!, losses: played - wins[i]!, ties: 0, remaining: left[i]!, bonusWeeks: 0 }));
    const st = clinchStatus(teams, { playoffTeams: N, byes: B, wildcardsByPoints: 0, seeding: "RECORD", divisionWinnersTopSeeds: false });
    const outcomes: number[][] = [];
    for (let mask = 0; mask < 1 << games.length; mask++) {
      const w = [...wins];
      games.forEach(([a, b], g) => (mask & (1 << g) ? w[a]!++ : w[b]!++));
      outcomes.push(w);
    }
    for (let i = 0; i < 8; i++) {
      const s = st.get(ids[i]!)!;
      const ge = (w: number[], k: number) => w.filter((x, j) => j !== i && x >= w[i]!).length < k; // surely in top k
      const gt = (w: number[], k: number) => w.filter((x, j) => j !== i && x > w[i]!).length >= k; // surely out of top k
      if (s.playoffs === "clinched") assert.ok(outcomes.every((w) => ge(w, N)), `trial ${trial} team ${i} false playoff clinch`);
      if (s.playoffs === "eliminated") assert.ok(outcomes.every((w) => gt(w, N)), `trial ${trial} team ${i} false elimination`);
      if (s.bye === "clinched") assert.ok(outcomes.every((w) => ge(w, B)), `trial ${trial} team ${i} false bye clinch`);
      if (s.bye === "eliminated" && s.playoffs !== "eliminated") assert.ok(outcomes.every((w) => gt(w, B)), `trial ${trial} team ${i} false bye elimination`);
      const rivals = ids.map((_, j) => j).filter((j) => j !== i && div(j) === div(i));
      if (s.division === "clinched") assert.ok(outcomes.every((w) => rivals.every((j) => w[j]! < w[i]!)), `trial ${trial} team ${i} false division clinch`);
      if (s.division === "eliminated") assert.ok(outcomes.every((w) => rivals.some((j) => w[j]! > w[i]!)), `trial ${trial} team ${i} false division elimination`);
    }
  }
});

test("finalClinchStatus marks seeds, division winners and byes exactly", () => {
  const s = finalClinchStatus(["a", "b", "c", "d"], ["a", "c"], ["a", "d"], 1);
  assert.equal(markerFor(s.get("a")), "z");
  assert.equal(markerFor(s.get("c")), "x");
  assert.equal(markerFor(s.get("d")), "y");
  assert.equal(s.get("d")!.playoffs, "eliminated");
  assert.equal(markerFor(s.get("b")), "e");
});

test("simDataFrom rewinds to a week and regressedPpg shrinks toward the league mean", () => {
  const { teams, matchups } = makeSeason({ finalWeeks: 10 });
  const d5 = simDataFrom(teams, matchups, DEFAULT_SETTINGS, 5);
  assert.equal(d5.lastFinalWeek, 5);
  assert.equal(d5.final.length, 30);
  assert.equal(d5.games.length, 9 * 6);
  assert.equal(d5.gamesPlayed.get(teams[0]!.id), 5);
  const d = simDataFrom(teams, matchups, DEFAULT_SETTINGS);
  assert.equal(d.lastFinalWeek, 10);
  assert.equal(regressedPpg(1300, 10, 100), (1300 + 200) / 12);
  assert.equal(regressedPpg(0, 0, 110), 110);
});

// ───────── power ranking blurbs ─────────

const facts = (p: Partial<PowerFacts> = {}): PowerFacts => ({
  teamId: "t1", teamName: "Bell Ringers", week: 11, rank: 3, prevRank: 3, teamCount: 12, wins: 7, losses: 3, ties: 0,
  streak: "W1", pfRank: 5, pointsFor: 1200, allPlayPct: 0.6, recordPct: 0.7, rosRank: 6, rosPerWeek: 120,
  injuredStars: [], playoffPct: 0.6, ...p,
});

test("powerBlurb reflects the facts and varies its phrasing", () => {
  assert.match(powerBlurb(facts({ streak: "W4" })), /\b(4|four)\b/i);
  assert.match(powerBlurb(facts({ streak: "L3", wins: 4, losses: 6 })), /\b(3|three)\b/i);
  assert.match(powerBlurb(facts({ injuredStars: [{ name: "Star Player", status: "Out", position: "RB" }] })), /Star Player/);
  assert.match(powerBlurb(facts({ pfRank: 1, pointsFor: 1400.5 })), /1,?400/);
  assert.match(powerBlurb(facts({ prevRank: 8, rank: 3 })), /5/);
  const variants = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => powerBlurb(facts({ teamId: id, streak: "W5" }))));
  assert.ok(variants.size >= 2, "phrasing varies between teams");
  for (const v of variants) {
    assert.ok(v.length > 20 && v.length < 220, v);
    assert.match(v, /^[A-Z]/);
    assert.match(v, /[.!]$/);
  }
});
