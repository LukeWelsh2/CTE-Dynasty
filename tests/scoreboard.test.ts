// Playoff Matchup rows carry the bracket's result (@/lib/scoreboard refreshWeekMatchups → playoffRowWinners):
// the same winner bracketGames / resolveTies advance, on every week of a multi-week game.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Matchup } from "@prisma/client";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import { bracketGames, gameKey, resolveTies, type StoredBracket } from "@/lib/playoffs/bracket";
import { resolvePlayoffTie, SLOT_BASE } from "@/lib/playoffs/structure";
import { hashString } from "@/lib/sim/rng";
import { decideWinner, playoffRowWinners, unbracketedPlayoffWinner } from "@/lib/scoreboard-rules";
import { resultFor } from "@/lib/stats/manager-stats";

const LEAGUE = "L1";
const SEASON = 2026;

const row = (p: Partial<Matchup> & Pick<Matchup, "id" | "week">): Matchup => ({
  leagueId: LEAGUE,
  season: SEASON,
  homeTeamId: "A",
  awayTeamId: "B",
  homeScore: 0,
  awayScore: 0,
  homeProjected: 0,
  awayProjected: 0,
  homeWinProb: 0.5,
  status: "FINAL",
  winnerTeamId: null,
  isPlayoff: true,
  isConsolation: false,
  isChampionship: false,
  bracketRound: 1,
  bracketSlot: 1,
  homeSeed: 1,
  awaySeed: 4,
  label: null,
  updatedAt: new Date(0),
  ...p,
});

const stored: StoredBracket = {
  version: 1,
  season: SEASON,
  createdAt: "",
  reseed: false,
  thirdPlace: false,
  winners: ["A", "C", "D", "B"].map((teamId, i) => ({ teamId, seed: i + 1, displaySeed: i + 1 })),
  sides: [{ kind: "TOILET", offset: 0, entries: ["H", "G", "F", "E"].map((teamId, i) => ({ teamId, seed: i + 1, displaySeed: 8 - i })) }],
};

const settingsWith = (chain: LeagueSettings["standings"]["playoffMatchupTiebreakers"], extra: Parameters<typeof deepMerge>[1] = {}): LeagueSettings =>
  deepMerge(deepMerge(DEFAULT_SETTINGS, { standings: { playoffMatchupTiebreakers: chain } }), extra);

/** What refreshWeekMatchups stores for `week`: bracketGames → resolveTies (games of the week) → bracketGames → playoffRowWinners. */
async function rowResults(rows: Matchup[], settings: LeagueSettings, week = 15) {
  const ties = await resolveTies(bracketGames(rows, stored, 2).filter((g) => g.weeks.includes(week)), LEAGUE, SEASON, settings);
  const games = bracketGames(rows, stored, 2, ties);
  return { games, results: playoffRowWinners(games, { week }) };
}

/** Rows as written back (winnerTeamId / homeWinProb from the results). */
function applied(rows: Matchup[], results: Map<string, { winnerTeamId: string | null; homeWinProb: number }>): Matchup[] {
  return rows.map((r) => {
    const x = results.get(r.id);
    return x ? { ...r, winnerTeamId: x.winnerTeamId, homeWinProb: x.homeWinProb } : r;
  });
}

test("a tied playoff week goes to the bracket's tiebreak (higher seed), not the regular season chain", async () => {
  // toilet bowl: the home side is the worst team (regular-season rank 8), the away side ranked 5th
  const rows = [row({ id: "t1", week: 15, isConsolation: true, bracketSlot: SLOT_BASE.TOILET + 1, homeTeamId: "H", awayTeamId: "E", homeSeed: 8, awaySeed: 5, homeScore: 101.4, awayScore: 101.4 })];
  const settings = settingsWith(["HIGHER_SEED"]);
  const { games, results } = await rowResults(rows, settings);
  assert.equal(games[0]!.winnerTeamId, "E", "the bracket advances the better seed");
  assert.deepEqual(results.get("t1"), { winnerTeamId: "E", homeWinProb: 0 });
  // the old scoreboard path (matchup tiebreak chain, home team last) named the other team
  const side = (teamId: string) => ({ teamId, points: 101.4, benchPoints: 0, topStarter: 0 });
  assert.equal(decideWinner(side("H"), side("E"), settings, { mustHaveWinner: true }), "H");
  // views that read bracketGames without the tie map (playoffs page, odds sim) agree once the row carries the winner
  assert.equal(bracketGames(applied(rows, results), stored, 2)[0]!.winnerTeamId, "E");
});

