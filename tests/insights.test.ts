import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { toAssignment, type Assignment } from "@/lib/team/lineup-model";
import {
  ageByPosition,
  byePlanner,
  contractYearsHistogram,
  defenseVsPosition,
  difficultyFor,
  efficiencyTable,
  findLineupWarnings,
  lineupTotals,
  placeInLineup,
  positionNeeds,
  positionStrength,
  startersByPosition,
  startSitAnalysis,
  waiverUpgrades,
  weekEfficiency,
  type StartSitPlayer,
} from "@/lib/insights/engine";

const S: LeagueSettings = structuredClone(DEFAULT_SETTINGS);
const slots = expandSlots(S);

function sp(id: string, pos: string, proj: number, extra: Partial<StartSitPlayer> = {}): StartSitPlayer {
  return { id, name: id, pos, projected: proj, liveProjected: proj, variance: 50, locked: false, ...extra };
}

function roster() {
  const list = [
    sp("qb1", "QB", 22), sp("qb2", "QB", 18),
    sp("rb1", "RB", 15), sp("rb2", "RB", 12), sp("rb3", "RB", 9), sp("rb4", "RB", 14),
    sp("wr1", "WR", 16), sp("wr2", "WR", 14), sp("wr3", "WR", 11), sp("wr4", "WR", 13),
    sp("te1", "TE", 9), sp("k1", "K", 8), sp("def1", "DEF", 7),
  ];
  return new Map(list.map((p) => [p.id, p]));
}

