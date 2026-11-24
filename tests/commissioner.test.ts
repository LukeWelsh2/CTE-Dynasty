import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, resolveSettings, withTombstones } from "@/lib/settings/schema";
import { SECTIONS, fieldEnabled, formatFieldValue, getAt, labelForPath, sectionFields, setAt, type EditableSection } from "@/lib/commissioner/settings-meta";
import { crossFieldIssues, detectPreset, parseScoring, parseSection, playoffEndWeek, scoringIssues, scoringSchema } from "@/lib/commissioner/settings-validate";
import { applyScoringPreset, applySection, changeSummary, describeChange, groupChanges, sectionLock, settingsChanges, settingsFromSnapshot, slotsStructureChanged, uniqueId } from "@/lib/commissioner/settings-logic";
import { buildSeasonSchedule, circleRounds, divisionRounds, weekPairingErrors, type SchedTeam } from "@/lib/commissioner/schedule-gen";
import { isoToLocalInput, localInputToIso } from "@/lib/commissioner/time";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const TEAM_IDS = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
const ctx = { teamIds: TEAM_IDS };

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

test("settings catalog covers every key of every editable section", () => {
  for (const sec of SECTIONS) {
    const paths = new Set(sectionFields(sec.key).map((f) => f.path));
    const missing: string[] = [];
    const walk = (obj: Record<string, unknown>, prefix: string) => {
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (paths.has(p)) continue;
        if (isPlain(v)) walk(v, p);
        else missing.push(`${sec.key}.${p}`);
      }
    };
    walk(DEFAULT_SETTINGS[sec.key] as unknown as Record<string, unknown>, "");
    assert.deepEqual(missing, [], `uncovered settings: ${missing.join(", ")}`);
    for (const p of paths) assert.notEqual(getAt(DEFAULT_SETTINGS[sec.key], p), undefined, `${sec.key}.${p} is not a real setting`);
  }
  const editable = SECTIONS.map((s) => s.key).sort();
  const all = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== "scoring").sort();
  assert.deepEqual(editable, all);
  assert.deepEqual(Object.keys(scoringSchema.shape).sort(), Object.keys(DEFAULT_SETTINGS.scoring).sort());
});

test("default settings pass every section schema and scoring schema", () => {
  for (const sec of SECTIONS) {
    const r = parseSection(sec.key, clone(DEFAULT_SETTINGS[sec.key]));
    assert.ok(r.ok, `${sec.key}: ${!r.ok ? JSON.stringify(r.issues) : ""}`);
    if (r.ok) assert.deepEqual(r.data, DEFAULT_SETTINGS[sec.key], `${sec.key} round-trips unchanged`);
  }
  const s = parseScoring(clone(DEFAULT_SETTINGS.scoring));
  assert.ok(s.ok);
});

test("section schema rejects out-of-range, wrong types and bad enums", () => {
  const cap = clone(DEFAULT_SETTINGS.salaryCap);
  (cap as Record<string, unknown>).cap = -5;
  let r: { ok: boolean; issues?: { path: string; message: string }[] } = parseSection("salaryCap", cap);
  assert.ok(!r.ok && r.issues!.some((i) => i.path === "cap"));

  const w = clone(DEFAULT_SETTINGS.waivers);
  (w as Record<string, unknown>).type = "BOGUS";
  r = parseSection("waivers", w);
  assert.ok(!r.ok && r.issues!.some((i) => i.path === "type"));

  const w2 = clone(DEFAULT_SETTINGS.waivers);
  w2.processDays = [];
  r = parseSection("waivers", w2);
  assert.ok(!r.ok && r.issues!.some((i) => i.path === "processDays"));

  const ro = clone(DEFAULT_SETTINGS.roster);
  ro.slots = [...ro.slots, { key: "QB", label: "QB2", count: 1, eligible: ["QB"] }];
  r = parseSection("roster", ro);
  assert.ok(!r.ok && r.issues!.some((i) => i.message.includes("unique")));

  const st = clone(DEFAULT_SETTINGS.standings);
  st.tiebreakers = ["H2H", "H2H"];
  r = parseSection("standings", st);
  assert.ok(!r.ok);

  const g = clone(DEFAULT_SETTINGS.general);
  (g as Record<string, unknown>).regularSeasonWeeks = 14.5;
  r = parseSection("general", g);
  assert.ok(!r.ok && r.issues!.some((i) => i.path === "regularSeasonWeeks"));
});

