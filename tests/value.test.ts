import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import {
  ageFactor,
  classifyOutlooks,
  consolidatedTotal,
  evaluateTrade,
  expectedGamesMissed,
  faabValue,
  isSuperflex,
  marketDollarsPerPoint,
  pickCurve,
  PICK_ROUND_END_RATIO,
  PICK_TOP_VALUE,
  pickValue,
  playerValue,
  projectedPickSlot,
  replacementLevels,
  rookieScaleSalary,
  verdictFor,
  type PlayerValueInput,
  type ValueEnv,
} from "@/lib/value/model";

function env(over: Partial<ValueEnv> = {}, settings: LeagueSettings = DEFAULT_SETTINGS): ValueEnv {
  return {
    settings,
    teams: 12,
    remainingWeeks: 7,
    seasonWeeks: 17,
    remainingRegularWeeks: 4,
    replacement: { QB: 13, RB: 10, WR: 10, TE: 10, K: 8, DEF: 6 },
    dollarsPerPoint: 0.35,
    scale: 0.125,
    nextDraftSeason: 2027,
    projectedSlots: { worst: 1, best: 12 },
    slotConfidence: 1,
    ...over,
  };
}

function player(over: Partial<PlayerValueInput> = {}): PlayerValueInput {
  return {
    id: "p",
    position: "WR",
    age: 25,
    yearsExp: 3,
    injuryStatus: null,
    rosPoints: 7 * 18,
    rosGames: 7,
    scheduledGames: 7,
    seasonPpg: 18,
    gamesPlayed: 10,
    salary: 20,
    contractYears: 2,
    isRookieContract: false,
    ...over,
  };
}

test("age curves: RB declines steeply after 26, QB holds into early 30s", () => {
  assert.equal(ageFactor("RB", 24), 1);
  assert.ok(ageFactor("RB", 29) < 0.65);
  assert.ok(ageFactor("RB", 31) < ageFactor("WR", 31));
  assert.equal(ageFactor("QB", 33), 1);
  assert.ok(ageFactor("WR", 21) < 1, "young WRs still growing");
  assert.equal(ageFactor("DEF", null), 1);
  // interpolation between knots
  const mid = ageFactor("RB", 27.5);
  assert.ok(mid < ageFactor("RB", 27) && mid > ageFactor("RB", 28));
});

test("expected games missed by injury designation", () => {
  assert.equal(expectedGamesMissed(null, 7), 0);
  assert.equal(expectedGamesMissed("Questionable", 7), 0.3);
  assert.equal(expectedGamesMissed("Doubtful", 7), 0.85);
  assert.equal(expectedGamesMissed("Out", 7), 1.6);
  assert.ok(expectedGamesMissed("IR", 7) >= 4);
  assert.equal(expectedGamesMissed("IR", 2), 2, "capped at remaining games");
});

test("replacement levels fill dedicated slots first, then flex", () => {
  const pool = [
    ...Array.from({ length: 4 }, (_, i) => ({ position: "QB", ppg: 25 - i })),
    ...Array.from({ length: 6 }, (_, i) => ({ position: "RB", ppg: 20 - i })),
  ];
  // 2 teams, 1 QB + 2 RB + 1 FLEX(RB) → QB: 2 starters, RB: 4 + 2 flex = 6? only 6 RBs exist
  const slots = [
    { key: "QB", count: 1, eligible: ["QB"] },
    { key: "RB", count: 2, eligible: ["RB"] },
    { key: "FLEX", count: 1, eligible: ["RB", "WR"] },
  ];
  const r = replacementLevels(pool, slots, 2);
  assert.equal(r.replacement.QB, 23, "third-best QB is replacement");
  assert.equal(r.startersByPos.RB, 6);
  assert.ok(r.replacement.RB > 0 && r.replacement.RB < 15, "falls back below the weakest starter");
  // superflex: QBs fill the SF slot, so QB replacement drops
  const sf = replacementLevels(pool, [...slots, { key: "SFLEX", count: 1, eligible: ["QB", "RB"] }], 2);
  assert.ok(sf.replacement.QB < r.replacement.QB);
});

