import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignPickNumbers,
  autopickChain,
  clampYears,
  composeRookieOrder,
  drawLottery,
  extendEndsAt,
  lastIndexOfTeam,
  lotteryProbabilities,
  maxBidFor,
  median,
  minNextBid,
  moveItem,
  nextNominator,
  normalizeOdds,
  openRosterSpots,
  pickFromSources,
  pickInRoundFor,
  resolveProxyBids,
  rookieSalary,
  roundPickLabel,
  seededRandom,
  shuffle,
  type OrderTeamInput,
  coinFlipValue,
  forcedLotterySeed,
  maxYearsUnderLimits,
  skippedIndexes,
  undoRewindIndex,
} from "@/lib/draft/logic";
import { addClockTime, clockTimeBetween, fmtCountdown, pauseWindowAt, utcToZonedLocal, zonedLocalToUtc } from "@/lib/draft/time";
import { DEFAULT_SETTINGS } from "@/lib/settings/schema";

test("round.pick labels", () => {
  assert.equal(roundPickLabel(1, 4), "1.04");
  assert.equal(roundPickLabel(2, 12), "2.12");
  assert.equal(roundPickLabel(3, null), "R3");
});

test("linear vs snake pick numbers", () => {
  assert.equal(pickInRoundFor(1, 1, 12, "LINEAR"), 1);
  assert.equal(pickInRoundFor(1, 2, 12, "LINEAR"), 1);
  assert.equal(pickInRoundFor(1, 2, 12, "SNAKE"), 12);
  assert.equal(pickInRoundFor(12, 2, 12, "SNAKE"), 1);
  assert.equal(pickInRoundFor(3, 3, 12, "SNAKE"), 3);
});

test("assignPickNumbers follows the original team's slot, keeps traded picks with their original slot", () => {
  const picks = [
    { id: "a1", round: 1, originalTeamId: "A" },
    { id: "b1", round: 1, originalTeamId: "B" },
    { id: "c1", round: 1, originalTeamId: "C" },
    { id: "a2", round: 2, originalTeamId: "A" },
    { id: "b2", round: 2, originalTeamId: "B" },
    { id: "c2", round: 2, originalTeamId: "C" },
    { id: "a3", round: 3, originalTeamId: "A" }, // beyond configured rounds: ignored
  ];
  const linear = assignPickNumbers(picks, ["C", "A", "B"], "LINEAR", 2);
  assert.deepEqual(linear.map((p) => p.id), ["c1", "a1", "b1", "c2", "a2", "b2"]);
  assert.deepEqual(linear.map((p) => p.overall), [1, 2, 3, 4, 5, 6]);
  const snake = assignPickNumbers(picks, ["C", "A", "B"], "SNAKE", 2);
  assert.deepEqual(snake.map((p) => p.id), ["c1", "a1", "b1", "b2", "a2", "c2"]);
  assert.equal(snake.find((p) => p.id === "b2")!.pickInRound, 1);
  // a team missing from the order is appended instead of dropped
  const partial = assignPickNumbers(picks, ["B"], "LINEAR", 1);
  assert.deepEqual(partial.map((p) => p.id), ["b1", "a1", "c1"]);
});

const teams: OrderTeamInput[] = [
  { teamId: "T1", rank: 1, pointsFor: 1500, potentialPoints: 1700, madePlayoffs: true, playoffFinish: 2 },
  { teamId: "T2", rank: 2, pointsFor: 1400, potentialPoints: 1650, madePlayoffs: true, playoffFinish: 1 },
  { teamId: "T3", rank: 3, pointsFor: 1300, potentialPoints: 1500, madePlayoffs: true, playoffFinish: 3 },
  { teamId: "T4", rank: 4, pointsFor: 1250, potentialPoints: 1560, madePlayoffs: false, playoffFinish: null },
  { teamId: "T5", rank: 5, pointsFor: 1100, potentialPoints: 1580, madePlayoffs: false, playoffFinish: null },
  { teamId: "T6", rank: 6, pointsFor: 1200, potentialPoints: 1400, madePlayoffs: false, playoffFinish: null },
];

