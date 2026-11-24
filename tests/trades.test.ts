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

test("completion: a trade blocked only by a running rookie draft waits; anything else fails it", async () => {
  const { onlyPickLocks } = await import("@/lib/trades/validate");
  const draftLock = "2027 picks can't be traded while the 2027 Rookie Draft is under way.";
  const out = "Bravo lost in the semifinal. Teams eliminated from the playoffs can't make trades in this league.";
  assert.equal(onlyPickLocks({ errors: [draftLock], locks: { picks: [draftLock], teams: [] } }), true);
  assert.equal(onlyPickLocks({ errors: [], locks: { picks: [], teams: [] } }), false);
  // a hard problem alongside the lock (an asset moved, a team eliminated) fails the trade instead of holding it
  assert.equal(onlyPickLocks({ errors: [draftLock, "Player a1 is no longer on Alpha."], locks: { picks: [draftLock], teams: [] } }), false);
  assert.equal(onlyPickLocks({ errors: [out, draftLock], locks: { picks: [draftLock], teams: [out] } }), false);
  assert.equal(onlyPickLocks({ errors: [out], locks: { picks: [], teams: [out] } }), false);
});

test("trade builder: the viewer's own block closes the window; locked pick seasons drop out", async () => {
  const { rulesSummary, withViewerLocks } = await import("@/lib/trades/assets");
  const s = deepMerge(S, { trades: { enabled: true, deadlineWeek: null, allowDraftPickTrading: true, futurePickYears: 3 } });
  const base = rulesSummary(s, "PRESEASON", 0, 2027);
  assert.equal(base.windowOpen, true);
  assert.deepEqual(base.pickSeasons, [2027, 2028, 2029]);
  const draftLock = "2027 picks can't be traded while the 2027 Rookie Draft is under way.";
  const locked = withViewerLocks(base, { myBlock: null, blockedTeams: new Map(), lockedPicks: [{ season: 2027, reason: draftLock }] });
  assert.equal(locked.windowOpen, true);
  assert.deepEqual(locked.pickSeasons, [2028, 2029]);
  assert.deepEqual(locked.lockedPickSeasons, [{ season: 2027, reason: draftLock }]);
  const mine = "Your team lost in the quarterfinal. Teams eliminated from the playoffs can't make trades in this league.";
  const blocked = withViewerLocks(base, { myBlock: mine, blockedTeams: new Map(), lockedPicks: [] });
  assert.equal(blocked.windowOpen, false);
  assert.equal(blocked.windowReason, mine);
  assert.equal(blocked.windowNote, null);
  // a closed league window keeps its own reason
  const closed = rulesSummary(deepMerge(s, { trades: { allowDuringPlayoffs: false } }), "PLAYOFFS", 16, 2026);
  assert.equal(withViewerLocks(closed, { myBlock: mine, blockedTeams: new Map(), lockedPicks: [] }).windowReason, "Trades are closed during the playoffs.");
  // nothing to apply: unchanged apart from the (empty) lock list
  assert.deepEqual(withViewerLocks(base, { myBlock: null, blockedTeams: new Map(), lockedPicks: [] }), { ...base, lockedPickSeasons: [] });
});

// ───────────────────────── League-wide cap ceiling / roster limit / enforcement in trades ─────────────────────────

/** A: 20 × $10 = $200; B's b1 costs $120 → A takes b1 for a1: $200 − 10 + 120 = $310 */
function overCapTrade() {
  const snap = snapshot();
  snap.spots.find((s) => s.playerId === "b1")!.salary = 120;
  const input = { teamIds: ["A", "B"], assets: [{ type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} };
  return { snap, input };
}

test("soft cap: a trade over the cap but under the soft-cap limit is fine; past the limit it must be fixed", () => {
  const { snap, input } = overCapTrade();
  const soft = deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: 20 } });
  const ok = checkTrade(input, snap, opts({}, soft));
  assert.deepEqual(ok.errors, []);
  assert.ok(!ok.warnings.some((w) => w.includes("over the")));
  const a = ok.impacts.find((i) => i.teamId === "A")!;
  assert.equal(a.capAfter, 310);
  assert.equal(a.cap, 300);
  assert.equal(a.capLimit, 320);
  assert.equal(a.capOverBy, 0);
  const tight = checkTrade(input, snap, opts({}, deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: 5 } })));
  assert.ok(tight.errors.some((e) => e.includes("Alpha would be at $310, $5 over the $305 soft-cap limit.")));
  assert.equal(tight.impacts.find((i) => i.teamId === "A")!.capOverBy, 5);
  // no max overage: never blocked
  assert.deepEqual(checkTrade(input, snap, opts({}, deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: null } }))).errors, []);
  // the hard cap: capOverBy is what the accepting team must clear
  const hard = checkTrade(input, snap, opts());
  assert.equal(hard.impacts.find((i) => i.teamId === "A")!.capOverBy, 10);
  assert.equal(hard.impacts.find((i) => i.teamId === "A")!.capMode, "BLOCK");
});

