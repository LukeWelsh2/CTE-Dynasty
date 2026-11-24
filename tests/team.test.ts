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
  capEnforced,
  capForSeason,
  consecutiveTagCount,
  contractCapCheck,
  contractOffers,
  contractTags,
  deadMoneyPreview,
  extensionEligibility,
  extensionSalary,
  extensionWindowCheck,
  franchiseTagContractYears,
  franchiseTagEligibility,
  franchiseTagSalary,
  lengthLimitProblem,
  maxExtensionYears,
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

test("extensions compound the raise and respect max years / years-added limits", () => {
  const anyTime = structuredClone(S);
  anyTime.contracts.extensionWindow = "ANY_TIME";
  const spot = { salary: 10, contractYears: 2, isRookieContract: false, isFranchiseTagged: false };
  const ctx = { phase: "REGULAR", extendedThisSeason: false };
  assert.equal(extensionSalary(10, 1, S), 12);
  assert.equal(extensionSalary(10, 2, S), 14);
  assert.equal(extensionEligibility(spot, anyTime, ctx).ok, true);
  assert.equal(extensionEligibility({ ...spot, contractYears: 5 }, anyTime, ctx).ok, false);
  assert.equal(extensionEligibility(spot, anyTime, { ...ctx, extendedThisSeason: true }).ok, false);
  // maxYears 5, extensionMaxYearsAdded 3 → a 2-year deal can add 3
  assert.equal(maxExtensionYears(spot, anyTime, "REGULAR"), 3);
  assert.equal(maxExtensionYears({ contractYears: 4 }, anyTime, "REGULAR"), 1);
  // offseason: the finished season no longer counts toward maxYears
  assert.equal(maxExtensionYears({ contractYears: 5 }, anyTime, "OFFSEASON"), 1);
  const off = structuredClone(anyTime);
  off.contracts.extensionsAllowed = false;
  assert.equal(extensionEligibility(spot, off, ctx).ok, false);
  const limited = structuredClone(anyTime);
  limited.contracts.extensionsPerTeamPerSeason = 1;
  assert.equal(extensionEligibility(spot, limited, { ...ctx, extensionsUsed: 1 }).ok, false);
  assert.equal(extensionEligibility(spot, limited, { ...ctx, extensionsUsed: 0 }).ok, true);
});

test("extension window: final-year offseason (default), any offseason, any time", () => {
  assert.equal(S.contracts.extensionWindow, "FINAL_YEAR_OFFSEASON");
  // in season: closed
  assert.equal(extensionWindowCheck({ contractYears: 1 }, S, "REGULAR").ok, false);
  // offseason before rollover: contract with 2 years (entering its final season) is extendable, 3 years is not
  assert.equal(extensionWindowCheck({ contractYears: 2 }, S, "OFFSEASON").ok, true);
  assert.equal(extensionWindowCheck({ contractYears: 3 }, S, "KEEPER").ok, false);
  // expired contracts (1 year in the offseason) go through keepers / franchise tag
  assert.equal(extensionWindowCheck({ contractYears: 1 }, S, "OFFSEASON").ok, false);
  // preseason (after rollover): final-year contracts
  assert.equal(extensionWindowCheck({ contractYears: 1 }, S, "PRESEASON").ok, true);
  const anyOff = structuredClone(S);
  anyOff.contracts.extensionWindow = "ANY_OFFSEASON";
  assert.equal(extensionWindowCheck({ contractYears: 3 }, anyOff, "PRESEASON").ok, true);
  assert.equal(extensionWindowCheck({ contractYears: 3 }, anyOff, "PLAYOFFS").ok, false);
});

test("contract length limits", () => {
  const s = structuredClone(S);
  s.contracts.lengthLimits = [{ years: 4, maxCount: 2 }];
  assert.equal(lengthLimitProblem(4, 2, [4, 5, 1], s) !== null, true); // already 2 deals of 4+
  assert.equal(lengthLimitProblem(4, 2, [4, 1, 1], s), null);
  assert.equal(lengthLimitProblem(3, 2, [4, 5], s), null); // stays under the threshold
  assert.equal(lengthLimitProblem(5, 4, [4, 5], s), null); // already counted
});

