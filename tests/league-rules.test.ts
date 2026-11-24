// Shared league-rule helpers: matchup winners / tiebreaks, forfeits, auto-subs, dead money, cap limits,
// roster limits and lineup locks.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NflGame } from "@prisma/client";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { decideWinner, didNotPlay, planAutoSubs, playingStarters, tiebreakChain, type SubCandidate } from "@/lib/scoreboard-rules";
import { capLimit, deadMoneyCharges } from "@/lib/roster-rules";
import { activeRosterLimit, rosterLimitProblems, validateRoster } from "@/lib/roster";
import { canStart, isLocked } from "@/lib/lineup";

const base = (): LeagueSettings => structuredClone(DEFAULT_SETTINGS);
const side = (teamId: string, points: number, extra: Partial<{ benchPoints: number; topStarter: number; forfeit: boolean }> = {}) => ({
  teamId,
  points,
  benchPoints: extra.benchPoints ?? 0,
  topStarter: extra.topStarter ?? 0,
  forfeit: extra.forfeit,
});

test("decideWinner: higher score wins, reverse-scoring week flips it", () => {
  const s = base();
  assert.equal(decideWinner(side("H", 101.5), side("A", 99), s), "H");
  assert.equal(decideWinner(side("H", 101.5), side("A", 99), s, { reverse: true }), "A");
});

test("decideWinner: ties stand only when allowed and no tiebreaker applies", () => {
  const s = base();
  s.matchups.allowTies = true;
  s.matchups.tiebreaker = "NONE";
  s.lineup.benchPointsTiebreaker = false;
  assert.equal(decideWinner(side("H", 90), side("A", 90, { benchPoints: 30 }), s), null);
  // playoff games always need a winner
  assert.equal(decideWinner(side("H", 90), side("A", 90, { benchPoints: 30 }), s, { mustHaveWinner: true }), "A");
  // ties not allowed -> bench, then top starter, then home team
  s.matchups.allowTies = false;
  assert.equal(decideWinner(side("H", 90, { benchPoints: 5 }), side("A", 90, { benchPoints: 4 }), s), "H");
  assert.equal(decideWinner(side("H", 90, { topStarter: 20 }), side("A", 90, { topStarter: 25 }), s), "A");
  assert.equal(decideWinner(side("H", 90), side("A", 90), s), "H");
  // benchPointsTiebreaker alone breaks a tie even when ties are allowed
  s.matchups.allowTies = true;
  s.lineup.benchPointsTiebreaker = true;
  assert.equal(decideWinner(side("H", 90, { benchPoints: 1 }), side("A", 90, { benchPoints: 2 }), s), "A");
  assert.deepEqual(tiebreakChain(s), ["BENCH_POINTS"]);
});

test("decideWinner: a forfeiting team loses regardless of score", () => {
  const s = base();
  assert.equal(decideWinner(side("H", 140, { forfeit: true }), side("A", 60), s), "A");
  assert.equal(decideWinner(side("H", 140, { forfeit: true }), side("A", 60, { forfeit: true }), s), "H");
});

const cand = (id: string, pos: string, o: Partial<SubCandidate> = {}): SubCandidate => ({
  playerId: id,
  position: pos,
  injuryStatus: null,
  gameState: "pre",
  kickoff: new Date("2026-11-29T18:00:00Z"),
  hasStats: false,
  value: 10,
  ...o,
});

test("didNotPlay: final with no stats, or ruled out before playing", () => {
  assert.equal(didNotPlay(cand("a", "RB", { gameState: "post" })), true);
  assert.equal(didNotPlay(cand("a", "RB", { gameState: "post", hasStats: true })), false);
  assert.equal(didNotPlay(cand("a", "RB", { injuryStatus: "Out" })), true);
  assert.equal(didNotPlay(cand("a", "RB", { injuryStatus: "Questionable" })), false);
  assert.equal(didNotPlay(cand("a", "RB", { gameState: "bye" })), false);
});

