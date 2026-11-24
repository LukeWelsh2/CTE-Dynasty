import { test } from "node:test";
import assert from "node:assert/strict";
import type { Team } from "@prisma/client";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import { lastFantasyWeek } from "@/lib/league-week";
import { standingsFromMatchups, type StandingRow } from "@/lib/standings";
import {
  advKey,
  applyLastPlaceRule,
  bracketKindOf,
  bracketPlan,
  bracketWinner,
  finalPlacement,
  placementOrder,
  placementPairings,
  placementShape,
  playoffSchedule,
  realGamesInRound,
  resolvePlayoffTie,
  roundLabel,
  roundPairings,
  seedPositions,
  sideBrackets,
  SLOT_BASE,
} from "@/lib/playoffs/structure";
import { leagueSeeds } from "@/lib/playoffs/seeding";
import { advancersFor, bracketGames, buildBracketSeeds, placementEntries, placementShapeFor, playoffGameContexts, playoffGameWinProb, seedingWindow, validManualSeeds, type StoredBracket } from "@/lib/playoffs/bracket";
import { gameResultFor, gameStateShort, gameStateText, legLabel, patchGameWeek } from "@/components/scoring/playoff-game";
import { clinchChanges } from "@/lib/sim/playoff-odds";
import { tiebreakNotes } from "@/lib/playoffs/tiebreak-notes";

const settingsWith = (patch: Record<string, unknown>): LeagueSettings => deepMerge(DEFAULT_SETTINGS, patch);

