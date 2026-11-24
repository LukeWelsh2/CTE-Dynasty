import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import {
  assetKey,
  canVoteOnTrade,
  checkTrade,
  duesPaidForPicks,
  playerCountProblems,
  retainedAmount,
  retentionDeadMoney,
  retentionMax,
  reviewHours,
  reviewRoute,
  salaryNextSeason,
  dropDeadMoney,
  faabTradingAllowed,
  listJoin,
  maxTeams,
  pickAssetLabel,
  pointsSinceTrade,
  spotCapHit,
  tradablePickSeasons,
  tradeHasStaleAssets,
  tradeLockProblems,
  tradeSummaryFor,
  tradeWindow,
  voteTally,
  type CheckOptions,
  type SpotLite,
  type TradeSnapshot,
} from "@/lib/trades/rules";
import { contractText, signed, timeLeft } from "@/lib/trades/format";

const S = DEFAULT_SETTINGS;

function spot(teamId: string, playerId: string, over: Partial<SpotLite> = {}): SpotLite {
  return {
    playerId,
    teamId,
    status: "ACTIVE",
    salary: 10,
    contractYears: 2,
    isRookieContract: false,
    player: { fullName: `Player ${playerId}`, position: "WR", injuryStatus: null, status: "Active", yearsExp: 3 },
    ...over,
  };
}

function snapshot(over: Partial<TradeSnapshot> = {}): TradeSnapshot {
  const spots: SpotLite[] = [];
  for (let i = 0; i < 20; i++) spots.push(spot("A", `a${i}`));
  for (let i = 0; i < 20; i++) spots.push(spot("B", `b${i}`));
  return {
    teams: new Map([
      ["A", { id: "A", name: "Alpha", faabBalance: 50 }],
      ["B", { id: "B", name: "Bravo", faabBalance: 80 }],
      ["C", { id: "C", name: "Charlie", faabBalance: 100 }],
    ]),
    spots,
    picks: new Map([
      ["pkA", { id: "pkA", season: 2027, round: 1, pickInRound: null, ownerTeamId: "A", originalTeamId: "A", playerId: null }],
      ["pkB", { id: "pkB", season: 2027, round: 2, pickInRound: null, ownerTeamId: "B", originalTeamId: "C", playerId: null }],
      ["pkOld", { id: "pkOld", season: 2026, round: 1, pickInRound: 3, ownerTeamId: "A", originalTeamId: "A", playerId: "used" }],
      ["pkFar", { id: "pkFar", season: 2031, round: 1, pickInRound: null, ownerTeamId: "A", originalTeamId: "A", playerId: null }],
    ]),
    deadMoney: new Map(),
    recentMoves: [],
    ...over,
  };
}

function opts(over: Partial<CheckOptions> = {}, settings: LeagueSettings = S): CheckOptions {
  return { settings, phase: "REGULAR", week: 11, season: 2026, nextDraftSeason: 2027, now: new Date("2026-11-24T12:00:00Z"), checkWindow: true, strictTeams: new Set(["A"]), ...over };
}

test("trade window: deadline, playoffs, offseason, disabled", () => {
  assert.equal(tradeWindow(S, "REGULAR", 11).open, true);
  assert.match(tradeWindow(S, "REGULAR", 11).note ?? "", /this week/);
  assert.equal(tradeWindow(S, "REGULAR", 12).open, false);
  assert.equal(tradeWindow(S, "PLAYOFFS", 15).open, false);
  assert.equal(tradeWindow(deepMerge(S, { trades: { allowDuringPlayoffs: true } }), "PLAYOFFS", 15).open, true);
  assert.equal(tradeWindow(S, "OFFSEASON", 17).open, true);
  assert.equal(tradeWindow(deepMerge(S, { trades: { allowOffseasonTrades: false } }), "KEEPER", 17).open, false);
  assert.equal(tradeWindow(deepMerge(S, { trades: { enabled: false } }), "REGULAR", 1).open, false);
  assert.equal(tradeWindow(deepMerge(S, { trades: { deadlineWeek: null } }), "REGULAR", 17).open, true);
});

test("settings helpers", () => {
  assert.deepEqual(tradablePickSeasons(S, 2027), [2027, 2028, 2029]);
  assert.equal(maxTeams(S), 3);
  assert.equal(maxTeams(deepMerge(S, { trades: { allowMultiTeamTrades: false } })), 2);
  assert.equal(faabTradingAllowed(S), true);
  assert.equal(faabTradingAllowed(deepMerge(S, { waivers: { faabTradable: false } })), false);
  assert.equal(faabTradingAllowed(deepMerge(S, { waivers: { type: "PRIORITY" } })), false);
});