test("planAutoSubs: best eligible bench player, later kickoff, weekly max", () => {
  const s = base();
  const starters = [
    { eligible: ["RB"], player: cand("rb1", "RB", { injuryStatus: "Out" }) },
    { eligible: ["WR"], player: cand("wr1", "WR", { gameState: "post" }) },
    { eligible: ["TE"], player: cand("te1", "TE", { hasStats: true, gameState: "in" }) },
  ];
  const bench = [
    cand("rb2", "RB", { value: 8, kickoff: new Date("2026-11-29T21:25:00Z") }),
    cand("rb3", "RB", { value: 12, kickoff: new Date("2026-11-29T17:00:00Z") }),
    cand("wr2", "WR", { value: 6, kickoff: new Date("2026-11-30T01:20:00Z") }),
  ];
  assert.equal(planAutoSubs(starters, bench, s).size, 0); // off by default
  s.lineup.autoSubOutPlayers = true;
  s.lineup.autoSubRequireLaterKickoff = true;
  s.lineup.autoSubsMaxPerWeek = 0;
  const subs = planAutoSubs(starters, bench, s);
  assert.equal(subs.get(0), "rb2"); // rb3 kicked off earlier than the starter
  assert.equal(subs.get(1), "wr2");
  assert.equal(subs.has(2), false);
  s.lineup.autoSubRequireLaterKickoff = false;
  assert.equal(planAutoSubs(starters, bench, s).get(0), "rb3");
  s.lineup.autoSubsMaxPerWeek = 1;
  assert.equal(planAutoSubs(starters, bench, s).size, 1);
  assert.equal(playingStarters(starters.map((x) => x.player)), 1);
});

test("deadMoneyCharges: current + future seasons, exemptions, preseason discount", () => {
  const s = base();
  s.salaryCap.enabled = true;
  s.salaryCap.deadMoney.enabled = true;
  s.salaryCap.deadMoney.currentSeasonPercent = 50;
  s.salaryCap.deadMoney.futureSeasonPercent = 25;
  s.salaryCap.deadMoney.preseasonCutPercent = 20;
  s.salaryCap.deadMoney.rookieContractsExempt = true;
  s.salaryCap.deadMoney.waivedInSeasonBeforeWeek = null;
  s.salaryCap.minSalary = 1;
  assert.deepEqual(deadMoneyCharges({ salary: 32, contractYears: 3 }, s, 2026, 5), [
    { season: 2026, amount: 16 },
    { season: 2027, amount: 8 },
    { season: 2028, amount: 8 },
  ]);
  assert.deepEqual(deadMoneyCharges({ salary: 30, contractYears: 1 }, s, 2026, 1, { preseason: true }), [{ season: 2026, amount: 6 }]);
  assert.deepEqual(deadMoneyCharges({ salary: 30, contractYears: 2, isRookieContract: true }, s, 2026, 5), []);
  assert.deepEqual(deadMoneyCharges({ salary: 1, contractYears: 2 }, s, 2026, 5), []);
});

test("capLimit + validateRoster honor soft caps", () => {
  const s = base();
  s.salaryCap.enabled = true;
  s.salaryCap.enforceInSeason = true;
  s.salaryCap.cap = 200;
  s.salaryCap.capType = "HARD";
  assert.equal(capLimit(s), 200);
  const spots = [{ status: "ACTIVE", salary: 210, player: { position: "QB", injuryStatus: null, status: "Active", yearsExp: 4, fullName: "Q" } }];
  assert.equal(validateRoster(spots, s, { checkCap: true }).length, 1);
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 20;
  assert.equal(capLimit(s), 220);
  assert.equal(validateRoster(spots, s, { checkCap: true }).length, 0);
  s.salaryCap.softCapMaxOverage = null;
  assert.equal(capLimit(s), null);
});

test("roster limits: offseason active-roster limit until the cutdown date", () => {
  const s = base();
  s.roster.maxActiveRoster = 2;
  s.roster.offseasonMaxActiveRoster = 3;
  s.roster.rosterCutdownDate = "2026-08-31";
  const spots = ["a", "b", "c"].map(() => ({ status: "ACTIVE", player: { position: "WR" } }));
  assert.equal(rosterLimitProblems(spots, s).length, 1);
  assert.equal(rosterLimitProblems(spots, s, { offseason: true, now: new Date("2026-05-01T12:00:00Z") }).length, 0);
  assert.equal(activeRosterLimit(s, { offseason: true, now: new Date("2026-09-02T12:00:00Z") }), 2);
});

test("lineup: taxi starters only when allowed; lock offset applies to every lock type", () => {
  const s = base();
  assert.equal(canStart("TAXI", s), false);
  s.roster.taxiPlayersCanStart = true;
  assert.equal(canStart("TAXI", s), true);
  assert.equal(canStart("IR", s), false);
  const g = { homeTeam: "KC", awayTeam: "BUF", startTime: new Date("2026-11-29T18:00:00Z"), state: "pre" } as unknown as NflGame;
  const games = new Map([["KC", g], ["BUF", g]]);
  const now = new Date("2026-11-29T17:50:00Z");
  s.lineup.lockType = "FIRST_GAME_OF_WEEK";
  s.lineup.lockOffsetMinutes = 0;
  assert.equal(isLocked("KC", games, s, now), false);
  s.lineup.lockOffsetMinutes = 15;
  assert.equal(isLocked("KC", games, s, now), true);
});