test("reverse standings with playoff teams by finish (champion picks last)", () => {
  const o = composeRookieOrder({ teams, method: "REVERSE_STANDINGS", playoffTeamsByFinish: true, lotteryTeams: 3 });
  assert.deepEqual(o.map((s) => s.teamId), ["T6", "T5", "T4", "T3", "T1", "T2"]);
  assert.equal(o[5].basis, "Champion");
  assert.equal(o[0].group, "NON_PLAYOFF");
});

test("reverse standings without playoff-finish split", () => {
  const o = composeRookieOrder({ teams, method: "REVERSE_STANDINGS", playoffTeamsByFinish: false, lotteryTeams: 3 });
  assert.deepEqual(o.map((s) => s.teamId), ["T6", "T5", "T4", "T3", "T2", "T1"]);
});

test("reverse max potential points (both potential-points methods use the best possible lineups)", () => {
  const pf = composeRookieOrder({ teams, method: "REVERSE_MAX_PF", playoffTeamsByFinish: true, lotteryTeams: 3 });
  assert.deepEqual(pf.slice(0, 3).map((s) => s.teamId), ["T6", "T4", "T5"]);
  assert.match(pf[0].basis, /max potential/);
  const pp = composeRookieOrder({ teams, method: "REVERSE_POTENTIAL_POINTS", playoffTeamsByFinish: false, lotteryTeams: 3 });
  assert.deepEqual(pp.map((s) => s.teamId), ["T6", "T3", "T4", "T5", "T2", "T1"]);
});

test("draft order tiebreakers settle tied records (worse team picks first)", () => {
  const tied: OrderTeamInput[] = [
    { teamId: "A", rank: 5, pct: 0.4, pointsFor: 1200, pointsAgainst: 1300, potentialPoints: 1500, madePlayoffs: false, playoffFinish: null },
    { teamId: "B", rank: 6, pct: 0.4, pointsFor: 1250, pointsAgainst: 1250, potentialPoints: 1450, madePlayoffs: false, playoffFinish: null },
    { teamId: "C", rank: 4, pct: 0.5, pointsFor: 1100, pointsAgainst: 1200, potentialPoints: 1400, madePlayoffs: false, playoffFinish: null },
  ];
  const base = { teams: tied, method: "REVERSE_STANDINGS" as const, playoffTeamsByFinish: true, lotteryTeams: 0 };
  // no chain: falls back to the standings rank (B ranked 6th picks first)
  assert.deepEqual(composeRookieOrder(base).map((s) => s.teamId), ["B", "A", "C"]);
  assert.deepEqual(composeRookieOrder({ ...base, tiebreakers: ["POINTS_FOR"] }).map((s) => s.teamId), ["A", "B", "C"]);
  assert.deepEqual(composeRookieOrder({ ...base, tiebreakers: ["MAX_POTENTIAL_POINTS"] }).map((s) => s.teamId), ["B", "A", "C"]);
  assert.deepEqual(composeRookieOrder({ ...base, tiebreakers: ["POINTS_AGAINST"] }).map((s) => s.teamId), ["A", "B", "C"]);
  // coin flips are deterministic for a seed
  const c1 = composeRookieOrder({ ...base, tiebreakers: ["COIN_FLIP"], coinSeed: "L:2027" }).map((s) => s.teamId);
  const c2 = composeRookieOrder({ ...base, tiebreakers: ["COIN_FLIP"], coinSeed: "L:2027" }).map((s) => s.teamId);
  assert.deepEqual(c1, c2);
  assert.equal(c1[2], "C");
  assert.ok(coinFlipValue("x") >= 0 && coinFlipValue("x") < 1);
});

