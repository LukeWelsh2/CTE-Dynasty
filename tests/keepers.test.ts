import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { capHit, salaryInYear } from "@/lib/roster";
import {
  checkSelection,
  keeperCapEnforcement,
  designationApplies,
  salaryAfterRaises,
  countsTowardLimit,
  dueReminder,
  experienceNextSeason,
  keeperContractYears,
  keeperEligibility,
  keeperSalary,
  keeperWindowState,
  needsDesignation,
  projectNextSeason,
  statusNextSeason,
  type ProjectionSpot,
} from "@/lib/keepers/logic";

function settings(patch: (s: LeagueSettings) => void = () => {}): LeagueSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
}

function spot(id: string, over: Partial<ProjectionSpot> = {}): ProjectionSpot {
  return { playerId: id, status: "ACTIVE", salary: 10, contractYears: 1, keeperCount: 0, isRookieContract: false, yearsExp: 4, rookieYear: 2022, ...over };
}

test("keeper salary escalation: percent rounds up with a minimum increase, flat, none, clamps", () => {
  const pct = settings(); // PERCENT 10%, minIncrease 1
  assert.equal(keeperSalary(10, pct), 11);
  assert.equal(keeperSalary(25, pct), 28); // ceil(2.5) = 3
  assert.equal(keeperSalary(3, pct), 4); // min increase 1
  assert.equal(keeperSalary(1, settings((s) => (s.keepers.escalation = { type: "PERCENT", value: 10, minIncrease: 3 }))), 4);
  assert.equal(keeperSalary(10, settings((s) => (s.keepers.escalation = { type: "FLAT", value: 5, minIncrease: 0 }))), 15);
  assert.equal(keeperSalary(10, settings((s) => (s.keepers.escalation = { type: "NONE", value: 0, minIncrease: 0 }))), 10);
  assert.equal(keeperSalary(50, settings((s) => (s.salaryCap.maxSalary = 52))), 52);
});

test("only expiring contracts need a designation in dynasty mode; every player in keeper-league mode", () => {
  const s = settings();
  assert.equal(needsDesignation({ contractYears: 1 }, s), true);
  assert.equal(needsDesignation({ contractYears: 3 }, s), false);
  assert.equal(needsDesignation({ contractYears: 3 }, settings((x) => (x.contracts.enabled = false))), true);
  assert.equal(keeperContractYears({ contractYears: 1 }), 1);
  assert.equal(keeperContractYears({ contractYears: 3 }), 2);
});

test("eligibility: contract rollover, max years kept, IR, requireContractYears", () => {
  const s = settings();
  assert.deepEqual(keeperEligibility(spot("a"), s), { eligible: true, reason: null });
  assert.equal(keeperEligibility(spot("a", { contractYears: 2 }), s).eligible, false);
  assert.match(keeperEligibility(spot("a", { keeperCount: 2 }), settings((x) => (x.keepers.maxYearsKept = 2))).reason!, /Already kept 2 times/);
  assert.match(keeperEligibility(spot("a", { status: "IR" }), settings((x) => (x.keepers.allowKeepingIR = false))).reason!, /IR/);
  assert.equal(keeperEligibility(spot("a", { status: "IR" }), s).eligible, true);
  assert.match(keeperEligibility(spot("a"), settings((x) => (x.keepers.requireContractYears = true))).reason!, /contract years remaining/);
  assert.equal(keeperEligibility(spot("a"), settings((x) => (x.keepers.enabled = false))).eligible, false);
});

test("rookie contracts only count toward the limit when the league says so", () => {
  assert.equal(countsTowardLimit({ isRookieContract: true }, settings()), false);
  assert.equal(countsTowardLimit({ isRookieContract: true }, settings((s) => (s.keepers.rookiesCountTowardLimit = true))), true);
  assert.equal(countsTowardLimit({ isRookieContract: false }, settings()), true);
});