test("market $ per point uses the league cap", () => {
  const dpp = marketDollarsPerPoint(DEFAULT_SETTINGS, 10_000);
  // (12 × 300 − 12 × 27 × 1) / 10000
  assert.equal(Math.round(dpp * 10000), 12 * 300 - 12 * 27);
});

test("player value: components add up and production drives value", () => {
  const e = env();
  const star = playerValue(player({ seasonPpg: 24, rosPoints: 7 * 24 }), e);
  const depth = playerValue(player({ seasonPpg: 11, rosPoints: 7 * 11 }), e);
  assert.ok(star.value > depth.value * 3);
  const sum = star.components.reduce((a, c) => a + c.value, 0);
  assert.ok(Math.abs(sum - star.value) < 1e-6, "components sum to the value");
});

test("young players beat old players with the same production; RBs age fastest", () => {
  const e = env();
  const young = playerValue(player({ position: "RB", age: 23 }), e).value;
  const old = playerValue(player({ position: "RB", age: 30 }), e).value;
  assert.ok(young > old * 1.5);
  const oldWr = playerValue(player({ position: "WR", age: 30 }), e).value;
  assert.ok(oldWr > old, "30-year-old WR holds value better than a 30-year-old RB");
});

test("contract surplus: cheap long contracts add value, expensive short ones subtract", () => {
  const e = env();
  const cheap = playerValue(player({ salary: 3, contractYears: 4 }), e);
  const pricey = playerValue(player({ salary: 60, contractYears: 1 }), e);
  const c1 = cheap.components.find((c) => c.key === "contract")!.value;
  const c2 = pricey.components.find((c) => c.key === "contract")!.value;
  assert.ok(c1 > 0 && c2 < 0);
  assert.ok(cheap.value > pricey.value);
  // no cap → no contract component
  const noCap = deepMerge(DEFAULT_SETTINGS, { salaryCap: { enabled: false } });
  assert.equal(playerValue(player({ salary: 60 }), env({}, noCap)).components.find((c) => c.key === "contract"), undefined);
});

test("rookie contract option and rookie upside", () => {
  const e = env();
  const base = player({ age: 22, yearsExp: 0, salary: 5, contractYears: 3 });
  const rookie = playerValue({ ...base, isRookieContract: true }, e);
  const vet = playerValue({ ...base, isRookieContract: false }, e);
  assert.ok(rookie.value >= vet.value, "fourth-year option is extra surplus");
  assert.ok(rookie.components.some((c) => c.key === "rookie"));
});

test("injury discount for Out / IR players", () => {
  const e = env();
  const healthy = playerValue(player(), e).value;
  const out = playerValue(player({ injuryStatus: "Out" }), e);
  const ir = playerValue(player({ injuryStatus: "IR" }), e);
  assert.ok(out.value < healthy);
  assert.ok(ir.value < out.value);
  assert.ok(out.components.find((c) => c.key === "injury")!.value < 0);
  // games already zeroed by projections aren't double counted
  const zeroed = playerValue(player({ injuryStatus: "Out", rosGames: 6, rosPoints: 6 * 18 }), e);
  assert.ok(Math.abs(zeroed.gamesMissed - 0.6) < 1e-9);
});

test("superflex premium only for QBs when a superflex slot exists", () => {
  assert.equal(isSuperflex(DEFAULT_SETTINGS), true);
  const qb = playerValue(player({ position: "QB", seasonPpg: 22, rosPoints: 7 * 22 }), env());
  assert.ok(qb.components.some((c) => c.key === "superflex"));
  const oneQb = deepMerge(DEFAULT_SETTINGS, { roster: { slots: DEFAULT_SETTINGS.roster.slots.filter((s) => s.key !== "SFLEX") } });
  assert.equal(isSuperflex(oneQb), false);
  assert.ok(!playerValue(player({ position: "QB", seasonPpg: 22 }), env({}, oneQb)).components.some((c) => c.key === "superflex"));
});

