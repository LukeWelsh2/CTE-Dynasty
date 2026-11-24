import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, resolveSettings, withTombstones } from "@/lib/settings/schema";
import { SECTIONS, fieldEnabled, formatFieldValue, getAt, labelForPath, sectionFields, setAt, type EditableSection } from "@/lib/commissioner/settings-meta";
import { crossFieldIssues, detectPreset, normalizeBonus, parseScoring, parseSection, playoffEndWeek, scoringIssues, scoringSchema } from "@/lib/commissioner/settings-validate";
import {
  applyScoringPreset,
  applySection,
  changeSummary,
  describeChange,
  groupChanges,
  sectionLock,
  settingsChanges,
  settingsFromSnapshot,
  slotsStructureChanged,
  uniqueId,
  voteNote,
  voteOutcome,
} from "@/lib/commissioner/settings-logic";
import { amnestyStatus, capProblem, deadMoneyPreview, effectiveRosterSettings, forgiveEntries, luxuryTaxFor } from "@/lib/commissioner/roster-logic";
import { buildLedger, ledgerActive, luxuryTaxInDues, weeklyHighScorers } from "@/lib/commissioner/ledger";
import { auditDetail, auditLabel } from "@/lib/commissioner/audit-labels";
import { upcomingDeadlines } from "@/lib/commissioner/deadlines";
import {
  basicsProse,
  capProse,
  contractProse,
  draftProse,
  keeperProse,
  lineupProse,
  matchupProse,
  nicheProse,
  playoffProse,
  rosterProse,
  scoringProse,
  standingsTiebreakProse,
  tradeProse,
  waiverProse,
} from "@/lib/commissioner/rulebook";
import { decideWinner } from "@/lib/scoreboard-rules";
import { bracketGames, type StoredBracket } from "@/lib/playoffs/bracket";
import { championshipStatusFrom } from "@/lib/playoffs/elimination";
import { rulesFromSettings, waiverContractYears } from "@/lib/waivers/logic";
import { activeRosterLimit, capEnforcement, capLimit, rosterCheck, validateRoster } from "@/lib/roster";
import { contractCapCheck } from "@/lib/team/contracts";
import type { Matchup } from "@prisma/client";
import { describeCron } from "@/lib/commissioner/cron";
import { buildSeasonSchedule, circleRounds, divisionRounds, weekPairingErrors, type SchedTeam } from "@/lib/commissioner/schedule-gen";
import { isoToLocalInput, localInputToIso } from "@/lib/commissioner/time";
import { statCorrectionCutoff, statCorrectionsOpen } from "@/lib/commissioner/stat-corrections";

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

// ───────────── league vote, roster limits, amnesty, ledger, deadlines, rulebook, dead money ─────────────

test("league vote outcome honors the threshold", () => {
  // 67% of 12 managers = 8.04 -> 9 yes votes needed
  const fail = voteOutcome({ yes: 8, no: 4 }, 12, 67);
  assert.equal(fail.needed, 9);
  assert.equal(fail.passed, false);
  assert.match(fail.error!, /8 of 12/);
  const pass = voteOutcome({ yes: 9, no: 3 }, 12, 67);
  assert.equal(pass.passed, true);
  assert.equal(pass.pct, 75);
  assert.match(voteNote(pass), /9–3/);
  // exactly on the threshold passes (50% of 12 = 6)
  assert.equal(voteOutcome({ yes: 6, no: 6 }, 12, 50).passed, true);
  // more votes than managers is rejected
  assert.match(voteOutcome({ yes: 10, no: 5 }, 12, 50).error!, /only 12 managers/);
  // unanimity
  assert.equal(voteOutcome({ yes: 11, no: 1 }, 12, 100).passed, false);
});

test("offseason roster limit applies until the cutdown date", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.roster.offseasonMaxActiveRoster = 35;
  s.roster.rosterCutdownDate = "2027-08-30T16:00:00.000Z";
  assert.equal(effectiveRosterSettings(s, "OFFSEASON", new Date("2027-03-01T00:00:00Z")).roster.maxActiveRoster, 35);
  assert.equal(effectiveRosterSettings(s, "OFFSEASON", new Date("2027-09-01T00:00:00Z")).roster.maxActiveRoster, s.roster.maxActiveRoster);
  assert.equal(effectiveRosterSettings(s, "REGULAR", new Date("2027-03-01T00:00:00Z")).roster.maxActiveRoster, s.roster.maxActiveRoster);
  s.roster.rosterCutdownDate = null;
  assert.equal(effectiveRosterSettings(s, "KEEPER", new Date()).roster.maxActiveRoster, 35);
  s.roster.offseasonMaxActiveRoster = null;
  assert.equal(effectiveRosterSettings(s, "OFFSEASON", new Date()), s, "unchanged object when there is no offseason limit");
});

test("amnesty status and dead money helpers", () => {
  const s = clone(DEFAULT_SETTINGS);
  assert.deepEqual(amnestyStatus(s, 0), { allowed: 0, used: 0, remaining: 0 });
  s.salaryCap.deadMoney.amnestyCutsPerTeam = 2;
  assert.deepEqual(amnestyStatus(s, 1), { allowed: 2, used: 1, remaining: 1 });
  assert.equal(amnestyStatus(s, 5).remaining, 0);
  s.salaryCap.deadMoney.enabled = false;
  assert.equal(amnestyStatus(s, 0).allowed, 0, "no amnesty without dead money");

  const d = clone(DEFAULT_SETTINGS); // 50% now, 25% per future year
  const prev = deadMoneyPreview({ salary: 20, contractYears: 3, isRookieContract: false }, d, 2026, 12);
  assert.deepEqual(prev.bySeason, [
    { season: 2026, amount: 10 },
    { season: 2027, amount: 5 },
    { season: 2028, amount: 5 },
  ]);
  assert.equal(prev.total, 20);
  assert.equal(deadMoneyPreview({ salary: 1, contractYears: 3, isRookieContract: false }, d, 2026, 12).total, 0, "minimum salary cuts are free");
  d.salaryCap.deadMoney.rookieContractsExempt = true;
  assert.match(deadMoneyPreview({ salary: 9, contractYears: 2, isRookieContract: true }, d, 2026, 12).reason!, /Rookie/);

  const entries = [
    { teamId: "a", season: 2026, amount: 10 },
    { teamId: "a", season: 2027, amount: 5 },
    { teamId: "b", season: 2026, amount: 3 },
  ];
  assert.equal(forgiveEntries(entries, "a", 2026).amount, 10);
  const all = forgiveEntries(entries, "a", null);
  assert.equal(all.amount, 15);
  assert.deepEqual(all.kept, [{ teamId: "b", season: 2026, amount: 3 }]);
});

