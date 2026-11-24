import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import {
  assetKey,
  checkTrade,
  dropDeadMoney,
  faabTradingAllowed,
  listJoin,
  maxTeams,
  pickAssetLabel,
  pointsSinceTrade,
  spotCapHit,
  tradablePickSeasons,
  tradeHasStaleAssets,
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