test("seedPositions builds the standard seeded bracket", () => {
  assert.deepEqual(seedPositions(2), [1, 2]);
  assert.deepEqual(seedPositions(4), [1, 4, 2, 3]);
  assert.deepEqual(seedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("bracketPlan: sizes, rounds and natural byes", () => {
  assert.deepEqual({ ...bracketPlan(6), positions: undefined }, { teams: 6, size: 8, rounds: 3, byes: 2, positions: undefined });
  assert.equal(bracketPlan(4).byes, 0);
  assert.equal(bracketPlan(4).rounds, 2);
  assert.equal(bracketPlan(8).rounds, 3);
  assert.equal(bracketPlan(12).byes, 4);
  assert.equal(bracketPlan(3).byes, 1);
  assert.equal(bracketPlan(1).rounds, 0);
});

test("6-team bracket: byes for seeds 1-2, fixed second round", () => {
  const plan = bracketPlan(6);
  const r1 = roundPairings(plan, 1, false, new Map())!;
  assert.deepEqual(r1, [
    { slot: 1, home: 1, away: null },
    { slot: 2, home: 4, away: 5 },
    { slot: 3, home: 2, away: null },
    { slot: 4, home: 3, away: 6 },
  ]);
  assert.equal(roundPairings(plan, 2, false, new Map()), null, "round 2 waits for round 1 results");
  const adv = new Map([
    [advKey(1, 2), 5],
    [advKey(1, 4), 3],
  ]);
  assert.deepEqual(roundPairings(plan, 2, false, adv), [
    { slot: 1, home: 1, away: 5 },
    { slot: 2, home: 2, away: 3 },
  ]);
  adv.set(advKey(2, 1), 1);
  adv.set(advKey(2, 2), 3);
  assert.deepEqual(roundPairings(plan, 3, false, adv), [{ slot: 1, home: 1, away: 3 }]);
  assert.equal(bracketWinner(plan, false, adv), null);
  adv.set(advKey(3, 1), 3);
  assert.equal(bracketWinner(plan, false, adv), 3);
});

test("reseeding pairs the best remaining seed with the worst", () => {
  const plan = bracketPlan(6);
  const adv = new Map([
    [advKey(1, 2), 4],
    [advKey(1, 4), 6],
  ]);
  assert.deepEqual(roundPairings(plan, 2, false, adv), [
    { slot: 1, home: 1, away: 4 },
    { slot: 2, home: 2, away: 6 },
  ]);
  assert.deepEqual(roundPairings(plan, 2, true, adv), [
    { slot: 1, home: 1, away: 6 },
    { slot: 2, home: 2, away: 4 },
  ]);
});

test("8-team bracket has no byes and four quarterfinals", () => {
  const r1 = roundPairings(bracketPlan(8), 1, false, new Map())!;
  assert.equal(r1.filter((p) => p.home !== null && p.away !== null).length, 4);
  assert.deepEqual(
    r1.map((p) => [p.home, p.away]),
    [
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ],
  );
});

test("round labels", () => {
  assert.equal(roundLabel("WINNERS", 1, 3), "Quarterfinal");
  assert.equal(roundLabel("WINNERS", 2, 3), "Semifinal");
  assert.equal(roundLabel("WINNERS", 3, 3), "Championship");
  assert.equal(roundLabel("WINNERS", 1, 4), "Round of 16");
  assert.equal(roundLabel("CONSOLATION", 2, 2), "Consolation Final");
  assert.equal(roundLabel("TOILET", 2, 2), "Toilet Bowl");
  assert.equal(roundLabel("TOILET", 1, 2), "Toilet Bowl Semifinal");
  assert.equal(roundLabel("THIRD", 1, 1), "3rd Place");
});

test("playoffSchedule follows startWeek / weeksPerRound / championshipWeeks and matches lastFantasyWeek", () => {
  const s = playoffSchedule(DEFAULT_SETTINGS);
  assert.deepEqual(s.roundWeeks, [[15], [16], [17]]);
  assert.equal(s.lastWeek, lastFantasyWeek(DEFAULT_SETTINGS));
  const two = settingsWith({ playoffs: { championshipWeeks: 2 } });
  assert.deepEqual(playoffSchedule(two).roundWeeks, [[15], [16], [17, 18]]);
  assert.equal(playoffSchedule(two).lastWeek, lastFantasyWeek(two));
  const slow = settingsWith({ playoffs: { teams: 4, startWeek: 14, weeksPerRound: 2 } });
  assert.deepEqual(playoffSchedule(slow).roundWeeks, [
    [14, 15],
    [16, 17],
  ]);
  assert.equal(playoffSchedule(slow).lastWeek, lastFantasyWeek(slow));
  // 2-week rounds + a 2-week championship: the final is weeksPerRound + championshipWeeks − 1 = 3 weeks (the length the
  // /playoffs summary, home's key dates and the bracket headings show)
  const threeWeekFinal = settingsWith({ playoffs: { teams: 4, startWeek: 9, weeksPerRound: 2, championshipWeeks: 2 } });
  assert.deepEqual(playoffSchedule(threeWeekFinal).roundWeeks, [
    [9, 10],
    [11, 12, 13],
  ]);
  assert.equal(playoffSchedule(threeWeekFinal).roundWeeks.at(-1)!.length, 3);
  assert.equal(playoffSchedule(threeWeekFinal).lastWeek, lastFantasyWeek(threeWeekFinal));
  // fewer teams in the league than playoff spots
  assert.equal(playoffSchedule(DEFAULT_SETTINGS, 4).plan.teams, 4);
});

test("sideBrackets splits non-playoff teams and aligns finals with the championship", () => {
  const pool = ["t7", "t8", "t9", "t10", "t11", "t12"];
  const both = sideBrackets(pool, 3, { consolation: true, toilet: true });
  assert.equal(both.length, 2);
  assert.deepEqual(both[0], { kind: "CONSOLATION", teamIds: ["t7", "t8", "t9"], plan: bracketPlan(3), offset: 1 });
  assert.deepEqual(both[1]!.teamIds, ["t12", "t11", "t10"], "toilet bowl seeds the worst team first");
  assert.equal(both[1]!.offset, 1);
  const toiletOnly = sideBrackets(pool, 3, { consolation: false, toilet: true });
  assert.equal(toiletOnly.length, 1);
  assert.equal(toiletOnly[0]!.teamIds.length, 6);
  assert.equal(toiletOnly[0]!.offset, 0);
  // capped so it can finish with a 2-round championship bracket
  const capped = sideBrackets(["a", "b", "c", "d", "e", "f", "g", "h"], 2, { consolation: true, toilet: false });
  assert.deepEqual(capped[0]!.teamIds, ["a", "b", "c", "d"]);
  assert.deepEqual(sideBrackets(["a"], 3, { consolation: true, toilet: true }), []);
});

test("finalPlacement orders champion, runner-up, 3rd place, eliminated rounds, consolation, toilet bowl", () => {
  const playoffTeams = ["s1", "s2", "s3", "s4", "s5", "s6"];
  const order = finalPlacement({
    playoffTeams,
    champion: "s3",
    eliminatedRound: new Map([
      ["s1", 3],
      ["s2", 2],
      ["s5", 2],
      ["s4", 1],
      ["s6", 1],
    ]),
    thirdPlace: { winner: "s5", loser: "s2" },
    consolation: { teamIds: ["c7", "c8", "c9"], winner: "c9", eliminatedRound: new Map([["c8", 1], ["c7", 2]]) },
    toilet: { teamIds: ["t12", "t11", "t10"], last: "t12", escapedRound: new Map([["t10", 1], ["t11", 2]]) },
    rankOf: new Map([["s1", 1], ["s2", 2], ["s3", 3], ["s4", 4], ["s5", 5], ["s6", 6], ["c7", 7], ["c8", 8], ["c9", 9], ["t10", 10], ["t11", 11], ["t12", 12]]),
    allTeams: [...playoffTeams, "c7", "c8", "c9", "t10", "t11", "t12"],
  });
  assert.deepEqual(order, ["s3", "s1", "s5", "s2", "s4", "s6", "c9", "c7", "c8", "t10", "t11", "t12"]);
});

test("finalPlacement without side brackets ranks non-playoff teams by record", () => {
  const order = finalPlacement({
    playoffTeams: ["a", "b", "c", "d"],
    champion: "b",
    eliminatedRound: new Map([["a", 2], ["c", 1], ["d", 1]]),
    rankOf: new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5], ["f", 6]]),
    allTeams: ["f", "e", "d", "c", "b", "a"],
  });
  assert.deepEqual(order, ["b", "a", "c", "d", "e", "f"]);
});

test("resolvePlayoffTie walks the tiebreaker chain", () => {
  const g = { key: "k", homeTeamId: "H", awayTeamId: "A", homeSeed: 1, awaySeed: 4, bench: [10, 22] as [number, number], highestStarter: [30, 25] as [number, number] };
  assert.equal(resolvePlayoffTie(["BENCH_POINTS", "HIGHER_SEED"], g, () => 0), "A");
  assert.equal(resolvePlayoffTie(["HIGHEST_STARTER"], g, () => 0), "H");
  assert.equal(resolvePlayoffTie(["HIGHER_SEED"], g, () => 0), "H");
  assert.equal(resolvePlayoffTie(["BENCH_POINTS"], { ...g, bench: [5, 5] }, () => 0), "H", "falls back to the better seed");
  assert.equal(resolvePlayoffTie(["COIN_FLIP"], g, () => 1), "A");
});

