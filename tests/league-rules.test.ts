// Shared league-rule helpers: matchup winners / tiebreaks, forfeits, auto-subs, dead money, cap limits,
// roster limits and lineup locks.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NflGame } from "@prisma/client";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { decideWinner, didNotPlay, planAutoSubs, playingStarters, tiebreakChain, type SubCandidate } from "@/lib/scoreboard-rules";
import { bindingCapRoom, capCheck, capEnforcement, capLimit, capLimitLabel, capWarningNote, deadlineInstant, deadlineLabel, deadMoneyCharges, isOffseasonPhase } from "@/lib/roster-rules";
import { activeRosterLimit, rosterCheck, rosterLimitProblems, validateRoster } from "@/lib/roster";
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

// ───────────────────────── One cap ceiling, one active-roster limit, one enforcement rule ─────────────────────────

test("isOffseasonPhase: everything but the regular season and playoffs", () => {
  for (const p of ["PRESEASON", "OFFSEASON", "KEEPER"]) assert.equal(isOffseasonPhase(p), true, p);
  for (const p of ["REGULAR", "PLAYOFFS", null, undefined, ""]) assert.equal(isOffseasonPhase(p), false, String(p));
});

test("deadlineInstant: full ISO values as stored, date-only values end at midnight in the league timezone", () => {
  assert.equal(deadlineInstant("2027-08-30T16:00:00.000Z")?.toISOString(), "2027-08-30T16:00:00.000Z");
  // date-only = through the end of that day in the league timezone (EDT in summer, EST in winter, other zones)
  assert.equal(deadlineInstant("2026-08-31", "America/New_York")?.toISOString(), "2026-09-01T04:00:00.000Z");
  assert.equal(deadlineInstant("2026-12-15", "America/New_York")?.toISOString(), "2026-12-16T05:00:00.000Z");
  assert.equal(deadlineInstant("2026-08-31", "America/Los_Angeles")?.toISOString(), "2026-09-01T07:00:00.000Z");
  assert.equal(deadlineInstant("2026-08-31", "UTC")?.toISOString(), "2026-09-01T00:00:00.000Z");
  // the night clocks fall back (Nov 1 2026 in New York) still ends at the local midnight
  assert.equal(deadlineInstant("2026-10-31", "America/New_York")?.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(deadlineInstant("2026-11-01", "America/New_York")?.toISOString(), "2026-11-02T05:00:00.000Z");
  for (const bad of [null, undefined, "", "soon", "2026-02-30", "2026-13-01"]) assert.equal(deadlineInstant(bad, "America/New_York"), null, String(bad));
  assert.equal(deadlineLabel("2027-03-01", "America/New_York"), "Mar 1, 2027");
  assert.match(deadlineLabel("2027-03-01T17:00:00.000Z", "America/New_York") ?? "", /^Mar 1, 2027, 12:00 PM EST$/);
});

test("activeRosterLimit: offseason limit outside the season until the cutdown (ISO and date-only values)", () => {
  const s = base();
  s.general.timezone = "America/New_York";
  s.roster.maxActiveRoster = 27;
  s.roster.offseasonMaxActiveRoster = 40;
  s.roster.rosterCutdownDate = "2027-08-30T16:00:00.000Z"; // what the settings editor stores
  const at = (iso: string) => new Date(iso);
  assert.equal(activeRosterLimit(s, { phase: "OFFSEASON", now: at("2027-03-01T12:00:00Z") }), 40);
  assert.equal(activeRosterLimit(s, { phase: "PRESEASON", now: at("2027-08-30T15:59:59Z") }), 40);
  assert.equal(activeRosterLimit(s, { phase: "PRESEASON", now: at("2027-08-30T16:00:00Z") }), 27, "the stored ISO cutdown ends the offseason limit");
  assert.equal(activeRosterLimit(s, { phase: "REGULAR", now: at("2027-03-01T12:00:00Z") }), 27);
  assert.equal(activeRosterLimit(s, { phase: "PLAYOFFS", now: at("2027-03-01T12:00:00Z") }), 27);
  assert.equal(activeRosterLimit(s, { now: at("2027-03-01T12:00:00Z") }), 27, "no phase = in season");
  assert.equal(activeRosterLimit(s, { offseason: true, now: at("2027-03-01T12:00:00Z") }), 40, "legacy flag");
  // date-only: the whole cutdown day still allows the offseason limit (league time)
  s.roster.rosterCutdownDate = "2027-08-30";
  assert.equal(activeRosterLimit(s, { phase: "KEEPER", now: at("2027-08-31T03:59:00Z") }), 40, "11:59 PM EDT on the cutdown day");
  assert.equal(activeRosterLimit(s, { phase: "KEEPER", now: at("2027-08-31T04:00:00Z") }), 27);
  s.general.timezone = "America/Los_Angeles";
  assert.equal(activeRosterLimit(s, { phase: "KEEPER", now: at("2027-08-31T06:59:00Z") }), 40);
  // no cutdown: the offseason limit lasts until the season starts; a smaller "offseason limit" never shrinks rosters
  s.roster.rosterCutdownDate = null;
  assert.equal(activeRosterLimit(s, { phase: "OFFSEASON", now: at("2030-01-01T00:00:00Z") }), 40);
  s.roster.offseasonMaxActiveRoster = 20;
  assert.equal(activeRosterLimit(s, { phase: "OFFSEASON" }), 27);
  // rosterLimitProblems / validateRoster take the phase
  s.roster.maxActiveRoster = 2;
  s.roster.offseasonMaxActiveRoster = 3;
  const spots = ["a", "b", "c"].map(() => ({ status: "ACTIVE", salary: 1, player: { position: "WR", injuryStatus: null, status: "Active", yearsExp: 3, fullName: "W" } }));
  assert.equal(rosterLimitProblems(spots, s, { phase: "OFFSEASON" }).length, 0);
  assert.equal(validateRoster(spots, s, { phase: "REGULAR" }).length, 1);
});

test("capLimit: hard cap, soft cap with and without a max overage, per-season caps", () => {
  const s = base();
  s.salaryCap.cap = 300;
  s.salaryCap.capType = "HARD";
  assert.equal(capLimit(s), 300);
  assert.equal(capLimit(s, 310), 310, "next season's cap");
  assert.equal(capLimitLabel(s), "cap");
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 25;
  assert.equal(capLimit(s), 325);
  assert.equal(capLimit(s, 310), 335);
  assert.equal(capLimitLabel(s), "soft-cap limit");
  s.salaryCap.softCapMaxOverage = null;
  assert.equal(capLimit(s), null);
});

test("capEnforcement: in season follows enforceInSeason; the offseason follows offseasonEnforcement", () => {
  const s = base();
  s.general.timezone = "America/New_York";
  s.salaryCap.enabled = true;
  s.salaryCap.enforceInSeason = true;
  const now = new Date("2027-02-01T12:00:00Z");
  assert.equal(capEnforcement(s, "REGULAR", now), "BLOCK");
  assert.equal(capEnforcement(s, "PLAYOFFS", now), "BLOCK");
  assert.equal(capEnforcement(s, null, now), "BLOCK", "no phase = in season");
  s.salaryCap.enforceInSeason = false;
  assert.equal(capEnforcement(s, "REGULAR", now), "OFF");
  s.salaryCap.offseasonEnforcement = "BLOCK_OVER_CAP_MOVES";
  for (const p of ["PRESEASON", "OFFSEASON", "KEEPER"]) assert.equal(capEnforcement(s, p, now), "BLOCK", p);
  s.salaryCap.offseasonEnforcement = "WARN_ONLY";
  assert.equal(capEnforcement(s, "OFFSEASON", now), "WARN");
  assert.equal(capWarningNote(s), "The cap is only a warning in the offseason.");
  s.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
  s.salaryCap.complianceDate = null;
  assert.equal(capEnforcement(s, "OFFSEASON", now), "WARN", "no compliance date: never blocks");
  assert.equal(capWarningNote(s), "Allowed in the offseason (no cap compliance deadline is set).");
  s.salaryCap.complianceDate = "2027-03-01T05:00:00.000Z";
  assert.equal(capEnforcement(s, "OFFSEASON", now), "WARN", "before the compliance date");
  assert.equal(capEnforcement(s, "OFFSEASON", new Date("2027-03-01T05:00:00Z")), "BLOCK", "from the compliance date on");
  assert.match(capWarningNote(s), /^Allowed until the cap compliance deadline \(Mar 1, 2027, 12:00 AM EST\)\.$/);
  s.salaryCap.complianceDate = "2027-03-01"; // date-only: the whole day is still allowed (league time)
  assert.equal(capEnforcement(s, "OFFSEASON", new Date("2027-03-02T04:59:00Z")), "WARN");
  assert.equal(capEnforcement(s, "OFFSEASON", new Date("2027-03-02T05:00:00Z")), "BLOCK");
  s.salaryCap.enabled = false;
  assert.equal(capEnforcement(s, "REGULAR", now), "OFF");
  assert.equal(capEnforcement(s, "OFFSEASON", new Date("2030-01-01T00:00:00Z")), "OFF");
});

test("capCheck / bindingCapRoom: only moves that add salary are over; WARN never blocks; OFF checks nothing", () => {
  const s = base();
  s.salaryCap.enabled = true;
  s.salaryCap.cap = 300;
  s.salaryCap.capType = "HARD";
  s.salaryCap.enforceInSeason = true;
  s.salaryCap.offseasonEnforcement = "WARN_ONLY";
  assert.deepEqual(capCheck(310, s, { phase: "REGULAR" }), { mode: "BLOCK", limit: 300, enforced: true, over: 10, excess: 10, blocked: true, warned: false });
  assert.equal(capCheck(310, s, { phase: "REGULAR", before: 320 }).blocked, false, "shedding salary while over is fine");
  assert.equal(capCheck(310, s, { phase: "REGULAR", before: 305 }).blocked, true, "adding salary while over is not");
  assert.deepEqual(capCheck(310, s, { phase: "OFFSEASON" }), { mode: "WARN", limit: 300, enforced: false, over: 10, excess: 10, blocked: false, warned: true });
  assert.equal(capCheck(330, s, { phase: "REGULAR", cap: 340 }).over, 0, "a later season's cap");
  assert.equal(bindingCapRoom(280, s, { phase: "REGULAR" }), 20);
  assert.equal(bindingCapRoom(280, s, { phase: "OFFSEASON" }), null, "a warning never limits spending");
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 20;
  assert.equal(capCheck(315, s, { phase: "REGULAR" }).over, 0, "within the soft-cap limit");
  assert.equal(capCheck(325, s, { phase: "REGULAR" }).over, 5);
  assert.equal(bindingCapRoom(280, s, { phase: "REGULAR" }), 40);
  s.salaryCap.softCapMaxOverage = null;
  assert.equal(capCheck(9999, s, { phase: "REGULAR" }).blocked, false);
  assert.equal(bindingCapRoom(280, s, { phase: "REGULAR" }), null);
  s.salaryCap.enforceInSeason = false;
  s.salaryCap.capType = "HARD";
  assert.deepEqual(capCheck(400, s, { phase: "REGULAR" }), { mode: "OFF", limit: 300, enforced: false, over: 0, excess: 0, blocked: false, warned: false });
});

test("rosterCheck: the cap blocks, warns or is skipped by phase; legacy validateRoster callers keep the in-season rule", () => {
  const s = base();
  s.salaryCap.enabled = true;
  s.salaryCap.cap = 200;
  s.salaryCap.capType = "HARD";
  s.salaryCap.enforceInSeason = true;
  s.salaryCap.offseasonEnforcement = "WARN_ONLY";
  const spots = [{ status: "ACTIVE", salary: 210, player: { position: "QB", injuryStatus: null, status: "Active", yearsExp: 4, fullName: "Q" } }];
  assert.deepEqual(rosterCheck(spots, s, { checkCap: true, phase: "REGULAR" }), { errors: ["Salary would be $210, over the $200 cap."], warnings: [] });
  assert.deepEqual(validateRoster(spots, s, { checkCap: true }), ["Salary would be $210, over the $200 cap."], "no phase: in-season rules");
  const off = rosterCheck(spots, s, { checkCap: true, phase: "OFFSEASON" });
  assert.deepEqual(off.errors, []);
  assert.deepEqual(off.warnings, ["Salary would be $210, over the $200 cap. The cap is only a warning in the offseason."]);
  assert.deepEqual(rosterCheck(spots, s, { checkCap: true, phase: "REGULAR", capBefore: 215 }).errors, [], "the move lowered salary");
  assert.deepEqual(rosterCheck(spots, s, { checkCap: true, phase: "REGULAR", deadMoney: 0, capBefore: 205 }).errors.length, 1);
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 5;
  assert.deepEqual(rosterCheck(spots, s, { checkCap: true, phase: "REGULAR" }).errors, ["Salary would be $210, over the $205 soft-cap limit."]);
});

test("capCheck.excess: what a move must shed — back under the ceiling, or no more than before for a team already over", () => {
  const s = base();
  s.salaryCap.enabled = true;
  s.salaryCap.cap = 300;
  s.salaryCap.capType = "HARD";
  s.salaryCap.enforceInSeason = true;
  // under the cap before: everything above the cap
  assert.deepEqual([capCheck(315, s, { phase: "REGULAR", before: 290 }).over, capCheck(315, s, { phase: "REGULAR", before: 290 }).excess], [15, 15]);
  // already $10 over: a move adding $5 is $15 over the cap, but shedding $5 (back to the old payroll) is enough
  const over = capCheck(315, s, { phase: "REGULAR", before: 310 });
  assert.equal(over.blocked, true);
  assert.equal(over.over, 15);
  assert.equal(over.excess, 5);
  assert.equal(capCheck(310, s, { phase: "REGULAR", before: 310 }).blocked, false, "shedding the excess unblocks it");
  // no `before`: measured against the ceiling only
  assert.equal(capCheck(315, s, { phase: "REGULAR" }).excess, 15);
  // soft cap: against cap + max overage
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 20;
  assert.equal(capCheck(330, s, { phase: "REGULAR", before: 300 }).excess, 10);
  assert.equal(capCheck(330, s, { phase: "REGULAR", before: 325 }).excess, 5);
});

test("deadlineInstant: a datetime without a UTC offset is wall-clock time in the league timezone (not the server's)", () => {
  // what an import / hand-edited setting may hold: no "Z", no offset
  assert.equal(deadlineInstant("2027-03-01T12:00", "America/New_York")?.toISOString(), "2027-03-01T17:00:00.000Z");
  assert.equal(deadlineInstant("2027-08-30T12:00:00", "America/New_York")?.toISOString(), "2027-08-30T16:00:00.000Z", "EDT");
  assert.equal(deadlineInstant("2027-08-30 12:00:00.5", "America/Los_Angeles")?.toISOString(), "2027-08-30T19:00:00.500Z");
  assert.equal(deadlineInstant("2027-08-30T12:00:00", "UTC")?.toISOString(), "2027-08-30T12:00:00.000Z");
  // an explicit offset is used as written
  assert.equal(deadlineInstant("2027-08-30T12:00:00-07:00", "America/New_York")?.toISOString(), "2027-08-30T19:00:00.000Z");
  for (const bad of ["2027-02-30T12:00", "2027-03-01T24:00", "2027-03-01T12:60"]) assert.equal(deadlineInstant(bad, "America/New_York"), null, bad);
  assert.match(deadlineLabel("2027-03-01T12:00", "America/New_York") ?? "", /^Mar 1, 2027, 12:00 PM EST$/);
  // an unknown zone falls back to UTC instead of throwing
  assert.equal(deadlineInstant("2027-03-01", "Not/AZone")?.toISOString(), "2027-03-02T00:00:00.000Z");
  assert.equal(deadlineLabel("2027-03-01T17:00:00.000Z", "Not/AZone"), "Mar 1, 2027, 5:00 PM UTC", "a set deadline is never hidden");
  // repeated calls (cached formatter per zone) keep giving the same answer in every zone
  for (let i = 0; i < 3; i++) {
    assert.equal(deadlineInstant("2026-12-15", "America/New_York")?.toISOString(), "2026-12-16T05:00:00.000Z");
    assert.equal(deadlineInstant("2026-12-15", "America/Chicago")?.toISOString(), "2026-12-16T06:00:00.000Z");
  }
  // the cutdown / compliance rules read it in the league timezone
  const s = base();
  s.general.timezone = "America/Chicago";
  s.roster.maxActiveRoster = 27;
  s.roster.offseasonMaxActiveRoster = 35;
  s.roster.rosterCutdownDate = "2027-08-30T12:00";
  assert.equal(activeRosterLimit(s, { phase: "PRESEASON", now: new Date("2027-08-30T16:59:00Z") }), 35);
  assert.equal(activeRosterLimit(s, { phase: "PRESEASON", now: new Date("2027-08-30T17:00:00Z") }), 27);
  s.salaryCap.enabled = true;
  s.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
  s.salaryCap.complianceDate = "2027-03-01T00:00";
  assert.equal(capEnforcement(s, "OFFSEASON", new Date("2027-03-01T05:59:00Z")), "WARN");
  assert.equal(capEnforcement(s, "OFFSEASON", new Date("2027-03-01T06:00:00Z")), "BLOCK");
});