const current = (): Assignment =>
  toAssignment(
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

test("placeInLineup re-routes starters through flex slots", () => {
  const players = roster();
  const pos = new Map([...players.values()].map((p) => [p.id, p.pos]));
  // remove WR3 and place RB4: RB4 can't play WR, so FLEX's RB3... RB4 takes FLEX? FLEX is occupied by RB3;
  // the only free slot is WR#2 which needs a WR -> place should fail without a WR
  const a = { ...current(), "WR#2": null };
  assert.equal(placeInLineup(a, slots, pos, "rb4"), null);
  // remove RB2 (RB#1 free) and place WR4: WR4 goes to FLEX, RB3 moves FLEX -> RB#1
  const b = { ...current(), "RB#1": null };
  const placed = placeInLineup(b, slots, pos, "wr4")!;
  assert.equal(placed["FLEX#0"], "wr4");
  assert.equal(placed["RB#1"], "rb3");
  // fixed slots are never touched
  assert.equal(placeInLineup(b, slots, pos, "wr4", new Set(["FLEX#0"])), null);
});

test("startSitAnalysis finds one-for-one swaps with valid lineups", () => {
  const players = roster();
  const optimal = { ...current(), "FLEX#0": "rb4", "WR#2": "wr4" };
  const res = startSitAnalysis({ slots, current: current(), optimal, players });
  assert.equal(res.gain, 7); // (14-9) + (13-11)
  assert.equal(res.swaps.length, 2);
  const [a, b] = res.swaps;
  assert.equal(a.inId, "rb4");
  assert.equal(a.outId, "rb3");
  assert.equal(a.gain, 5);
  assert.equal(b.inId, "wr4");
  assert.equal(b.outId, "wr3");
  assert.equal(b.gain, 2);
  // each swap lineup keeps everything else
  assert.equal(a.lineup["WR#2"], "wr3");
  assert.equal(a.totals.liveProjected, res.current.liveProjected + 5);
});

test("startSitAnalysis never swaps out locked starters and fills empty slots first", () => {
  const players = roster();
  players.get("rb3")!.locked = true;
  const cur = { ...current(), "K#0": null };
  const optimal = { ...cur, "K#0": "k1" };
  const res = startSitAnalysis({ slots, current: cur, optimal, players });
  assert.equal(res.swaps.length, 1);
  assert.equal(res.swaps[0].outId, null);
  assert.equal(res.swaps[0].slot, "K#0");
  assert.equal(res.swaps[0].gain, 8);
});

test("lineupTotals adds base points and variance", () => {
  const players = roster();
  const t = lineupTotals({ "QB#0": "qb1", "RB#0": "rb1" }, players, { liveProjected: 1, variance: 2 });
  assert.equal(t.liveProjected, 38);
  assert.equal(t.variance, 102);
});

test("defenseVsPosition ranks defenses (1 = toughest)", () => {
  const rows = [
    { pos: "WR", opponent: "KC", week: 1, points: 30 },
    { pos: "WR", opponent: "KC", week: 2, points: 20 },
    { pos: "WR", opponent: "BUF", week: 1, points: 50 },
    { pos: "QB", opponent: "BUF", week: 1, points: 10 },
    { pos: "WR", opponent: "DEN", week: 2, points: 10 },
  ];
  const t = defenseVsPosition(rows, ["QB", "WR"]);
  assert.equal(t.get("WR", "KC")?.perGame, 25);
  assert.equal(t.get("WR", "DEN")?.rank, 1);
  assert.equal(t.get("WR", "BUF")?.rank, 3);
  assert.equal(t.get("QB", "KC")?.perGame, 0);
  assert.equal(t.teamCount.WR, 3);
  assert.equal(difficultyFor(1, 32), "tough");
  assert.equal(difficultyFor(16, 32), "avg");
  assert.equal(difficultyFor(30, 32), "easy");
});

test("weekEfficiency uses the best possible lineup from the pool", () => {
  const players = [...roster().values()].map((p) => ({ id: p.id, position: p.pos }));
  const points = new Map<string, number>([...roster().values()].map((p) => [p.id, p.projected]));
  points.set("rb4", 30); // big bench game
  const starters = Object.values(current()).filter((x): x is string => !!x);
  const e = weekEfficiency(3, starters, players, points, S);
  assert.equal(e.actual, 141);
  assert.equal(e.optimal, 141 - 9 + 30 + (13 - 11));
  assert.equal(e.left, e.optimal - e.actual);
  assert.ok(e.pct < 1 && e.pct > 0.8);
  const table = efficiencyTable([
    { teamId: "a", weeks: [e] },
    { teamId: "b", weeks: [{ week: 3, actual: 100, optimal: 100, left: 0, pct: 1 }] },
  ]);
  assert.equal(table[0].teamId, "b");
  assert.equal(table[1].rank, 2);
});

test("position needs and waiver upgrades", () => {
  const need = startersByPosition(slots);
  assert.equal(need.QB, 1);
  assert.equal(need.RB, 2);
  assert.equal(need.WR, 3);
  const mine = positionStrength([{ pos: "RB", value: 10 }, { pos: "RB", value: 4 }, { pos: "WR", value: 20 }], need);
  assert.equal(mine.RB, 7);
  const other = positionStrength([{ pos: "RB", value: 20 }, { pos: "RB", value: 18 }], need);
  const needs = positionNeeds("me", [
    { teamId: "me", strength: mine },
    { teamId: "x", strength: other },
  ]);
  assert.equal(needs.find((n) => n.pos === "RB")?.rank, 2);
  const ups = waiverUpgrades(
    "RB",
    2,
    [{ id: "a", name: "A", pos: "RB", value: 10 }, { id: "b", name: "B", pos: "RB", value: 4 }],
    [{ id: "f1", pos: "RB", value: 6 }, { id: "f2", pos: "RB", value: 3 }, { id: "f3", pos: "WR", value: 50 }],
  );
  assert.equal(ups.length, 1);
  assert.equal(ups[0].player.id, "f1");
  assert.equal(ups[0].replaces, "B");
  assert.equal(ups[0].upgrade, 2);
});

test("byePlanner flags positions that can't be covered", () => {
  const byes = new Map([["KC", [10]], ["BUF", [12]]]);
  const plan = byePlanner(
    [10, 11, 12],
    [
      { id: "q1", name: "Q1", pos: "QB", team: "KC", starter: true, unavailable: false },
      { id: "q2", name: "Q2", pos: "QB", team: "BUF", starter: true, unavailable: false },
      { id: "t1", name: "T1", pos: "TE", team: "KC", starter: true, unavailable: false },
    ],
    byes,
    { QB: 1, TE: 1 },
  );
  assert.equal(plan[0].onBye.length, 2);
  assert.deepEqual(plan[0].short.map((s) => s.pos), ["TE"]);
  assert.equal(plan[1].onBye.length, 0);
  assert.equal(plan[2].startersOnBye, 1);
  assert.equal(plan[2].short.length, 0);
});

test("age snapshot and contract histogram", () => {
  const rows = ageByPosition([{ pos: "RB", age: 24 }, { pos: "RB", age: 26 }], [{ pos: "RB", age: 28 }, { pos: "WR", age: 25 }], ["QB", "RB", "WR"]);
  assert.deepEqual(rows.map((r) => r.pos), ["RB", "WR"]);
  assert.equal(rows[0].mine, 25);
  const h = contractYearsHistogram([{ contractYears: 1 }, { contractYears: 1 }, { contractYears: 3 }, { contractYears: 7 }], 5);
  assert.deepEqual(h.map((x) => x.count), [2, 0, 1, 0, 1]);
});

test("findLineupWarnings: injured / bye / empty starters within the reminder window", () => {
  const now = new Date("2026-11-22T16:30:00Z");
  const games = new Map([
    ["KC", { startTime: new Date("2026-11-22T18:00:00Z"), state: "pre" }],
    ["BUF", { startTime: new Date("2026-11-22T18:00:00Z"), state: "pre" }],
    ["DAL", { startTime: new Date("2026-11-23T01:20:00Z"), state: "pre" }],
    ["NYG", { startTime: new Date("2026-11-22T15:00:00Z"), state: "in" }],
  ]);
  const players = new Map([
    ["p1", { id: "p1", fullName: "Out Guy", team: "KC", injuryStatus: "Out" }],
    ["p2", { id: "p2", fullName: "Late Out", team: "DAL", injuryStatus: "Out" }],
    ["p3", { id: "p3", fullName: "Bye Guy", team: "MIA", injuryStatus: null }],
    ["p4", { id: "p4", fullName: "Healthy", team: "BUF", injuryStatus: "Questionable" }],
    ["p5", { id: "p5", fullName: "Locked", team: "NYG", injuryStatus: "Out" }],
  ]);
  const lineup = {
    ...Object.fromEntries(slots.map((s) => [`${s.key}#${s.index}`, null])),
    "QB#0": "p1",
    "RB#0": "p2",
    "RB#1": "p3",
    "WR#0": "p4",
    "WR#1": "p5",
  } as Assignment;
  const w = findLineupWarnings({ slots, lineup, players, games, now, hoursBefore: 2, isLocked: (t) => t === "NYG" });
  const keys = w.map((x) => x.key).sort();
  // p1 Out (kickoff in 1.5h), p3 bye (next kickoff 1.5h), empty slots; not p2 (kickoff 9h away), not p4, not locked p5
  assert.ok(keys.includes("p1"));
  assert.ok(keys.includes("p3"));
  assert.ok(!keys.includes("p2"));
  assert.ok(!keys.includes("p4"));
  assert.ok(!keys.includes("p5"));
  assert.ok(keys.includes("WR#2"));
  assert.equal(findLineupWarnings({ slots, lineup, players, games, now, hoursBefore: 0, isLocked: () => false }).length, 0);
});