test("applyLastPlaceRule moves the designated team to last", () => {
  const order = ["a", "b", "c", "d", "e"];
  const info = { rankOf: new Map([["a", 1], ["b", 2], ["c", 3], ["d", 5], ["e", 4]]), pointsFor: new Map([["c", 900], ["d", 1100], ["e", 1000]]), playoffTeams: ["a", "b"] };
  assert.deepEqual(applyLastPlaceRule(order, "TOILET_BOWL_LOSER", info), order);
  assert.deepEqual(applyLastPlaceRule(order, "REGULAR_SEASON_RECORD", info), ["a", "b", "c", "e", "d"]);
  assert.deepEqual(applyLastPlaceRule(order, "POINTS_FOR", info), ["a", "b", "d", "e", "c"]);
});

// ───────── seeding & bracket rows ─────────

function row(id: string, rank: number, opts: Partial<StandingRow> & { division?: string | null } = {}): StandingRow {
  const team = { id, name: id.toUpperCase(), division: opts.division ?? null } as Team;
  return {
    team, rank, wins: 10 - rank, losses: rank, ties: 0, pct: (10 - rank) / 10, pointsFor: 1000 - rank * 10, pointsAgainst: 900,
    divWins: 0, divLosses: 0, divTies: 0, allPlayWins: 0, allPlayLosses: 0, allPlayTies: 0, streak: "", last5: [], gamesBack: 0,
    divisionRank: opts.divisionRank ?? rank, maxPointsFor: 0, powerScore: 0, powerRank: rank, medianWins: 0, medianLosses: 0, ...opts,
  };
}

test("leagueSeeds: divisionWinnersQualify guarantees a spot, seeded by record", () => {
  const standings = [
    row("a", 1, { division: "east", divisionRank: 1 }),
    row("b", 2, { division: "east", divisionRank: 2 }),
    row("c", 3, { division: "east", divisionRank: 3 }),
    row("d", 4, { division: "east", divisionRank: 4 }),
    row("e", 5, { division: "west", divisionRank: 1 }),
    row("f", 6, { division: "west", divisionRank: 2 }),
  ];
  const plain = settingsWith({ playoffs: { teams: 4 } });
  assert.deepEqual(leagueSeeds(standings, plain).map((r) => r.team.id), ["a", "b", "c", "d"]);
  const qualify = settingsWith({ playoffs: { teams: 4, divisionWinnersQualify: true } });
  assert.deepEqual(leagueSeeds(standings, qualify).map((r) => r.team.id), ["a", "b", "c", "e"]);
  const top = settingsWith({ playoffs: { teams: 4 }, standings: { divisionWinnersTopSeeds: true } });
  assert.deepEqual(leagueSeeds(standings, top).map((r) => r.team.id), ["a", "e", "b", "c"]);
});

test("buildBracketSeeds stores playoff seeds and both side brackets", () => {
  const standings = Array.from({ length: 12 }, (_, i) => row(`t${i + 1}`, i + 1));
  const b = buildBracketSeeds(standings, DEFAULT_SETTINGS, 2026);
  assert.deepEqual(b.winners.map((e) => e.teamId), ["t1", "t2", "t3", "t4", "t5", "t6"]);
  assert.equal(b.thirdPlace, true);
  assert.deepEqual(b.sides.map((s) => s.kind), ["CONSOLATION", "TOILET"]);
  assert.deepEqual(b.sides[0]!.entries.map((e) => [e.teamId, e.seed, e.displaySeed]), [["t7", 1, 7], ["t8", 2, 8], ["t9", 3, 9]]);
  assert.deepEqual(b.sides[1]!.entries.map((e) => [e.teamId, e.seed, e.displaySeed]), [["t12", 1, 12], ["t11", 2, 11], ["t10", 3, 10]]);
  const none = buildBracketSeeds(standings, settingsWith({ playoffs: { consolationBracket: false, toiletBowl: false, thirdPlaceGame: false } }), 2026);
  assert.deepEqual(none.sides, []);
  assert.equal(none.thirdPlace, false);
});

function m(p: Partial<import("@prisma/client").Matchup>): import("@prisma/client").Matchup {
  return {
    id: Math.random().toString(36).slice(2), leagueId: "L", season: 2026, week: 15, homeTeamId: null, awayTeamId: null, homeScore: 0, awayScore: 0,
    homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, status: "UPCOMING", winnerTeamId: null, isPlayoff: true, isConsolation: false,
    isChampionship: false, bracketRound: 1, bracketSlot: 1, homeSeed: null, awaySeed: null, label: null, updatedAt: new Date(), ...p,
  };
}