test("nullable numbers, datetimes and lists validate", () => {
  const k = clone(DEFAULT_SETTINGS.keepers);
  k.deadline = "not a date";
  assert.ok(!parseSection("keepers", k).ok);
  k.deadline = "2027-03-01T17:00:00.000Z";
  k.maxKeepers = null;
  assert.ok(parseSection("keepers", k).ok);

  const n = clone(DEFAULT_SETTINGS.niche);
  n.custom = [{ id: "a", title: "", description: "x", enabled: true, since: null }];
  assert.ok(!parseSection("niche", n).ok, "custom rule title required");
  n.custom = [{ id: "a", title: "No tanking", description: "Start a full lineup", enabled: true }];
  const r = parseSection("niche", n);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.data.custom[0].since, null, "missing since becomes null");
});

test("cross-field checks catch inconsistent rules", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.playoffs.byes = 1; // 6 teams - 1 bye = 5 -> odd
  let r = crossFieldIssues("playoffs", s, ctx);
  assert.ok(r.errors.some((e) => e.path === "byes"));

  s.playoffs.byes = 2;
  s.playoffs.startWeek = 14; // regular season ends week 14
  r = crossFieldIssues("playoffs", s, ctx);
  assert.ok(r.errors.some((e) => e.path === "startWeek"));

  s.playoffs.startWeek = 17; // 3 rounds -> ends week 19
  r = crossFieldIssues("playoffs", s, ctx);
  assert.ok(r.errors.some((e) => e.message.includes("Week 19")));

  const d = clone(DEFAULT_SETTINGS);
  d.draft.rookie.orderMethod = "LOTTERY";
  d.draft.rookie.lottery.odds = [50, 30, 10];
  r = crossFieldIssues("draft", d, ctx);
  assert.ok(r.errors.some((e) => e.path === "rookie.lottery.odds"));
  d.draft.rookie.lottery.odds = [25, 20, 17.5, 15, 12.5, 10];
  assert.equal(crossFieldIssues("draft", d, ctx).errors.length, 0);

  const ro = clone(DEFAULT_SETTINGS);
  ro.roster.slots.push({ key: "DL", label: "DL", count: 1, eligible: ["DL"] });
  r = crossFieldIssues("roster", ro, ctx);
  assert.ok(r.errors.some((e) => e.message.includes("IDP")));
  ro.roster.idpEnabled = true;
  ro.roster.positionLimits.RB = { min: 0, max: 1 }; // 2 RB slots
  r = crossFieldIssues("roster", ro, ctx);
  assert.ok(r.errors.some((e) => e.path === "positionLimits"));

  const m = clone(DEFAULT_SETTINGS);
  m.matchups.rivalries = [["t1", "t2"], ["t2", "t3"]];
  r = crossFieldIssues("matchups", m, ctx);
  assert.ok(r.errors.some((e) => e.message.includes("one rival")));

  for (const sec of SECTIONS) assert.deepEqual(crossFieldIssues(sec.key as EditableSection, clone(DEFAULT_SETTINGS), ctx).errors, [], `${sec.key} defaults have no errors`);
});

test("tombstones keep removed default map entries removed", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.scoring.positionOverrides = { QB: { pass_td: 6 } }; // TE premium removed
  delete (s.roster.positionLimits as Record<string, unknown>).K;
  delete (s.contracts.rookieScale as Record<string, unknown>)["2"];
  // without tombstones the default TE override would come back
  assert.deepEqual(resolveSettings(JSON.parse(JSON.stringify(s))).scoring.positionOverrides.TE, { rec: 1.5 });
  const stored = withTombstones(s);
  const back = resolveSettings(JSON.parse(JSON.stringify(stored)));
  assert.deepEqual(back.scoring.positionOverrides, { QB: { pass_td: 6 } });
  assert.equal(back.roster.positionLimits.K, undefined);
  assert.equal(back.contracts.rookieScale["2"], undefined);
  assert.deepEqual(back.contracts.rookieScale["1"], DEFAULT_SETTINGS.contracts.rookieScale["1"]);

  // removing one stat inside a default position keeps the others
  const t = clone(DEFAULT_SETTINGS);
  t.scoring.positionOverrides = { TE: { rec_yd: 0.15 } };
  const t2 = resolveSettings(JSON.parse(JSON.stringify(withTombstones(t))));
  assert.deepEqual(t2.scoring.positionOverrides, { TE: { rec_yd: 0.15 } });
  // resolve never exposes tombstone nulls
  assert.equal(Object.values(t2.scoring.positionOverrides.TE).every((v) => typeof v === "number"), true);
});