test("contender vs rebuild weighting", () => {
  const e = env();
  const vet = player({ age: 29, position: "RB", seasonPpg: 20, rosPoints: 140 });
  assert.ok(playerValue(vet, e, "contender").value > playerValue(vet, e, "rebuild").value);
  const pick = { season: 2028, round: 1, originalTeamId: "x", pickInRound: null };
  assert.ok(pickValue(pick, e, "rebuild").value > pickValue(pick, e, "contender").value);
});

test("pick curve: 1.01 >> 1.12 > 2.01 > 2.12", () => {
  const v = (o: number) => pickCurve(o, 12);
  assert.ok(v(1) > v(12) * 3);
  assert.ok(v(12) > v(13));
  assert.ok(v(13) > v(24));
  assert.ok(Math.abs(v(12) / v(1) - PICK_ROUND_END_RATIO) < 1e-9);
  assert.equal(v(1), PICK_TOP_VALUE);
});

test("pick slots from standings for next year's draft, mid-round later", () => {
  const e = env();
  assert.equal(projectedPickSlot({ season: 2027, round: 1, originalTeamId: "worst", pickInRound: null }, e), 1);
  assert.equal(projectedPickSlot({ season: 2028, round: 1, originalTeamId: "worst", pickInRound: null }, e), 6.5);
  assert.equal(projectedPickSlot({ season: 2027, round: 1, originalTeamId: "best", pickInRound: 3 }, e), 3, "final order wins");
  // low confidence early in the season pulls toward the middle
  assert.equal(projectedPickSlot({ season: 2027, round: 1, originalTeamId: "worst", pickInRound: null }, env({ slotConfidence: 0.5 })), 3.75);
  const early = pickValue({ season: 2027, round: 1, originalTeamId: "worst", pickInRound: null }, e);
  const late = pickValue({ season: 2027, round: 1, originalTeamId: "best", pickInRound: null }, e);
  const future = pickValue({ season: 2029, round: 1, originalTeamId: "worst", pickInRound: null }, e);
  assert.ok(early.value > late.value);
  assert.equal(early.slotLabel, "1.01");
  assert.ok(future.components.some((c) => c.key === "year" && c.value < 0));
});

test("rookie scale salary by round and slot", () => {
  assert.equal(rookieScaleSalary(DEFAULT_SETTINGS, 1, 1), 10);
  assert.equal(rookieScaleSalary(DEFAULT_SETTINGS, 2, 12), 1);
  assert.equal(rookieScaleSalary(DEFAULT_SETTINGS, 3, 1), DEFAULT_SETTINGS.salaryCap.minSalary, "missing round → min salary");
});

test("FAB is worth a small amount per dollar and decays without rollover", () => {
  const full = faabValue(100, env({ remainingRegularWeeks: 14 })).value;
  const late = faabValue(100, env({ remainingRegularWeeks: 2 })).value;
  assert.ok(full > late);
  assert.ok(faabValue(10, env()).value < 2);
  const rollover = deepMerge(DEFAULT_SETTINGS, { waivers: { faabRollover: true } });
  assert.equal(faabValue(100, env({ remainingRegularWeeks: 0 }, rollover)).value, 12);
});

test("consolidation: two nickels are not a quarter", () => {
  assert.ok(Math.abs(consolidatedTotal([100]) - 100) < 1e-9);
  assert.ok(consolidatedTotal([50, 50]) < 100);
  assert.ok(consolidatedTotal([50, 50]) > 50);
  assert.ok(Math.abs(consolidatedTotal([40, -5]) - 35) < 1e-9, "liabilities subtract linearly");
  assert.equal(consolidatedTotal([]), 0);
});

