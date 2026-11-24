import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { salaryInYear } from "@/lib/roster";
import {
  faabForNewSeason,
  keptSalary,
  pickSeasonsAfterRollover,
  planRollover,
  pruneDeadCap,
  rolloverConfirmText,
  rolloverPhaseProblem,
  utcToZonedLocal,
  zonedLocalToUtc,
  type RolloverSpot,
} from "@/lib/season/logic";

function settings(patch: (s: LeagueSettings) => void = () => {}): LeagueSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
}

function spot(id: string, over: Partial<RolloverSpot> = {}): RolloverSpot {
  return {
    id: `spot-${id}`,
    teamId: "A",
    playerId: id,
    name: `Player ${id}`,
    status: "ACTIVE",
    salary: 10,
    contractYears: 1,
    keeperCount: 0,
    isRookieContract: false,
    isFranchiseTagged: false,
    yearsExp: 3,
    rookieYear: 2023,
    ...over,
  };
}

test("rollover plan: designated expiring kept, undesignated released, others decrement with raises", () => {
  const s = settings((x) => {
    x.contracts.annualRaisePercent = 10;
    x.keepers.tradeCarriesKeeperCost = false;
  });
  const plan = planRollover({
    settings: s,
    fromSeason: 2026,
    spots: [spot("kept"), spot("cut"), spot("multi", { salary: 20, contractYears: 3 }), spot("traded", { teamId: "B" })],
    designations: [
      { teamId: "A", playerId: "kept", keeperSalary: 11, contractYears: 1, status: "LOCKED" },
      // trades don't carry keeper status in this league: the previous owner's designation is void
      { teamId: "A", playerId: "traded", keeperSalary: 11, contractYears: 1, status: "DESIGNATED" },
    ],
  });
  assert.equal(plan.toSeason, 2027);
  const by = new Map(plan.actions.map((a) => [a.spot.playerId, a]));
  assert.equal(by.get("kept")?.kind, "KEEP");
  const kept = by.get("kept");
  assert.ok(kept && kept.kind === "KEEP" && kept.salary === 11 && kept.contractYears === 1);
  assert.equal(by.get("cut")?.kind, "RELEASE");
  const multi = by.get("multi");
  assert.ok(multi && multi.kind === "ROLL" && multi.salary === 22 && multi.contractYears === 2);
  assert.equal(by.get("traded")?.kind, "RELEASE");
  assert.deepEqual(plan.byTeam.get("A"), { teamId: "A", kept: 1, released: 1, rolled: 1, promoted: 0, payrollNext: 33 });
});

test("annual raises honor raiseAppliesTo and raiseRounding", () => {
  const base = (x: LeagueSettings) => (x.contracts.annualRaisePercent = 10);
  const spots = [spot("vet", { salary: 15, contractYears: 3, yearsExp: 6 }), spot("rook", { salary: 15, contractYears: 3, isRookieContract: true, yearsExp: 1 }), spot("young", { salary: 15, contractYears: 3, yearsExp: 2 })];
  const salaries = (patch: (s: LeagueSettings) => void) =>
    Object.fromEntries(
      planRollover({ settings: settings((x) => (base(x), patch(x))), fromSeason: 2026, spots, designations: [] }).actions.map((a) => [a.spot.playerId, a.kind === "RELEASE" ? 0 : a.salary]),
    );
  assert.deepEqual(salaries(() => {}), { vet: 17, rook: 17, young: 17 }); // 16.5 → nearest 17
  assert.deepEqual(salaries((x) => (x.contracts.raiseRounding = "DOWN")), { vet: 16, rook: 16, young: 16 });
  assert.deepEqual(salaries((x) => (x.contracts.raiseAppliesTo = "ALL_EXCEPT_ROOKIE")), { vet: 17, rook: 15, young: 17 });
  assert.deepEqual(salaries((x) => (x.contracts.raiseAppliesTo = "VETERANS_ONLY")), { vet: 17, rook: 15, young: 15 });
});

test("rollover promotes taxi players who are no longer taxi-eligible", () => {
  const plan = planRollover({ settings: settings(), fromSeason: 2026, spots: [spot("t", { status: "TAXI", contractYears: 3, rookieYear: 2025, yearsExp: 1 })], designations: [] });
  const a = plan.actions[0];
  assert.ok(a.kind === "ROLL" && a.status === "ACTIVE" && a.promoted);
  assert.equal(plan.byTeam.get("A")?.promoted, 1);
});

test("keepers disabled: expiring contracts end; no contracts and no keepers: everyone stays", () => {
  const off = planRollover({ settings: settings((x) => (x.keepers.enabled = false)), fromSeason: 2026, spots: [spot("x")], designations: [] });
  assert.equal(off.actions[0].kind, "RELEASE");
  const none = planRollover({
    settings: settings((x) => {
      x.keepers.enabled = false;
      x.contracts.enabled = false;
    }),
    fromSeason: 2026,
    spots: [spot("x", { contractYears: 1 })],
    designations: [],
  });
  assert.equal(none.actions[0].kind, "ROLL");
});

test("keeper-league mode (contracts off) requires designations for everyone", () => {
  const s = settings((x) => (x.contracts.enabled = false));
  const plan = planRollover({ settings: s, fromSeason: 2026, spots: [spot("a", { contractYears: 3 }), spot("b", { contractYears: 3 })], designations: [{ teamId: "A", playerId: "a", keeperSalary: 12, contractYears: 2, status: "DESIGNATED" }] });
  assert.deepEqual(
    plan.actions.map((a) => a.kind),
    ["KEEP", "RELEASE"],
  );
});