test("window state follows phase, window opening and deadline", () => {
  const now = new Date("2027-02-01T12:00:00Z");
  const base = settings();
  assert.equal(keeperWindowState({ settings: base, phase: "OFFSEASON", now }).status, "NOT_OPEN");
  assert.equal(keeperWindowState({ settings: base, phase: "KEEPER", now }).status, "OPEN");
  const opened = settings((s) => {
    s.keepers.windowOpens = "2027-01-20T12:00:00Z";
    s.keepers.deadline = "2027-02-10T12:00:00Z";
  });
  const w = keeperWindowState({ settings: opened, phase: "OFFSEASON", now });
  assert.equal(w.status, "OPEN");
  assert.equal(w.deadline?.toISOString(), "2027-02-10T12:00:00.000Z");
  assert.equal(keeperWindowState({ settings: opened, phase: "KEEPER", now: new Date("2027-02-11T00:00:00Z") }).status, "LOCKED");
  assert.equal(keeperWindowState({ settings: opened, phase: "KEEPER", now, locked: true }).status, "LOCKED");
  assert.equal(keeperWindowState({ settings: settings((s) => (s.keepers.enabled = false)), phase: "KEEPER", now }).status, "DISABLED");
});

test("taxi players who outgrow taxi eligibility are promoted next season", () => {
  const s = settings(); // taxiMaxYearsExp 1
  assert.equal(experienceNextSeason({ yearsExp: 0, rookieYear: 2026 }, 2027), 1);
  assert.equal(experienceNextSeason({ yearsExp: 0, rookieYear: null }, 2027), 1);
  assert.equal(statusNextSeason({ status: "TAXI", yearsExp: 0, rookieYear: 2026 }, s, 2027), "TAXI");
  assert.equal(statusNextSeason({ status: "TAXI", yearsExp: 1, rookieYear: 2025 }, s, 2027), "ACTIVE");
});

test("next season projection: rollovers with raises, kept players escalate, released drop off", () => {
  const s = settings((x) => {
    x.contracts.annualRaisePercent = 10;
    x.salaryCap.annualCapIncrease = 20;
  });
  const spots = [spot("roll", { salary: 20, contractYears: 3 }), spot("keep", { salary: 10 }), spot("cut", { salary: 30 }), spot("taxi", { salary: 4, contractYears: 3, status: "TAXI", yearsExp: 1, rookieYear: 2025 })];
  const p = projectNextSeason({ spots, designated: new Set(["keep"]), settings: s, nextSeason: 2027, deadMoney: 5 });
  const by = new Map(p.rows.map((r) => [r.playerId, r]));
  assert.equal(by.get("roll")?.outcome, "ROLLS");
  assert.equal(by.get("roll")?.salaryNext, 22);
  assert.equal(by.get("roll")?.yearsNext, 2);
  assert.equal(by.get("keep")?.outcome, "KEPT");
  assert.equal(by.get("keep")?.salaryNext, 11);
  assert.equal(by.get("cut")?.outcome, "RELEASED");
  assert.equal(by.get("taxi")?.statusNext, "ACTIVE"); // promoted → full cap hit
  assert.equal(by.get("taxi")?.capHitNext, 4);
  assert.equal(p.cap, 320);
  assert.equal(p.committed, 22 + 11 + 4 + 5);
  assert.equal(p.overCap, false);
});