test("labels and summaries", () => {
  const name = (id: string) => ({ A: "Alpha", C: "Bell Ringers" })[id] ?? "?";
  assert.equal(pickAssetLabel({ season: 2027, round: 1, pickInRound: null, originalTeamId: "C" }, "A", name), "2027 1st (via Bell Ringers)");
  assert.equal(pickAssetLabel({ season: 2027, round: 2, pickInRound: 4, originalTeamId: "A" }, "A", name), "2027 2.04 (Alpha)");
  assert.equal(listJoin(["a", "b", "c"]), "a, b and c");
  assert.equal(listJoin([]), "nothing");
  const sum = tradeSummaryFor("A", [
    { fromTeamId: "B", toTeamId: "A", label: "X" },
    { fromTeamId: "A", toTeamId: "B", label: "Y" },
  ]);
  assert.deepEqual(sum, { received: ["X"], sent: ["Y"] });
  assert.equal(assetKey({ type: "PICK", pickId: "p1", fromTeamId: "A" }), "K:p1");
});

test("valid 2-team trade with a pick and FAB", () => {
  const r = checkTrade(
    {
      teamIds: ["A", "B"],
      assets: [
        { type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" },
        { type: "PICK", pickId: "pkA", fromTeamId: "A", toTeamId: "B" },
        { type: "FAAB", faabAmount: 10, fromTeamId: "A", toTeamId: "B" },
        { type: "PLAYER", playerId: "b1", fromTeamId: "B", toTeamId: "A" },
      ],
      drops: {},
    },
    snapshot(),
    opts(),
  );
  assert.deepEqual(r.errors, []);
  const a = r.impacts.find((i) => i.teamId === "A")!;
  assert.equal(a.faabAfter, 40);
  assert.equal(a.activeAfter, 20);
});

test("ownership, pick and FAB rules", () => {
  const snap = snapshot();
  const bad = checkTrade(
    {
      teamIds: ["A", "B"],
      assets: [
        { type: "PLAYER", playerId: "b2", fromTeamId: "A", toTeamId: "B" }, // not A's player
        { type: "PICK", pickId: "pkOld", fromTeamId: "A", toTeamId: "B" }, // used
        { type: "PICK", pickId: "pkFar", fromTeamId: "A", toTeamId: "B" }, // outside futurePickYears
        { type: "FAAB", faabAmount: 60, fromTeamId: "A", toTeamId: "B" }, // more than balance
      ],
      drops: {},
    },
    snap,
    opts(),
  );
  assert.ok(bad.errors.some((e) => e.includes("no longer on Alpha")));
  assert.ok(bad.errors.some((e) => e.includes("already been used")));
  assert.ok(bad.errors.some((e) => e.includes("2027–2029")));
  assert.ok(bad.errors.some((e) => e.includes("only has $50 FAB")));
  const noPicks = checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PICK", pickId: "pkA", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snap, opts({}, deepMerge(S, { trades: { allowDraftPickTrading: false } })));
  assert.ok(noPicks.errors.some((e) => e.includes("not allowed")));
});

test("structure rules: partners, team limits, duplicates, everyone involved", () => {
  const snap = snapshot();
  assert.ok(checkTrade({ teamIds: ["A"], assets: [], drops: {} }, snap, opts()).errors.some((e) => e.includes("partner")));
  const dup = checkTrade(
    {
      teamIds: ["A", "B"],
      assets: [
        { type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" },
        { type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" },
      ],
      drops: {},
    },
    snap,
    opts(),
  );
  assert.ok(dup.errors.some((e) => e.includes("twice")));
  const idle = checkTrade({ teamIds: ["A", "B", "C"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snap, opts());
  assert.ok(idle.errors.some((e) => e.includes("Charlie isn't sending or receiving")));
  const twoOnly = deepMerge(S, { trades: { allowMultiTeamTrades: false } });
  assert.ok(checkTrade({ teamIds: ["A", "B", "C"], assets: [], drops: {} }, snap, opts({}, twoOnly)).errors.some((e) => e.includes("Multi-team")));
});

test("deadline blocks proposals after the deadline week", () => {
  const r = checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snapshot(), opts({ week: 12 }));
  assert.ok(r.errors.some((e) => e.includes("deadline")));
  assert.deepEqual(checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snapshot(), opts({ week: 12, checkWindow: false })).errors, []);
});

test("roster overflow: proposer must drop, partner gets a warning", () => {
  const snap = snapshot();
  for (let i = 20; i < 27; i++) snap.spots.push(spot("A", `a${i}`)); // A at 27/27
  for (let i = 20; i < 27; i++) snap.spots.push(spot("B", `b${i}`)); // B at 27/27
  const twoForOne = { teamIds: ["A", "B"], assets: [{ type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "b2", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} };
  const r = checkTrade(twoForOne, snap, opts());
  assert.ok(r.errors.some((e) => e.includes("Alpha would have 28 active players") && e.includes("drop 1")));
  assert.equal(r.impacts.find((i) => i.teamId === "A")!.dropsNeeded, 1);
  const fixed = checkTrade({ ...twoForOne, drops: { A: ["a5"] } }, snap, opts());
  assert.deepEqual(fixed.errors, []);
  // partner overflow is a warning until they accept
  const reverse = checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }, { type: "PLAYER", playerId: "a2", fromTeamId: "A", toTeamId: "B" }, { type: "PLAYER", playerId: "b1", fromTeamId: "B", toTeamId: "A" }], drops: {} }, snap, opts());
  assert.deepEqual(reverse.errors, []);
  assert.ok(reverse.warnings.some((w) => w.includes("Bravo") && w.includes("accepting")));
  // dropping a player you're trading away is invalid
  assert.ok(checkTrade({ ...twoForOne, drops: { A: ["a1"] } }, snap, opts()).errors.some((e) => e.includes("already being traded")));
});