test("franchise tag: offseason only, expiring contracts, topN cost, repeat multiplier", () => {
  assert.equal(franchiseTagSalary(5, [40, 30, 20, 10, 10, 5, 1], S), 22);
  assert.equal(franchiseTagSalary(50, [40, 30, 20, 10, 10], S), 50); // never a pay cut
  const top3 = structuredClone(S);
  top3.contracts.franchiseTag.topN = 3;
  assert.equal(franchiseTagSalary(5, [40, 30, 20, 10, 10], top3), 30);
  // a second straight tag costs consecutiveMultiplier (1.2) more
  assert.equal(franchiseTagSalary(5, [40, 30, 20, 10, 10, 5, 1], S, 1), 27);
  const raise = structuredClone(S);
  raise.contracts.franchiseTag.costMethod = "RAISE_PERCENT";
  raise.contracts.franchiseTag.raisePercent = 25;
  assert.equal(franchiseTagSalary(20, [], raise), 25);
  const spot = { salary: 5, contractYears: 1, isRookieContract: false, isFranchiseTagged: false };
  const off = { phase: "OFFSEASON", tagsUsedThisSeason: 0 };
  assert.equal(franchiseTagEligibility(spot, S, off).ok, true);
  assert.equal(franchiseTagEligibility(spot, S, { ...off, phase: "REGULAR" }).ok, false);
  assert.equal(franchiseTagEligibility(spot, S, { ...off, tagsUsedThisSeason: 1 }).ok, false);
  assert.equal(franchiseTagEligibility({ ...spot, contractYears: 2 }, S, off).ok, false);
  assert.equal(franchiseTagEligibility(spot, S, { ...off, consecutive: 2 }).ok, false); // maxConsecutive 2
  const any = structuredClone(S);
  any.contracts.franchiseTag.eligibility = "ANY_PLAYER";
  assert.equal(franchiseTagEligibility({ ...spot, contractYears: 3 }, any, off).ok, true);
  assert.equal(consecutiveTagCount([2024, 2025], 2026), 2);
  assert.equal(consecutiveTagCount([2023, 2025], 2026), 1);
  assert.equal(consecutiveTagCount([2024], 2026), 0);
  assert.equal(franchiseTagContractYears(S), 2); // the finished season + 1 tag year
});

test("rookie option: offseason after the rookie deal, eligible rounds", () => {
  const spot = { salary: 6, contractYears: 1, isRookieContract: true, isFranchiseTagged: false };
  const off = { phase: "OFFSEASON", optionUsed: false };
  assert.equal(rookieOptionEligibility(spot, S, off).ok, true);
  assert.equal(rookieOptionEligibility(spot, S, { ...off, phase: "REGULAR" }).ok, false);
  assert.equal(rookieOptionEligibility({ ...spot, contractYears: 2 }, S, off).ok, false);
  assert.equal(rookieOptionEligibility(spot, S, { ...off, optionUsed: true }).ok, false);
  assert.equal(rookieOptionEligibility({ ...spot, isRookieContract: false }, S, off).ok, false);
  assert.equal(rookieOptionEligibility(spot, S, { ...off, draftRound: 1 }).ok, true);
  assert.equal(rookieOptionEligibility(spot, S, { ...off, draftRound: 2 }).ok, false); // rookieOptionRounds [1]
  assert.equal(rookieOptionSalary(6, S), 9);
});

