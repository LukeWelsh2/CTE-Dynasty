import { test } from "node:test";
import assert from "node:assert/strict";
import type { Matchup, Team } from "@prisma/client";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import { playoffSeeds, standingsFromMatchups } from "@/lib/standings";
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
      });
      assert.deepEqual(sim.order, standings.map((r) => r.team.id), `order, config ${ci} seed ${seed}`);
      const expected = (settings.playoffs.divisionWinnersQualify ? leagueSeeds(standings, settings) : playoffSeeds(standings, settings)).map((r) => r.team.id);
      assert.deepEqual(sim.seeds, expected, `seeds, config ${ci} seed ${seed}`);
    }
  }
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