test("offseason trades use the offseason roster limit and the offseason cap rule", () => {
  const snap = snapshot();
  for (let i = 20; i < 27; i++) snap.spots.push(spot("A", `a${i}`)); // A at 27/27
  const twoForOne = { teamIds: ["A", "B"], assets: [{ type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "b2", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} };
  const big = deepMerge(S, { roster: { offseasonMaxActiveRoster: 30, rosterCutdownDate: null } });
  const off = checkTrade(twoForOne, snap, opts({ phase: "OFFSEASON" }, big));
  assert.deepEqual(off.errors, []);
  assert.equal(off.impacts.find((i) => i.teamId === "A")!.maxActive, 30);
  assert.equal(off.impacts.find((i) => i.teamId === "A")!.dropsNeeded, 0);
  const reg = checkTrade(twoForOne, snap, opts({ phase: "REGULAR" }, big));
  assert.equal(reg.impacts.find((i) => i.teamId === "A")!.dropsNeeded, 1);
  // past the cutdown deadline the in-season limit is back
  const cut = deepMerge(big, { roster: { rosterCutdownDate: "2026-08-30T16:00:00.000Z" } });
  assert.equal(checkTrade(twoForOne, snap, opts({ phase: "PRESEASON", now: new Date("2026-09-01T00:00:00Z") }, cut)).impacts.find((i) => i.teamId === "A")!.dropsNeeded, 1);
});

test("cap enforcement mode: WARN lets an over-cap trade through with the reason, OFF checks nothing", () => {
  const { snap, input } = overCapTrade();
  const warn = checkTrade(input, snap, opts({ phase: "OFFSEASON" }, deepMerge(S, { salaryCap: { offseasonEnforcement: "WARN_ONLY" } })));
  assert.deepEqual(warn.errors, []);
  assert.ok(warn.warnings.some((w) => w === "Alpha would be at $310, $10 over the $300 cap. The cap is only a warning in the offseason."));
  assert.equal(warn.impacts.find((i) => i.teamId === "A")!.capOverBy, 0);
  assert.equal(warn.impacts.find((i) => i.teamId === "A")!.capMode, "WARN");
  // blocked in the offseason too once the compliance date has passed
  const due = deepMerge(S, { salaryCap: { offseasonEnforcement: "ALLOW_UNTIL_COMPLIANCE_DATE", complianceDate: "2026-11-01T04:00:00.000Z" } });
  assert.ok(checkTrade(input, snap, opts({ phase: "OFFSEASON" }, due)).errors.some((e) => e.includes("$10 over the $300 cap")));
  // in-season enforcement off: no cap message at all
  const off = checkTrade(input, snap, opts({}, deepMerge(S, { salaryCap: { enforceInSeason: false } })));
  assert.deepEqual(off.errors, []);
  assert.ok(!off.warnings.some((w) => w.includes("cap")));
  assert.equal(off.impacts.find((i) => i.teamId === "A")!.capMode, "OFF");
});

test("capOverBy is what the accepting team must clear: a team already over the cap only has to get back to its old payroll", () => {
  // A: a0 $115 + 19 × $10 = $305, already $5 over the $300 cap; taking $20 b1 for $10 a1 → $315
  const snap = snapshot();
  snap.spots.find((s) => s.playerId === "a0")!.salary = 115;
  snap.spots.find((s) => s.playerId === "b1")!.salary = 20;
  const input = { teamIds: ["A", "B"], assets: [{ type: "PLAYER" as const, playerId: "b1", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER" as const, playerId: "a1", fromTeamId: "A", toTeamId: "B" }], drops: {} };
  const res = checkTrade(input, snap, opts({ strictTeams: new Set() }));
  const a = res.impacts.find((i) => i.teamId === "A")!;
  assert.equal(a.capBefore, 305);
  assert.equal(a.capAfter, 315);
  assert.ok(res.warnings.some((w) => w.startsWith("Alpha would be at $315, $15 over the $300 cap.")), "the message gives the full overage");
  assert.equal(a.capOverBy, 10, "shedding $10 (back to $305) is enough — a move that adds no salary is allowed");
  // the same trade at an even swap adds no salary: allowed although A stays over the cap
  snap.spots.find((s) => s.playerId === "b1")!.salary = 10;
  const even = checkTrade(input, snap, opts());
  assert.deepEqual(even.errors, []);
  assert.equal(even.impacts.find((i) => i.teamId === "A")!.capOverBy, 0);
});

test("trade screens measure cap room like the rules: the ceiling while it blocks, the league cap otherwise", async () => {
  const { tradeCapReference } = await import("@/lib/trades/assets");
  const now = new Date("2026-11-24T12:00:00Z");
  const soft = deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: 20 } });
  assert.equal(tradeCapReference(S, "REGULAR", { now }), 300);
  assert.equal(tradeCapReference(soft, "REGULAR", { now }), 320, "soft cap: room under the $320 limit every cap check uses");
  assert.equal(tradeCapReference(soft, "REGULAR", { now, cap: 310 }), 330, "next season's cap + the max overage");
  assert.equal(tradeCapReference(deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: null } }), "REGULAR", { now }), 300, "no ceiling: the league cap");
  // the cap doesn't block: the league cap (the overage is only a warning, or nothing is checked)
  assert.equal(tradeCapReference(deepMerge(soft, { salaryCap: { offseasonEnforcement: "WARN_ONLY" } }), "OFFSEASON", { now }), 300);
  assert.equal(tradeCapReference(deepMerge(soft, { salaryCap: { enforceInSeason: false } }), "REGULAR", { now }), 300);
  // ALLOW_UNTIL_COMPLIANCE_DATE: the ceiling binds once the (date-only, league-time) deadline has passed
  const due = deepMerge(soft, { salaryCap: { offseasonEnforcement: "ALLOW_UNTIL_COMPLIANCE_DATE", complianceDate: "2026-11-23" } });
  assert.equal(tradeCapReference(due, "OFFSEASON", { now: new Date("2026-11-24T04:59:00Z") }), 300, "still Nov 23 in New York");
  assert.equal(tradeCapReference(due, "OFFSEASON", { now: new Date("2026-11-24T05:00:00Z") }), 320);
  // checkTrade measures the same ceiling it blocks on
  const { snap, input } = overCapTrade();
  const a = checkTrade(input, snap, opts({}, soft)).impacts.find((i) => i.teamId === "A")!;
  assert.equal(a.capLimit, tradeCapReference(soft, "REGULAR", { now }));
});