test("cap compliance after the trade, including dead money from drops", () => {
  const snap = snapshot();
  snap.spots.find((s) => s.playerId === "b1")!.salary = 120; // A: 20 × $10 = $200 → +120 −10 = $310
  const input = { teamIds: ["A", "B"], assets: [{ type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} };
  const r = checkTrade(input, snap, opts());
  assert.ok(r.errors.some((e) => e.includes("$10 over the $300 cap")));
  // dropping a $10 player only frees $5 (50% dead money) → still over
  const oneDrop = checkTrade({ ...input, drops: { A: ["a2"] } }, snap, opts());
  assert.ok(oneDrop.errors.some((e) => e.includes("over the")));
  assert.equal(oneDrop.impacts.find((i) => i.teamId === "A")!.capAfter, 305);
  const twoDrops = checkTrade({ ...input, drops: { A: ["a2", "a3"] } }, snap, opts());
  assert.deepEqual(twoDrops.errors, []);
  // not enforced when the league doesn't require cap compliance → warning
  const loose = checkTrade(input, snap, opts({}, deepMerge(S, { trades: { requireCapCompliance: false } })));
  assert.deepEqual(loose.errors, []);
  assert.ok(loose.warnings.some((w) => w.includes("over the")));
  // already over the cap but the trade lowers salary → allowed
  const snap2 = snapshot();
  for (const s of snap2.spots.filter((x) => x.teamId === "A")) s.salary = 16; // $320
  assert.deepEqual(checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snap2, opts()).errors, []);
});

test("trade-back cooldown uses completed trades", () => {
  const snap = snapshot({ recentMoves: [{ playerId: "a1", fromTeamId: "B", toTeamId: "A", completedAt: new Date("2026-11-20T12:00:00Z") }] });
  const settings = deepMerge(S, { trades: { tradeBackCooldownDays: 30 } });
  const back = checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snap, opts({}, settings));
  assert.ok(back.errors.some((e) => e.includes("can't be traded back to Bravo within 30 days")));
  const later = checkTrade({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} }, snap, opts({ now: new Date("2027-01-30T12:00:00Z") }, settings));
  assert.deepEqual(later.errors, []);
  const elsewhere = checkTrade({ teamIds: ["A", "C"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "C" }], drops: {} }, snapshot({ ...snap, spots: [...snap.spots, spot("C", "c1")] }), opts({}, settings));
  assert.ok(!elsewhere.errors.some((e) => e.includes("traded back")));
});