test("money ledger: dues, fines, fees and weekly prizes", () => {
  const s = clone(DEFAULT_SETTINGS);
  const teams = [
    { id: "a", name: "Alpha", abbrev: "AL" },
    { id: "b", name: "Bravo", abbrev: "BR" },
  ];
  assert.equal(ledgerActive(s), false);
  s.general.leagueDues = 100;
  s.general.duesPaidTeamIds = ["a"];
  s.niche.emptyStarterFine = 5;
  s.waivers.addDropFee = 2;
  s.niche.weeklyHighScorePrize = 10;
  assert.equal(ledgerActive(s), true);
  const high = weeklyHighScorers([
    { teamId: "a", week: 1, points: 120 },
    { teamId: "b", week: 1, points: 110 },
    { teamId: "a", week: 2, points: 90 },
    { teamId: "b", week: 2, points: 90 }, // tie shares the week
  ]);
  assert.deepEqual(high.get("a"), [1, 2]);
  assert.deepEqual(high.get("b"), [2]);
  const l = buildLedger(s, { teams, emptySlots: new Map([["b", 3]]), acquisitions: new Map([["a", 4], ["b", 1]]), highScoreWeeks: high });
  const a = l.rows.find((r) => r.teamId === "a")!;
  const b = l.rows.find((r) => r.teamId === "b")!;
  assert.equal(a.owed, 8, "paid dues + 4 moves x $2");
  assert.equal(a.winnings, 20);
  assert.equal(b.fines, 15);
  assert.equal(b.owed, 100 + 15 + 2);
  assert.equal(l.totals.duesCollected, 100);
  assert.equal(l.totals.duesOutstanding, 100);
  assert.equal(l.totals.pot, 200 + 15 + 10);
  // turning a charge off removes it from what is owed
  s.waivers.addDropFee = 0;
  const l2 = buildLedger(s, { teams, emptySlots: new Map(), acquisitions: new Map([["a", 4]]), highScoreWeeks: new Map() });
  assert.equal(l2.rows[0].fees, 0);
  assert.equal(l2.show.fees, false);
});

test("upcoming deadlines come from the settings, soonest first", () => {
  const s = clone(DEFAULT_SETTINGS);
  const now = new Date("2026-11-24T12:00:00Z");
  s.general.leagueDues = 50;
  s.general.duesDueDate = "2026-11-20T12:00:00.000Z"; // 4 days ago: shown as passed
  s.salaryCap.complianceDate = "2026-11-26T12:00:00.000Z";
  s.salaryCap.overCapPenalty = "FORFEIT_PICK";
  s.keepers.deadline = "2025-01-01T00:00:00.000Z"; // long past: hidden
  s.niche.reverseScoringWeek = 13;
  const list = upcomingDeadlines(s, { now, week: 12 });
  const keys = list.map((d) => d.key);
  assert.ok(!keys.includes("keeper-deadline"));
  assert.ok(!keys.includes("trade-deadline"), "trade deadline week 11 is behind week 12");
  assert.ok(keys.includes("playoffs") && keys.includes("reverse") && keys.includes("compliance") && keys.includes("dues"));
  assert.equal(list.find((d) => d.key === "dues")!.passed, true);
  assert.match(list.find((d) => d.key === "compliance")!.detail!, /forfeit a draft pick/);
  assert.ok(keys.indexOf("dues") < keys.indexOf("compliance"));
  assert.ok(keys.indexOf("compliance") < keys.indexOf("reverse"));
  assert.ok(keys.indexOf("reverse") < keys.indexOf("playoffs"));
});

test("rulebook prose reflects the settings", () => {
  const s = clone(DEFAULT_SETTINGS);
  assert.match(capProse(s).join(" "), /hard salary cap of \$300/);
  s.salaryCap.enabled = false;
  assert.deepEqual(capProse(s), ["There is no salary cap."]);
  assert.match(rosterProse(s).join(" "), /starts 11 players/);
  assert.match(scoringProse(s).join(" "), /full point-per-reception/);
  assert.match(scoringProse(s).join(" "), /TE receptions 1\.5/);
  assert.match(playoffProse(s, { teamNames: new Map(), teamCount: 12, season: 2026 }).join(" "), /6 of 12 teams make the playoffs \(Weeks 15-17\)/);
  s.playoffs.teams = 0;
  assert.match(playoffProse(s, { teamNames: new Map(), teamCount: 12, season: 2026 })[0], /no playoffs/);
  assert.match(waiverProse(s).join(" "), /\$100 per season/);
  assert.match(contractProse(s).join(" "), /or his current salary, if higher/);
  assert.equal(nicheProse(s).length > 0, true, "taco trophy is on by default");
  s.niche.emptyStarterFine = 5;
  assert.match(nicheProse(s).join(" "), /\$5 fine/);
});

test("cron descriptions", () => {
  assert.equal(describeCron("*/20 * * * * *"), "Every 20 seconds");
  assert.equal(describeCron("*/10 * * * *"), "Every 10 minutes");
  assert.equal(describeCron("7 * * * *"), "Hourly at :07");
  assert.equal(describeCron("20 */6 * * *"), "Every 6 hours at :20");
  assert.equal(describeCron("15 4 * * *"), "Daily at 4:15 AM ET");
  assert.equal(describeCron("0 9 * * 2"), "0 9 * * 2");
});

test("scoring normalization: no-op bonus edits are not changes", () => {
  const s = clone(DEFAULT_SETTINGS);
  const edited = clone(s.scoring);
  edited.bonuses[0].positions = [];
  edited.bonuses[0].repeatEvery = null;
  const parsed = parseScoring(edited);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.deepEqual(settingsChanges(s.scoring, parsed.data), [], "empty positions / null repeat equal the defaults");
  assert.equal("positions" in parsed.data.bonuses[0], false);
  edited.bonuses[0].positions = ["QB"];
  edited.bonuses[0].repeatEvery = 50;
  const p2 = parseScoring(edited);
  assert.ok(p2.ok && p2.data.bonuses[0].positions?.[0] === "QB" && p2.data.bonuses[0].repeatEvery === 50);
  assert.deepEqual(normalizeBonus({ id: "x", label: "X", stat: "rec", threshold: 5, points: 1, positions: [], repeatEvery: 0 }), { id: "x", label: "X", stat: "rec", threshold: 5, points: 1 });
});

test("soft cap: cap problems and luxury tax", () => {
  const s = clone(DEFAULT_SETTINGS); // hard $300 cap
  assert.equal(capProblem(300, s), null);
  assert.match(capProblem(310, s)!, /over the \$300 cap by \$10/);
  assert.equal(luxuryTaxFor(310, s), 0, "hard caps have no luxury tax");
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 25;
  s.salaryCap.luxuryTaxRate = 1.5;
  assert.equal(capProblem(320, s), null, "within the allowed overage");
  assert.match(capProblem(330, s)!, /over the \$325 soft-cap limit by \$5/);
  assert.equal(luxuryTaxFor(320, s), 30);
  assert.equal(luxuryTaxFor(301, s), 2, "rounded up to whole dollars");
  assert.equal(luxuryTaxFor(300, s), 0);
  s.salaryCap.softCapMaxOverage = null;
  assert.equal(capProblem(5000, s), null, "no ceiling");
  s.salaryCap.enabled = false;
  assert.equal(capProblem(5000, s), null);
  assert.equal(luxuryTaxFor(5000, s), 0);
});