test("selection check: max keepers, minimum warning, cap compliance, ineligible picks", () => {
  const s = settings((x) => {
    x.keepers.maxKeepers = 1;
    x.keepers.minKeepers = 1;
    x.salaryCap.cap = 15;
  });
  const spots = [spot("a", { salary: 10 }), spot("b", { salary: 2 }), spot("r", { salary: 1, isRookieContract: true }), spot("c", { contractYears: 2, salary: 1 })];
  const mk = (ids: string[]) => {
    const designated = new Set(ids);
    return checkSelection({ spots, designated, settings: s, projection: projectNextSeason({ spots, designated, settings: s, nextSeason: 2027, deadMoney: 0 }) });
  };
  assert.deepEqual(mk(["b"]).errors, []);
  assert.deepEqual(mk(["b", "r"]).errors, []); // rookie contract doesn't count toward the max
  assert.match(mk(["a", "b"]).errors.join(" "), /at most 1 player/);
  assert.match(mk([]).warnings.join(" "), /at least 1/);
  assert.match(mk(["a", "c"]).errors.join(" "), /rolls over automatically/);
  const capped = settings((x) => (x.salaryCap.cap = 5));
  const designated = new Set(["a"]);
  const res = checkSelection({ spots, designated, settings: capped, projection: projectNextSeason({ spots, designated, settings: capped, nextSeason: 2027, deadMoney: 0 }) });
  assert.match(res.errors.join(" "), /over the \$5 cap/);
});

test("deadline reminders: most urgent threshold only, missed ones skipped", () => {
  const deadline = new Date("2027-02-10T12:00:00Z");
  assert.equal(dueReminder(deadline, new Date("2027-02-01T00:00:00Z"), new Set()), null); // > 7 days out
  assert.deepEqual(dueReminder(deadline, new Date("2027-02-04T12:00:00Z"), new Set()), { key: "7d", label: "7 days", skip: [] });
  assert.equal(dueReminder(deadline, new Date("2027-02-04T12:00:00Z"), new Set(["7d"])), null);
  assert.deepEqual(dueReminder(deadline, new Date("2027-02-10T11:00:00Z"), new Set()), { key: "2h", label: "2 hours", skip: ["7d", "1d"] });
  assert.equal(dueReminder(deadline, new Date("2027-02-10T13:00:00Z"), new Set()), null); // passed
});

test("designations follow a traded player only when trades carry keeper status", () => {
  const carry = settings((x) => (x.keepers.tradeCarriesKeeperCost = true));
  const noCarry = settings((x) => (x.keepers.tradeCarriesKeeperCost = false));
  const d = { teamId: "A", status: "DESIGNATED" };
  assert.equal(designationApplies(d, "A", noCarry), true);
  assert.equal(designationApplies(d, "B", carry), true);
  assert.equal(designationApplies(d, "B", noCarry), false);
  assert.equal(designationApplies(d, null, carry), false); // released / unrostered
  assert.equal(designationApplies({ teamId: "A", status: "RELEASED" }, "A", carry), false);
  assert.equal(designationApplies(null, "A", carry), false);
});

test("keeper projections use the same raises and cap hits as @/lib/roster", () => {
  const s = settings((x) => {
    x.contracts.annualRaisePercent = 15;
    x.contracts.raiseRounding = "UP";
    x.contracts.raiseAppliesTo = "ALL_EXCEPT_ROOKIE";
    x.roster.taxiCountsAgainstCap = false;
    x.roster.taxiCapPercent = 50;
  });
  const spots = [spot("vet", { salary: 21, contractYears: 3 }), spot("rook", { salary: 21, contractYears: 3, isRookieContract: true, status: "TAXI", yearsExp: 0, rookieYear: 2026 })];
  const p = projectNextSeason({ spots, designated: new Set(), settings: s, nextSeason: 2027, deadMoney: 0 });
  const by = new Map(p.rows.map((r) => [r.playerId, r]));
  assert.equal(by.get("vet")!.salaryNext, salaryInYear(21, 1, s, spots[0]));
  assert.equal(by.get("vet")!.salaryNext, 25); // 24.15 rounded up
  assert.equal(by.get("rook")!.salaryNext, 21); // rookie deals don't escalate
  assert.equal(by.get("rook")!.capHitNext, capHit({ salary: 21, status: "TAXI" }, s));
  assert.equal(salaryAfterRaises(21, 2, s, spots[0]), salaryInYear(21, 2, s, spots[0]));
});

