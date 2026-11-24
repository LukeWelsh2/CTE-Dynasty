import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import {
  applyFix,
  applyMove,
  changedSlotCount,
  lineupIssues,
  moveTargets,
  slotId,
  toAssignment,
  toList,
  type LineupPlayerInfo,
} from "@/lib/team/lineup-model";
import {
  capForSeason,
  contractTags,
  deadMoneyPreview,
  extensionEligibility,
  extensionSalary,
  franchiseTagEligibility,
  franchiseTagSalary,
  rookieOptionEligibility,
  rookieOptionSalary,
  taxiPromotionOpen,
  taxiWindowOpen,
} from "@/lib/team/contracts";
import { pickTier, projectedPickOrder, rookieScaleSalary } from "@/lib/team/picks";
import { byeWeeksByTeam, countdown, gameLine } from "@/lib/team/format";

const S: LeagueSettings = structuredClone(DEFAULT_SETTINGS);
const slots = expandSlots(S);

function player(id: string, pos: string, extra: Partial<LineupPlayerInfo> = {}): LineupPlayerInfo {
  return { id, name: id, pos, rosterStatus: "ACTIVE", locked: false, onBye: false, injuryStatus: null, projected: 10, ...extra };
}

function baseRoster() {
  const list = [
    player("qb1", "QB", { projected: 22 }),
    player("qb2", "QB", { projected: 18 }),
    player("rb1", "RB", { projected: 15 }),
    player("rb2", "RB", { projected: 12 }),
    player("rb3", "RB", { projected: 9 }),
    player("wr1", "WR", { projected: 16 }),
    player("wr2", "WR", { projected: 14 }),
    player("wr3", "WR", { projected: 11 }),
    player("wr4", "WR", { projected: 8 }),
    player("te1", "TE", { projected: 9 }),
    player("k1", "K", { projected: 8 }),
    player("def1", "DEF", { projected: 7 }),
  ];
  return new Map(list.map((p) => [p.id, p]));
}

function baseAssign() {
  return toAssignment(
    [
      { slot: "QB", slotIndex: 0, playerId: "qb1" },
      { slot: "RB", slotIndex: 0, playerId: "rb1" },
      { slot: "RB", slotIndex: 1, playerId: "rb2" },
      { slot: "WR", slotIndex: 0, playerId: "wr1" },
      { slot: "WR", slotIndex: 1, playerId: "wr2" },
      { slot: "WR", slotIndex: 2, playerId: "wr3" },
      { slot: "TE", slotIndex: 0, playerId: "te1" },
      { slot: "FLEX", slotIndex: 0, playerId: "rb3" },
      { slot: "SFLEX", slotIndex: 0, playerId: "qb2" },
      { slot: "K", slotIndex: 0, playerId: "k1" },
      { slot: "DEF", slotIndex: 0, playerId: "def1" },
    ],
    slots,
  );
}

test("toAssignment/toList round-trip keeps settings slot order", () => {
  const a = baseAssign();
  const list = toList(a, slots);
  assert.equal(list.length, slots.length);
  assert.deepEqual(list.map((l) => l.slot), slots.map((s) => s.key));
  assert.equal(list.find((l) => l.slot === "FLEX")?.playerId, "rb3");
});

test("moveTargets: bench WR can go to WR, FLEX and SFLEX slots only", () => {
  const players = baseRoster();
  const t = moveTargets(baseAssign(), slots, players, "wr4");
  assert.deepEqual([...t.slots].sort(), ["FLEX#0", "SFLEX#0", "WR#0", "WR#1", "WR#2"]);
  assert.equal(t.bench, false);
});

test("moveTargets: starters can go to the bench and swap with eligible bench players", () => {
  const players = baseRoster();
  const t = moveTargets(baseAssign(), slots, players, "wr3");
  assert.equal(t.bench, true);
  assert.ok(t.players.has("wr4"));
  assert.ok(!t.players.has("qb1"));
});

test("moveTargets: locked slots and locked players are excluded", () => {
  const players = baseRoster();
  players.get("wr1")!.locked = true;
  const t = moveTargets(baseAssign(), slots, players, "wr4");
  assert.ok(!t.slots.has("WR#0"));
  const none = moveTargets(baseAssign(), slots, players, "wr1");
  assert.equal(none.slots.size + none.players.size, 0);
  assert.equal(none.bench, false);
});