test("contract cap checks: current season in season, next season in the offseason, soft cap", () => {
  const roster = [
    { playerId: "a", salary: 100, contractYears: 2, status: "ACTIVE" },
    { playerId: "b", salary: 150, contractYears: 1, status: "ACTIVE" },
    { playerId: "c", salary: 40, contractYears: 3, status: "ACTIVE" },
  ];
  // in season: a 100 → 120 adds 20 to this season's 290 (+ 5 dead) = 315 > 300 cap → blocked
  const now = contractCapCheck({ settings: S, phase: "REGULAR", season: 2026, roster, playerId: "a", newSalary: 120, newYears: 3, dead: [5, 0] });
  assert.equal(now.season, 2026);
  assert.equal(now.committedAfter, 315);
  assert.equal(now.blocked, true);
  // offseason: b's deal has expired, next season = a + c = 140 → tag b at 150 for one more year = 290 → fits
  const next = contractCapCheck({ settings: S, phase: "OFFSEASON", season: 2026, roster, playerId: "b", newSalary: 150, newYears: 2, dead: [0, 0] });
  assert.equal(next.season, 2027);
  assert.equal(next.committedBefore, 140);
  assert.equal(next.committedAfter, 290);
  assert.equal(next.blocked, false);
  // soft cap with $20 overage allows 315
  const soft = structuredClone(S);
  soft.salaryCap.capType = "SOFT";
  soft.salaryCap.softCapMaxOverage = 20;
  const softMove = contractCapCheck({ settings: soft, phase: "REGULAR", season: 2026, roster, playerId: "a", newSalary: 120, newYears: 3, dead: [5, 0] });
  assert.equal(softMove.blocked, false);
  // the space shown is measured against the enforced ceiling ($320), so an allowed move never reads negative
  assert.equal(softMove.spaceAfter, 5);
  assert.equal(now.spaceAfter, -15, "hard cap: $15 over the $300 cap");
  const softOver = contractCapCheck({ settings: soft, phase: "REGULAR", season: 2026, roster, playerId: "a", newSalary: 130, newYears: 3, dead: [5, 0] });
  assert.deepEqual([softOver.blocked, softOver.spaceAfter], [true, -5]);
  // a cap that only warns (offseason WARN_ONLY) has no enforced ceiling: space against the league cap
  const softWarn = structuredClone(soft);
  softWarn.salaryCap.offseasonEnforcement = "WARN_ONLY";
  const warned = contractCapCheck({ settings: softWarn, phase: "PRESEASON", season: 2026, roster, playerId: "a", newSalary: 120, newYears: 3, dead: [5, 0] });
  assert.deepEqual([warned.blocked, warned.spaceAfter], [false, -15]);
  // warn-only offseason enforcement never blocks
  const warn = structuredClone(S);
  warn.salaryCap.offseasonEnforcement = "WARN_ONLY";
  assert.equal(capEnforced(warn, "OFFSEASON"), false);
  assert.equal(capEnforced(warn, "REGULAR"), S.salaryCap.enforceInSeason);
});