test("bracketGames sums multi-week legs and advancersFor maps winners/losers to seeds", () => {
  const stored: StoredBracket = {
    version: 1, season: 2026, createdAt: "", reseed: false, thirdPlace: false,
    winners: [{ teamId: "A", seed: 1, displaySeed: 1 }, { teamId: "B", seed: 2, displaySeed: 2 }],
    sides: [],
  };
  const rows = [
    m({ week: 16, homeTeamId: "A", awayTeamId: "B", homeScore: 100, awayScore: 130, status: "FINAL", isChampionship: true, homeSeed: 1, awaySeed: 2, label: "Championship (Wk 1 of 2)" }),
    m({ week: 17, homeTeamId: "A", awayTeamId: "B", homeScore: 140, awayScore: 105, status: "FINAL", isChampionship: true, homeSeed: 1, awaySeed: 2, label: "Championship (Wk 2 of 2)" }),
  ];
  const games = bracketGames(rows, stored, 1);
  assert.equal(games.length, 1);
  const g = games[0]!;
  assert.equal(g.homeScore, 240);
  assert.equal(g.awayScore, 235);
  assert.equal(g.winnerTeamId, "A");
  assert.equal(g.label, "Championship");
  assert.deepEqual(g.weeks, [16, 17]);
  assert.deepEqual([...advancersFor(games, stored.winners, false)], [["1:1", 1]]);
  assert.deepEqual([...advancersFor(games, stored.winners, true)], [["1:1", 2]]);
  // in progress
  const live = bracketGames([rows[0]!, { ...rows[1]!, status: "LIVE", homeProjected: 120, awayProjected: 90 }], stored, 1)[0]!;
  assert.equal(live.status, "LIVE");
  assert.equal(live.winnerTeamId, null);
  // ties: resolved map wins over the seed fallback
  const tied = [m({ homeTeamId: "A", awayTeamId: "B", homeScore: 99, awayScore: 99, status: "FINAL", homeSeed: 1, awaySeed: 2 })];
  assert.equal(bracketGames(tied, stored, 1)[0]!.winnerTeamId, "A");
  assert.equal(bracketGames(tied, stored, 1, new Map([["WINNERS|1|1", "B"]]))[0]!.winnerTeamId, "B");
});

test("bracketGames: a tied multi-week game the scoreboard settled keeps its stored winner on every week", () => {
  const stored: StoredBracket = {
    version: 1, season: 2026, createdAt: "", reseed: false, thirdPlace: false,
    winners: [{ teamId: "A", seed: 1, displaySeed: 1 }, { teamId: "B", seed: 2, displaySeed: 2 }],
    sides: [],
  };
  // 220–220 over two weeks; the playoff tiebreakers (bench points, say) gave the game to the lower seed B
  const legs = [
    m({ id: "w1", week: 15, homeTeamId: "A", awayTeamId: "B", homeScore: 120, awayScore: 100, status: "FINAL", homeSeed: 1, awaySeed: 2, winnerTeamId: "B" }),
    m({ id: "w2", week: 16, homeTeamId: "A", awayTeamId: "B", homeScore: 100, awayScore: 120, status: "FINAL", homeSeed: 1, awaySeed: 2, winnerTeamId: "B" }),
  ];
  assert.equal(bracketGames(legs, stored, 1)[0]!.winnerTeamId, "B", "the stored result of both weeks agrees with resolveTies");
  // weeks that disagree (an older leg-by-leg result) fall back to the higher seed, as before
  assert.equal(bracketGames([legs[0]!, { ...legs[1]!, winnerTeamId: "A" }], stored, 1)[0]!.winnerTeamId, "A");
  assert.equal(bracketGames([{ ...legs[0]!, winnerTeamId: null }, legs[1]!], stored, 1)[0]!.winnerTeamId, "A");
  // a single-week tie keeps its stored winner too
  assert.equal(bracketGames([{ ...legs[0]!, homeScore: 90, awayScore: 90 }], stored, 1)[0]!.winnerTeamId, "B");
});

