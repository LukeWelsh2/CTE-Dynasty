import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adpScore,
  ageMultiplier,
  autoTiers,
  draftCapitalFromMetadata,
  draftCapitalScore,
  hasTePremium,
  isSuperflex,
  mergeRanks,
  movedIndexes,
  positionMultiplier,
  rankingKey,
  rankMovement,
  rookieAutoScore,
  searchRankScore,
} from "@/lib/rookies/logic";
import { DEFAULT_SETTINGS } from "@/lib/settings/schema";

test("signal scores are bounded and monotonic", () => {
  assert.ok(searchRankScore(10)! > searchRankScore(100)!);
  assert.equal(searchRankScore(9_999_999), null);
  assert.equal(searchRankScore(null), null);
  assert.ok(adpScore(5)! > adpScore(50)!);
  assert.equal(adpScore(1000), null);
  assert.ok(draftCapitalScore(1, 1)! > draftCapitalScore(1, 20)!);
  assert.ok(draftCapitalScore(1, 32)! > draftCapitalScore(3, 1)!);
  assert.equal(draftCapitalScore(null, null), null);
});

test("superflex and TE premium detection from settings", () => {
  assert.equal(isSuperflex(DEFAULT_SETTINGS), true);
  assert.equal(hasTePremium(DEFAULT_SETTINGS), true);
  const oneQb = { roster: { ...DEFAULT_SETTINGS.roster, slots: DEFAULT_SETTINGS.roster.slots.filter((s) => s.key !== "SFLEX") } };
  assert.equal(isSuperflex(oneQb), false);
  assert.ok(positionMultiplier("QB", { superflex: true, tePremium: false }) > positionMultiplier("QB", { superflex: false, tePremium: false }));
  assert.ok(positionMultiplier("TE", { superflex: true, tePremium: true }) > positionMultiplier("TE", { superflex: true, tePremium: false }));
});

test("age multiplier favors younger prospects within bounds", () => {
  assert.ok(ageMultiplier(21) > ageMultiplier(24));
  assert.equal(ageMultiplier(null), 1);
  assert.ok(ageMultiplier(18) <= 1.06 && ageMultiplier(30) >= 0.92);
});

test("auto score uses available signals only", () => {
  const opts = { superflex: true, tePremium: true };
  const strong = rookieAutoScore({ searchRank: 15, adp: 10, position: "WR", age: 21 }, opts);
  const weak = rookieAutoScore({ searchRank: 900, adp: null, position: "WR", age: 24 }, opts);
  assert.ok(strong > weak);
  assert.equal(rookieAutoScore({ position: "WR" }, opts), 0);
  // superflex QB outranks a comparable WR
  assert.ok(rookieAutoScore({ searchRank: 50, adp: 40, position: "QB", age: 22 }, opts) > rookieAutoScore({ searchRank: 50, adp: 40, position: "WR", age: 22 }, opts));
});

test("mergeRanks keeps pinned ranks and fills around them", () => {
  const order = mergeRanks(
    [{ key: "pin-a", rank: 1 }, { key: "pin-b", rank: 3 }],
    [{ key: "x", score: 90 }, { key: "y", score: 95 }, { key: "z", score: 10 }],
  );
  assert.deepEqual(order, ["pin-a", "y", "pin-b", "x", "z"]);
  // colliding pinned ranks slide down; out-of-range ranks go last
  assert.deepEqual(mergeRanks([{ key: "p1", rank: 2 }, { key: "p2", rank: 2 }, { key: "p3", rank: 99 }], [{ key: "a", score: 1 }]), ["a", "p1", "p2", "p3"]);
  assert.deepEqual(mergeRanks([], [{ key: "b", score: 1 }, { key: "a", score: 2 }]), ["a", "b"]);
});

test("auto tiers break on big drops", () => {
  assert.deepEqual(autoTiers([100, 98, 97, 80, 79, 50]), [1, 1, 1, 2, 2, 3]);
  assert.deepEqual(autoTiers([]), []);
});

test("movement + keys", () => {
  assert.equal(rankMovement(10, 4), 6);
  assert.equal(rankMovement(null, 4), 0);
  assert.equal(rankingKey({ playerId: "123", position: "WR" }), "p:123");
  assert.equal(rankingKey({ prospectName: "Arch Manning", position: "QB" }), "x:archmanning:QB");
});

test("draft capital from metadata variants", () => {
  assert.deepEqual(draftCapitalFromMetadata({ draft_round: "1", draft_pick: "7" }), { round: 1, pick: 7 });
  assert.deepEqual(draftCapitalFromMetadata({ draft_overall: 40 }), { round: 2, pick: 8 });
  assert.deepEqual(draftCapitalFromMetadata({ rookie_year: "2026" }), { round: null, pick: null });
  assert.deepEqual(draftCapitalFromMetadata(null), { round: null, pick: null });
});

test("movedIndexes finds the minimal set of moved rows", () => {
  // moving rank 5 to the top shifts 1-4 down by one, but only the moved row is "moved"
  assert.deepEqual([...movedIndexes([5, 1, 2, 3, 4])], [0]);
  // swapping two neighbours marks one of them
  assert.equal(movedIndexes([2, 1, 3]).size, 1);
  // new rows (null previous rank) always count as moved
  assert.deepEqual([...movedIndexes([1, null, 2])], [1]);
  assert.equal(movedIndexes([1, 2, 3]).size, 0);
});