test("evaluateTrade: fairness, verdicts and cap / roster impact", () => {
  const teams = [
    { teamId: "a", name: "Alpha", outlook: "balanced" as const, cap: { enabled: true, cap: 300, committed: 290, nextSeasonCommitted: 200, nextSeasonCap: 300 }, roster: { active: 27, maxActive: 27, ir: 0, irSlots: 3 } },
    { teamId: "b", name: "Bravo", outlook: "balanced" as const, cap: { enabled: true, cap: 300, committed: 250, nextSeasonCommitted: 200, nextSeasonCap: 300 }, roster: { active: 25, maxActive: 27, ir: 0, irSlots: 3 } },
  ];
  const fair = evaluateTrade({
    teams,
    assets: [
      { key: "P:1", type: "PLAYER", label: "Stud", fromTeamId: "b", toTeamId: "a", value: 60, components: [], salary: 20, capHit: 20 },
      { key: "P:2", type: "PLAYER", label: "Solid", fromTeamId: "a", toTeamId: "b", value: 58, components: [], salary: 10, capHit: 10 },
    ],
  });
  assert.equal(fair.verdict, "Fair");
  assert.ok(fair.fairness > 0.95);
  const a = fair.teams.find((t) => t.teamId === "a")!;
  assert.equal(a.cap!.after, 300);
  assert.equal(a.roster!.activeAfter, 27);

  const lopsided = evaluateTrade({
    teams,
    assets: [
      { key: "P:1", type: "PLAYER", label: "Stud", fromTeamId: "b", toTeamId: "a", value: 90, components: [], salary: 40, capHit: 40 },
      { key: "P:2", type: "PLAYER", label: "Depth", fromTeamId: "a", toTeamId: "b", value: 20, components: [], salary: 5, capHit: 5 },
      { key: "P:3", type: "PLAYER", label: "Depth 2", fromTeamId: "b", toTeamId: "a", value: 5, components: [], salary: 1, capHit: 1 },
    ],
  });
  assert.equal(lopsided.verdict, "Lopsided for Alpha");
  assert.equal(lopsided.favoredTeamId, "a");
  assert.ok(lopsided.warnings.some((w) => w.includes("over the $300 cap")));
  assert.ok(lopsided.warnings.some((w) => w.includes("drop")));
  // consolidation: two 50s for one 100 favors the side getting the 100
  const consol = evaluateTrade({
    teams: teams.map((t) => ({ ...t, cap: undefined, roster: undefined })),
    assets: [
      { key: "P:1", type: "PLAYER", label: "Quarter", fromTeamId: "b", toTeamId: "a", value: 100, components: [] },
      { key: "P:2", type: "PLAYER", label: "Nickel", fromTeamId: "a", toTeamId: "b", value: 50, components: [] },
      { key: "P:3", type: "PLAYER", label: "Nickel", fromTeamId: "a", toTeamId: "b", value: 50, components: [] },
    ],
  });
  assert.equal(consol.favoredTeamId, "a");
  assert.notEqual(consol.verdict, "Fair");
  // depth-for-depth swaps aren't "lopsided" just because 4 is twice 2
  const depth = evaluateTrade({
    teams: teams.map((t) => ({ ...t, cap: undefined, roster: undefined })),
    assets: [
      { key: "P:1", type: "PLAYER", label: "Depth A", fromTeamId: "b", toTeamId: "a", value: 3.9, components: [] },
      { key: "P:2", type: "PLAYER", label: "Depth B", fromTeamId: "a", toTeamId: "b", value: 2.1, components: [] },
    ],
  });
  assert.equal(depth.verdict, "Fair");
  // ...but giving a starter away for nothing still is
  const giveaway = evaluateTrade({ teams: teams.map((t) => ({ ...t, cap: undefined, roster: undefined })), assets: [{ key: "P:1", type: "PLAYER", label: "Starter", fromTeamId: "b", toTeamId: "a", value: 30, components: [] }] });
  assert.equal(giveaway.verdict, "Lopsided for Alpha");
});