test("playoffGameContexts: week-of-game context and combined score for multi-week games only", () => {
  const rows = [
    // two-week semifinal: A loses week 1, wins on aggregate
    m({ id: "s1", week: 15, homeTeamId: "A", awayTeamId: "D", homeScore: 100, awayScore: 140, status: "FINAL", homeSeed: 1, awaySeed: 4, winnerTeamId: "A", bracketRound: 1, bracketSlot: 1 }),
    m({ id: "s2", week: 16, homeTeamId: "A", awayTeamId: "D", homeScore: 145, awayScore: 90, status: "FINAL", homeSeed: 1, awaySeed: 4, winnerTeamId: "A", bracketRound: 1, bracketSlot: 1 }),
    // other semifinal, week 2 live
    m({ id: "t1", week: 15, homeTeamId: "B", awayTeamId: "C", homeScore: 120, awayScore: 120, status: "FINAL", bracketRound: 1, bracketSlot: 2 }),
    m({ id: "t2", week: 16, homeTeamId: "B", awayTeamId: "C", homeScore: 40, awayScore: 55.5, status: "LIVE", bracketRound: 1, bracketSlot: 2 }),
    // a single-week toilet bowl game and a regular season row get no context
    m({ id: "x1", week: 15, homeTeamId: "E", awayTeamId: "F", homeScore: 80, awayScore: 70, status: "FINAL", isConsolation: true, bracketRound: 1, bracketSlot: SLOT_BASE.TOILET + 1 }),
    m({ id: "r1", week: 10, homeTeamId: "A", awayTeamId: "B", isPlayoff: false, bracketRound: null, bracketSlot: null, status: "FINAL" }),
  ];
  const ctx = playoffGameContexts(rows);
  assert.deepEqual([...ctx.keys()].sort(), ["s1", "s2", "t1", "t2"]);
  const w1 = ctx.get("s1")!;
  assert.deepEqual([w1.leg, w1.legs, w1.weeks], [1, 2, [15, 16]]);
  assert.deepEqual([w1.homeBefore, w1.awayBefore, w1.homeThrough, w1.awayThrough, w1.homeTotal, w1.awayTotal], [0, 0, 100, 140, 245, 230]);
  assert.equal(w1.status, "FINAL");
  assert.equal(w1.winnerTeamId, "A", "week 1's row names the game's winner, not the week's");
  assert.equal(gameResultFor(w1, "A"), "W");
  assert.equal(gameResultFor(w1, "D"), "L");
  const w2 = ctx.get("s2")!;
  assert.deepEqual([w2.leg, w2.homeBefore, w2.awayBefore, w2.homeThrough, w2.awayThrough], [2, 100, 140, 245, 230]);
  assert.equal(legLabel(w2), "Week 2 of 2");
  assert.equal(gameStateText(w1, { homeId: "A", homeName: "Aces", awayName: "Dukes" }), "Aces wins 245.00–230.00 over 2 weeks");
  assert.equal(gameStateShort(w1, { homeId: "A", home: "ACE", away: "DUK" }), "ACE wins 245.0–230.0 (2 wks)");
  assert.equal(gameStateShort({ ...w1, homeTotal: 240, awayTotal: 240 }, { homeId: "A", home: "ACE", away: "DUK" }), "ACE wins 240.0–240.0 (2 wks, tiebreaker)", "a level game says how it was won");

  const live = ctx.get("t2")!;
  assert.equal(live.status, "LIVE");
  assert.equal(live.winnerTeamId, null);
  assert.equal(gameResultFor(live, "C"), null, "no result before every week is final");
  assert.equal(gameStateText(live, { homeId: "B", homeName: "Bees", awayName: "Cats" }), "Cats leads 175.50–160.00 · Week 2 of 2 live");
  assert.equal(gameStateText(ctx.get("t1")!, { homeId: "B", homeName: "Bees", awayName: "Cats" }), "Cats leads 175.50–160.00 · Week 2 of 2 live", "every week's row shows where the game stands");
  // a live update of week 2 re-sums the game (still undecided until the server settles it)
  const patched = patchGameWeek(live, "t2", 90, 60, "FINAL");
  assert.deepEqual([patched.homeThrough, patched.awayThrough, patched.homeTotal, patched.status], [210, 180, 210, "LIVE"]);
  assert.equal(gameStateText({ ...patched, parts: patched.parts.map((p) => ({ ...p, status: "FINAL" })) }, { homeId: "B", homeName: "Bees", awayName: "Cats" }), "Bees leads 210.00–180.00 after Week 2 of 2");

  // only week 1 played: the game is level, nobody has won
  const half = playoffGameContexts([rows[2]!, { ...rows[3]!, status: "UPCOMING", homeScore: 0, awayScore: 0 }]).get("t1")!;
  assert.equal(half.status, "LIVE");
  assert.equal(gameStateText(half, { homeId: "B", homeName: "Bees", awayName: "Cats" }), "Tied 120.00–120.00 after Week 1 of 2");
  const notStarted = playoffGameContexts(rows.slice(2, 4).map((r) => ({ ...r, status: "UPCOMING", homeScore: 0, awayScore: 0 }))).get("t2")!;
  assert.equal(gameStateText(notStarted, { homeId: "B", homeName: "Bees", awayName: "Cats" }), "2-week game: Weeks 15–16 combined");
  assert.equal(gameStateShort(notStarted, { homeId: "B", home: "BEE", away: "CAT" }), "Wk 2 of 2 · combined score");
});

test("playoffGameContexts orients every week to the row and handles a two-week final next to a one-week 3rd place game", () => {
  const rows = [
    m({ id: "f1", week: 17, homeTeamId: "A", awayTeamId: "B", homeScore: 130, awayScore: 110, status: "FINAL", isChampionship: true, bracketRound: 2, bracketSlot: 1 }),
    // the stored rows normally keep home / away; a swapped week is turned around
    m({ id: "f2", week: 18, homeTeamId: "B", awayTeamId: "A", homeScore: 150, awayScore: 100, status: "FINAL", isChampionship: true, bracketRound: 2, bracketSlot: 1 }),
    m({ id: "3rd", week: 17, homeTeamId: "C", awayTeamId: "D", homeScore: 90, awayScore: 95, status: "FINAL", isConsolation: true, bracketRound: 2, bracketSlot: SLOT_BASE.THIRD + 1, winnerTeamId: "D" }),
  ];
  const ctx = playoffGameContexts(rows);
  assert.equal(ctx.has("3rd"), false, "single-week games need no context");
  const f2 = ctx.get("f2")!;
  assert.deepEqual(f2.parts.map((p) => [p.home, p.away]), [[110, 130], [150, 100]]);
  assert.deepEqual([f2.homeTotal, f2.awayTotal, f2.homeBefore, f2.awayBefore], [260, 230, 110, 130]);
  assert.equal(f2.winnerTeamId, "B");
  assert.equal(ctx.get("f1")!.winnerTeamId, "B");
  assert.deepEqual([ctx.get("f1")!.homeTotal, ctx.get("f1")!.awayTotal], [230, 260]);
});