test("applySection + diff + grouped summaries", () => {
  const cur = clone(DEFAULT_SETTINGS);
  const cap = { ...cur.salaryCap, cap: 320, deadMoney: { ...cur.salaryCap.deadMoney, currentSeasonPercent: 40 } };
  const next = applySection(cur, "salaryCap", cap);
  assert.equal(next.salaryCap.cap, 320);
  assert.equal(next.waivers.faabBudget, cur.waivers.faabBudget);
  const changes = settingsChanges(cur, next);
  assert.deepEqual(changes.map((c) => c.path).sort(), ["salaryCap.cap", "salaryCap.deadMoney.currentSeasonPercent"]);
  const summary = changeSummary(groupChanges(changes, cur, next));
  assert.match(summary, /\$300 → \$320/);
  assert.match(summary, /50% → 40%/);

  const sc = clone(cur.contracts);
  sc.rookieScale["1"][0] = 12;
  sc.rookieScale["1"][1] = 11;
  const n2 = applySection(cur, "contracts", sc);
  const grouped = groupChanges(settingsChanges(cur, n2), cur, n2);
  assert.equal(grouped.length, 1, "rookie scale cells collapse into one change");
  assert.equal(grouped[0].path, "contracts.rookieScale");
  assert.match(labelForPath("salaryCap.deadMoney.futureSeasonPercent"), /Salary cap: Each future season/);
  assert.equal(labelForPath("scoring.positionOverrides.TE.rec"), "Scoring: TE Receptions override");
  assert.equal(labelForPath("scoring.rules.pass_td"), "Scoring: Passing TD");
});

test("slot structure change detection", () => {
  const a = clone(DEFAULT_SETTINGS.roster.slots);
  const b = clone(a);
  b[0].label = "Quarterback";
  assert.equal(slotsStructureChanged(a, b), false, "label-only change keeps lineups");
  b[1].count = 3;
  assert.equal(slotsStructureChanged(a, b), true);
  const c = clone(a).reverse();
  assert.equal(slotsStructureChanged(a, c), true, "reordering changes lineup slots");
});

test("scoring parse drops overrides equal to the base value and validates tiers", () => {
  const s = clone(DEFAULT_SETTINGS.scoring);
  s.positionOverrides = { TE: { rec: 1.5, rec_yd: 0.1 }, QB: { pass_td: 6 } };
  const r = parseScoring(s);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.data.positionOverrides, { TE: { rec: 1.5 }, QB: { pass_td: 6 } });

  const bad = clone(DEFAULT_SETTINGS.scoring);
  bad.fieldGoalsByDistance = [
    { min: 0, max: 39, points: 3 },
    { min: 35, max: 49, points: 4 },
  ];
  assert.ok(scoringIssues(bad).errors.some((e) => e.message.includes("overlap")));
  bad.fieldGoalsByDistance = [{ min: 20, max: 39, points: 3 }];
  assert.ok(scoringIssues(bad).warnings.some((w) => w.includes("under 20")));
  const dup = clone(DEFAULT_SETTINGS.scoring);
  dup.pointsAllowedTiers.push({ max: 0, points: 12 });
  assert.ok(scoringIssues(dup).errors.length > 0);
  const lt = clone(DEFAULT_SETTINGS.scoring) as unknown as { longTdBonuses: { minYards: number; points: number }[] };
  lt.longTdBonuses = [{ minYards: 30, points: 1 }];
  assert.ok(!parseScoring(lt).ok, "only 40/50 yard long TD buckets exist");
  assert.equal(scoringIssues(DEFAULT_SETTINGS.scoring).errors.length, 0);
});

test("scoring presets", () => {
  const base = DEFAULT_SETTINGS.scoring.rules;
  assert.equal(detectPreset(base, base), "PPR");
  const half = applyScoringPreset(DEFAULT_SETTINGS.scoring, "HALF_PPR");
  assert.equal(half.rules.rec, 0.5);
  assert.equal(half.preset, "HALF_PPR");
  assert.equal(detectPreset(half.rules, base), "HALF_PPR");
  assert.equal(detectPreset({ ...base, pass_td: 6 }, base), "CUSTOM");
  assert.equal(applyScoringPreset(DEFAULT_SETTINGS.scoring, "STANDARD").rules.rec, 0);
});