test("evaluateTrade cap warnings: the league's ceiling and its name (soft-cap limit), hard caps unchanged", () => {
  const asset = (salary: number) => ({ key: "P:1", type: "PLAYER" as const, label: "Stud", fromTeamId: "b", toTeamId: "a", value: 40, components: [], salary, capHit: salary, nextSeasonSalary: salary });
  const team = (cap: Record<string, unknown>) => [
    { teamId: "a", name: "Alpha", outlook: "balanced" as const, cap: { enabled: true, cap: 300, committed: 290, nextSeasonCommitted: 290, nextSeasonCap: 300, ...cap } },
    { teamId: "b", name: "Bravo", outlook: "balanced" as const },
  ];
  // hard cap, no ceiling given: the cap is the ceiling and the wording is the same as before
  const hard = evaluateTrade({ teams: team({}), assets: [asset(20)] });
  assert.deepEqual(hard.warnings, ["Alpha would be $10 over the $300 cap."]);
  assert.deepEqual({ ...hard.teams[0]!.cap, limit: undefined }, { before: 290, after: 310, cap: 300, spaceAfter: -10, nextBefore: 290, nextAfter: 310, nextCap: 300, over: true, limit: undefined, nextLimit: 300, limitLabel: "cap" });
  assert.equal(hard.teams[0]!.cap!.limit, 300);
  // soft cap ($300 + $20): $310 is under the limit, nothing to warn about now — next season's limit too
  const softCap = { limit: 320, nextSeasonLimit: 320, limitLabel: "soft-cap limit" };
  const under = evaluateTrade({ teams: team(softCap), assets: [asset(20)] });
  assert.deepEqual(under.warnings, []);
  assert.equal(under.teams[0]!.cap!.over, false);
  assert.equal(under.teams[0]!.cap!.spaceAfter, -10, "room is still measured against the cap figure shown");
  const over = evaluateTrade({ teams: team(softCap), assets: [asset(40)] });
  assert.deepEqual(over.warnings, ["Alpha would be $10 over the $320 soft-cap limit."]);
  const nextOnly = evaluateTrade({ teams: team({ ...softCap, limit: 400 }), assets: [asset(40)] });
  assert.deepEqual(nextOnly.warnings, ["Alpha would have $330 committed next season (soft-cap limit $320)."]);
  // no ceiling (a soft cap without a maximum overage): never over
  const none = evaluateTrade({ teams: team({ limit: null, nextSeasonLimit: null, limitLabel: "soft-cap limit" }), assets: [asset(200)] });
  assert.deepEqual(none.warnings, []);
  assert.equal(none.teams[0]!.cap!.over, false);
});

test("verdict thresholds", () => {
  assert.equal(verdictFor(0.95, "X").verdict, "Fair");
  assert.equal(verdictFor(0.8, "X").verdict, "Slightly favors X");
  assert.equal(verdictFor(0.5, "X").verdict, "Lopsided for X");
});

test("team outlook classification", () => {
  const teams = Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i + 1}`, rank: i + 1 }));
  const o = classifyOutlooks(teams, { playoffTeams: 6, gamesPlayed: 10 });
  assert.equal(o.t1, "contender");
  assert.equal(o.t5, "contender");
  assert.equal(o.t6, "balanced");
  assert.equal(o.t12, "rebuild");
  assert.equal(o.t9, "rebuild");
  assert.equal(classifyOutlooks(teams, { playoffTeams: 6, gamesPlayed: 1 }).t1, "balanced", "too early to tell");
  assert.equal(classifyOutlooks([{ teamId: "x", rank: 12, playoffPct: 0.7 }], { playoffTeams: 6, gamesPlayed: 10 }).x, "contender", "playoff odds win");
});