test("money ledger collects luxury tax paid as dues", () => {
  const s = clone(DEFAULT_SETTINGS);
  const teams = [
    { id: "a", name: "Alpha", abbrev: "AL" },
    { id: "b", name: "Bravo", abbrev: "BR" },
  ];
  s.salaryCap.capType = "SOFT";
  s.salaryCap.luxuryTaxRate = 1;
  s.salaryCap.luxuryTaxPaidAs = "FAAB";
  assert.equal(luxuryTaxInDues(s), false);
  assert.equal(ledgerActive(s), false);
  s.salaryCap.luxuryTaxPaidAs = "DUES";
  assert.equal(ledgerActive(s), true, "a real-money luxury tax turns the ledger on");
  const l = buildLedger(s, { teams, emptySlots: new Map(), acquisitions: new Map(), highScoreWeeks: new Map(), luxuryTax: new Map([["a", 12]]) });
  assert.equal(l.show.tax, true);
  assert.equal(l.rows.find((r) => r.teamId === "a")!.owed, 12);
  assert.equal(l.rows.find((r) => r.teamId === "b")!.owed, 0);
  assert.equal(l.totals.tax, 12);
  assert.equal(l.totals.pot, 12);
});

test("audit labels cover other modules' actions", () => {
  assert.equal(auditLabel("settings.update"), "Updated league settings");
  assert.equal(auditLabel("live.simulation.start"), "Started a live scoring simulation");
  assert.equal(auditLabel("widgets.big_reset"), "Widgets: big reset");
  assert.equal(auditLabel("foo.bar.baz_qux"), "Foo: bar baz qux");
  assert.equal(auditLabel("solo"), "Solo");
  assert.equal(auditDetail({ headline: "CP sends Burrow to H2H", note: "fair" }), "CP sends Burrow to H2H · fair");
  assert.equal(auditDetail({ week: 12 }), "Week 12");
  assert.equal(auditDetail({ version: 3, sections: ["salaryCap"] }), "v3 · Salary cap");
  assert.equal(auditDetail(null), "");
});

test("rulebook does not promise co-managers the site can't support", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.general.allowCoManagers = true;
  assert.ok(!basicsProse(s, { teamNames: new Map(), teamCount: 12, season: 2026 }).join(" ").includes("co-manager"));
});

test("audit details don't repeat what the summary says", () => {
  assert.equal(
    auditDetail({ summary: "Commissioner added $1 FAB to Concussion Protocol: QA credit", note: "QA credit", team: "Concussion Protocol" }),
    "Commissioner added $1 FAB to Concussion Protocol: QA credit",
  );
  assert.equal(auditDetail({ summary: "CP Week 12: +1.5 pts", reason: "Stat correction", team: "Concussion Protocol" }), "CP Week 12: +1.5 pts · Concussion Protocol · Stat correction");
});

test("stat-correction cutoff follows the league day, hour and timezone", () => {
  const s = clone(DEFAULT_SETTINGS); // Thursday 6 AM, America/New_York
  // Monday night game 8:15 PM ET (Nov 23 2026, EST = UTC-5)
  const mnf = new Date("2026-11-24T01:15:00Z");
  assert.equal(statCorrectionCutoff(mnf, s).toISOString(), "2026-11-26T11:00:00.000Z", "Thu Nov 26 6 AM EST");
  assert.equal(statCorrectionsOpen(mnf, s, new Date("2026-11-26T10:59:00Z")), true);
  assert.equal(statCorrectionsOpen(mnf, s, new Date("2026-11-26T11:00:00Z")), false);
  assert.equal(statCorrectionsOpen(null, s), true, "no games yet");
  // a cutoff day equal to the game day rolls to the next week (at least 12h after kickoff)
  s.general.statCorrectionDay = "MON";
  s.general.statCorrectionHour = 23;
  assert.equal(statCorrectionCutoff(mnf, s).toISOString(), "2026-12-01T04:00:00.000Z", "Mon Nov 30 11 PM EST");
  // other timezones and DST (Sept: EDT = UTC-4)
  s.general.statCorrectionDay = "WED";
  s.general.statCorrectionHour = 9;
  s.general.timezone = "America/Los_Angeles";
  assert.equal(statCorrectionCutoff(new Date("2026-09-15T00:15:00Z"), s).toISOString(), "2026-09-16T16:00:00.000Z", "Wed Sep 16 9 AM PDT");
});

// ───────────── settings that nothing applies yet, legacy options, rulebook accuracy ─────────────

const RC = { teamNames: new Map<string, string>(), teamCount: 12, season: 2026 };
const flat = () => SECTIONS.flatMap((sec) => sec.groups.flatMap((g) => g.fields.map((f) => ({ key: `${sec.key}.${f.path}`, f }))));

test("'Not yet enforced' help text and the notEnforced flag stay in sync", () => {
  for (const { key, f } of flat()) {
    assert.equal(!!f.notEnforced, f.help.startsWith("Not yet enforced"), `${key}: flag and help text disagree`);
    if (!f.notEnforced) assert.ok(!/not yet enforced/i.test(f.help), `${key}: unflagged help mentions "not yet enforced"`);
  }
  // the audited list of settings nothing on the site applies yet (update with the code, not around it)
  assert.deepEqual(
    flat()
      .filter(({ f }) => f.notEnforced)
      .map(({ key }) => key)
      .sort(),
    [
      "commissioner.managersSeeOtherQueues",
      "contracts.auctionWinnerChoosesYears",
      "contracts.inSeasonPickupMaxYears",
      "contracts.rfaMatchWindowHours",
      "contracts.undraftedRookieSalary",
      "general.allowCoManagers",
      "general.maxManagersPerTeam",
      "general.showInactiveTeams",
      "lineup.autoSetForInactiveManagers",
      "niche.guillotine",
      "niche.guillotineEliminatedPerWeek",
      "niche.hallOfFameEnabled",
      "roster.taxiMaxSeasonsOnTaxi",
      "roster.taxiOwnerCanMatchPoach",
      "roster.taxiPoachCompensation",
      "roster.taxiPoachSalaryMultiplier",
      "roster.taxiPoachingAllowed",
      "salaryCap.allowCapSpaceTrading",
      "salaryCap.deadMoney.deadMoneyTradable",
      "salaryCap.emptyRosterSpotCharge",
      "salaryCap.rolloverMax",
      "salaryCap.rolloverMode",
      "salaryCap.rolloverPercent",
      "waivers.newPlayersStartOnWaivers",
    ],
  );
  // option values that aren't applied yet say so in their label
  const opts = flat().flatMap(({ key, f }) => ("options" in f ? f.options.filter((o) => /not yet enforced/i.test(o.label)).map((o) => `${key}=${o.value}`) : []));
  assert.deepEqual(opts.sort(), [
    "contracts.expiredContractsBecome=RFA",
    "matchups.format=ALL_PLAY",
    "matchups.format=POINTS_ONLY",
    "matchups.oddTeamCountPolicy=MEDIAN_OPPONENT",
    "roster.illegalRosterPolicy=BLOCK_MOVES",
    "roster.irActivationPolicy=AUTO_BENCH",
    "salaryCap.luxuryTaxPaidAs=NEXT_YEAR_CAP",
  ]);
  // the settings the foundation now enforces no longer carry a note
  for (const key of [
    "lineup.lockOffsetMinutes",
    "lineup.defaultCarryOver",
    "lineup.bestBall",
    "lineup.autoSubOutPlayers",
    "lineup.benchPointsTiebreaker",
    "matchups.allowTies",
    "niche.reverseScoringWeek",
    "niche.minimumStartersOrForfeit",
    "roster.illegalRosterPolicy",
    "roster.taxiPlayersCanStart",
    "roster.offseasonMaxActiveRoster",
    "salaryCap.capType",
    "salaryCap.deadMoney.preseasonCutPercent",
    "salaryCap.deadMoney.retirementForgives",
    "general.statCorrectionDay",
    "playoffs.eliminatedTeamsCanTransact",
    "waivers.eliminatedTeamsCanAdd",
    "draft.rookie.tradingDuringDraft",
    "keepers.releasedPlayersReturnTo",
  ]) {
    const hit = flat().find((x) => x.key === key);
    assert.ok(hit && !hit.f.notEnforced, `${key} is enforced`);
  }
});