test("field helpers: setAt/getAt/enabledWhen/format", () => {
  const o = { a: { b: 1 }, c: 2 };
  const n = setAt(o, "a.b", 5);
  assert.equal(n.a.b, 5);
  assert.equal(o.a.b, 1, "immutable");
  assert.equal(getAt(n, "a.b"), 5);
  assert.equal(fieldEnabled({ enabledWhen: "type=FAB" }, { type: "FAB" }), true);
  assert.equal(fieldEnabled({ enabledWhen: "type=FAB" }, { type: "PRIORITY" }), false);
  assert.equal(fieldEnabled({ enabledWhen: "x" }, { x: false }), false);
  assert.equal(fieldEnabled({ enabledWhen: "rolloverMode=PERCENT_UNUSED|FULL_UNUSED" }, { rolloverMode: "FULL_UNUSED" }), true);
  const capField = sectionFields("salaryCap").find((f) => f.path === "cap")!;
  assert.equal(formatFieldValue(capField, 300), "$300");
  const tb = sectionFields("standings").find((f) => f.path === "tiebreakers")!;
  assert.equal(formatFieldValue(tb, ["H2H", "POINTS_FOR"]), "Head-to-head record → Points for");
  const dl = sectionFields("trades").find((f) => f.path === "deadlineWeek")!;
  assert.equal(formatFieldValue(dl, null), "No deadline");
  assert.equal(formatFieldValue(dl, 11), "Week 11");
  assert.equal(uniqueId("East Division", ["east-division"]), "east-division-2");
});

test("section locks", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.commissioner.lockedSectionsInSeason = ["scoring", "commissioner"];
  s.commissioner.sectionsRequiringVote = ["salaryCap"];
  assert.equal(sectionLock(s, "scoring", "REGULAR").locked, true);
  assert.equal(sectionLock(s, "scoring", "OFFSEASON").locked, false);
  assert.equal(sectionLock(s, "commissioner", "REGULAR").locked, false, "the commissioner section can always be unlocked");
  assert.equal(sectionLock(s, "salaryCap", "PLAYOFFS").requiresVote, true);
});

test("round robin + division weighted schedule", () => {
  const rounds = circleRounds(["a", "b", "c", "d"]);
  assert.equal(rounds.length, 3);
  const met = new Set(rounds.flat().map(([x, y]) => [x, y].sort().join("")));
  assert.equal(met.size, 6, "everyone plays everyone once");
  assert.equal(circleRounds(["a", "b", "c"]).flat().filter(([x, y]) => !x || !y).length, 3, "odd count gets byes");

  const teams: SchedTeam[] = TEAM_IDS.map((id, i) => ({ id, division: i < 6 ? "east" : "west" }));
  const div = divisionRounds(teams);
  assert.equal(div.length, 5);
  for (const r of div) for (const [a, b] of r) assert.equal(teams.find((t) => t.id === a)!.division, teams.find((t) => t.id === b)!.division);

  const s = clone(DEFAULT_SETTINGS);
  s.general.regularSeasonWeeks = 14;
  const rr = buildSeasonSchedule(teams, s);
  assert.equal(rr.length, 14 * 6);
  for (let w = 1; w <= 14; w++) {
    const wk = rr.filter((m) => m.week === w);
    assert.deepEqual(weekPairingErrors(wk, TEAM_IDS), [], `week ${w} valid`);
  }

  s.matchups.scheduleType = "DIVISION_WEIGHTED";
  const dw = buildSeasonSchedule(teams, s);
  const last3 = dw.filter((m) => m.week >= 12);
  for (const m of last3) assert.equal(teams.find((t) => t.id === m.homeTeamId)!.division, teams.find((t) => t.id === m.awayTeamId)!.division, "late weeks are division games");
  // repeat division meetings flip home/away
  const firstMeeting = dw.find((m) => m.week <= 11 && [m.homeTeamId, m.awayTeamId].sort().join() === [last3[0].homeTeamId, last3[0].awayTeamId].sort().join())!;
  assert.equal(firstMeeting.homeTeamId, last3[0].awayTeamId);

  s.matchups.rivalryWeek = 3;
  s.matchups.rivalries = [["t1", "t12"]];
  const rv = buildSeasonSchedule(teams, s).filter((m) => m.week === 3);
  assert.ok(rv.some((m) => [m.homeTeamId, m.awayTeamId].sort().join() === "t1,t12"));
  assert.ok(rv.every((m) => m.label === "Rivalry Week"));
  assert.deepEqual(weekPairingErrors(rv, TEAM_IDS), []);
});