test("a coin-flip playoff tie stores the bracket's own coin result", async () => {
  const settings = settingsWith(["COIN_FLIP"]);
  for (let slot = 1; slot <= 2; slot++) {
    const rows = [row({ id: `c${slot}`, week: 15, bracketSlot: slot, homeScore: 88, awayScore: 88 })];
    const { results } = await rowResults(rows, settings);
    const expected = resolvePlayoffTie(["COIN_FLIP"], { key: `${LEAGUE}:${SEASON}:${gameKey("WINNERS", 1, slot)}`, homeTeamId: "A", awayTeamId: "B", homeSeed: 1, awaySeed: 4 }, hashString);
    assert.equal(results.get(`c${slot}`)!.winnerTeamId, expected);
    assert.equal(bracketGames(applied(rows, results), stored, 2)[0]!.winnerTeamId, expected);
  }
});

test("a two-week round: every week's row carries the round winner once both weeks are final", async () => {
  const settings = settingsWith(["HIGHER_SEED"]);
  // A wins week 1 by 40 and loses week 2 by 30: A advances 190-180
  const wk1 = row({ id: "w1", week: 15, homeScore: 120, awayScore: 80, label: "Semifinal (Wk 1 of 2)" });
  const wk2 = row({ id: "w2", week: 16, homeScore: 70, awayScore: 100, label: "Semifinal (Wk 2 of 2)" });
  const { games, results } = await rowResults([wk1, wk2], settings);
  assert.equal(games.length, 1);
  assert.equal(games[0]!.winnerTeamId, "A");
  for (const id of ["w1", "w2"]) assert.deepEqual(results.get(id), { winnerTeamId: "A", homeWinProb: 1 });
  // week 2 reads as a win for A (the round result), not a loss
  const [, w2] = applied([wk1, wk2], results);
  assert.equal(resultFor(w2!, "home"), "W");
  assert.equal(resultFor(w2!, "away"), "L");

  // refreshing either week settles both rows
  const fromWeek2 = await rowResults([wk1, wk2], settings, 16);
  assert.deepEqual([...fromWeek2.results.entries()].sort(), [...results.entries()].sort());

  // the second week still being played: no winner on either week yet; week 1 (final) reads by its own score and
  // week 2 keeps its live win probability
  const live = await rowResults([wk1, { ...wk2, status: "LIVE", homeWinProb: 0.27 }], settings, 16);
  assert.deepEqual(live.results.get("w1"), { winnerTeamId: null, homeWinProb: 1 });
  assert.deepEqual(live.results.get("w2"), { winnerTeamId: null, homeWinProb: 0.27 });
  assert.equal(resultFor(applied([wk1], live.results)[0]!, "home"), "W", "week 1 alone: its own score");
  const notStarted = await rowResults([{ ...wk1, homeScore: 90, awayScore: 90 }, { ...wk2, status: "UPCOMING", homeWinProb: 0.6 }], settings, 15);
  assert.deepEqual(notStarted.results.get("w1"), { winnerTeamId: null, homeWinProb: 0.5 }, "a level final week of an undecided game");
  assert.deepEqual(notStarted.results.get("w2"), { winnerTeamId: null, homeWinProb: 0.6 });

  // level on aggregate (190-190): the tie goes to the higher seed on both rows
  const level = await rowResults([wk1, { ...wk2, homeScore: 70, awayScore: 110 }], settings);
  for (const id of ["w1", "w2"]) assert.equal(level.results.get(id)!.winnerTeamId, "A");
  // and the rows' home/away swapped in week 2: each row's win probability follows its own home team
  const swapped = await rowResults([wk1, { ...wk2, homeTeamId: "B", awayTeamId: "A", homeSeed: 4, awaySeed: 1, homeScore: 110, awayScore: 70 }], settings);
  assert.deepEqual(swapped.results.get("w1"), { winnerTeamId: "A", homeWinProb: 1 });
  assert.deepEqual(swapped.results.get("w2"), { winnerTeamId: "A", homeWinProb: 0 });
});