test("applyMove swaps starters when the occupant is eligible, else benches it", () => {
  const players = baseRoster();
  const a = baseAssign();
  // RB in FLEX -> RB#0: rb1 is eligible for FLEX so they swap
  const swapped = applyMove(a, slots, players, "rb3", { kind: "slot", slot: "RB#0" });
  assert.equal(swapped["RB#0"], "rb3");
  assert.equal(swapped["FLEX#0"], "rb1");
  // QB2 (SFLEX) -> WR? not eligible; move WR3 into SFLEX: qb2 can't play WR so it goes to the bench
  const s2 = applyMove(a, slots, players, "wr3", { kind: "slot", slot: "SFLEX#0" });
  assert.equal(s2["SFLEX#0"], "wr3");
  assert.equal(s2["WR#2"], null);
  // bench player into occupied slot: occupant to bench
  const s3 = applyMove(a, slots, players, "wr4", { kind: "slot", slot: "WR#1" });
  assert.equal(s3["WR#1"], "wr4");
  assert.equal(Object.values(s3).includes("wr2"), false);
  // starter to bench
  const s4 = applyMove(a, slots, players, "k1", { kind: "bench" });
  assert.equal(s4["K#0"], null);
  // swap with bench player
  const s5 = applyMove(a, slots, players, "wr3", { kind: "player", playerId: "wr4" });
  assert.equal(s5["WR#2"], "wr4");
  assert.equal(changedSlotCount(a, s5), 1);
  // original not mutated
  assert.equal(a["WR#2"], "wr3");
});

test("lineupIssues flags injured, bye and empty slots with healthy fixes", () => {
  const players = baseRoster();
  players.get("wr1")!.injuryStatus = "Out";
  players.get("te1")!.onBye = true;
  players.get("wr4")!.projected = 12;
  const a = { ...baseAssign(), "K#0": null };
  const issues = lineupIssues(a, slots, players);
  const byKind = Object.fromEntries(issues.map((i) => [i.kind + ":" + i.slot, i]));
  assert.equal(byKind["injury:WR#0"].fix?.playerId, "wr4");
  assert.equal(byKind["bye:TE#0"].fix, null); // no other TE
  assert.equal(byKind["empty:K#0"].fix?.playerId, "k1"); // benched kicker goes back in
  const fixed = applyFix(a, "WR#0", "wr4");
  assert.equal(fixed["WR#0"], "wr4");
});

test("lineupIssues skips locked starters and doesn't suggest the same fix twice", () => {
  const players = baseRoster();
  players.get("wr1")!.injuryStatus = "IR";
  players.get("wr2")!.injuryStatus = "Out";
  players.get("wr3")!.injuryStatus = "Out";
  players.get("wr3")!.locked = true;
  const issues = lineupIssues(baseAssign(), slots, players);
  assert.equal(issues.filter((i) => i.slot === "WR#2").length, 0);
  const fixes = issues.map((i) => i.fix?.playerId).filter(Boolean);
  assert.equal(new Set(fixes).size, fixes.length);
});

test("deadMoneyPreview mirrors league dead-money rules", () => {
  const dm = deadMoneyPreview({ salary: 20, contractYears: 3, isRookieContract: false }, S, 2026, 5);
  assert.deepEqual(dm, [
    { season: 2026, amount: 10 },
    { season: 2027, amount: 5 },
    { season: 2028, amount: 5 },
  ]);
  assert.deepEqual(deadMoneyPreview({ salary: 1, contractYears: 3, isRookieContract: false }, S, 2026, 5), []);
  const exempt = structuredClone(S);
  exempt.salaryCap.deadMoney.rookieContractsExempt = true;
  assert.deepEqual(deadMoneyPreview({ salary: 8, contractYears: 3, isRookieContract: true }, exempt, 2026, 5), []);
  const early = structuredClone(S);
  early.salaryCap.deadMoney.waivedInSeasonBeforeWeek = 3;
  assert.deepEqual(deadMoneyPreview({ salary: 8, contractYears: 1, isRookieContract: false }, early, 2026, 2), []);
});

