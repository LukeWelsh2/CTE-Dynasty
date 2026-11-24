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
} from "@/lib/draft/logic";
import { fmtCountdown, utcToZonedLocal, zonedLocalToUtc } from "@/lib/draft/time";
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

test("reverse PF and reverse potential points", () => {
  const pf = composeRookieOrder({ teams, method: "REVERSE_MAX_PF", playoffTeamsByFinish: true, lotteryTeams: 3 });
  assert.deepEqual(pf.slice(0, 3).map((s) => s.teamId), ["T5", "T6", "T4"]);
  const pp = composeRookieOrder({ teams, method: "REVERSE_POTENTIAL_POINTS", playoffTeamsByFinish: false, lotteryTeams: 3 });
  assert.deepEqual(pp.map((s) => s.teamId), ["T6", "T3", "T4", "T5", "T2", "T1"]);
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