test("FAB resets to the budget, carrying unused FAB only when the league allows it", () => {
  assert.deepEqual(faabForNewSeason(37, settings()), { budget: 100, carry: 0, total: 100 });
  assert.deepEqual(faabForNewSeason(37, settings((s) => (s.waivers.faabRollover = true))), { budget: 100, carry: 37, total: 137 });
  assert.deepEqual(faabForNewSeason(-5, settings((s) => (s.waivers.faabRollover = true))), { budget: 100, carry: 0, total: 100 });
});

test("expired dead money is cleared", () => {
  assert.deepEqual(
    pruneDeadCap(
      [
        { teamId: "A", season: 2026, amount: 5 },
        { teamId: "A", season: 2027, amount: 3 },
        { teamId: "B", season: 2028, amount: 2 },
      ],
      2027,
    ),
    [
      { teamId: "A", season: 2027, amount: 3 },
      { teamId: "B", season: 2028, amount: 2 },
    ],
  );
});

test("rollover phase guard and confirmation text", () => {
  assert.equal(rolloverPhaseProblem("OFFSEASON", false), null);
  assert.equal(rolloverPhaseProblem("KEEPER", false), null);
  assert.match(rolloverPhaseProblem("REGULAR", false)!, /Regular season/);
  assert.equal(rolloverPhaseProblem("REGULAR", true), null);
  assert.equal(rolloverConfirmText(2027), "ROLLOVER 2027");
  assert.deepEqual(pickSeasonsAfterRollover(2027, settings()), [2027, 2028, 2029, 2030]);
});

test("datetime-local values convert to and from the league time zone", () => {
  const winter = zonedLocalToUtc("2027-02-10T20:00", "America/New_York");
  assert.equal(winter?.toISOString(), "2027-02-11T01:00:00.000Z");
  const summer = zonedLocalToUtc("2027-07-04T12:30", "America/New_York");
  assert.equal(summer?.toISOString(), "2027-07-04T16:30:00.000Z");
  assert.equal(zonedLocalToUtc("2027-02-10T20:00", "America/Los_Angeles")?.toISOString(), "2027-02-11T04:00:00.000Z");
  assert.equal(zonedLocalToUtc("not a date", "America/New_York"), null);
  assert.equal(utcToZonedLocal("2027-02-11T01:00:00.000Z", "America/New_York"), "2027-02-10T20:00");
  assert.equal(utcToZonedLocal(null, "America/New_York"), "");
});

test("a designated keeper traded away stays kept by his new team when trades carry keeper status", () => {
  const s = settings((x) => (x.keepers.tradeCarriesKeeperCost = true));
  const plan = planRollover({
    settings: s,
    fromSeason: 2026,
    spots: [spot("traded", { teamId: "B" })],
    designations: [{ teamId: "A", playerId: "traded", keeperSalary: 11, contractYears: 1, status: "LOCKED", currentSalary: 10 }],
  });
  const a = plan.actions[0];
  assert.equal(a.kind, "KEEP");
  assert.equal(a.spot.teamId, "B");
  assert.equal(plan.byTeam.get("B")?.kept, 1);
  // a RELEASED designation never applies
  const void_ = planRollover({ settings: s, fromSeason: 2026, spots: [spot("x")], designations: [{ teamId: "A", playerId: "x", keeperSalary: 11, contractYears: 1, status: "RELEASED" }] });
  assert.equal(void_.actions[0].kind, "RELEASE");
});

test("keeper salary is re-derived when the contract changed after the designation", () => {
  const s = settings(); // PERCENT 10, min +1
  assert.equal(keptSalary({ keeperSalary: 11, currentSalary: 10 }, { salary: 10 }, s), 11);
  assert.equal(keptSalary({ keeperSalary: 11, currentSalary: 10 }, { salary: 30 }, s), 33);
  assert.equal(keptSalary({ keeperSalary: 11 }, { salary: 30 }, s), 11); // no snapshot → trust the designation
  const plan = planRollover({
    settings: s,
    fromSeason: 2026,
    spots: [spot("ext", { salary: 30 })],
    designations: [{ teamId: "A", playerId: "ext", keeperSalary: 11, contractYears: 1, status: "LOCKED", currentSalary: 10 }],
  });
  const a = plan.actions[0];
  assert.ok(a.kind === "KEEP" && a.salary === 33);
});

test("rollover raises match salaryInYear in @/lib/roster for every raise mode", () => {
  for (const rounding of ["UP", "NEAREST", "DOWN"] as const)
    for (const appliesTo of ["ALL", "ALL_EXCEPT_ROOKIE", "VETERANS_ONLY"] as const) {
      const s = settings((x) => {
        x.contracts.annualRaisePercent = 7;
        x.contracts.raiseRounding = rounding;
        x.contracts.raiseAppliesTo = appliesTo;
      });
      for (const sp of [spot("v", { salary: 13, contractYears: 3, yearsExp: 6 }), spot("r", { salary: 13, contractYears: 3, isRookieContract: true, yearsExp: 1 }), spot("y", { salary: 13, contractYears: 3, yearsExp: 1 })]) {
        const a = planRollover({ settings: s, fromSeason: 2026, spots: [sp], designations: [] }).actions[0];
        assert.ok(a.kind === "ROLL");
        assert.equal(a.salary, salaryInYear(sp.salary, 1, s, sp), `${rounding}/${appliesTo}/${sp.playerId}`);
      }
    }
});