test("extensions compound the raise and respect max years", () => {
  const spot = { salary: 10, contractYears: 2, isRookieContract: false, isFranchiseTagged: false };
  assert.equal(extensionSalary(10, 1, S), 12);
  assert.equal(extensionSalary(10, 2, S), 14);
  assert.equal(extensionEligibility(spot, S, { extendedThisSeason: false }).ok, true);
  assert.equal(extensionEligibility({ ...spot, contractYears: 5 }, S, { extendedThisSeason: false }).ok, false);
  assert.equal(extensionEligibility(spot, S, { extendedThisSeason: true }).ok, false);
  const off = structuredClone(S);
  off.contracts.extensionsAllowed = false;
  assert.equal(extensionEligibility(spot, off, { extendedThisSeason: false }).ok, false);
});

test("franchise tag cost: top-5 average at position or raise percent", () => {
  assert.equal(franchiseTagSalary(5, [40, 30, 20, 10, 10, 5, 1], S), 22);
  assert.equal(franchiseTagSalary(50, [40, 30, 20, 10, 10], S), 50); // never a pay cut
  const raise = structuredClone(S);
  raise.contracts.franchiseTag.costMethod = "RAISE_PERCENT";
  raise.contracts.franchiseTag.raisePercent = 25;
  assert.equal(franchiseTagSalary(20, [], raise), 25);
  const spot = { salary: 5, contractYears: 1, isRookieContract: false, isFranchiseTagged: false };
  assert.equal(franchiseTagEligibility(spot, S, { tagsUsedThisSeason: 0 }).ok, true);
  assert.equal(franchiseTagEligibility(spot, S, { tagsUsedThisSeason: 1 }).ok, false);
  assert.equal(franchiseTagEligibility({ ...spot, contractYears: 2 }, S, { tagsUsedThisSeason: 0 }).ok, false);
});

test("rookie option eligibility + salary", () => {
  const spot = { salary: 6, contractYears: 1, isRookieContract: true, isFranchiseTagged: false };
  assert.equal(rookieOptionEligibility(spot, S, { optionUsed: false }).ok, true);
  assert.equal(rookieOptionEligibility(spot, S, { optionUsed: true }).ok, false);
  assert.equal(rookieOptionEligibility({ ...spot, isRookieContract: false }, S, { optionUsed: false }).ok, false);
  assert.equal(rookieOptionSalary(6, S), 9);
});

test("taxi window and promotion rules", () => {
  assert.equal(taxiWindowOpen(S, "PRESEASON", 1, false), true);
  assert.equal(taxiWindowOpen(S, "REGULAR", 1, false), true);
  assert.equal(taxiWindowOpen(S, "REGULAR", 1, true), false);
  assert.equal(taxiWindowOpen(S, "REGULAR", 5, false), false);
  const none = structuredClone(S);
  none.roster.taxiDeadlineWeek = null;
  assert.equal(taxiWindowOpen(none, "REGULAR", 9, true), true);
  assert.equal(taxiPromotionOpen(S, "REGULAR"), true);
  const noPromo = structuredClone(S);
  noPromo.roster.taxiPromotionAllowedInSeason = false;
  assert.equal(taxiPromotionOpen(noPromo, "REGULAR"), false);
  assert.equal(taxiPromotionOpen(noPromo, "OFFSEASON"), true);
});

test("contract tags and cap growth", () => {
  assert.deepEqual(contractTags({ contractYears: 1, isRookieContract: true, isFranchiseTagged: false }), ["ROOKIE", "EXPIRING"]);
  const grow = structuredClone(S);
  grow.salaryCap.annualCapIncrease = 10;
  assert.equal(capForSeason(grow, 2), grow.salaryCap.cap + 20);
});

test("projected pick order and tiers", () => {
  const order = projectedPickOrder(
    [
      { teamId: "a", rank: 1, pointsFor: 900 },
      { teamId: "b", rank: 2, pointsFor: 1000 },
      { teamId: "c", rank: 3, pointsFor: 800 },
    ],
    "REVERSE_STANDINGS",
  );
  assert.deepEqual(order, ["c", "b", "a"]);
  assert.deepEqual(projectedPickOrder([{ teamId: "a", rank: 1, pointsFor: 900 }, { teamId: "b", rank: 2, pointsFor: 1000 }], "REVERSE_MAX_PF"), ["a", "b"]);
  assert.equal(pickTier(1, 2, 12), "Early 1st");
  assert.equal(pickTier(1, 6, 12), "Mid 1st");
  assert.equal(pickTier(2, 12, 12), "Late 2nd");
  assert.equal(pickTier(1, null, 12), "1st round");
  assert.equal(rookieScaleSalary(S, 1, 1), 10);
  assert.equal(rookieScaleSalary(S, 2, 12), 1);
});