test("keepers must fit under next season's ceiling (capLimit), blocking per the offseason cap rule", () => {
  // next season's cap: $15 + $5 increase = $20; a $10 rollover + keeping "a" ($11) = $21
  const spots = [spot("roll", { salary: 10, contractYears: 2 }), spot("a", { salary: 10 })];
  const now = new Date("2027-02-01T12:00:00Z");
  const check = (patch: (s: LeagueSettings) => void, ids = ["a"], at = now) => {
    const s = settings((x) => {
      x.salaryCap.cap = 15;
      x.salaryCap.annualCapIncrease = 5;
      patch(x);
    });
    const designated = new Set(ids);
    const projection = projectNextSeason({ spots, designated, settings: s, nextSeason: 2027, deadMoney: 0 });
    return { projection, ...checkSelection({ spots, designated, settings: s, projection, now: at }) };
  };
  // hard cap, default offseason rule (BLOCK_OVER_CAP_MOVES): blocked as before
  const hard = check(() => {});
  assert.equal(hard.projection.limit, 20);
  assert.equal(hard.projection.overCap, true);
  assert.deepEqual(hard.errors, ["Next season's payroll would be $21, over the $20 cap."]);
  assert.deepEqual(check(() => {}, []).errors, [], "nothing kept: $10 fits");
  // soft cap: over the cap but under the soft-cap limit is fine; past the limit it's blocked
  const soft = check((x) => {
    x.salaryCap.capType = "SOFT";
    x.salaryCap.softCapMaxOverage = 3;
  });
  assert.equal(soft.projection.cap, 20);
  assert.equal(soft.projection.limit, 23);
  assert.equal(soft.projection.space, -1, "space is still measured against the cap");
  assert.equal(soft.projection.overCap, false);
  assert.deepEqual(soft.errors, []);
  const tight = check((x) => {
    x.salaryCap.capType = "SOFT";
    x.salaryCap.softCapMaxOverage = 0;
  });
  assert.deepEqual(tight.errors, ["Next season's payroll would be $21, over the $20 soft-cap limit."]);
  // a soft cap without a max overage never blocks keepers
  const open = check((x) => {
    x.salaryCap.capType = "SOFT";
    x.salaryCap.softCapMaxOverage = null;
  });
  assert.equal(open.projection.limit, null);
  assert.deepEqual([open.errors, open.warnings], [[], []]);
  // WARN_ONLY: allowed with a warning; ALLOW_UNTIL_COMPLIANCE_DATE: a warning until the date, then blocked
  const warn = check((x) => (x.salaryCap.offseasonEnforcement = "WARN_ONLY"));
  assert.deepEqual(warn.errors, []);
  assert.deepEqual(warn.warnings, ["Next season's payroll would be $21, over the $20 cap. The cap is only a warning in the offseason."]);
  const due = (x: LeagueSettings) => {
    x.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
    x.salaryCap.complianceDate = "2027-03-01";
  };
  assert.match(check(due).warnings.join(" "), /over the \$20 cap\. Allowed until the cap compliance deadline \(Mar 1, 2027\)\./);
  assert.deepEqual(check(due).errors, []);
  assert.deepEqual(check(due, ["a"], new Date("2027-03-02T05:00:00Z")).errors, ["Next season's payroll would be $21, over the $20 cap."]);
  // keepers count against next season's cap, so the offseason rule applies even while the window is open in season
  const strictInSeasonOff = check((x) => (x.salaryCap.enforceInSeason = false));
  assert.equal(keeperCapEnforcement(settings((x) => (x.salaryCap.enforceInSeason = false)), now), "BLOCK");
  assert.equal(strictInSeasonOff.errors.length, 1);
  // keepers.mustBeCapCompliant off, or no cap: nothing is checked
  assert.deepEqual(check((x) => (x.keepers.mustBeCapCompliant = false)).errors, []);
  const noCap = check((x) => (x.salaryCap.enabled = false));
  assert.deepEqual([noCap.projection.overCap, noCap.errors, noCap.warnings], [false, [], []]);
  assert.equal(keeperCapEnforcement(settings((x) => (x.salaryCap.enabled = false)), now), "OFF");
});