test("draft order: the duplicate potential-points method stays valid but is marked legacy", () => {
  const field = sectionFields("draft").find((f) => f.path === "rookie.orderMethod")!;
  assert.ok(field.kind === "select");
  if (field.kind !== "select") return;
  assert.deepEqual(field.options.filter((o) => o.legacy).map((o) => o.value), ["REVERSE_POTENTIAL_POINTS"]);
  for (const method of ["REVERSE_MAX_PF", "REVERSE_POTENTIAL_POINTS"] as const) {
    const d = clone(DEFAULT_SETTINGS.draft);
    d.rookie.orderMethod = method;
    assert.ok(parseSection("draft", d).ok, `${method} still saves`);
  }
  // both methods are the same rule in the rulebook (draft/logic.ts ranks both by max potential points)
  const a = clone(DEFAULT_SETTINGS);
  a.draft.rookie.orderMethod = "REVERSE_MAX_PF";
  const b = clone(DEFAULT_SETTINGS);
  b.draft.rookie.orderMethod = "REVERSE_POTENTIAL_POINTS";
  assert.deepEqual(draftProse(a), draftProse(b));
  assert.match(draftProse(a).join(" "), /max potential points \(each regular season week's best possible lineup/);
  assert.match(draftProse(a).join(" "), /Teams tied on max potential points/);
});

test("rulebook lineup prose follows the lineup and scoring rules", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.lineup.lockType = "PER_GAME";
  s.lineup.lockOffsetMinutes = 5;
  assert.match(lineupProse(s)[0], /each player locks 5 minutes before his own kickoff/);
  s.lineup.lockType = "SUNDAY_FIRST_GAME";
  assert.match(lineupProse(s)[0], /5 minutes before the first Sunday kickoff \(Thursday and Saturday players lock 5 minutes before their own kickoff\)/);
  s.lineup.lockOffsetMinutes = 0;
  assert.match(lineupProse(s)[0], /locks at the first Sunday kickoff/);
  s.lineup.defaultCarryOver = "EMPTY";
  assert.match(lineupProse(s).join(" "), /starts with empty starting slots .*first lineup of the season is filled automatically with your best projected lineup/);
  assert.ok(!lineupProse(s).join(" ").includes("later weeks you haven't changed"), "an empty week doesn't inherit last week's change");
  s.lineup.defaultCarryOver = "OPTIMAL_PROJECTED";
  assert.match(lineupProse(s).join(" "), /starts with your best projected lineup until you change it\. A lineup change also updates any later week that still shows the lineup you replaced/);
  s.lineup.defaultCarryOver = "PREVIOUS_WEEK";
  assert.match(lineupProse(s).join(" "), /starts with your previous lineup .* carries into later weeks you haven't changed\. Your first lineup of the season is filled automatically/);
  s.lineup.defaultCarryOver = "OPTIMAL_PROJECTED";
  s.lineup.autoSubOutPlayers = true;
  s.lineup.autoSubsMaxPerWeek = 2;
  s.lineup.autoSubRequireLaterKickoff = true;
  assert.match(lineupProse(s).join(" "), /highest-scoring eligible bench player who plays and kicks off later, up to 2 subs per week/);
  s.lineup.bestBall = true;
  const bb = lineupProse(s).join(" ");
  assert.match(bb, /Best ball/);
  assert.ok(!bb.includes("Auto-subs"), "auto-subs don't apply with best ball");
  s.niche.minimumStartersOrForfeit = 8;
  assert.match(
    lineupProse(s).join(" "),
    /fewer than 8 starters who play \(empty slots and starters on bye, ruled out or without a stat line don't count; auto-subs do\) loses its regular season matchup whatever the score; if both teams fall short, the score decides/,
  );
});

test("rulebook matchup tie prose agrees with decideWinner", () => {
  const side = (teamId: string) => ({ teamId, points: 100, benchPoints: 10, topStarter: 20 });
  const cases: [Partial<{ allowTies: boolean; tiebreaker: "NONE" | "BENCH_POINTS" | "HIGHEST_STARTER" | "HOME_TEAM"; bench: boolean }>, RegExp][] = [
    [{ allowTies: true, tiebreaker: "NONE", bench: false }, /Tied regular season matchups stay ties/],
    [{ allowTies: true, tiebreaker: "NONE", bench: true }, /goes to the team with more bench points; if still level, it stays a tie/],
    [{ allowTies: true, tiebreaker: "HOME_TEAM", bench: false }, /goes to the home team\./],
    [{ allowTies: false, tiebreaker: "NONE", bench: false }, /more bench points, then the team with the highest-scoring starter, then the home team\./],
    [{ allowTies: false, tiebreaker: "HIGHEST_STARTER", bench: true }, /highest-scoring starter, then the team with more bench points, then the home team\./],
  ];
  for (const [o, re] of cases) {
    const s = clone(DEFAULT_SETTINGS);
    s.matchups.allowTies = o.allowTies!;
    s.matchups.tiebreaker = o.tiebreaker!;
    s.lineup.benchPointsTiebreaker = o.bench!;
    const prose = matchupProse(s, RC).join(" ");
    assert.match(prose, re);
    // a dead-even game (same points, bench and top starter) stays a tie exactly when the rulebook says it can
    const tie = decideWinner(side("h"), side("a"), s) === null;
    assert.equal(tie, /stays? a tie|stay ties/.test(prose), JSON.stringify(o));
  }
  const s = clone(DEFAULT_SETTINGS);
  for (const format of ["ALL_PLAY", "POINTS_ONLY"] as const) {
    s.matchups.format = format;
    const p = matchupProse(s, RC).join(" ");
    assert.match(p, /^Matchups are head-to-head\./, `${format} isn't applied: standings count head-to-head results`);
    assert.ok(!/all-play \(every team/.test(p));
  }
  s.matchups.format = "H2H_PLUS_MEDIAN";
  assert.match(matchupProse(s, RC)[0], /league median: a score above the week's median is an extra win, below it an extra loss/);
  assert.match(matchupProse(s, { ...RC, teamCount: 11 }).join(" "), /one team has a bye each week/);
});

test("rulebook standings tiebreakers describe group ties and the last resort", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.standings.tiebreakers = ["H2H"];
  s.standings.divisionTiebreakers = ["DIVISION_RECORD"];
  s.general.divisions = [
    { id: "e", name: "East" },
    { id: "w", name: "West" },
  ];
  const p = standingsTiebreakProse(s);
  assert.match(p, /Standings tiebreakers: head-to-head record\./);
  assert.match(p, /Ties among three or more teams are broken as a group: head-to-head uses the record in games among the tied teams when they all met equally often \(otherwise only a clean sweep counts\); once a step separates teams, the teams still tied start the list again\./);
  assert.match(p, /Last resort: points for, then a coin flip drawn once per season\./);
  assert.match(p, /Division ranks use division record, then the overall standings order\./);
  s.standings.tiebreakers = ["POINTS_FOR", "COIN_FLIP"];
  assert.ok(!standingsTiebreakProse(s).includes("Last resort"), "nothing left to append");
  s.general.divisions = [];
  assert.ok(!standingsTiebreakProse(s).includes("Division ranks"));
});

test("rulebook playoff prose: tied games and eliminated teams", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.standings.playoffMatchupTiebreakers = ["BENCH_POINTS", "HIGHEST_STARTER"];
  assert.match(playoffProse(s, RC).join(" "), /never end in a tie: a tied game goes to more bench points, then the highest-scoring starter, then the higher seed\./);
  s.standings.playoffMatchupTiebreakers = ["COIN_FLIP"];
  s.playoffs.weeksPerRound = 2;
  assert.match(playoffProse(s, RC).join(" "), /a tied game \(combined score\) goes to a coin flip\./);
  s.playoffs.lockRostersInPlayoffs = false;
  s.playoffs.eliminatedTeamsCanTransact = true;
  s.waivers.eliminatedTeamsCanAdd = true;
  assert.ok(!playoffProse(s, RC).join(" ").includes("championship bracket"));
  s.waivers.eliminatedTeamsCanAdd = false;
  assert.match(playoffProse(s, RC).join(" "), /teams out of the championship bracket \(including teams that missed the playoffs\) can't add players or make waiver claims\. A first-round bye never eliminates a team/);
  s.playoffs.eliminatedTeamsCanTransact = false;
  assert.match(playoffProse(s, RC).join(" "), /can't add players, make waiver claims or trade\./);
  s.playoffs.lockRostersInPlayoffs = true;
  const locked = playoffProse(s, RC).join(" ");
  assert.match(locked, /Rosters lock once the playoffs begin/);
  assert.ok(!locked.includes("championship bracket"), "locked rosters already cover it");
});

test("rulebook roster, cap and trade prose promise nothing the site doesn't apply", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.roster.illegalRosterPolicy = "ZERO_POINTS";
  assert.match(rosterProse(s).join(" "), /over a roster limit .* at any time while a week is being played scores zero points that week/);
  s.roster.illegalRosterPolicy = "BLOCK_MOVES";
  assert.match(rosterProse(s).join(" "), /The commissioner resolves rosters that end up over a limit/);
  s.roster.taxiPoachingAllowed = true;
  s.roster.taxiPlayersCanStart = true;
  const ro = rosterProse(s).join(" ");
  assert.ok(!/poach/i.test(ro), "taxi poaching isn't applied");
  assert.ok(!/up to \d+ seasons?/.test(ro), "max seasons on taxi isn't applied");
  assert.match(ro, /Taxi players can be started/);
  s.roster.offseasonMaxActiveRoster = 40;
  s.roster.rosterCutdownDate = "2027-08-30T16:00:00.000Z";
  assert.match(
    rosterProse(s)[0],
    /Outside the regular season and playoffs \(until the roster cutdown deadline\), the limit is 40 active players for every move: adds, waiver claims, trades, the salary auction, IR activations and taxi promotions\./,
  );

  s.salaryCap.rolloverMode = "FULL_UNUSED";
  s.salaryCap.emptyRosterSpotCharge = 5;
  s.salaryCap.allowCapSpaceTrading = true;
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 25;
  s.salaryCap.luxuryTaxRate = 1.5;
  s.salaryCap.luxuryTaxPaidAs = "DUES";
  s.salaryCap.deadMoney.preseasonCutPercent = 25;
  s.salaryCap.deadMoney.retirementForgives = true;
  const cap = capProse(s).join(" ");
  assert.ok(!/rolls? over/i.test(cap), "cap rollover isn't applied");
  assert.ok(!/empty active-roster spot/i.test(cap), "empty roster spot charge isn't applied");
  assert.match(
    cap,
    /Teams may go over the cap by up to \$25: every cap check uses the \$325 soft-cap limit\. Each \$1 over the cap costs a 1\.5× luxury tax \(rounded up to whole dollars\), added to the team's league dues/,
  );
  assert.match(cap, /cuts during the preseason charge 25% for this season instead/);
  assert.match(cap, /If a released player retires, his dead money for the current and future seasons is wiped/);

  const tr = tradeProse(s).join(" ");
  assert.ok(!tr.includes("cap space"), "cap space can't be traded");
  assert.ok(!tr.includes("rookie draft is under way"));
  s.draft.rookie.tradingDuringDraft = false;
  assert.match(tradeProse(s).join(" "), /Picks of a season can't be traded while that season's rookie draft is under way/);
  s.trades.allowDraftPickTrading = false;
  assert.ok(!tradeProse(s).join(" ").includes("rookie draft is under way"), "no pick rules without pick trading");
});

test("rulebook draft prose covers the draft rules the draft module applies", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.draft.rookie.orderMethod = "LOTTERY";
  s.draft.rookie.playoffTeamsByFinish = true;
  s.draft.rookie.lottery.teams = 6;
  s.draft.rookie.lottery.picksDrawn = 4;
  s.draft.rookie.lottery.maxDropSpots = 2;
  s.standings.draftOrderTiebreakers = ["MAX_POTENTIAL_POINTS", "COIN_FLIP"];
  s.playoffs.consolationBracket = true;
  s.draft.rookie.consolationWinnerPick = "FIRST_NON_PLAYOFF";
  s.niche.lastPlaceDraftPenalty = "PICK_SWAP";
  s.draft.auction.proxyBidding = true;
  s.draft.auction.autoNominateOnTimeout = false;
  s.draft.auction.nominatorOpeningBid = "MIN_BID";
  s.draft.auction.includesRookies = false;
  let p = draftProse(s).join(" ");
  assert.match(p, /the 6 lowest teams in reverse standings \(non-playoff teams first\) draw for the top picks; only the first 4 picks are drawn and the other lottery teams keep their pre-lottery order; no team falls more than 2 spots below its pre-lottery slot/);
  assert.match(p, /then the playoff teams in reverse order of playoff finish \(the champion picks last\)/);
  assert.match(p, /Teams tied on record are ordered by lower max potential points, then a coin flip, then the standings/);
  assert.match(p, /its champion moves to the first slot after the lottery picks/);
  assert.match(p, /last-place team \(decided by the toilet bowl\) swaps draft slots with the team right after it/);
  assert.match(p, /every nomination opens at the minimum bid\. A nominator who runs out of time loses the turn\. Managers can set a maximum bid/);
  assert.match(p, /Rookies aren't part of the auction/);
  s.draft.rookie.orderMethod = "REVERSE_STANDINGS";
  s.draft.auction.autoNominateOnTimeout = true;
  s.draft.auction.nominatorOpeningBid = "ANY_AMOUNT";
  s.draft.auction.proxyBidding = false;
  s.salaryCap.minSalary = 2;
  s.draft.auction.minBid = 1;
  p = draftProse(s).join(" ");
  assert.match(p, /consolation bracket is decided, its champion moves to the No\. 1 slot/, "no lottery: the first non-playoff pick is No. 1");
  assert.match(p, /top available player on the nominator's targets list \(or the best available by ADP\) is nominated at the minimum bid/);
  assert.match(p, /may open at any amount up to their max bid/);
  assert.match(p, /bids start at \$2/, "an auction bid is never below the league minimum salary");
  assert.ok(!p.includes("maximum bid on their targets"));
  s.playoffs.consolationBracket = false;
  assert.ok(!draftProse(s).join(" ").includes("consolation"), "no consolation bracket, no consolation pick");
});

test("rulebook keeper and contract prose follow the rollover", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.keepers.enabled = false;
  s.keepers.releasedPlayersReturnTo = "AUCTION_POOL";
  assert.match(keeperProse(s)[0], /expiring contracts end at the season rollover\. Released players can only be signed in the new season's salary auction, and become free agents once it is complete \(or once the regular season starts, if no auction is held that season\)/);
  s.contracts.enabled = false;
  assert.deepEqual(keeperProse(s), ["There are no keeper designations: every rostered player carries over."]);
  s.contracts.enabled = true;
  s.keepers.enabled = true;
  s.keepers.releasedPlayersReturnTo = "FREE_AGENCY";
  s.keepers.allowKeepingIR = false;
  const k = keeperProse(s).join(" ");
  assert.match(k, /a player whose contract is expiring must be kept to stay\. Players who aren't kept are released at the season rollover\. Players on IR can't be kept/);
  assert.match(k, /Released players become free agents/);
  s.contracts.expiredContractsBecome = "RFA";
  s.contracts.undraftedRookieSalary = 3;
  const c = contractProse(s).join(" ");
  assert.ok(!/restricted/i.test(c) && !/undrafted/i.test(c), "RFA and the undrafted salary aren't applied");
  assert.match(c, /A contract that expires ends at the season rollover unless the player is kept/);
});

test("rulebook fun prose: reverse scoring and side games", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.niche.reverseScoringWeek = 13;
  s.niche.guillotine = true;
  s.niche.survivorPoolEnabled = true;
  s.niche.lastPlaceDraftPenalty = "LOSE_FAAB";
  const p = nicheProse(s).join(" ");
  assert.match(p, /Week 13 is reverse scoring: the lower score wins each matchup/);
  assert.ok(!/guillotine/i.test(p), "the guillotine isn't run by the site");
  assert.match(p, /survivor pool, run by the commissioner/);
  assert.match(p, /loses FAB \(applied by the commissioner\)/);
  // decideWinner: the lower score wins in the reverse week
  assert.equal(decideWinner({ teamId: "h", points: 80, benchPoints: 0, topStarter: 0 }, { teamId: "a", points: 90, benchPoints: 0, topStarter: 0 }, s, { reverse: true }), "h");
  assert.match(basicsProse(s, RC).join(" "), /first Thursday at 6 AM that is at least 12 hours after a week's last kickoff/);
});

// ───────────── rulebook claims checked against the code paths they describe ─────────────

const playoffRow = (p: Partial<Matchup>): Matchup => ({
  id: "m1", leagueId: "L", season: 2026, week: 16, homeTeamId: "A", awayTeamId: "B", homeScore: 0, awayScore: 0, homeProjected: 0, awayProjected: 0,
  homeWinProb: 0.5, status: "FINAL", winnerTeamId: null, isPlayoff: true, isConsolation: false, isChampionship: false, bracketRound: 1, bracketSlot: 1,
  homeSeed: 1, awaySeed: 2, label: null, updatedAt: new Date(), ...p,
});
const twoTeamBracket: StoredBracket = { version: 1, season: 2026, createdAt: "", reseed: false, thirdPlace: false, winners: [{ teamId: "A", seed: 1, displaySeed: 1 }, { teamId: "B", seed: 2, displaySeed: 2 }], sides: [] };

test("rulebook: forfeits and reverse scoring don't decide playoff games (the bracket advances the higher score)", () => {
  // the scoreboard marks A the winner (B forfeited, or a reverse week) but the bracket advances the higher score
  const game = bracketGames([playoffRow({ homeScore: 80, awayScore: 95, winnerTeamId: "A" })], twoTeamBracket, 1)[0]!;
  assert.equal(game.winnerTeamId, "B");

  const s = clone(DEFAULT_SETTINGS);
  assert.ok(!playoffProse(s, RC).join(" ").includes("decided by the score alone"), "nothing to qualify by default");
  s.niche.minimumStartersOrForfeit = 8;
  assert.match(lineupProse(s).join(" "), /loses its regular season matchup whatever the score/);
  assert.match(playoffProse(s, RC).join(" "), /Playoff games are decided by the score alone: the minimum-starters forfeit doesn't apply to them\./);
  s.niche.reverseScoringWeek = s.playoffs.startWeek + 1;
  assert.match(playoffProse(s, RC).join(" "), new RegExp(`the minimum-starters forfeit and Week ${s.playoffs.startWeek + 1}'s reverse scoring don't apply to them`));
  assert.match(nicheProse(s).join(" "), /is marked as reverse scoring, but it is a playoff week and playoff games are decided by the normal score/);
  assert.ok(!/the lower score wins/.test(nicheProse(s).join(" ")));
  s.niche.reverseScoringWeek = 10;
  s.niche.medianGameEachWeek = true;
  assert.match(nicheProse(s).join(" "), /Week 10 is reverse scoring: the lower score wins each matchup \(tied scores still go to the usual tiebreakers; the median game and all-play records still reward the higher score\)/);
  assert.ok(!playoffProse(s, RC).join(" ").includes("reverse scoring"), "a regular season reverse week isn't a playoff note");
  const help = (section: EditableSection, path: string) => sectionFields(section).find((f) => f.path === path)!.help;
  assert.match(help("niche", "minimumStartersOrForfeit"), /regular season matchup .* Playoff games are decided by the score alone/);
  assert.match(help("niche", "reverseScoringWeek"), /playoff games are always decided by the normal score/);
  assert.match(help("lineup", "benchPointsTiebreaker"), /tied regular season matchup .* Tied playoff games use Standings › Playoff matchup tiebreakers/);
});

test("rulebook: a first-round bye never eliminates a team, but a bye team that later loses is out", () => {
  const stored = { winners: [1, 2, 3, 4, 5, 6].map((seed) => ({ teamId: `t${seed}`, seed })) };
  const games = [
    { kind: "WINNERS" as const, round: 1, status: "FINAL" as const, loserTeamId: "t6" },
    { kind: "WINNERS" as const, round: 1, status: "FINAL" as const, loserTeamId: "t5" },
    { kind: "WINNERS" as const, round: 2, status: "FINAL" as const, loserTeamId: "t1" },
  ];
  const st = championshipStatusFrom(stored, games, stored.winners.map((w) => w.teamId));
  assert.equal(st.get("t2")!.alive, true, "a bye is not an elimination");
  assert.equal(st.get("t1")!.alive, false, "the top seed had a bye and then lost");
  const s = clone(DEFAULT_SETTINGS);
  s.playoffs.eliminatedTeamsCanTransact = false;
  const p = playoffProse(s, RC).join(" ");
  assert.match(p, /A first-round bye never eliminates a team/);
  assert.ok(!/never out/.test(p), "bye teams can still be eliminated later");
  for (const [section, path] of [["playoffs", "eliminatedTeamsCanTransact"], ["waivers", "eliminatedTeamsCanAdd"]] as const) {
    const h = sectionFields(section).find((f) => f.path === path)!.help;
    assert.match(h, /A first-round bye never eliminates a team/);
    assert.ok(!/never out/.test(h), `${section}.${path}`);
  }
});

test("rulebook soft cap + offseason roster limit: every transaction path uses the same ceiling and limit", () => {
  const s = clone(DEFAULT_SETTINGS);
  s.salaryCap.capType = "SOFT";
  s.salaryCap.softCapMaxOverage = 25;
  s.roster.offseasonMaxActiveRoster = 40;
  s.roster.rosterCutdownDate = null;
  const ceiling = s.salaryCap.cap + 25;
  assert.equal(capLimit(s), ceiling);
  // contract changes (team/contracts) …
  const roster = [{ playerId: "p", salary: s.salaryCap.cap, contractYears: 2, status: "ACTIVE" }];
  const ext = (salary: number) => contractCapCheck({ settings: s, phase: "REGULAR", season: 2026, roster, playerId: "p", newSalary: salary, newYears: 3, dead: [0, 0] });
  assert.equal(ext(s.salaryCap.cap + 20).blocked, false, "a contract change may use the overage");
  assert.equal(ext(s.salaryCap.cap + 30).blocked, true, "but not go past it");
  // … adds / roster moves (validateRoster) …
  const pl = { position: "QB", injuryStatus: null, status: "Active", yearsExp: 4, fullName: "Q" };
  assert.deepEqual(validateRoster([{ status: "ACTIVE", salary: ceiling, player: pl }], s, { checkCap: true, phase: "REGULAR" }), []);
  assert.match(validateRoster([{ status: "ACTIVE", salary: ceiling + 1, player: pl }], s, { checkCap: true, phase: "REGULAR" })[0], /over the \$325 soft-cap limit/);
  // … and the waiver run share the ceiling and the phase's active-roster limit
  assert.equal(rulesFromSettings(s).cap, ceiling, "waiver claims use the soft-cap limit too");
  assert.equal(rulesFromSettings(s, { phase: "REGULAR" }).maxActiveRoster, s.roster.maxActiveRoster);
  assert.equal(rulesFromSettings(s, { phase: "OFFSEASON" }).maxActiveRoster, 40, "offseason claims use the offseason limit");
  assert.equal(activeRosterLimit(s, { phase: "KEEPER" }), 40);
  assert.equal(effectiveRosterSettings(s, "PRESEASON").roster.maxActiveRoster, 40);
  const cap = capProse(s).join(" ");
  assert.match(cap, /Teams may go over the cap by up to \$25: every cap check uses the \$325 soft-cap limit\./);
  assert.match(
    cap,
    /During the regular season and playoffs, adds, waiver claims, trades, salary-auction bids, roster moves and contract changes \(extensions, franchise tags, rookie options\) that would put a team over the soft-cap limit are blocked\./,
  );
  assert.ok(!/still have to fit/.test(cap), "no path is left checking the cap itself");
  s.trades.requireCapCompliance = false;
  assert.match(capProse(s).join(" "), /adds, waiver claims, salary-auction bids, roster moves and contract changes/, "trades only warn without cap compliance");
  s.salaryCap.softCapMaxOverage = null;
  const open = capProse(s).join(" ");
  assert.match(open, /Teams may go over the cap by any amount, so no move is ever blocked by it\./);
  assert.ok(!/are blocked/.test(open), "no ceiling, nothing blocked");
  assert.equal(rulesFromSettings(s).cap, null);
  assert.match(rosterProse(s)[0], /Outside the regular season and playoffs, the limit is 40 active players for every move: adds, waiver claims, trades, the salary auction, IR activations and taxi promotions\./);
  assert.ok(!/still use/.test(rosterProse(s)[0]));
  const meta = (section: EditableSection, path: string) => sectionFields(section).find((f) => f.path === path)!.help;
  assert.match(meta("roster", "offseasonMaxActiveRoster"), /Every move uses it: adds, waiver claims, trades, the salary auction, IR activations, taxi promotions and commissioner roster changes/);
  assert.match(meta("roster", "rosterCutdownDate"), /end of that day in the league time zone/);
  assert.match(meta("salaryCap", "capType"), /every cap check \(adds, waiver claims, trades, auction bids, roster moves and contract changes\) uses cap \+ max overage as the limit/);
  assert.match(meta("salaryCap", "softCapMaxOverage"), /every cap check uses the cap plus this/);
  for (const [section, path] of [["roster", "offseasonMaxActiveRoster"], ["salaryCap", "capType"], ["salaryCap", "softCapMaxOverage"]] as const)
    assert.ok(!/still (use|have to)/.test(meta(section, path)), `${section}.${path}`);
});

test("rulebook cap enforcement: one rule per phase for adds, claims, trades, auction bids, roster moves and contracts", () => {
  const s = clone(DEFAULT_SETTINGS);
  const roster = [{ playerId: "p", salary: s.salaryCap.cap, contractYears: 3, status: "ACTIVE" }];
  const contract = (phase: string) => contractCapCheck({ settings: s, phase, season: 2026, roster, playerId: "p", newSalary: s.salaryCap.cap + 10, newYears: 4, dead: [0, 0] });
  const pl = { position: "QB", injuryStatus: null, status: "Active", yearsExp: 4, fullName: "Q" };
  const add = (phase: string) => rosterCheck([{ status: "ACTIVE", salary: s.salaryCap.cap + 10, player: pl }], s, { checkCap: true, phase });
  // in season: enforceInSeason blocks every path
  assert.equal(capEnforcement(s, "REGULAR"), "BLOCK");
  assert.equal(contract("REGULAR").blocked, true);
  assert.equal(add("PLAYOFFS").errors.length, 1);
  assert.equal(rulesFromSettings(s, { phase: "REGULAR" }).capEnforced, true);
  // WARN_ONLY: offseason moves go through with a warning on every path
  s.salaryCap.offseasonEnforcement = "WARN_ONLY";
  assert.equal(capEnforcement(s, "OFFSEASON"), "WARN");
  assert.equal(contract("OFFSEASON").blocked, false);
  assert.match(contract("OFFSEASON").warning ?? "", /over the \$\d+ cap\. The cap is only a warning in the offseason\./);
  assert.deepEqual(add("PRESEASON").errors, []);
  assert.match(add("PRESEASON").warnings[0], /The cap is only a warning in the offseason/);
  assert.equal(rulesFromSettings(s, { phase: "KEEPER" }).capEnforced, false);
  assert.ok(rulesFromSettings(s, { phase: "KEEPER" }).capWarning, "the waiver run awards with a warning");
  let p = capProse(s).join(" ");
  assert.match(p, /During the regular season and playoffs, adds, waiver claims, trades, salary-auction bids, roster moves and contract changes \(extensions, franchise tags, rookie options\) that would put a team over the cap are blocked\./);
  assert.match(p, /Outside the regular season and playoffs the cap is only a warning: the same moves go through, with a warning\./);
  assert.ok(!/in-season contract changes|checked the same way in the offseason/.test(p), "no path follows a different rule");
  // ALLOW_UNTIL_COMPLIANCE_DATE without a date never blocks; with a past date it blocks
  s.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
  s.salaryCap.complianceDate = null;
  assert.equal(contract("OFFSEASON").blocked, false, "no compliance date: never blocked in the offseason");
  assert.equal(rulesFromSettings(s, { phase: "OFFSEASON" }).capEnforced, false);
  assert.match(capProse(s).join(" "), /Outside the regular season and playoffs, they may put a team over the cap, with a warning \(no cap compliance deadline is set\)\./);
  s.salaryCap.complianceDate = "2000-01-01T00:00:00.000Z";
  assert.equal(contract("OFFSEASON").blocked, true, "past the compliance date: blocked");
  assert.equal(add("OFFSEASON").errors.length, 1);
  assert.equal(rulesFromSettings(s, { phase: "OFFSEASON" }).capEnforced, true);
  assert.match(capProse(s).join(" "), /Outside the regular season and playoffs, they may put a team over the cap \(with a warning\) until the cap compliance deadline; from then on they're blocked\./);
  s.salaryCap.offseasonEnforcement = "BLOCK_OVER_CAP_MOVES";
  assert.match(capProse(s).join(" "), /The same moves are blocked outside the regular season and playoffs\. A move that doesn't add salary is always allowed/);
  assert.match(tradeProse(s).join(" "), / A trade can't leave a team over the cap with more salary than it had before\./);
  // enforceInSeason off: nothing is checked in season, anywhere
  s.salaryCap.enforceInSeason = false;
  assert.equal(capEnforcement(s, "REGULAR"), "OFF");
  assert.equal(contract("REGULAR").blocked, false);
  assert.deepEqual(add("REGULAR"), { errors: [], warnings: [] });
  assert.equal(rulesFromSettings(s, { phase: "REGULAR" }).capEnforced, false);
  p = capProse(s).join(" ");
  assert.match(p, /During the regular season and playoffs, nothing is checked against the cap\. Outside the regular season and playoffs, adds, .* that would put a team over the cap are blocked\./);
  assert.match(tradeProse(s).join(" "), /Outside the regular season and playoffs, a trade can't leave a team over the cap/);
  s.salaryCap.offseasonEnforcement = "WARN_ONLY";
  assert.match(capProse(s).join(" "), /Outside the regular season and playoffs the cap is only a warning: adds, waiver claims, trades, salary-auction bids, roster moves and contract changes .* go through, with a warning\./);
  assert.ok(!/trade can't leave a team over the cap/.test(tradeProse(s).join(" ")), "never blocked: no trade cap rule");
  assert.ok(!/always allowed/.test(capProse(s).join(" ")));
  // defaults: the cap blocks all year (offseasonEnforcement BLOCK_OVER_CAP_MOVES)
  assert.equal(DEFAULT_SETTINGS.salaryCap.offseasonEnforcement, "BLOCK_OVER_CAP_MOVES");
  assert.match(tradeProse(clone(DEFAULT_SETTINGS)).join(" "), / A trade can't leave a team over the cap with more salary than it had before\./);
  assert.ok(!/During the regular season and playoffs, a trade/.test(tradeProse(clone(DEFAULT_SETTINGS)).join(" ")));
  assert.match(draftProse(clone(DEFAULT_SETTINGS)).join(" "), /The salary auction gives each team \$\d+ \(never more than its room under the cap\)/);
  const help = (path: string) => sectionFields("salaryCap").find((f) => f.path === path)!.help;
  assert.match(help("enforceInSeason"), /During the regular season and playoffs, block adds, waiver claims, trades \(when they must be cap-compliant\), auction bids, roster moves and contract changes/);
  assert.match(help("enforceInSeason"), /Outside the season, Offseason enforcement decides/);
  assert.match(help("offseasonEnforcement"), /to every move: adds, waiver claims, trades, auction bids, roster moves and contract changes/);
  assert.match(help("complianceDate"), /offseason moves that would put a team over the cap are blocked from then on \(with no date set they're never blocked\)/);
  for (const path of ["enforceInSeason", "offseasonEnforcement", "complianceDate"]) assert.ok(!/all year|contract changes over the cap are blocked/.test(help(path)), path);
});

test("rulebook lineups, draft and help text: carry-over, auction details and contract defaults", () => {
  const s = clone(DEFAULT_SETTINGS);
  assert.ok(!lineupProse(s).join(" ").includes("Auto-subs"), "auto-subs are off by default");
  s.lineup.autoSubOutPlayers = true;
  assert.match(lineupProse(s).join(" "), /ruled out — Out, IR, PUP, suspended or not active — or his game ends without a stat line/);
  // auction: the bid clock only ever extends to the reset, the nomination order is chosen per auction
  s.draft.auction.bidSeconds = 30;
  s.draft.auction.resetSecondsOnBid = 15;
  let d = draftProse(s).join(" ");
  assert.match(d, /30-second bid clock; each new high bid leaves at least 15 seconds on it/);
  assert.match(d, /Teams nominate in the order picked when the auction is created \(a random order unless the commissioner chooses another\)/);
  assert.match(d, /Each bidder picks a contract length \(1-5 years\) with the bid, and the winning bid's length applies\./);
  s.draft.auction.proxyBidding = true;
  s.contracts.defaultFreeAgentYears = 2;
  assert.match(draftProse(s).join(" "), /a lot won by a proxy bid signs for 2 years\./);
  s.contracts.enabled = false;
  d = draftProse(s).join(" ");
  assert.ok(!/contract length|Auction contracts are/.test(d), "no contract-length rule without contracts");
  // last place: how the pick swap's last-place team is chosen
  s.niche.lastPlaceDraftPenalty = "PICK_SWAP";
  s.niche.lastPlaceDeterminedBy = "POINTS_FOR";
  assert.match(draftProse(s).join(" "), /the last-place team \(decided by fewest points among non-playoff teams\) swaps draft slots/);
  s.niche.lastPlaceDeterminedBy = "TOILET_BOWL_LOSER";
  s.playoffs.toiletBowl = false;
  assert.match(nicheProse(s).join(" "), /Last place \(decided by the final standings\)/);
  // pickups sign for Waivers › Pickup contract years, not the free-agent default
  const c = clone(DEFAULT_SETTINGS);
  c.waivers.signedContractYears = 1;
  c.contracts.defaultFreeAgentYears = 3;
  assert.equal(waiverContractYears(c), 1);
  const help = (section: EditableSection, path: string) => sectionFields(section).find((f) => f.path === path)!.help;
  assert.match(help("contracts", "defaultFreeAgentYears"), /Waiver and free-agent pickups sign for Waivers › Pickup contract years/);
  assert.match(help("trades", "pickTradingRequiresPaidDues"), /only once its dues are marked paid/);
  assert.match(help("lineup", "defaultCarryOver"), /first lineup of the season/);
  // an empty standings chain (old stored settings) still reads as a sentence
  const e = clone(DEFAULT_SETTINGS);
  e.standings.tiebreakers = [];
  const st = standingsTiebreakProse(e);
  assert.ok(!st.includes("tiebreakers: ."));
  assert.match(st, /Teams with the same win percentage are ranked by: points for, then a coin flip drawn once per season\./);
});