test("playoffGameWinProb: settled weeks plus the live outlook of the rest", () => {
  const [g] = [...playoffGameContexts([
    m({ id: "a", week: 15, homeTeamId: "A", awayTeamId: "B", homeScore: 140, awayScore: 100, status: "FINAL" }),
    m({ id: "b", week: 16, homeTeamId: "A", awayTeamId: "B", status: "UPCOMING" }),
  ]).values()];
  // up 40 with a week to go and even projections: a strong favourite, not a lock
  const p = playoffGameWinProb(g!, "A", [{ homeProjected: 110, awayProjected: 110, variance: 2 * 400 }]);
  assert.ok(p > 0.85 && p < 0.99, String(p));
  // projected to lose week 2 by more than the lead
  assert.ok(playoffGameWinProb(g!, "A", [{ homeProjected: 90, awayProjected: 150, variance: 800 }]) < 0.5);
  // nothing left to play: the combined score decides; a decided game is certain
  assert.equal(playoffGameWinProb({ ...g!, parts: g!.parts.map((x) => ({ ...x, status: "FINAL" })) }, "A", []), 1);
  assert.equal(playoffGameWinProb({ ...g!, status: "FINAL", winnerTeamId: "B" }, "A", []), 0);
});

test("bracketKindOf decodes bracketSlot ranges", () => {
  assert.equal(bracketKindOf({ isPlayoff: false, isConsolation: false, bracketSlot: null }), null);
  assert.equal(bracketKindOf({ isPlayoff: true, isConsolation: false, bracketSlot: 2 }), "WINNERS");
  assert.equal(bracketKindOf({ isPlayoff: true, isConsolation: true, bracketSlot: SLOT_BASE.THIRD + 1 }), "THIRD");
  assert.equal(bracketKindOf({ isPlayoff: true, isConsolation: true, bracketSlot: SLOT_BASE.CONSOLATION + 2 }), "CONSOLATION");
  assert.equal(bracketKindOf({ isPlayoff: true, isConsolation: true, bracketSlot: SLOT_BASE.TOILET + 1 }), "TOILET");
  assert.equal(bracketKindOf({ isPlayoff: true, isConsolation: true, bracketSlot: SLOT_BASE.PLACEMENT + 2 }), "PLACEMENT");
});

// ───────── placement games ─────────

test("placementShape: 5th place game for 6 teams, placement semis + 5th/7th for 8, none for small brackets", () => {
  assert.equal(realGamesInRound(bracketPlan(6), 1), 2);
  assert.equal(realGamesInRound(bracketPlan(8), 1), 4);
  assert.equal(realGamesInRound(bracketPlan(12), 2), 4);
  assert.deepEqual(placementShape(bracketPlan(6), ["FIFTH"]), { size: 2, rounds: 1, offset: 2, fifth: true, seventh: false });
  assert.equal(placementShape(bracketPlan(6), ["SEVENTH"]), null, "7th place needs 8+ playoff teams");
  assert.deepEqual(placementShape(bracketPlan(8), ["FIFTH", "SEVENTH"]), { size: 4, rounds: 2, offset: 1, fifth: true, seventh: true });
  assert.deepEqual(placementShape(bracketPlan(7), ["FIFTH"]), { size: 3, rounds: 2, offset: 1, fifth: true, seventh: false });
  assert.deepEqual(placementShape(bracketPlan(12), ["FIFTH"]), { size: 4, rounds: 2, offset: 2, fifth: true, seventh: false });
  assert.equal(placementShape(bracketPlan(4), ["FIFTH"]), null, "no round before the semifinals");
  assert.equal(placementShape(bracketPlan(5), ["FIFTH"]), null, "a single quarterfinal loser");
  assert.equal(placementShape(bracketPlan(8), []), null);
  // played alongside the championship: the shape's last round is the final round
  const sched = playoffSchedule(settingsWith({ playoffs: { teams: 8 } }), 12);
  const shape = placementShape(sched.plan, ["FIFTH", "SEVENTH"])!;
  assert.equal(shape.offset + shape.rounds, sched.plan.rounds);
});

test("placementPairings / placementOrder for a 4-team pool", () => {
  const shape = placementShape(bracketPlan(8), ["FIFTH", "SEVENTH"])!;
  assert.deepEqual(placementPairings(shape, 1, new Map()), [
    { slot: 1, home: 1, away: 4 },
    { slot: 2, home: 2, away: 3 },
  ]);
  assert.equal(placementPairings(shape, 2, new Map()), null);
  const adv = new Map([
    [advKey(1, 1), 4],
    [advKey(1, 2), 2],
  ]);
  assert.deepEqual(placementPairings(shape, 2, adv), [
    { slot: 1, home: 2, away: 4 },
    { slot: 2, home: 1, away: 3 },
  ]);
  assert.equal(placementOrder(shape, adv), null);
  adv.set(advKey(2, 1), 4).set(advKey(2, 2), 3);
  assert.deepEqual(placementOrder(shape, adv), [4, 2, 3, 1]);
  // only the 5th place game: semifinal losers share 7th/8th by seed
  const fifthOnly = placementShape(bracketPlan(8), ["FIFTH"])!;
  const adv2 = new Map([
    [advKey(1, 1), 1],
    [advKey(1, 2), 3],
    [advKey(2, 1), 3],
  ]);
  assert.deepEqual(placementPairings(fifthOnly, 2, adv2), [{ slot: 1, home: 1, away: 3 }]);
  assert.deepEqual(placementOrder(fifthOnly, adv2), [3, 1, 2, 4]);
  // 2-team pool
  const two = placementShape(bracketPlan(6), ["FIFTH"])!;
  assert.deepEqual(placementOrder(two, new Map([[advKey(1, 1), 2]])), [2, 1]);
  // 3-team pool: 2 v 3, then 1 v winner
  const three = placementShape(bracketPlan(7), ["FIFTH"])!;
  assert.deepEqual(placementPairings(three, 1, new Map()), [{ slot: 1, home: 2, away: 3 }]);
  const adv3 = new Map([[advKey(1, 1), 3]]);
  assert.deepEqual(placementPairings(three, 2, adv3), [{ slot: 1, home: 1, away: 3 }]);
  adv3.set(advKey(2, 1), 1);
  assert.deepEqual(placementOrder(three, adv3), [1, 3, 2]);
});