test("consolation winner bonus slot and last-place pick swap", () => {
  const first = composeRookieOrder({ teams, method: "REVERSE_STANDINGS", playoffTeamsByFinish: true, lotteryTeams: 0, bonus: { teamId: "T4", slot: "FIRST_OVERALL" } });
  assert.deepEqual(first.map((s) => s.teamId), ["T4", "T6", "T5", "T3", "T1", "T2"]);
  assert.equal(first[0].group, "BONUS");
  assert.deepEqual(first.map((s) => s.slot), [1, 2, 3, 4, 5, 6]);
  // with a lottery, FIRST_NON_PLAYOFF lands right after the lottery picks (and the winner leaves the lottery pool)
  const afterLottery = composeRookieOrder({ teams, method: "LOTTERY", playoffTeamsByFinish: true, lotteryTeams: 2, bonus: { teamId: "T5", slot: "FIRST_NON_PLAYOFF" } });
  assert.deepEqual(afterLottery.map((s) => s.teamId), ["T6", "T4", "T5", "T3", "T1", "T2"]);
  assert.deepEqual(afterLottery.map((s) => s.group).slice(0, 3), ["LOTTERY", "LOTTERY", "BONUS"]);
  const swap = composeRookieOrder({ teams, method: "REVERSE_STANDINGS", playoffTeamsByFinish: true, lotteryTeams: 0, lastPlaceSwap: "T6" });
  assert.deepEqual(swap.map((s) => s.teamId), ["T5", "T6", "T4", "T3", "T1", "T2"]);
  assert.match(swap[1].basis, /last-place pick swap/);
});