test("cap hit and dead money mirror roster rules", () => {
  assert.equal(spotCapHit({ salary: 20, status: "ACTIVE" }, S), 20);
  assert.equal(spotCapHit({ salary: 20, status: "TAXI" }, S), 0);
  assert.equal(spotCapHit({ salary: 20, status: "IR" }, deepMerge(S, { roster: { irCountsAgainstCap: false } })), 0);
  assert.deepEqual(dropDeadMoney({ salary: 20, contractYears: 3, isRookieContract: false }, S, 11), { current: 10, next: 5 });
  assert.deepEqual(dropDeadMoney({ salary: 1, contractYears: 3, isRookieContract: false }, S, 11), { current: 0, next: 0 });
  assert.deepEqual(dropDeadMoney({ salary: 20, contractYears: 3, isRookieContract: true }, deepMerge(S, { salaryCap: { deadMoney: { rookieContractsExempt: true } } }), 11), { current: 0, next: 0 });
});

test("stale open trades are detected", () => {
  const state = {
    playerTeam: new Map<string, string | null>([["p1", "A"], ["p2", "C"]]),
    pickOwner: new Map([["k1", { ownerTeamId: "A", used: false }], ["k2", { ownerTeamId: "A", used: true }]]),
    faabBalance: new Map([["A", 5]]),
  };
  assert.equal(tradeHasStaleAssets([{ type: "PLAYER", playerId: "p1", fromTeamId: "A", toTeamId: "B" }], state), null);
  assert.match(tradeHasStaleAssets([{ type: "PLAYER", playerId: "p2", fromTeamId: "A", toTeamId: "B" }], state) ?? "", /changed teams/);
  assert.match(tradeHasStaleAssets([{ type: "PICK", pickId: "k2", fromTeamId: "A", toTeamId: "B" }], state) ?? "", /changed hands/);
  assert.match(tradeHasStaleAssets([{ type: "FAAB", faabAmount: 10, fromTeamId: "A", toTeamId: "B" }], state) ?? "", /FAB/);
});

test("vote tally", () => {
  assert.deepEqual(voteTally([{ vote: "VETO" }, { vote: "APPROVE" }, { vote: "VETO" }], 2), { veto: 2, approve: 1, required: 2, vetoed: true });
  assert.equal(voteTally([{ vote: "VETO" }], 4).vetoed, false);
});

test("points since the trade count starts for the new team", () => {
  const weeks = [
    { season: 2026, week: 3, points: 30, startedForTeam: false },
    { season: 2026, week: 4, points: 10, startedForTeam: true }, // trade week, started for new team
    { season: 2026, week: 5, points: 20, startedForTeam: true },
    { season: 2026, week: 6, points: 5, startedForTeam: false },
    { season: 2027, week: 1, points: 12, startedForTeam: true },
  ];
  assert.deepEqual(pointsSinceTrade(weeks, { season: 2026, week: 4 }), { started: 42, total: 47, startedWeeks: 3, weeks: 4 });
  // trade week not started for the new team → excluded
  const w2 = weeks.map((w) => (w.week === 4 ? { ...w, startedForTeam: false } : w));
  assert.equal(pointsSinceTrade(w2, { season: 2026, week: 4 }).total, 37);
});

test("formatting helpers", () => {
  assert.equal(signed(3.14, 1), "+3.1");
  assert.equal(signed(-2, 0), "−2");
  assert.equal(signed(0, 1), "0.0");
  assert.equal(contractText(22, 2), "$22 · 2 yrs");
  assert.equal(contractText(null, 2), "—");
  const now = Date.parse("2026-11-24T12:00:00Z");
  assert.equal(timeLeft(new Date(now + 90 * 60_000), now), "1h 30m left");
  assert.equal(timeLeft(new Date(now + 3 * 864e5 + 3600_000), now), "3d 1h left");
  assert.equal(timeLeft(new Date(now - 1), now), "ended");
});