test("trade rules summary: cap chip, ceiling and roster limit follow the league phase", async () => {
  const { rulesSummary } = await import("@/lib/trades/assets");
  const now = new Date("2026-11-24T12:00:00Z");
  const reg = rulesSummary(S, "REGULAR", 11, 2026, now);
  assert.equal(reg.requireCapCompliance, true, "default: over-cap trades must be fixed");
  assert.equal(reg.capMode, "BLOCK");
  assert.equal(reg.capLimit, 300);
  assert.equal(reg.capLimitLabel, "cap");
  assert.equal(reg.maxActive, S.roster.maxActiveRoster);
  // WARN offseason: an over-cap trade only carries a warning, so nothing has to be fixed
  const warn = rulesSummary(deepMerge(S, { salaryCap: { offseasonEnforcement: "WARN_ONLY" } }), "OFFSEASON", 17, 2026, now);
  assert.equal(warn.requireCapCompliance, false);
  assert.equal(warn.capMode, "WARN");
  // in-season enforcement off, trades.requireCapCompliance off, or a soft cap without a ceiling: never blocks
  assert.equal(rulesSummary(deepMerge(S, { salaryCap: { enforceInSeason: false } }), "REGULAR", 11, 2026, now).requireCapCompliance, false);
  assert.equal(rulesSummary(deepMerge(S, { trades: { requireCapCompliance: false } }), "REGULAR", 11, 2026, now).requireCapCompliance, false);
  const noCeiling = rulesSummary(deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: null } }), "REGULAR", 11, 2026, now);
  assert.equal(noCeiling.requireCapCompliance, false);
  assert.equal(noCeiling.capLimit, null);
  const soft = rulesSummary(deepMerge(S, { salaryCap: { capType: "SOFT", softCapMaxOverage: 25 } }), "REGULAR", 11, 2026, now);
  assert.deepEqual([soft.requireCapCompliance, soft.capLimit, soft.capLimitLabel], [true, 325, "soft-cap limit"]);
  // offseason roster limit until the cutdown (a date-only value ends at midnight in the league time zone)
  const big = deepMerge(S, { roster: { offseasonMaxActiveRoster: 35, rosterCutdownDate: "2027-08-31" } });
  assert.equal(rulesSummary(big, "OFFSEASON", 17, 2026, new Date("2027-09-01T03:59:00Z")).maxActive, 35);
  assert.equal(rulesSummary(big, "OFFSEASON", 17, 2026, new Date("2027-09-01T04:00:00Z")).maxActive, S.roster.maxActiveRoster);
  assert.equal(rulesSummary(big, "REGULAR", 11, 2026, now).maxActive, S.roster.maxActiveRoster);
});