test("finalPlacement uses placement-game results for 5th and below", () => {
  const playoffTeams = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
  const base = {
    playoffTeams,
    champion: "s1",
    eliminatedRound: new Map([["s2", 3], ["s3", 2], ["s4", 2], ["s5", 1], ["s6", 1], ["s7", 1], ["s8", 1]]),
    thirdPlace: { winner: "s4", loser: "s3" },
    rankOf: new Map(playoffTeams.map((id, i) => [id, i + 1])),
    allTeams: playoffTeams,
  };
  assert.deepEqual(finalPlacement(base), ["s1", "s2", "s4", "s3", "s5", "s6", "s7", "s8"]);
  assert.deepEqual(finalPlacement({ ...base, placement: ["s8", "s6", "s7", "s5"] }), ["s1", "s2", "s4", "s3", "s8", "s6", "s7", "s5"]);
});

test("placementEntries: pool = quarterfinal losers by seed, once every quarterfinal is final", () => {
  const standings = Array.from({ length: 12 }, (_, i) => row(`t${i + 1}`, i + 1));
  const stored = buildBracketSeeds(standings, settingsWith({ playoffs: { placementGames: ["FIFTH"] } }), 2026);
  assert.deepEqual(stored.placementGames, ["FIFTH"]);
  const shape = placementShapeFor(stored)!;
  const qf = (h: string, a: string, hs: number, as: number, status = "FINAL") =>
    m({ homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, status, bracketRound: 1, bracketSlot: h === "t4" ? 2 : 4 });
  const half = bracketGames([qf("t4", "t5", 100, 120), qf("t3", "t6", 0, 0, "UPCOMING")], stored, 3);
  assert.equal(placementEntries(stored, shape, half.filter((g) => g.kind === "WINNERS")), null);
  const done = bracketGames([qf("t4", "t5", 100, 120), qf("t3", "t6", 130, 90)], stored, 3);
  assert.deepEqual(placementEntries(stored, shape, done.filter((g) => g.kind === "WINNERS")), [
    { teamId: "t4", seed: 1, displaySeed: 4 },
    { teamId: "t6", seed: 2, displaySeed: 6 },
  ]);
  // a 6-team bracket can't play a 7th place game: not stored
  assert.deepEqual(buildBracketSeeds(standings, settingsWith({ playoffs: { placementGames: ["SEVENTH"] } }), 2026).placementGames, []);
});

// ───────── commissioner seeding ─────────

test("manual seeds replace the standings seeds only when allowed and valid", () => {
  const standings = Array.from({ length: 8 }, (_, i) => row(`t${i + 1}`, i + 1));
  const ids = standings.map((r) => r.team.id);
  const manual = ["t2", "t1", "t3", "t4", "t8", "t6"];
  assert.equal(validManualSeeds(manual, ids, 6), true);
  assert.equal(validManualSeeds(["t1", "t1", "t3", "t4", "t5", "t6"], ids, 6), false, "duplicates");
  assert.equal(validManualSeeds(["t1", "t2", "t3"], ids, 6), false, "wrong length");
  assert.equal(validManualSeeds(["t1", "t2", "t3", "t4", "t5", "zz"], ids, 6), false, "unknown team");
  const allowed = buildBracketSeeds(standings, settingsWith({ playoffs: { manualSeedingAllowed: true, toiletBowl: false } }), 2026, manual);
  assert.equal(allowed.manual, true);
  assert.deepEqual(allowed.winners.map((e) => e.teamId), manual);
  assert.deepEqual(allowed.sides.flatMap((s) => s.entries.map((e) => [e.teamId, e.displaySeed])), [["t5", 5], ["t7", 7]], "t5 drops to the consolation bracket");
  const off = buildBracketSeeds(standings, settingsWith({ playoffs: { manualSeedingAllowed: false } }), 2026, manual);
  assert.equal(off.manual, false);
  assert.deepEqual(off.winners.map((e) => e.teamId), ["t1", "t2", "t3", "t4", "t5", "t6"]);
});

test("seedingWindow opens after the regular season and closes at the first playoff kickoff", () => {
  const on = settingsWith({ playoffs: { manualSeedingAllowed: true } });
  const fin = [{ status: "FINAL" }, { status: "FINAL" }];
  assert.equal(seedingWindow(settingsWith({ playoffs: { manualSeedingAllowed: false } }), "REGULAR", fin, []).open, false);
  assert.equal(seedingWindow(on, "REGULAR", [{ status: "FINAL" }, { status: "LIVE" }], []).open, false);
  assert.equal(seedingWindow(on, "REGULAR", fin, []).open, true);
  assert.equal(seedingWindow(on, "PLAYOFFS", fin, [{ status: "UPCOMING", homeScore: 0, awayScore: 0 }]).open, true);
  assert.equal(seedingWindow(on, "PLAYOFFS", fin, [{ status: "LIVE", homeScore: 3, awayScore: 0 }]).open, false);
  assert.equal(seedingWindow(on, "OFFSEASON", fin, []).open, false);
});