test("lottery rules: picks drawn and max drop", () => {
  // only the first pick is drawn: everyone else keeps seed order
  for (let seed = 1; seed < 40; seed++) {
    const r = drawLottery(["A", "B", "C", "D"], [40, 30, 20, 10], seededRandom(seed), { picksDrawn: 1 });
    const rest = r.slice(1);
    assert.deepEqual(rest, ["A", "B", "C", "D"].filter((x) => x !== r[0]));
  }
  // nobody falls more than one spot
  for (let seed = 1; seed < 60; seed++) {
    const r = drawLottery(["A", "B", "C", "D", "E"], [30, 25, 20, 15, 10], seededRandom(seed), { maxDropSpots: 1 });
    ["A", "B", "C", "D", "E"].forEach((id, i) => assert.ok(r.indexOf(id) <= i + 1, `${id} fell too far in ${r.join("")}`));
  }
  assert.equal(forcedLotterySeed([0, 1, 2], 0, {}), null);
  assert.equal(forcedLotterySeed([1, 2], 1, { picksDrawn: 1 }), 1);
  assert.equal(forcedLotterySeed([0, 2, 3], 2, { maxDropSpots: 2 }), 0);
  const m = lotteryProbabilities(4, [40, 30, 20, 10], { picksDrawn: 1 });
  assert.ok(Math.abs(m[0][0] - 0.4) < 1e-9);
  assert.ok(Math.abs(m[3][3] - 0.9) < 1e-9); // D lands 4th unless it wins pick 1
  assert.equal(m[0][2], 0); // A can fall at most one spot
  const md = lotteryProbabilities(4, [25, 25, 25, 25], { maxDropSpots: 1 });
  for (let i = 0; i < 4; i++) for (let k = i + 2; k < 4; k++) assert.equal(md[i][k], 0);
  for (const row of md) assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("skipped picks and undo rewind", () => {
  const order = ["p1", "p2", "p3", "p4"];
  assert.deepEqual(skippedIndexes(order, 3, new Set(["p1", "p3"])), [1]);
  assert.deepEqual(skippedIndexes(order, 0, new Set()), []);
  assert.deepEqual(skippedIndexes(order, 4, new Set(["p1", "p2", "p3", "p4"])), []);
  // undoing the latest regular pick rewinds the clock to it (past skipped picks after it)
  assert.equal(undoRewindIndex(2, 3, [0]), 2);
  assert.equal(undoRewindIndex(1, 4, [0]), 1); // picks 2 and 3 were skipped
  // undoing a make-up pick (later picks exist) leaves the clock alone
  assert.equal(undoRewindIndex(1, 4, [0, 2, 3]), 4);
});

test("contract length limits cap the years a team may choose", () => {
  const limits = [{ years: 4, maxCount: 2 }];
  assert.equal(maxYearsUnderLimits([1, 2, 3, 4, 5], [1, 2, 4], limits), 5);
  assert.equal(maxYearsUnderLimits([1, 2, 3, 4, 5], [4, 5, 2], limits), 3);
  assert.equal(maxYearsUnderLimits([1, 2, 3], [5, 5, 5], []), 3);
});

test("overnight pause: the pick clock skips the pause window (league time)", () => {
  const tz = "America/New_York";
  const pause = { startHour: 23, endHour: 8, timeZone: tz };
  // 10:00 PM ET + 4h of clock → 1h before the pause, 3h after 8 AM → 11:00 AM ET next day
  const from = zonedLocalToUtc("2027-05-01T22:00", tz)!;
  assert.equal(utcToZonedLocal(addClockTime(from, 4 * 3600_000, pause), tz), "2027-05-02T11:00");
  // starting inside the window: the clock starts at 8 AM
  const night = zonedLocalToUtc("2027-05-02T02:30", tz)!;
  assert.equal(utcToZonedLocal(addClockTime(night, 30 * 60_000, pause), tz), "2027-05-02T08:30");
  // well before the window: plain addition
  const noon = zonedLocalToUtc("2027-05-02T12:00", tz)!;
  assert.equal(utcToZonedLocal(addClockTime(noon, 2 * 3600_000, pause), tz), "2027-05-02T14:00");
  // multi-day clocks skip every night (24h of clock from 8 AM = 15h day 1 + 9h day 2)
  const morning = zonedLocalToUtc("2027-05-03T08:00", tz)!;
  assert.equal(utcToZonedLocal(addClockTime(morning, 24 * 3600_000, pause), tz), "2027-05-04T17:00");
  assert.equal(clockTimeBetween(from, addClockTime(from, 4 * 3600_000, pause), pause), 4 * 3600_000);
  // a daytime window (start < end) works too
  const lunch = { startHour: 12, endHour: 13, timeZone: tz };
  assert.equal(utcToZonedLocal(addClockTime(zonedLocalToUtc("2027-05-02T11:30", tz)!, 3600_000, lunch), tz), "2027-05-02T13:30");
  assert.equal(addClockTime(noon, 1000, null).getTime(), noon.getTime() + 1000);
  const w = pauseWindowAt(night.getTime(), pause)!;
  assert.ok(w.active);
  assert.equal(utcToZonedLocal(new Date(w.end), tz), "2027-05-02T08:00");
  assert.equal(pauseWindowAt(noon.getTime(), { startHour: 5, endHour: 5, timeZone: tz }), null);
});

test("lottery: pre-draw seeds, then drawn order is authoritative", () => {
  const pre = composeRookieOrder({ teams, method: "LOTTERY", playoffTeamsByFinish: true, lotteryTeams: 2 });
  assert.deepEqual(pre.map((s) => s.teamId), ["T6", "T5", "T4", "T3", "T1", "T2"]);
  assert.equal(pre[0].group, "LOTTERY");
  assert.equal(pre[2].group, "NON_PLAYOFF");
  const post = composeRookieOrder({ teams, method: "LOTTERY", playoffTeamsByFinish: true, lotteryTeams: 2, lotteryResult: ["T5", "T6"] });
  assert.deepEqual(post.map((s) => s.teamId), ["T5", "T6", "T4", "T3", "T1", "T2"]);
  assert.match(post[0].basis, /jumped from #2/);
  assert.match(post[1].basis, /fell from #1/);
});

test("lottery odds normalize and probabilities sum to 1 per team and per pick", () => {
  const odds = normalizeOdds(4, [40, 30, 20, 10]);
  assert.deepEqual(odds.map((o) => Math.round(o * 100)), [40, 30, 20, 10]);
  assert.deepEqual(normalizeOdds(3, [50]).map((o) => Math.round(o * 1000)), [333, 333, 333]);
  assert.deepEqual(normalizeOdds(2, [0, 0]), [0.5, 0.5]);
  const m = lotteryProbabilities(4, [40, 30, 20, 10]);
  assert.ok(Math.abs(m[0][0] - 0.4) < 1e-9);
  for (const row of m) assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(m.reduce((a, row) => a + row[k], 0) - 1) < 1e-9);
});

test("drawLottery is a weighted permutation and reproducible from a seed", () => {
  const ids = ["A", "B", "C", "D", "E", "F"];
  const a = drawLottery(ids, [25, 20, 17.5, 15, 12.5, 10], seededRandom(42));
  const b = drawLottery(ids, [25, 20, 17.5, 15, 12.5, 10], seededRandom(42));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), ids);
  // the worst team wins pick 1 about 25% of the time
  const rand = seededRandom(7);
  let wins = 0;
  for (let i = 0; i < 4000; i++) if (drawLottery(ids, [25, 20, 17.5, 15, 12.5, 10], rand)[0] === "A") wins++;
  assert.ok(wins / 4000 > 0.22 && wins / 4000 < 0.28, `A won ${wins}`);
});

test("rookie salary scale with fallback", () => {
  const scale = DEFAULT_SETTINGS.contracts.rookieScale;
  assert.equal(rookieSalary(scale, 1, 1, 1), 10);
  assert.equal(rookieSalary(scale, 2, 12, 1), 1);
  assert.equal(rookieSalary(scale, 3, 1, 1), 1); // no round 3 in the scale
  assert.equal(rookieSalary({ "1": [0] }, 1, 1, 2), 2);
});

test("autopick: queue, then source chain, skipping unavailable", () => {
  assert.deepEqual(autopickChain("BIG_BOARD"), ["QUEUE", "BIG_BOARD", "LEAGUE_RANKINGS", "ADP"]);
  assert.deepEqual(autopickChain("ADP"), ["QUEUE", "ADP"]);
  const available = new Set(["p3", "p4", "p5"]);
  assert.equal(pickFromSources([["p1"], ["p2", "p4"], ["p3"]], available), "p4");
  assert.equal(pickFromSources([[], [], ["p5"]], available), "p5");
  assert.equal(pickFromSources([["x"]], available), null);
});

test("auction: open spots and max bid", () => {
  assert.equal(openRosterSpots({ rosterSpotsToFill: 25, wonInDraft: 0, maxActiveRoster: 27, activeCount: 0 }), 25);
  assert.equal(openRosterSpots({ rosterSpotsToFill: 25, wonInDraft: 2, maxActiveRoster: 27, activeCount: 24 }), 3);
  assert.equal(openRosterSpots({ rosterSpotsToFill: 25, wonInDraft: 25, maxActiveRoster: 27, activeCount: 25 }), 0);
  // remaining 300 − (25 − 1) × 1 = 276
  assert.deepEqual(maxBidFor({ budget: 300, spent: 0, capSpace: null, openSpots: 25, minBid: 1, rule: "BUDGET_MINUS_OPEN_SLOTS" }), { remaining: 300, maxBid: 276 });
  // capped by cap space
  assert.deepEqual(maxBidFor({ budget: 300, spent: 0, capSpace: 12, openSpots: 3, minBid: 1, rule: "BUDGET_MINUS_OPEN_SLOTS" }), { remaining: 12, maxBid: 10 });
  assert.deepEqual(maxBidFor({ budget: 300, spent: 50, capSpace: null, openSpots: 3, minBid: 1, rule: "BUDGET" }), { remaining: 250, maxBid: 250 });
  assert.equal(maxBidFor({ budget: 300, spent: 0, capSpace: null, openSpots: 0, minBid: 1, rule: "BUDGET" }).maxBid, 0);
  assert.equal(maxBidFor({ budget: 300, spent: 0, capSpace: null, openSpots: 5, minBid: 1, rule: "BUDGET", maxSalary: 60 }).maxBid, 60);
  assert.equal(maxBidFor({ budget: 10, spent: 8, capSpace: -5, openSpots: 4, minBid: 1, rule: "BUDGET_MINUS_OPEN_SLOTS" }).maxBid, 0);
  assert.equal(minNextBid(10, 1), 11);
  assert.equal(minNextBid(10, 0), 11);
});

test("bid timer extends to at least the reset window", () => {
  const now = new Date("2026-08-20T20:00:00Z");
  assert.equal(extendEndsAt(new Date("2026-08-20T20:00:05Z"), now, 15).toISOString(), "2026-08-20T20:00:15.000Z");
  assert.equal(extendEndsAt(new Date("2026-08-20T20:00:25Z"), now, 15).toISOString(), "2026-08-20T20:00:25.000Z");
  assert.equal(extendEndsAt(null, now, 10).toISOString(), "2026-08-20T20:00:10.000Z");
});

test("proxy bids: challenger beats a leader without a proxy at +1", () => {
  const r = resolveProxyBids({ price: 10, leaderTeamId: "A", increment: 1, caps: [{ teamId: "B", cap: 20, priority: 0 }] });
  assert.deepEqual(r, { price: 11, leaderTeamId: "B", bids: [{ teamId: "B", amount: 11 }] });
});

test("proxy bids: two proxies settle one increment above the loser", () => {
  const r = resolveProxyBids({ price: 10, leaderTeamId: "A", increment: 1, caps: [{ teamId: "A", cap: 15, priority: 0 }, { teamId: "B", cap: 20, priority: 1 }] });
  assert.equal(r.leaderTeamId, "B");
  assert.equal(r.price, 16);
  const hold = resolveProxyBids({ price: 10, leaderTeamId: "A", increment: 1, caps: [{ teamId: "A", cap: 20, priority: 0 }, { teamId: "B", cap: 15, priority: 1 }] });
  assert.equal(hold.leaderTeamId, "A");
  assert.equal(hold.price, 16);
  assert.deepEqual(hold.bids, [{ teamId: "B", amount: 15 }, { teamId: "A", amount: 16 }]);
});

test("proxy bids: three-way and no-op cases", () => {
  const r = resolveProxyBids({
    price: 5,
    leaderTeamId: "A",
    increment: 1,
    caps: [{ teamId: "B", cap: 20, priority: 0 }, { teamId: "C", cap: 18, priority: 1 }],
  });
  assert.equal(r.leaderTeamId, "B");
  assert.equal(r.price, 19);
  const none = resolveProxyBids({ price: 25, leaderTeamId: "A", increment: 1, caps: [{ teamId: "B", cap: 20, priority: 0 }] });
  assert.deepEqual(none, { price: 25, leaderTeamId: "A", bids: [] });
  const tie = resolveProxyBids({ price: 5, leaderTeamId: "A", increment: 1, caps: [{ teamId: "A", cap: 12, priority: 1 }, { teamId: "B", cap: 12, priority: 0 }] });
  assert.equal(tie.leaderTeamId, "B"); // equal ceilings: the earlier proxy wins
  assert.equal(tie.price, 12);
});

test("nominator rotation skips full teams and wraps", () => {
  const order = ["A", "B", "C"];
  assert.deepEqual(nextNominator(order, 0, () => true), { index: 0, teamId: "A" });
  assert.deepEqual(nextNominator(order, 4, () => true), { index: 4, teamId: "B" });
  assert.deepEqual(nextNominator(order, 1, (t) => t !== "B"), { index: 2, teamId: "C" });
  assert.equal(nextNominator(order, 0, () => false), null);
  assert.equal(lastIndexOfTeam(order, 5, "A"), 3);
  assert.equal(lastIndexOfTeam(order, 2, "B"), 1);
});

test("misc helpers", () => {
  assert.equal(clampYears(7, 1, 5), 5);
  assert.equal(clampYears(0, 1, 5), 1);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  const s = shuffle([1, 2, 3, 4, 5], seededRandom(3));
  assert.deepEqual([...s].sort(), [1, 2, 3, 4, 5]);
});

test("league timezone conversions", () => {
  // 7:30 PM EDT on May 2 2027 = 23:30 UTC
  assert.equal(zonedLocalToUtc("2027-05-02T19:30", "America/New_York")!.toISOString(), "2027-05-02T23:30:00.000Z");
  // winter (EST, UTC-5)
  assert.equal(zonedLocalToUtc("2027-01-10T12:00", "America/New_York")!.toISOString(), "2027-01-10T17:00:00.000Z");
  assert.equal(utcToZonedLocal(new Date("2027-05-02T23:30:00Z"), "America/New_York"), "2027-05-02T19:30");
  assert.equal(zonedLocalToUtc("garbage", "America/New_York"), null);
  assert.equal(fmtCountdown(65_000), "1:05");
  assert.equal(fmtCountdown(3_725_000), "1:02:05");
  assert.equal(fmtCountdown(2 * 86400_000 + 4 * 3600_000), "2d 4h");
  assert.equal(fmtCountdown(-5), "0:00");
});

test("bracket finish: bye teams are in the field, alive teams rank ahead, champion first, consolation winner", async () => {
  const { bracketFinish } = await import("@/lib/draft/bracket-finish");
  // 6-team bracket: seeds 1-2 have first-round byes (no round-1 game rows)
  const winners = ["S1", "S2", "S3", "S4", "S5", "S6"].map((teamId, i) => ({ teamId, seed: i + 1 }));
  const consolation = ["C1", "C2", "C3", "C4"].map((teamId, i) => ({ teamId, seed: i + 1 }));
  const g = (kind: "WINNERS" | "THIRD" | "CONSOLATION", round: number, slot: number, status: "FINAL" | "LIVE" | "UPCOMING", w: string | null, l: string | null) => ({ kind, round, slot, status, winnerTeamId: w, loserTeamId: l });
  // before any game: everyone alive, ordered by seed (byes included)
  let f = bracketFinish({ winners, consolation, reseed: false, games: [] });
  assert.deepEqual(f.order, ["S1", "S2", "S3", "S4", "S5", "S6"]);
  assert.equal(f.champion, null);
  // round 1: 4 beats 5, 6 upsets 3 → 3 and 5 out in round 1
  const r1 = [g("WINNERS", 1, 2, "FINAL", "S4", "S5"), g("WINNERS", 1, 4, "FINAL", "S6", "S3")];
  f = bracketFinish({ winners, consolation, reseed: false, games: r1 });
  assert.deepEqual(f.order, ["S1", "S2", "S4", "S6", "S3", "S5"]);
  // a multi-week semifinal still LIVE doesn't eliminate anyone
  const semis = [g("WINNERS", 2, 1, "FINAL", "S1", "S4"), g("WINNERS", 2, 2, "LIVE", null, null)];
  f = bracketFinish({ winners, consolation, reseed: false, games: [...r1, ...semis] });
  assert.deepEqual(f.order.slice(0, 3), ["S1", "S2", "S6"]);
  assert.equal(f.order[3], "S4");
  // final + third place game decided; consolation bracket won by C3
  const done = [
    ...r1,
    g("WINNERS", 2, 1, "FINAL", "S1", "S4"),
    g("WINNERS", 2, 2, "FINAL", "S6", "S2"),
    g("WINNERS", 3, 1, "FINAL", "S6", "S1"),
    g("THIRD", 1, 1, "FINAL", "S4", "S2"),
    g("CONSOLATION", 1, 1, "FINAL", "C1", "C4"),
    g("CONSOLATION", 1, 2, "FINAL", "C3", "C2"),
    g("CONSOLATION", 2, 1, "FINAL", "C3", "C1"),
  ];
  f = bracketFinish({ winners, consolation, reseed: false, games: done });
  assert.equal(f.champion, "S6");
  assert.deepEqual(f.order, ["S6", "S1", "S4", "S2", "S3", "S5"]);
  assert.equal(f.consolationWinner, "C3");
  // undecided consolation final → no winner yet
  assert.equal(bracketFinish({ winners, consolation, reseed: false, games: done.slice(0, -1) }).consolationWinner, null);
});

test("draft order: decided 5th / 7th place games order the teams knocked out before the semifinals", async () => {
  const { withPlacementResults } = await import("@/lib/draft/order");
  const { bracketFinish } = await import("@/lib/draft/bracket-finish");
  const { bracketGames } = await import("@/lib/playoffs/bracket");
  const { championshipStatusFrom } = await import("@/lib/playoffs/elimination");
  const ids = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
  const stored = {
    version: 1 as const,
    season: 2026,
    createdAt: "2026-12-15T00:00:00.000Z",
    winners: ids.map((teamId, i) => ({ teamId, seed: i + 1, displaySeed: i + 1 })),
    sides: [],
    thirdPlace: false,
    reseed: false,
    placementGames: ["FIFTH", "SEVENTH"] as ("FIFTH" | "SEVENTH")[],
  };
  let n = 0;
  const m = (round: number, slot: number, home: string, away: string, hs: number, as: number, status = "FINAL", consolation = false) => ({
    id: `m${++n}`, leagueId: "L", season: 2026, week: 14 + round, homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, homeProjected: 0, awayProjected: 0,
    homeWinProb: 0.5, status, winnerTeamId: null, isPlayoff: true, isConsolation: consolation, isChampionship: false, bracketRound: round, bracketSlot: slot,
    homeSeed: null, awaySeed: null, label: null, updatedAt: new Date(0),
  });
  // quarterfinals: 5 upsets 4 and 6 upsets 3 → the placement pool is S3, S4, S7, S8 (by seed)
  const qf = [m(1, 1, "S1", "S8", 120, 90), m(1, 2, "S4", "S5", 100, 110), m(1, 3, "S2", "S7", 130, 80), m(1, 4, "S3", "S6", 95, 105)];
  // placement semifinals (global round 2): S8 beats S3, S4 beats S7; then 5th: S8 over S4, 7th: S7 over S3
  const pSemis = [m(2, 401, "S3", "S8", 90, 100, "FINAL", true), m(2, 402, "S4", "S7", 110, 100, "FINAL", true)];
  const pFinals = [m(3, 401, "S4", "S8", 95, 99, "FINAL", true), m(3, 402, "S3", "S7", 70, 88, "FINAL", true)];
  const run = (rows: ReturnType<typeof m>[]) => {
    const games = bracketGames(rows, stored, 3);
    const f = bracketFinish({ winners: stored.winners, consolation: null, reseed: false, games });
    return { order: withPlacementResults(f.order, stored, games), raw: f.order, status: championshipStatusFrom(stored, games, ids) };
  };
  const partial = run([...qf, ...pSemis, pFinals[0]!]);
  assert.deepEqual(partial.order, partial.raw); // 7th place game not played yet: by seed
  assert.deepEqual(partial.raw.slice(4), ["S3", "S4", "S7", "S8"]);
  const done = run([...qf, ...pSemis, ...pFinals]);
  assert.deepEqual(done.order.slice(4), ["S8", "S4", "S7", "S3"]);
  assert.deepEqual(new Set(done.order.slice(0, 4)), new Set(["S1", "S2", "S5", "S6"]));
  // placement games don't revive anyone: the pool is out of the championship race, the QF winners are alive
  for (const id of ["S3", "S4", "S7", "S8"]) assert.equal(done.status.get(id)?.reason, "Lost in the quarterfinal");
  for (const id of ["S1", "S2", "S5", "S6"]) assert.equal(done.status.get(id)?.alive, true);
});