test("gameLine formats pre, live and final games from the team's side", () => {
  const g = { homeTeam: "KC", awayTeam: "BUF", startTime: new Date("2026-11-22T18:00:00Z"), state: "pre", homeScore: 0, awayScore: 0 };
  const pre = gameLine(g, "BUF", "America/New_York");
  assert.equal(pre.opp, "@KC");
  assert.equal(pre.status, "Sun 1:00 PM");
  const live = gameLine({ ...g, state: "in", period: 3, clock: "7:04", homeScore: 14, awayScore: 10 }, "KC", "America/New_York");
  assert.equal(live.opp, "vs BUF");
  assert.equal(live.status, "Q3 7:04");
  assert.equal(live.score, "14-10");
  const fin = gameLine({ ...g, state: "post", homeScore: 17, awayScore: 24 }, "KC", "America/New_York");
  assert.equal(fin.score, "L 17-24");
  assert.equal(gameLine(undefined, "KC", "America/New_York").opp, "BYE");
});

test("byeWeeksByTeam finds weeks without a game", () => {
  const byes = byeWeeksByTeam([
    { week: 1, homeTeam: "KC", awayTeam: "BUF" },
    { week: 2, homeTeam: "KC", awayTeam: "DEN" },
    { week: 3, homeTeam: "BUF", awayTeam: "DEN" },
  ]);
  assert.deepEqual(byes.get("KC"), [3]);
  assert.deepEqual(byes.get("BUF"), [2]);
  assert.deepEqual(byes.get("DEN"), [1]);
});

test("countdown", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  assert.equal(countdown(new Date("2026-11-22T12:45:00Z"), now), "45m");
  assert.equal(countdown(new Date("2026-11-22T14:15:00Z"), now), "2h 15m");
  assert.equal(countdown(new Date("2026-11-21T14:15:00Z"), now), null);
  assert.equal(slotId("FLEX", 0), "FLEX#0");
});

test("keepCurrentWhereEmpty keeps an unreplaceable starter instead of an empty slot", async () => {
  const { keepCurrentWhereEmpty } = await import("@/lib/team/lineup-model");
  const cur = baseAssign();
  const opt = { ...cur, "DEF#0": null, "WR#2": "wr4" };
  const kept = keepCurrentWhereEmpty(opt, cur);
  assert.equal(kept["DEF#0"], "def1");
  assert.equal(kept["WR#2"], "wr4");
  // a current player already used elsewhere in the optimal lineup isn't duplicated
  const opt2 = { ...cur, "FLEX#0": "wr3", "WR#2": null };
  assert.equal(keepCurrentWhereEmpty(opt2, cur)["WR#2"], null);
});

test("alignToCurrent keeps the optimal starters but minimizes slot changes", async () => {
  const { alignToCurrent } = await import("@/lib/team/lineup-model");
  const players = baseRoster();
  const positions = new Map([...players.values()].map((p) => [p.id, p.pos]));
  const cur = baseAssign();
  // optimizer output: same idea (wr4 in for wr3) but it also shuffled RBs between RB and FLEX
  const shuffled = { ...cur, "RB#0": "rb3", "FLEX#0": "rb1", "WR#2": "wr4" };
  const aligned = alignToCurrent(shuffled, cur, slots, positions);
  assert.equal(changedSlotCount(aligned, cur), 1);
  assert.equal(aligned["WR#2"], "wr4");
  assert.equal(aligned["RB#0"], "rb1");
  // starters needing re-routing still land legally (rb4 replaces wr3: wr3's WR slot can't take an RB)
  const opt2 = { ...cur, "WR#2": null, "FLEX#0": "rb4", "RB#1": "rb3" } as typeof cur;
  const a2 = alignToCurrent({ ...opt2, "WR#2": "wr4" }, cur, slots, positions);
  assert.deepEqual(new Set(Object.values(a2)), new Set(Object.values({ ...opt2, "WR#2": "wr4" })));
});