test("clinchChanges reports new clinches and eliminations only", () => {
  const st = (playoffs: "clinched" | "eliminated" | null, bye: "clinched" | "eliminated" | null = null, division: "clinched" | "eliminated" | null = null) => ({ playoffs, bye, division });
  const prev = [
    { teamId: "a", clinch: st(null) },
    { teamId: "b", clinch: st("clinched") },
    { teamId: "c", clinch: st(null) },
    { teamId: "d", clinch: st(null) },
  ];
  const next = [
    { teamId: "a", clinch: st("clinched") },
    { teamId: "b", clinch: st("clinched", "clinched", "clinched") },
    { teamId: "c", clinch: st("eliminated", "eliminated", "eliminated") },
    { teamId: "d", clinch: st(null) },
    { teamId: "e", clinch: st("clinched") },
  ];
  assert.deepEqual(clinchChanges(prev, next), [
    { teamId: "a", what: "playoffs" },
    { teamId: "b", what: "bye" },
    { teamId: "b", what: "division" },
    { teamId: "c", what: "eliminated" },
  ]);
  assert.deepEqual(clinchChanges(next, next), []);
});

test("tiebreakNotes explains why a team sits above the team it is tied with", () => {
  const a = row("a", 1, { pct: 0.6, pointsFor: 1500 });
  const b = row("b", 2, { pct: 0.6, pointsFor: 1400 });
  const c = row("c", 3, { pct: 0.6, pointsFor: 1450 });
  const d = row("d", 4, { pct: 0.4 });
  const h2h = { "a|b": { w: 1, l: 0 }, "b|a": { w: 0, l: 1 }, "b|c": { w: 0, l: 0 } };
  const notes = tiebreakNotes([a, b, c, d], h2h, ["H2H", "POINTS_FOR", "COIN_FLIP"]);
  assert.equal(notes.get("a"), "Ahead of B: won the head-to-head (1-0)");
  assert.equal(notes.get("b"), "Ahead of C through the other tied teams (C has more points for)");
  assert.equal(notes.has("c"), false, "c is not tied with d");
  assert.equal(tiebreakNotes([a, b], {}, ["POINTS_FOR"]).get("a"), "Ahead of B: more points for (1500.00 to 1400.00)");
  assert.equal(tiebreakNotes([b, a], {}, []).get("b"), "Tied with A; standings order kept");
});

test("a 3-way tie for the last playoff spot is settled by the whole group's tiebreak, whatever the team order", () => {
  // A is 3-0. B, C, D are 1-2 with cyclic head-to-head (B>C, C>D, D>B; each pair met once) → head-to-head can't
  // separate them, so points for decides the last of 2 spots: D (350) over B (305) and C (295)
  const reg = (week: number, h: string, a: string, hs: number, as: number) =>
    m({ week, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as, status: "FINAL", isPlayoff: false, bracketRound: null, bracketSlot: null, winnerTeamId: hs > as ? h : a });
  const games = [reg(1, "A", "B", 120, 100), reg(1, "C", "D", 110, 105), reg(2, "A", "C", 120, 90), reg(2, "D", "B", 130, 100), reg(3, "A", "D", 120, 115), reg(3, "B", "C", 105, 95)];
  const teams = ["A", "B", "C", "D"].map((id) => ({ id, name: id, division: null }) as Team);
  const settings = settingsWith({ playoffs: { teams: 2, consolationBracket: false, toiletBowl: false, thirdPlaceGame: false } });
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]) {
    const st = standingsFromMatchups(order.map((i) => teams[i]!), games, settings);
    assert.deepEqual(st.map((r) => r.team.id), ["A", "D", "B", "C"], `teams listed ${order.join("")}`);
    assert.deepEqual(leagueSeeds(st, settings).map((r) => r.team.id), ["A", "D"]);
    assert.deepEqual(buildBracketSeeds(st, settings, 2026).winners.map((e) => e.teamId), ["A", "D"]);
    const d = st[1]!.tiebreak!;
    assert.equal(d.by, "POINTS_FOR");
    assert.deepEqual(d.group, ["D", "B", "C"]);
    assert.deepEqual(d.h2hSkipped, { reason: "EVEN", record: [1, 1, 0] });
    // the hover notes explain the group decision, not a pairwise head-to-head (D did lose to C, B beat C, …)
    const notes = tiebreakNotes(st, {}, settings.standings.tiebreakers);
    assert.equal(notes.has("A"), false, "A is not tied with anyone");
    assert.equal(notes.get("D"), "Ahead of B: more points for (350.00 to 305.00) among the 3 tied teams; head-to-head among them was even");
    assert.equal(notes.get("B"), "Ahead of C: more points for (305.00 to 295.00) among the 3 tied teams; head-to-head among them was even");
    const div = [...st].sort((x, y) => x.divisionRank - y.divisionRank);
    assert.deepEqual(div.map((r) => r.team.id), ["A", "D", "B", "C"]);
    assert.equal(tiebreakNotes(div, {}, settings.standings.divisionTiebreakers, { division: true }).get("D"), notes.get("D"));
  }
});