test("accept-dialog drop candidates free exactly what checkTrade counts (cap hit, not salary, minus dead money)", async () => {
  const { acceptDropCandidate } = await import("@/lib/trades/respond");
  const { snap, input } = overCapTrade(); // A takes on +$110: $310 against the $300 cap
  const settings = deepMerge(S, { roster: { irCountsAgainstCap: false, taxiCountsAgainstCap: false, taxiCapPercent: 50 } });
  const a = (id: string) => snap.spots.find((s) => s.playerId === id)!;
  a("a2").status = "IR";
  a("a2").salary = 30;
  a("a3").status = "TAXI";
  a("a3").salary = 12;
  a("a4").salary = 25;
  a("a4").contractYears = 3;
  a("a5").salary = 1; // minimum salary: no dead money
  const base = checkTrade(input, snap, opts({}, settings)).impacts.find((i) => i.teamId === "A")!;
  assert.equal(base.capOverBy, base.capAfter - 300);
  for (const id of ["a2", "a3", "a4", "a5", "a6"]) {
    const c = acceptDropCandidate(a(id), settings, 11, "REGULAR", 0);
    const after = checkTrade({ ...input, drops: { A: [id] } }, snap, opts({}, settings)).impacts.find((i) => i.teamId === "A")!;
    assert.equal(c.capHit - c.deadMoney, base.capAfter - after.capAfter, `${id}: freed`);
    assert.equal(c.salary, a(id).salary);
  }
  // an IR player who doesn't count against the cap frees nothing (his dead money even adds to the payroll)
  const ir = acceptDropCandidate(a("a2"), settings, 11, "REGULAR", 0);
  assert.equal(ir.capHit, 0);
  assert.ok(ir.deadMoney > 0);
  assert.equal(acceptDropCandidate(a("a3"), settings, 11, "REGULAR", 0).capHit, 6, "taxi: the taxi cap share");
  // preseason cuts use deadMoney.preseasonCutPercent, as the drop itself does
  const pre = deepMerge(settings, { salaryCap: { deadMoney: { preseasonCutPercent: 0 } } });
  assert.equal(acceptDropCandidate(a("a4"), pre, 1, "PRESEASON", 0).deadMoney, dropDeadMoney(a("a4"), pre, 1, "PRESEASON").current);
  assert.equal(acceptDropCandidate(a("a4"), pre, 1, "PRESEASON", 0).deadMoney, 0);
});