test("IR / taxi tradability, max players per side and even player counts", () => {
  const snap = snapshot({ spots: [...snapshot().spots.filter((x) => x.playerId !== "a2" && x.playerId !== "a3"), spot("A", "a2", { status: "IR" }), spot("A", "a3", { status: "TAXI" })] });
  const twoForOne = {
    teamIds: ["A", "B"],
    assets: [
      { type: "PLAYER" as const, playerId: "a2", fromTeamId: "A", toTeamId: "B" },
      { type: "PLAYER" as const, playerId: "a3", fromTeamId: "A", toTeamId: "B" },
      { type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" },
    ],
    drops: {},
  };
  assert.deepEqual(checkTrade(twoForOne, snap, opts()).errors, [], "defaults allow IR/taxi players and 2-for-1 deals");
  const strict = deepMerge(S, { trades: { irPlayersTradable: false, taxiPlayersTradable: false, allowUnbalanced: false, maxPlayersPerSide: 1 } });
  const errs = checkTrade(twoForOne, snap, opts({}, strict)).errors.join(" | ");
  assert.match(errs, /on IR/);
  assert.match(errs, /taxi squad/);
  assert.match(errs, /at most 1 player/);
  assert.match(errs, /Uneven player counts/);
  const name = (id: string) => id;
  assert.deepEqual(playerCountProblems({ teamIds: ["A", "B"], assets: [{ type: "PLAYER", playerId: "a1", fromTeamId: "A", toTeamId: "B" }, { type: "PLAYER", playerId: "b1", fromTeamId: "B", toTeamId: "A" }, { type: "FAAB", faabAmount: 5, fromTeamId: "A", toTeamId: "B" }] }, strict, name), [], "1-for-1 plus FAB is balanced");
});

test("pick trades can require paid dues", () => {
  const dues = deepMerge(S, { trades: { pickTradingRequiresPaidDues: true }, general: { leagueDues: 100, duesPaidTeamIds: ["B"] } });
  assert.equal(duesPaidForPicks(dues, "A"), false);
  assert.equal(duesPaidForPicks(dues, "B"), true);
  assert.equal(duesPaidForPicks(deepMerge(dues, { general: { leagueDues: 0 } }), "A"), true, "free leagues have no dues to pay");
  const input = { teamIds: ["A", "B"], assets: [{ type: "PICK" as const, pickId: "pkA", fromTeamId: "A", toTeamId: "B" }, { type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" }], drops: {} };
  assert.match(checkTrade(input, snapshot(), opts({}, dues)).errors.join(" "), /must pay league dues/);
  assert.deepEqual(checkTrade(input, snapshot(), opts()).errors, []);
});

test("vote eligibility and review routing", () => {
  assert.equal(canVoteOnTrade(S, ["A", "B"], "C"), true);
  assert.equal(canVoteOnTrade(S, ["A", "B"], "A"), false);
  assert.equal(canVoteOnTrade(deepMerge(S, { trades: { voteEligibility: "ALL_TEAMS" } }), ["A", "B"], "A"), true);
  assert.equal(canVoteOnTrade(S, ["A", "B"], null), false);
  assert.equal(reviewRoute(S, false), "COMMISSIONER");
  assert.equal(reviewRoute(S, true), "COMMISSIONER", "NONE override = normal process");
  assert.equal(reviewRoute(deepMerge(S, { trades: { commissionerTradesReviewedBy: "CO_COMMISSIONER" } }), true), "CO_COMMISSIONER");
  assert.equal(reviewRoute(deepMerge(S, { trades: { commissionerTradesReviewedBy: "LEAGUE_VOTE" } }), true), "LEAGUE_VOTE");
  assert.equal(reviewRoute(deepMerge(S, { trades: { commissionerTradesReviewedBy: "LEAGUE_VOTE" } }), false), "COMMISSIONER");
  assert.equal(reviewRoute(deepMerge(S, { trades: { reviewType: "LEAGUE_VOTE", reviewPeriodHours: 0 } }), false), "NONE");
  assert.equal(reviewRoute(deepMerge(S, { trades: { reviewType: "NONE" } }), false), "NONE");
  assert.equal(reviewHours(deepMerge(S, { trades: { reviewPeriodHours: 0 } })), 24);
  assert.equal(reviewHours(deepMerge(S, { trades: { reviewPeriodHours: 48 } })), 48);
});

test("next-season salary honors raise rules", () => {
  const raise = deepMerge(S, { contracts: { annualRaisePercent: 10, raiseRounding: "UP", raiseAppliesTo: "ALL_EXCEPT_ROOKIE" } });
  assert.equal(salaryNextSeason({ salary: 21, contractYears: 2 }, raise), 24, "21 × 1.1 = 23.1 rounds up");
  assert.equal(salaryNextSeason({ salary: 21, contractYears: 2, isRookieContract: true }, raise), 21, "rookie deals don't get raises");
  assert.equal(salaryNextSeason({ salary: 21, contractYears: 1 }, raise), 0, "expiring deals cost nothing next season");
  const vets = deepMerge(raise, { contracts: { raiseAppliesTo: "VETERANS_ONLY", rookieContractYears: 3 } });
  assert.equal(salaryNextSeason({ salary: 10, contractYears: 3, player: { yearsExp: 1 } }, vets), 10);
  assert.equal(salaryNextSeason({ salary: 10, contractYears: 3, player: { yearsExp: 5 } }, vets), 11);
});

test("salary retention: limits, cap impact on both teams and dead-money schedule", () => {
  const input = (pct: number) => ({
    teamIds: ["A", "B"],
    assets: [
      { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B", retainPercent: pct },
      { type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" },
    ],
    drops: {},
  });
  const snap = snapshot({ spots: [...snapshot().spots.filter((x) => x.playerId !== "a1"), spot("A", "a1", { salary: 30, contractYears: 3 })] });
  assert.match(checkTrade(input(25), snap, opts()).errors.join(" "), /isn't allowed/, "retention is off by default");
  const s = deepMerge(S, { trades: { salaryRetentionMaxPercent: 50 } });
  assert.equal(retentionMax(s), 50);
  assert.equal(retentionMax(deepMerge(s, { salaryCap: { enabled: false } })), 0, "needs a salary cap");
  assert.match(checkTrade(input(60), snap, opts({}, s)).errors.join(" "), /at most 50%/);
  const base = checkTrade(input(0), snap, opts({}, s));
  const r = checkTrade(input(50), snap, opts({}, s));
  assert.deepEqual(r.errors, []);
  const a0 = base.impacts.find((i) => i.teamId === "A")!;
  const a1 = r.impacts.find((i) => i.teamId === "A")!;
  const b0 = base.impacts.find((i) => i.teamId === "B")!;
  const b1 = r.impacts.find((i) => i.teamId === "B")!;
  assert.equal(a1.capAfter - a0.capAfter, 15, "sender keeps paying half of $30");
  assert.equal(b0.capAfter - b1.capAfter, 15, "receiver only pays the other half");
  assert.equal(retainedAmount(30, 50), 15);
  assert.equal(retainedAmount(30, 0), 0);
  const raise = deepMerge(s, { contracts: { annualRaisePercent: 10 } });
  assert.deepEqual(retentionDeadMoney({ salary: 30, contractYears: 3 }, 50, raise, 2026, "A"), [
    { teamId: "A", season: 2026, amount: 15 },
    { teamId: "A", season: 2027, amount: 17 },
    { teamId: "A", season: 2028, amount: 18 },
  ]);
});

test("league-state locks: picks of a season whose rookie draft is running, eliminated teams", () => {
  const snap = snapshot();
  const draftLock = "2027 picks can't be traded while the 2027 Rookie Draft is under way.";
  const input = {
    teamIds: ["A", "B"],
    assets: [
      { type: "PICK" as const, pickId: "pkA", fromTeamId: "A", toTeamId: "B" },
      { type: "PICK" as const, pickId: "pkB", fromTeamId: "B", toTeamId: "A" },
      { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B" },
    ],
  };
  const none = { lockedPickSeasons: new Map<number, string>(), blockedTeams: new Map<string, string>() };
  assert.deepEqual(tradeLockProblems(input, snap.picks, none), []);
  // both 2027 picks hit the same lock: reported once
  assert.deepEqual(tradeLockProblems(input, snap.picks, { ...none, lockedPickSeasons: new Map([[2027, draftLock]]) }), [draftLock]);
  // another season's draft doesn't lock these picks; a player-only trade is never pick-locked
  assert.deepEqual(tradeLockProblems(input, snap.picks, { ...none, lockedPickSeasons: new Map([[2028, "2028 locked"]]) }), []);
  assert.deepEqual(tradeLockProblems({ teamIds: ["A", "B"], assets: [input.assets[2]!] }, snap.picks, { ...none, lockedPickSeasons: new Map([[2027, draftLock]]) }), []);
  // a team in the trade that is out of the championship race (playoffs.eliminatedTeamsCanTransact = false)
  const out = "Bravo lost in the quarterfinal. Teams eliminated from the playoffs can't make trades in this league.";
  assert.deepEqual(tradeLockProblems(input, snap.picks, { ...none, blockedTeams: new Map([["B", out], ["C", "Charlie missed the playoffs"]]) }), [out]);
  assert.deepEqual(tradeLockProblems(input, snap.picks, { lockedPickSeasons: new Map([[2027, draftLock]]), blockedTeams: new Map([["B", out]]) }), [out, draftLock]);
  // an unknown pick id is left to checkTrade ("no longer exists")
  assert.deepEqual(tradeLockProblems({ teamIds: ["A", "B"], assets: [{ type: "PICK", pickId: "gone", fromTeamId: "A", toTeamId: "B" }] }, snap.picks, { ...none, lockedPickSeasons: new Map([[2027, draftLock]]) }), []);
});