test("only the games of the refreshed week are settled", async () => {
  const settings = settingsWith(["HIGHER_SEED"]);
  const rows = [
    row({ id: "q1", week: 15, bracketRound: 1, bracketSlot: 1, homeScore: 100, awayScore: 90 }),
    row({ id: "f1", week: 16, bracketRound: 2, bracketSlot: 1, homeTeamId: "A", awayTeamId: "C", homeSeed: 1, awaySeed: 2, homeScore: 0, awayScore: 0, status: "UPCOMING", homeWinProb: 0.7 }),
  ];
  const wk15 = await rowResults(rows, settings, 15);
  assert.deepEqual([...wk15.results.keys()], ["q1"]);
  const wk16 = await rowResults(rows, settings, 16);
  assert.deepEqual([...wk16.results.keys()], ["f1"]);
  assert.deepEqual(wk16.results.get("f1"), { winnerTeamId: null, homeWinProb: 0.7 }, "not started: its pre-game probability");
});

test("a final playoff row outside the bracket still produces a winner, by the playoff tiebreakers", () => {
  const r = { homeTeamId: "A", awayTeamId: "B", homeScore: 99.5, awayScore: 99.5, homeSeed: 3, awaySeed: 2 };
  const stats = (benchPoints: number, topStarter: number) => ({ benchPoints, topStarter });
  assert.equal(unbracketedPlayoffWinner({ ...r, homeScore: 99.51 }, stats(0, 0), stats(0, 0), settingsWith(["HIGHER_SEED"]), "k"), "A", "the score first");
  assert.equal(unbracketedPlayoffWinner(r, stats(0, 0), stats(0, 0), settingsWith(["HIGHER_SEED"]), "k"), "B", "level → the higher seed");
  assert.equal(unbracketedPlayoffWinner(r, stats(30, 10), stats(20, 25), settingsWith(["BENCH_POINTS", "HIGHER_SEED"]), "k"), "A");
  assert.equal(unbracketedPlayoffWinner(r, stats(30, 10), stats(20, 25), settingsWith(["HIGHEST_STARTER"]), "k"), "B");
  assert.equal(unbracketedPlayoffWinner(r, stats(0, 0), stats(0, 0), settingsWith([]), "k"), "B", "an empty chain falls back to the higher seed");
  const coin = settingsWith(["COIN_FLIP"]);
  for (const key of ["k1", "k2", "k3"]) assert.equal(unbracketedPlayoffWinner(r, stats(0, 0), stats(0, 0), coin, key), hashString(key) % 2 === 0 ? "A" : "B");
  assert.equal(unbracketedPlayoffWinner({ ...r, awayTeamId: null }, stats(0, 0), stats(0, 0), coin, "k"), null, "a bye");
});

test("rows of different games are decided independently; rows outside the bracket are left to the caller", async () => {
  const settings = settingsWith(["HIGHER_SEED"]);
  const rows = [
    row({ id: "s1", week: 15, bracketSlot: 1, homeTeamId: "A", awayTeamId: "B", homeSeed: 1, awaySeed: 4, homeScore: 100, awayScore: 110 }),
    row({ id: "s2", week: 15, bracketSlot: 2, homeTeamId: "C", awayTeamId: "D", homeSeed: 2, awaySeed: 3, homeScore: 90, awayScore: 90 }),
    row({ id: "x", week: 15, bracketRound: null, bracketSlot: null, homeTeamId: "G", awayTeamId: "F" }),
  ];
  const { results } = await rowResults(rows, settings);
  assert.equal(results.get("s1")!.winnerTeamId, "B");
  assert.equal(results.get("s2")!.winnerTeamId, "C");
  assert.equal(results.has("x"), false);
});

test("a two-week tie settled by the tiebreakers reads the same from bracketGames without ties (bracket view, playoff odds)", async () => {
  // A (seed 1) vs B (seed 4): 110–100 then 100–110 → 210–210; the coin flip / chain may pick either — whatever the
  // scoreboard stores on both weeks' rows, a reader that calls bracketGames without resolveTies must agree
  const rows = [row({ id: "w1", week: 15, homeScore: 110, awayScore: 100 }), row({ id: "w2", week: 16, homeScore: 100, awayScore: 110 })];
  for (const chain of [["COIN_FLIP"], ["HIGHER_SEED"]] as const) {
    const settings = settingsWith([...chain]);
    const { games, results } = await rowResults(rows, settings, 16);
    const winner = games[0]!.winnerTeamId!;
    const written = applied(rows, results);
    assert.deepEqual(written.map((r) => r.winnerTeamId), [winner, winner], "both weeks carry the round winner");
    assert.equal(bracketGames(written, stored, 2)[0]!.winnerTeamId, winner, `${chain[0]}: same winner without the ties map`);
    // and the stats count it as one game won by that team
    assert.equal(resultFor({ ...written[0]!, homeScore: 210, awayScore: 210 }, winner === "A" ? "home" : "away"), "W");
  }
});
