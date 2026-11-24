import { test } from "node:test";
import assert from "node:assert/strict";
import { calcPoints } from "@/lib/scoring/engine";
import { DEFAULT_SETTINGS, deepMerge, resolveSettings } from "@/lib/settings/schema";

const scoring = DEFAULT_SETTINGS.scoring;

test("QB passing + bonuses", () => {
  const r = calcPoints({ pass_yd: 348, pass_td: 5, pass_int: 0, rush_yd: 15, pass_td_40p: 1 }, "QB", scoring);
  // 348*0.04=13.92 + 5*4=20 + 15*0.1=1.5 + 300yd bonus 2 + long TD 1
  assert.equal(r.points, 38.42);
});

test("TE premium applies only to TE", () => {
  const te = calcPoints({ rec: 6, rec_yd: 60 }, "TE", scoring);
  const wr = calcPoints({ rec: 6, rec_yd: 60 }, "WR", scoring);
  assert.equal(te.points, 15);
  assert.equal(wr.points, 12);
});

test("Kicker distance scoring", () => {
  const r = calcPoints({ fgm: 3, fgm_20_29: 1, fgm_40_49: 1, fgm_50_59: 1, xpm: 2, xpmiss: 1 }, "K", scoring);
  // 3 + 4 + 5 + 2 - 1
  assert.equal(r.points, 13);
});

test("Team defense tiers", () => {
  const r = calcPoints({ gp: 1, sack: 3, int: 1, fum_rec: 1, pts_allow: 13, yds_allow: 370 }, "DEF", scoring);
  // 3 + 2 + 2 + PA 13 => 4 + YA 370 => -1
  assert.equal(r.points, 10);
});

test("resolveSettings fills new keys while keeping overrides", () => {
  const s = resolveSettings({ scoring: { rules: { pass_td: 6 } }, roster: { taxiSlots: 5 } });
  assert.equal(s.scoring.rules.pass_td, 6);
  assert.equal(s.scoring.rules.rush_td, 6);
  assert.equal(s.roster.taxiSlots, 5);
  assert.equal(s.roster.irSlots, DEFAULT_SETTINGS.roster.irSlots);
  assert.deepEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] });
});