test("week pairing errors", () => {
  const names = new Map([["t1", "Alpha"]]);
  assert.ok(weekPairingErrors([{ homeTeamId: "t1", awayTeamId: "t1" }], TEAM_IDS).some((e) => e.includes("itself")));
  assert.ok(
    weekPairingErrors(
      [
        { homeTeamId: "t1", awayTeamId: "t2" },
        { homeTeamId: "t3", awayTeamId: "t1" },
      ],
      TEAM_IDS,
      names,
    ).some((e) => e.includes("Alpha is scheduled 2 times")),
  );
});

test("league timezone datetime conversion", () => {
  assert.equal(localInputToIso("2026-12-01T13:30", "America/New_York"), "2026-12-01T18:30:00.000Z");
  assert.equal(localInputToIso("2026-07-01T13:30", "America/New_York"), "2026-07-01T17:30:00.000Z");
  assert.equal(isoToLocalInput("2026-12-01T18:30:00.000Z", "America/New_York"), "2026-12-01T13:30");
  assert.equal(isoToLocalInput("2026-12-01T18:30:00.000Z", "America/Los_Angeles"), "2026-12-01T10:30");
  assert.equal(localInputToIso("", "UTC"), null);
});

test("playoff end week", () => {
  const p = clone(DEFAULT_SETTINGS.playoffs);
  assert.equal(playoffEndWeek(p), 17);
  p.championshipWeeks = 2;
  assert.equal(playoffEndWeek(p), 18);
  p.teams = 0;
  assert.equal(playoffEndWeek(p), null);
});

test("diffs ignore jsonb key reordering", () => {
  const before = clone(DEFAULT_SETTINGS);
  const after = clone(DEFAULT_SETTINGS);
  // jsonb returns object keys sorted by length, then bytewise
  after.scoring.bonuses = after.scoring.bonuses.map((b) => ({ id: b.id, stat: b.stat, label: b.label, points: b.points, threshold: b.threshold }));
  after.scoring.fieldGoalsByDistance = after.scoring.fieldGoalsByDistance.map((r) => ({ max: r.max, min: r.min, points: r.points }));
  assert.deepEqual(settingsChanges(before, after), []);
  after.scoring.bonuses[0].points = 3;
  const ch = settingsChanges(before, after);
  assert.equal(ch.length, 1);
  assert.match(describeChange(groupChanges(ch, before, after)[0]), /300\+ passing yards \(\+2\).*→.*300\+ passing yards \(\+3\)/);
});

test("applySection keeps removed default map entries removed", () => {
  const cur = clone(DEFAULT_SETTINGS);
  const next = applySection(cur, "scoring", { ...cur.scoring, positionOverrides: {} });
  assert.deepEqual(next.scoring.positionOverrides, {});
  const ch = settingsChanges(cur, next);
  assert.deepEqual(ch.map((c) => c.path), ["scoring.positionOverrides.TE"]);
  const lim = applySection(cur, "roster", { ...cur.roster, positionLimits: { QB: { min: 0, max: 4 } } });
  assert.deepEqual(Object.keys(lim.roster.positionLimits), ["QB"]);
  const scale = applySection(cur, "contracts", { ...cur.contracts, rookieScale: { "1": [5, 4, 3] } });
  assert.deepEqual(scale.contracts.rookieScale, { "1": [5, 4, 3] });
});

test("snapshots restore removed map entries as removed and fill new keys", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.scoring.positionOverrides = { QB: { pass_td: 6 } };
  const snap = JSON.parse(JSON.stringify(s)) as Record<string, Record<string, unknown>>;
  delete snap.general.championTrophyName; // a key added after the snapshot was taken
  const back = settingsFromSnapshot(snap);
  assert.deepEqual(back.scoring.positionOverrides, { QB: { pass_td: 6 } });
  assert.equal(back.general.championTrophyName, DEFAULT_SETTINGS.general.championTrophyName);
});