test("contractOffers bundles extension / tag / option with cap effects", () => {
  const s = structuredClone(S);
  s.contracts.extensionWindow = "ANY_TIME";
  // offseason cap is a warning until a (missing) compliance date — the default (BLOCK) is checked at the end
  s.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
  const roster = [
    { playerId: "x", salary: 10, contractYears: 1, status: "ACTIVE", isRookieContract: true },
    { playerId: "y", salary: 280, contractYears: 3, status: "ACTIVE" },
  ];
  const base = {
    settings: s,
    phase: "REGULAR",
    season: 2026,
    spot: { ...roster[0], isFranchiseTagged: false, isRookieContract: true },
    roster,
    dead: [0, 0] as [number, number],
    positionSalaries: [40, 30, 20, 10, 10],
    extendedThisSeason: false,
    extensionsUsed: 0,
    tagsUsedThisSeason: 0,
    tagSeasons: [],
    optionUsed: false,
    draftRound: 1,
  };
  const inSeason = contractOffers(base);
  assert.equal(inSeason.capSeason, 2026);
  assert.equal(inSeason.extension?.options.length, 3);
  // 290 committed: +1 yr → $12 → 292 fits; +3 yrs → $18 → 298 fits
  assert.equal(inSeason.extension?.ok, true);
  assert.equal(inSeason.tag?.ok, false); // in season
  assert.equal(inSeason.option?.ok, false);
  const offseason = contractOffers({ ...base, phase: "OFFSEASON" });
  assert.equal(offseason.capSeason, 2027);
  assert.equal(offseason.tag?.ok, true);
  assert.equal(offseason.tag?.salary, 22);
  assert.equal(offseason.option?.ok, true);
  assert.equal(offseason.option?.contractYears, 2);
  assert.equal(offseason.option?.spaceAfter, 300 - 280 - 15);
  assert.equal(offseason.extension?.ok, false); // expired contract
  // default offseasonEnforcement (BLOCK_OVER_CAP_MOVES): the $22 tag no longer fits under next season's cap
  const strict = structuredClone(s);
  strict.salaryCap.offseasonEnforcement = "BLOCK_OVER_CAP_MOVES";
  assert.equal(contractOffers({ ...base, settings: strict, phase: "OFFSEASON" }).tag?.ok, false);
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

test("roster move rules: taxi sources, return after promotion, IR minimum weeks, healthy IR players", async () => {
  const { rosterMoveCheck, effectiveRosterSettings, lineupWeekState, lockClock, canStartStatus, taxiSourceFor } = await import("@/lib/team/roster-rules");
  const s = structuredClone(S);
  s.roster.taxiDeadlineWeek = null;
  const pl = (name: string, extra: Record<string, unknown> = {}) => ({ position: "WR", injuryStatus: null, status: "Active", yearsExp: 0, fullName: name, ...extra });
  const rookie = { playerId: "r1", status: "ACTIVE", salary: 2, player: pl("Rookie One") };
  const hurt = { playerId: "h1", status: "IR", salary: 5, player: pl("Hurt Guy", { injuryStatus: "IR" }) };
  const healed = { playerId: "h2", status: "IR", salary: 5, player: pl("Healed Guy", { injuryStatus: null }) };
  const roster = [rookie, hurt];
  const m = { settings: s, phase: "REGULAR", week: 5, lockedStarter: false, gameLive: false, taxiDeadlineKickedOff: false, deadMoney: 0 };
  assert.equal(taxiSourceFor("WAIVER"), "WAIVERS");
  // default taxiAddSources = rookie draft + trade
  assert.equal(rosterMoveCheck("TAXI", rookie, roster, { ...m, acquiredVia: "ROOKIE_DRAFT" }).ok, true);
  assert.equal(rosterMoveCheck("TAXI", rookie, roster, { ...m, acquiredVia: "WAIVER" }).ok, false);
  assert.equal(rosterMoveCheck("TAXI", rookie, roster, { ...m, acquiredVia: "ROOKIE_DRAFT", promotedBefore: true }).ok, false);
  // IR minimum stay
  const minIr = structuredClone(s);
  minIr.roster.irMinWeeks = 2;
  assert.equal(rosterMoveCheck("ACTIVATE", hurt, roster, { ...m, settings: minIr, weeksOnIr: 1 }).ok, false);
  assert.equal(rosterMoveCheck("ACTIVATE", hurt, roster, { ...m, settings: minIr, weeksOnIr: 2 }).ok, true);
  // healthy player stuck on IR blocks other IR / taxi moves under BLOCK_MOVES
  const blocked = rosterMoveCheck("TAXI", rookie, [rookie, healed], { ...m, acquiredVia: "ROOKIE_DRAFT", healthyOnIr: ["Healed Guy"] });
  assert.equal(blocked.ok, false);
  assert.equal(rosterMoveCheck("ACTIVATE", healed, [rookie, healed], { ...m, healthyOnIr: ["Healed Guy"] }).ok, true);
  // offseason roster limit before the cutdown date
  const big = structuredClone(s);
  big.roster.offseasonMaxActiveRoster = 35;
  assert.equal(effectiveRosterSettings(big, "OFFSEASON").roster.maxActiveRoster, 35);
  assert.equal(effectiveRosterSettings(big, "REGULAR").roster.maxActiveRoster, s.roster.maxActiveRoster);
  big.roster.rosterCutdownDate = "2020-01-01T00:00:00Z";
  assert.equal(effectiveRosterSettings(big, "OFFSEASON").roster.maxActiveRoster, s.roster.maxActiveRoster);
  // eliminated teams (no game in the current playoff week)
  const po = structuredClone(s);
  po.lineup.eliminatedTeamsSetLineups = false;
  assert.equal(lineupWeekState(po, "PLAYOFFS", po.playoffs.startWeek, po.playoffs.startWeek, { hasMatchup: false }).editable, false);
  assert.equal(lineupWeekState(po, "PLAYOFFS", po.playoffs.startWeek, po.playoffs.startWeek, { hasMatchup: true }).editable, true);
  assert.equal(lineupWeekState(po, "REGULAR", 5, 5, { hasMatchup: false }).editable, true);
  // lock offset + taxi starters
  const lo = structuredClone(s);
  lo.lineup.lockOffsetMinutes = 10;
  const t0 = new Date("2026-11-22T17:00:00Z");
  // the offset is applied by the foundation isLocked(); lockClock is plain "now"
  assert.equal(lockClock(lo, t0).getTime(), t0.getTime());
  const { isLocked } = await import("@/lib/lineup");
  const g = { homeTeam: "KC", awayTeam: "BUF", startTime: new Date("2026-11-22T17:05:00Z"), state: "pre" } as unknown as import("@prisma/client").NflGame;
  const games = new Map([["KC", g], ["BUF", g]]);
  assert.equal(isLocked("KC", games, s, t0), false); // 5 min before kickoff, no offset
  assert.equal(isLocked("KC", games, lo, t0), true); // 10 min offset -> already locked
  assert.equal(canStartStatus("TAXI", s), false);
  const ts = structuredClone(s);
  ts.roster.taxiPlayersCanStart = true;
  assert.equal(canStartStatus("TAXI", ts), true);
  assert.equal(canStartStatus("IR", ts), false);
});

test("taxi starters and empty-slot rules in the lineup model", async () => {
  const { fillableEmptySlots, canStart } = await import("@/lib/team/lineup-model");
  const players = baseRoster();
  players.set("tx1", player("tx1", "WR", { rosterStatus: "TAXI", projected: 30 }));
  assert.equal(canStart(players.get("tx1")!), false);
  assert.equal(moveTargets(baseAssign(), slots, players, "tx1").slots.size, 0);
  players.set("tx1", player("tx1", "WR", { rosterStatus: "TAXI", startable: true, projected: 30 }));
  assert.equal(moveTargets(baseAssign(), slots, players, "tx1").slots.has("WR#0"), true);
  const a = { ...baseAssign(), "K#0": null };
  assert.deepEqual(fillableEmptySlots(a, slots, players).map((s) => s.key), ["K"]); // the benched kicker can fill it
  const noKicker = new Map(players);
  noKicker.delete("k1");
  assert.deepEqual(fillableEmptySlots(a, slots, noKicker).map((s) => s.key), []); // nobody eligible → empty is fine
  const b = { ...baseAssign(), "WR#2": null };
  assert.deepEqual(fillableEmptySlots(b, slots, players).map((s) => s.key), ["WR"]);
});

test("contracts and roster moves share the league cap rule: capEnforcement per phase, capLimit ceiling, WARN warns", async () => {
  const { capEnforcement } = await import("@/lib/roster-rules");
  const { rosterMoveCheck, effectiveRosterSettings } = await import("@/lib/team/roster-rules");
  const s = structuredClone(S);
  s.salaryCap.enabled = true;
  s.salaryCap.enforceInSeason = true;
  // capEnforced is the shared rule, for every phase and offseason mode
  for (const mode of ["BLOCK_OVER_CAP_MOVES", "WARN_ONLY", "ALLOW_UNTIL_COMPLIANCE_DATE"] as const) {
    s.salaryCap.offseasonEnforcement = mode;
    for (const phase of ["PRESEASON", "REGULAR", "PLAYOFFS", "OFFSEASON", "KEEPER"]) assert.equal(capEnforced(s, phase), capEnforcement(s, phase) === "BLOCK", `${mode} ${phase}`);
  }
  // WARN: the contract change is allowed and says why it's over
  s.salaryCap.offseasonEnforcement = "WARN_ONLY";
  const cap = s.salaryCap.cap;
  const roster = [{ playerId: "a", salary: cap, contractYears: 3, status: "ACTIVE" }];
  const warn = contractCapCheck({ settings: s, phase: "PRESEASON", season: 2026, roster, playerId: "a", newSalary: cap + 15, newYears: 4, dead: [0, 0] });
  assert.equal(warn.blocked, false);
  assert.equal(warn.reason, null);
  assert.equal(warn.warning, `That would put your 2026 payroll at $${cap + 15}, over the $${cap} cap. The cap is only a warning in the offseason.`);
  const blocked = contractCapCheck({ settings: s, phase: "REGULAR", season: 2026, roster, playerId: "a", newSalary: cap + 15, newYears: 4, dead: [0, 0] });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.warning, null);
  // contract offers carry the warning instead of a block
  s.contracts.extensionsAllowed = true;
  s.contracts.extensionWindow = "ANY_TIME";
  s.contracts.extensionRaisePercent = 10;
  const offers = contractOffers({
    settings: s,
    phase: "PRESEASON",
    season: 2026,
    roster,
    spot: { playerId: "a", salary: cap, contractYears: 3, isRookieContract: false, isFranchiseTagged: false, status: "ACTIVE" },
    dead: [0, 0],
    positionSalaries: [],
    extendedThisSeason: false,
    extensionsUsed: 0,
    tagsUsedThisSeason: 0,
    tagSeasons: [],
    optionUsed: false,
    draftRound: null,
  });
  const ext = offers.extension?.options[0];
  assert.ok(ext, "an extension is offered");
  assert.equal(ext.blocked, null);
  assert.match(ext.warning ?? "", /over the \$\d+ cap\. The cap is only a warning in the offseason\./);
  // roster moves: promoting a taxi player whose salary doesn't count yet adds salary → blocked / warned by phase
  s.roster.taxiCountsAgainstCap = false;
  s.roster.taxiCapPercent = 0;
  s.roster.taxiPromotionAllowedInSeason = true;
  const pl = (name: string) => ({ position: "WR", injuryStatus: null, status: "Active", yearsExp: 1, fullName: name });
  const vet = { playerId: "v", status: "ACTIVE", salary: cap - 5, player: pl("Vet") };
  const kid = { playerId: "k", status: "TAXI", salary: 20, player: pl("Kid") };
  const m = { settings: s, week: 3, lockedStarter: false, gameLive: false, taxiDeadlineKickedOff: false, deadMoney: 0 };
  const inSeason = rosterMoveCheck("PROMOTE", kid, [vet, kid], { ...m, phase: "REGULAR" });
  assert.equal(inSeason.ok, false);
  assert.match(inSeason.ok ? "" : inSeason.reason, /over the \$\d+ cap/);
  const offseason = rosterMoveCheck("PROMOTE", kid, [vet, kid], { ...m, phase: "OFFSEASON" });
  assert.equal(offseason.ok, true);
  assert.match(offseason.ok ? offseason.warning ?? "" : "", /The cap is only a warning in the offseason/);
  // effectiveRosterSettings is the shared activeRosterLimit (date-only cutdowns end with the day in league time)
  const big = structuredClone(S);
  big.general.timezone = "America/New_York";
  big.roster.offseasonMaxActiveRoster = 35;
  big.roster.rosterCutdownDate = "2027-08-30";
  assert.equal(effectiveRosterSettings(big, "OFFSEASON", new Date("2027-08-31T03:00:00Z")).roster.maxActiveRoster, 35);
  assert.equal(effectiveRosterSettings(big, "OFFSEASON", new Date("2027-08-31T04:00:00Z")).roster.maxActiveRoster, S.roster.maxActiveRoster);
  big.roster.rosterCutdownDate = "2027-08-30T16:00:00.000Z";
  assert.equal(effectiveRosterSettings(big, "KEEPER", new Date("2027-08-30T15:00:00Z")).roster.maxActiveRoster, 35);
  assert.equal(effectiveRosterSettings(big, "KEEPER", new Date("2027-08-30T16:00:00Z")).roster.maxActiveRoster, S.roster.maxActiveRoster);
});

test("fmtMoney: whole dollars with the sign in front (negative cap space reads -$5, never $-5)", async () => {
  const { fmtMoney } = await import("@/lib/utils");
  assert.equal(fmtMoney(5), "$5");
  assert.equal(fmtMoney(-5), "-$5");
  assert.equal(fmtMoney(-22.4), "-$22");
  assert.equal(fmtMoney(1250), "$1,250");
  assert.equal(fmtMoney(-1250.6), "-$1,251");
  assert.equal(fmtMoney(-0.4), "$0", "rounds to zero: no minus sign");
  assert.equal(fmtMoney(0), "$0");
  assert.equal(fmtMoney(null), "—");
  assert.equal(fmtMoney(undefined), "—");
  assert.equal(fmtMoney(Number.NaN), "—");
});
