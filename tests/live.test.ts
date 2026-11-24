// Live scoring pure logic: stat diffing, TD / big-play detection, descriptions, per-play points,
// alert recipients, throttles, formatting and the seeded game simulator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import {
  describePlay,
  detectPlays,
  diffStatMaps,
  matchupChanged,
  newEventCount,
  pairPassingTouchdowns,
  playPoints,
  selectTdRecipients,
  shouldRecordWinProb,
  touchdownAlertBody,
  touchdownYards,
  type DetectedPlay,
} from "@/lib/live/diff";
import { gameStatusLabel, leagueKeyDates, playoffWeekInfo, possessionTeam, statLine, wpPercent } from "@/lib/live/format";
import { buildSimPlan, gameStateAt, scaleYards, simulateAt, slotOffsets, totalSteps, GAME_SECONDS, SLOT_GAP_SECONDS, type SimPlayerInput } from "@/lib/live/sim-plan";

const S: LeagueSettings = structuredClone(DEFAULT_SETTINGS);

// ───────────── diffing ─────────────

test("diffStatMaps reports only meaningful changes and ignores players missing from the new feed", () => {
  const prev = new Map<string, StatMap>([
    ["a", { rush_yd: 20, rush_att: 4, off_snp: 10, pts_ppr: 2 }],
    ["b", { rec: 2, rec_yd: 15 }],
  ]);
  const next = new Map<string, StatMap>([
    ["a", { rush_yd: 54, rush_att: 5, rush_td: 1, off_snp: 14, pts_ppr: 11.4 }],
    ["c", { pass_yd: 12 }],
  ]);
  const d = diffStatMaps(prev, next);
  assert.deepEqual(d.get("a"), { rush_yd: 34, rush_att: 1, rush_td: 1 });
  assert.deepEqual(d.get("c"), { pass_yd: 12 });
  assert.equal(d.has("b"), false, "a player dropping out of the feed is not a negative delta");
});

test("diffStatMaps returns nothing when only snap counts / rates moved", () => {
  const d = diffStatMaps(new Map([["a", { off_snp: 10, rush_ypa: 4 }]]), new Map([["a", { off_snp: 20, rush_ypa: 5.5, tm_off_snp: 40 }]]));
  assert.equal(d.size, 0);
});

test("diffStatMaps keeps team-defense points allowed (it scores) while dropping provider fantasy totals", () => {
  const d = diffStatMaps(new Map([["DEN", { pts_allow: 7, pts_ppr: 9 }]]), new Map([["DEN", { pts_allow: 14, pts_ppr: 6 }]]));
  assert.deepEqual(d.get("DEN"), { pts_allow: 7 });
});

// ───────────── touchdown detection ─────────────

test("touchdownYards derives the length from the longest-TD stat when possible", () => {
  assert.equal(touchdownYards({}, { rush_td: 1, rush_td_lng: 34 }, "rush_td"), 34, "first TD: longest = this TD");
  assert.equal(touchdownYards({ rush_td: 1, rush_td_lng: 5 }, { rush_td: 2, rush_td_lng: 41 }, "rush_td"), 41, "new longest");
  assert.equal(touchdownYards({ rush_td: 1, rush_td_lng: 41 }, { rush_td: 2, rush_td_lng: 41 }, "rush_td"), null, "shorter than an earlier TD: unknown");
  assert.equal(touchdownYards({}, { rush_td: 2, rush_td_lng: 9 }, "rush_td"), null, "two TDs in one update: unknown");
});

test("detectPlays finds touchdowns, long gains and defensive plays", () => {
  const plays = detectPlays("p1", { rush_td: 0, rush_lng: 12, rec_lng: 9 }, { rush_td: 1, rush_td_lng: 34, rush_lng: 34, rec_lng: 52 });
  assert.deepEqual(
    plays.map((p) => [p.statKey, p.kind, p.yards]),
    [
      ["rush_td", "TD", 34],
      ["big_rec", "BIG", 52],
    ],
    "the 34-yd run is the TD itself, the 52-yd catch is a separate big play",
  );
  const def = detectPlays("KC", { int: 0, sack: 1 }, { int: 1, sack: 2 });
  assert.deepEqual(def.map((p) => p.statKey), ["int"]);
  const pick6 = detectPlays("KC", { int: 0, def_td: 0 }, { int: 1, def_td: 1 });
  assert.deepEqual(pick6.map((p) => p.statKey), ["def_td"], "pick-six reported once as the TD");
  const fg = detectPlays("k", { fgm_50p: 0, fgm_lng: 33 }, { fgm_50p: 1, fgm_50_59: 1, fgm_lng: 54 });
  assert.equal(fg[0]?.statKey, "fgm_50p");
  assert.equal(fg[0]?.yards, 54);
  assert.deepEqual(detectPlays("x", { rush_yd: 10 }, { rush_yd: 14 }), []);
});

test("negative plays are flagged as NEGATIVE", () => {
  const p = detectPlays("qb", { pass_int: 0 }, { pass_int: 1, fum_lost: 1 });
  assert.deepEqual(p.map((x) => [x.statKey, x.kind]), [
    ["pass_int", "NEGATIVE"],
    ["fum_lost", "NEGATIVE"],
  ]);
});

test("pairPassingTouchdowns links the QB and receiver on the same NFL team", () => {
  const plays: (DetectedPlay & { nflTeam: string | null })[] = [
    { playerId: "qb", statKey: "pass_td", delta: 1, yards: 32, kind: "TD", nflTeam: "CIN" },
    { playerId: "wr", statKey: "rec_td", delta: 1, yards: 32, kind: "TD", nflTeam: "CIN" },
    { playerId: "other", statKey: "rec_td", delta: 1, yards: 32, kind: "TD", nflTeam: "KC" },
  ];
  pairPassingTouchdowns(plays);
  assert.equal(plays[0]!.pairedPlayerId, "wr");
  assert.equal(plays[1]!.pairedPlayerId, "qb");
  assert.equal(plays[2]!.pairedPlayerId, undefined);
  const names = new Map([
    ["qb", { name: "Joe Burrow" }],
    ["wr", { name: "Ja'Marr Chase" }],
  ]);
  assert.equal(describePlay(plays[0]!, names), "Joe Burrow 32-yd TD pass to Ja'Marr Chase");
  assert.equal(describePlay(plays[1]!, names), "Ja'Marr Chase 32-yd TD catch from Joe Burrow");
});

test("pairPassingTouchdowns pairs a lone pass TD with a lone catch even without lengths", () => {
  const plays: (DetectedPlay & { nflTeam: string | null })[] = [
    { playerId: "qb", statKey: "pass_td", delta: 1, yards: null, kind: "TD", nflTeam: "BUF" },
    { playerId: "te", statKey: "rec_td", delta: 1, yards: 7, kind: "TD", nflTeam: "BUF" },
  ];
  pairPassingTouchdowns(plays);
  assert.equal(plays[0]!.pairedPlayerId, "te");
  assert.equal(plays[0]!.yards, 7);
});

test("describePlay falls back when length is unknown", () => {
  const names = new Map([["b", { name: "Bijan Robinson" }]]);
  assert.equal(describePlay({ playerId: "b", statKey: "rush_td", delta: 1, yards: 34, kind: "TD" }, names), "Bijan Robinson 34-yd rush TD");
  assert.equal(describePlay({ playerId: "b", statKey: "rush_td", delta: 1, yards: null, kind: "TD" }, names), "Bijan Robinson rushing TD");
  assert.equal(describePlay({ playerId: "b", statKey: "rec_td", delta: 1, yards: null, kind: "TD" }, names), "Bijan Robinson receiving TD");
  assert.equal(describePlay({ playerId: "b", statKey: "rush_td", delta: 2, yards: null, kind: "TD" }, names), "Bijan Robinson 2 rushing TDs");
});

test("playPoints gives a lone play the full point change and splits several plays by marginal value", () => {
  const prev = { rush_yd: 20, rush_att: 5 };
  const next = { rush_yd: 54, rush_att: 6, rush_td: 1, rush_td_lng: 34, rush_lng: 34 };
  const [one] = playPoints(prev, next, [{ playerId: "p", statKey: "rush_td", delta: 1, yards: 34, kind: "TD" }], "RB", S.scoring);
  const expected = calcPoints(next, "RB", S.scoring).points - calcPoints(prev, "RB", S.scoring).points;
  assert.equal(one, Math.round(expected * 100) / 100);
  assert.equal(one, 9.4);
  const two = playPoints({}, { rush_td: 1, rec_td: 1 }, [
    { playerId: "p", statKey: "rush_td", delta: 1, yards: null, kind: "TD" },
    { playerId: "p", statKey: "rec_td", delta: 1, yards: null, kind: "TD" },
  ], "RB", S.scoring);
  assert.deepEqual(two, [6, 6]);
  // a lone interception is worth its rule value even when yards were gained in the same update
  const [pick] = playPoints({ pass_yd: 100 }, { pass_yd: 120, pass_int: 1 }, [{ playerId: "q", statKey: "pass_int", delta: 1, yards: null, kind: "NEGATIVE" }], "QB", S.scoring);
  assert.equal(pick, -2);
  // TD + fumble in one update: the fumble is -2, the TD gets the rest
  const mixed = playPoints({ rush_yd: 10 }, { rush_yd: 25, rush_td: 1, fum_lost: 1 }, [
    { playerId: "r", statKey: "rush_td", delta: 1, yards: 15, kind: "TD" },
    { playerId: "r", statKey: "fum_lost", delta: 1, yards: null, kind: "NEGATIVE" },
  ], "RB", S.scoring);
  assert.deepEqual(mixed, [7.5, -2]);
});

test("playPoints: a defensive TD is not charged for points/yards allowed that moved in the same update", () => {
  const prev = { pts_allow: 0, yds_allow: 120 };
  const next = { pts_allow: 7, yds_allow: 190, def_st_td: 1 };
  const [td] = playPoints(prev, next, [{ playerId: "DEN", statKey: "def_st_td", delta: 1, yards: null, kind: "TD" }], "DEF", S.scoring);
  const rule = calcPoints({ def_st_td: 1 }, "DEF", S.scoring).points;
  assert.equal(td, rule, "the return TD is worth exactly its rule value");
  assert.ok(td > 0);
});

test("newEventCount is idempotent against already-recorded events", () => {
  assert.equal(newEventCount(1, 0), 1);
  assert.equal(newEventCount(1, 1), 0, "re-sync after restart does not duplicate");
  assert.equal(newEventCount(2, 1), 1);
  assert.equal(newEventCount(0, 1), 0, "stat correction removing a TD never goes negative");
});

// ───────────── alert recipients ─────────────

const managersByTeam = new Map([
  ["T1", ["u1"]],
  ["T2", ["u2", "u2b"]],
  ["T3", ["u3"]],
]);

function recipients(scopes: Record<string, string | null>, opts: { isStarter?: boolean; matchup?: string[]; def?: "MY_MATCHUP" | "LEAGUE" | "OFF" | "MY_ROSTER" | "MY_STARTERS" } = {}) {
  return selectTdRecipients({
    ownerTeamId: "T1",
    isStarter: opts.isStarter ?? true,
    matchupTeamIds: opts.matchup ?? ["T1", "T2"],
    managersByTeam,
    members: Object.entries(scopes).map(([userId, scope]) => ({ userId, scope })),
    defaultScope: opts.def ?? "MY_MATCHUP",
  }).sort();
}

test("selectTdRecipients honors each scope", () => {
  const all = { u1: "MY_MATCHUP", u2: "MY_MATCHUP", u2b: "MY_MATCHUP", u3: "MY_MATCHUP" };
  assert.deepEqual(recipients(all), ["u1", "u2", "u2b"], "MY_MATCHUP: both sides of the matchup (co-managers too)");
  assert.deepEqual(recipients({ u1: "MY_STARTERS", u2: "MY_STARTERS", u3: "MY_STARTERS" }), ["u1"]);
  assert.deepEqual(recipients({ u1: "MY_STARTERS" }, { isStarter: false }), [], "benched player: no starters alert");
  assert.deepEqual(recipients({ u1: "MY_ROSTER", u2: "MY_ROSTER" }, { isStarter: false }), ["u1"], "MY_ROSTER includes bench");
  assert.deepEqual(recipients({ u1: "MY_MATCHUP", u2: "MY_MATCHUP" }, { isStarter: false }), [], "a bench TD does not affect the matchup");
  assert.deepEqual(recipients({ u1: "OFF", u2: "LEAGUE", u3: "LEAGUE", commish: "LEAGUE" }), ["commish", "u2", "u3"]);
});

test("selectTdRecipients uses the league default when a user has no preference row", () => {
  assert.deepEqual(recipients({ u1: null, u2: null, u3: null }, { def: "LEAGUE" }), ["u1", "u2", "u3"]);
  assert.deepEqual(recipients({ u1: null, u2: null, u3: null }, { def: "OFF" }), []);
  assert.deepEqual(recipients({ u3: "bogus" }, { def: "LEAGUE" }), ["u3"], "unknown stored scope falls back to the default");
  assert.deepEqual(recipients({ u1: "MY_MATCHUP" }, { matchup: [] }), [], "team without a matchup (bye)");
});

test("touchdownAlertBody formats points and the matchup score", () => {
  assert.equal(
    touchdownAlertBody({ description: "Bijan Robinson 34-yd rush TD", points: 9.4, team: { name: "A", score: 102.44 }, opponent: { name: "B", score: 88.06 } }),
    "Bijan Robinson 34-yd rush TD (+9.40 pts). A 102.4 – 88.1 B",
  );
  assert.equal(touchdownAlertBody({ description: "X", points: 6 }), "X (+6.00 pts).");
});

// ───────────── throttles ─────────────

test("matchupChanged ignores float noise", () => {
  const a = { homeScore: 10, awayScore: 5, homeProjected: 100, awayProjected: 90, homeWinProb: 0.6, status: "LIVE" };
  assert.equal(matchupChanged(a, { ...a, homeProjected: 100.01 }), false);
  assert.equal(matchupChanged(a, { ...a, homeScore: 16 }), true);
  assert.equal(matchupChanged(a, { ...a, status: "FINAL" }), true);
});

test("shouldRecordWinProb throttles to one point per interval and only on movement", () => {
  const now = new Date("2026-11-29T18:00:00Z");
  const cur = { homeWinProb: 0.55, homeScore: 10, awayScore: 8 };
  assert.equal(shouldRecordWinProb(null, cur, now), true);
  assert.equal(shouldRecordWinProb({ at: new Date(now.getTime() - 30_000), homeWinProb: 0.5, homeScore: 4, awayScore: 8 }, cur, now), false, "too soon");
  assert.equal(shouldRecordWinProb({ at: new Date(now.getTime() - 61_000), homeWinProb: 0.5, homeScore: 4, awayScore: 8 }, cur, now), true);
  assert.equal(shouldRecordWinProb({ at: new Date(now.getTime() - 600_000), ...cur }, cur, now), false, "nothing moved");
});

// ───────────── formatting ─────────────

test("statLine renders CBS-style compact lines", () => {
  assert.equal(statLine({ pass_cmp: 18, pass_att: 27, pass_yd: 245, pass_td: 2 }, "QB"), "18/27 245 yd 2 TD");
  assert.equal(statLine({ rush_att: 12, rush_yd: 88, rush_td: 1, rec: 3, rec_yd: 21, rec_tgt: 4 }, "RB"), "12-88-1 rush, 3-21 rec");
  assert.equal(statLine({ rec: 5, rec_yd: 78, rec_tgt: 7, rec_td: 1 }, "WR"), "5-78-1 rec");
  assert.equal(statLine({ fga: 3, fgm: 2, fgm_lng: 52, xpa: 3, xpm: 3 }, "K"), "FG 2/3 (52), XP 3/3");
  assert.equal(statLine({ sack: 3, int: 1, pts_allow: 17, yds_allow: 301 }, "DEF"), "3 sk, 1 INT, 17 PA, 301 YA");
  assert.equal(statLine(null, "WR"), "");
  assert.equal(statLine({ pass_cmp: 28, pass_att: 40, pass_yd: 300, pass_td: 2, rush_att: 2, rush_yd: -1 }, "QB"), "28/40 300 yd 2 TD, 2-(-1) rush");
});

test("gameStatusLabel and possession normalization", () => {
  const tz = "America/New_York";
  assert.equal(gameStatusLabel({ state: "in", period: 3, clock: "4:21", statusDetail: "4:21 - 3rd", startTime: new Date() }, tz), "Q3 4:21");
  assert.equal(gameStatusLabel({ state: "in", period: 2, clock: "0:00", statusDetail: "Halftime", startTime: new Date() }, tz), "Half");
  assert.equal(gameStatusLabel({ state: "in", period: 5, clock: "6:10", statusDetail: "6:10 - OT", startTime: new Date() }, tz), "OT 6:10");
  assert.equal(gameStatusLabel({ state: "post", period: 4, clock: "0:00", statusDetail: "Final", startTime: new Date() }, tz), "Final");
  assert.equal(gameStatusLabel({ state: "pre", period: null, clock: null, statusDetail: null, startTime: "2026-11-29T18:00:00Z" }, tz), "Sun 1:00 PM");
  assert.equal(possessionTeam("4", { homeTeam: "WAS", awayTeam: "CIN" }), "CIN");
  assert.equal(possessionTeam("28", { homeTeam: "WAS", awayTeam: "CIN" }), "WAS");
  assert.equal(possessionTeam("KC", { homeTeam: "WAS", awayTeam: "CIN" }), null);
  assert.equal(wpPercent(0.0000001), 1);
  assert.equal(wpPercent(1, true), 100);
});

test("playoff week labels and key dates come from settings", () => {
  assert.equal(playoffWeekInfo(14, S), null);
  assert.equal(playoffWeekInfo(15, S)?.label, "Quarterfinals");
  assert.equal(playoffWeekInfo(16, S)?.label, "Semifinals");
  assert.equal(playoffWeekInfo(17, S)?.label, "Championship");
  const four: LeagueSettings = structuredClone(S);
  four.playoffs.teams = 4;
  four.playoffs.startWeek = 14;
  four.playoffs.championshipWeeks = 2;
  assert.equal(playoffWeekInfo(14, four)?.label, "Semifinals");
  assert.equal(playoffWeekInfo(15, four)?.label, "Championship · Week 1 of 2");
  assert.equal(playoffWeekInfo(16, four)?.label, "Championship · Week 2 of 2");
  const keys = leagueKeyDates(S);
  assert.equal(keys.find((k) => k.key === "trade")?.week, S.trades.deadlineWeek);
  assert.equal(keys.find((k) => k.key === "playoffs")?.week, 15);
  assert.equal(keys.find((k) => k.key === "championship")?.week, 17);
  const noDeadline: LeagueSettings = structuredClone(S);
  noDeadline.trades.deadlineWeek = null;
  assert.equal(leagueKeyDates(noDeadline).some((k) => k.key === "trade"), false);
});

// ───────────── simulation ─────────────

const games = [
  { id: "g1", homeTeam: "KC", awayTeam: "BUF", spread: -3, overUnder: 50.5, startTime: "2026-11-29T18:00:00Z" },
  { id: "g2", homeTeam: "DAL", awayTeam: "PHI", spread: 4, overUnder: 45, startTime: "2026-11-29T21:25:00Z" },
];
const players: SimPlayerInput[] = [
  { id: "qbKC", position: "QB", team: "KC", proj: { pass_att: 36, pass_cmp: 24, pass_yd: 270, pass_td: 2, pass_int: 0.6, rush_att: 4, rush_yd: 18 } },
  { id: "wrKC", position: "WR", team: "KC", proj: { rec_tgt: 8, rec: 6, rec_yd: 75, rec_td: 0.5 } },
  { id: "rbBUF", position: "RB", team: "BUF", proj: { rush_att: 17, rush_yd: 80, rush_td: 0.7, rec_tgt: 3, rec: 2, rec_yd: 15 } },
  { id: "kBUF", position: "K", team: "BUF", proj: { fgm: 1.8, xpm: 2.5 } },
  { id: "KC", position: "DEF", team: "KC", proj: { sack: 2.5, int: 0.9 } },
  { id: "teDAL", position: "TE", team: "DAL", proj: null },
];

test("slotOffsets staggers kickoff windows", () => {
  const off = slotOffsets(games);
  assert.equal(off.get("g1"), 0);
  assert.equal(off.get("g2"), SLOT_GAP_SECONDS);
});

test("buildSimPlan is deterministic for a seed", () => {
  const a = buildSimPlan(games, players, 42);
  const b = buildSimPlan(games, players, 42);
  assert.deepEqual(a, b);
  assert.equal(a.totalSeconds, SLOT_GAP_SECONDS + GAME_SECONDS);
  assert.ok(totalSteps(a, 90) > 10);
});

test("simulateAt is monotonic and consistent with game scores", () => {
  for (const seed of [1, 7, 99, 2026]) {
    const plan = buildSimPlan(games, players, seed);
    let prev = simulateAt(plan, 0);
    assert.equal(prev.stats.size, 0, "nothing before kickoff");
    assert.equal(prev.games.get("g1")?.state, "pre");
    for (let t = 90; t <= plan.totalSeconds; t += 90) {
      const cur = simulateAt(plan, t);
      for (const [pid, s] of cur.stats) {
        const p = prev.stats.get(pid) ?? {};
        for (const k of ["pass_att", "pass_td", "rush_att", "rush_td", "rec", "rec_td", "fgm", "xpm", "sack", "int", "pts_allow", "yds_allow"]) {
          assert.ok((s[k] ?? 0) >= (p[k] ?? 0), `${pid}.${k} never decreases (seed ${seed}, t ${t})`);
        }
      }
      prev = cur;
    }
    const end = simulateAt(plan, plan.totalSeconds);
    const g1 = end.games.get("g1")!;
    assert.equal(g1.state, "post");
    assert.equal(g1.statusDetail, "Final");
    assert.equal(end.stats.get("KC")?.pts_allow, g1.awayScore, "KC defense allows BUF's points");
    // every receiving TD of a KC player is thrown by the KC QB
    const qbTd = end.stats.get("qbKC")?.pass_td ?? 0;
    const wrTd = end.stats.get("wrKC")?.rec_td ?? 0;
    assert.ok(qbTd >= wrTd);
    // team points can be reconstructed from the scoring plan
    const planned = plan.games.find((g) => g.id === "g1")!.scores.filter((s) => s.team === "KC").reduce((a, s) => a + s.pts, 0);
    assert.equal(g1.homeScore, planned);
    assert.ok(Number.isFinite(calcPoints(end.stats.get("rbBUF") ?? {}, "RB", S.scoring).points));
  }
});

test("gameStateAt produces an ESPN-like clock", () => {
  const plan = buildSimPlan(games, players, 5);
  const g = plan.games[0]!;
  const q3 = gameStateAt(g, 1800 + 879);
  assert.equal(q3.state, "in");
  assert.equal(q3.period, 3);
  assert.equal(q3.clock, "0:21");
  assert.equal(gameStateAt(g, 1800).statusDetail, "Halftime");
  assert.equal(gameStateAt(plan.games[1]!, 100).state, "pre", "late window has not kicked off");
});

test("scaleYards keeps play shapes but hits the yardage target exactly", () => {
  const y = scaleYards([1, 1, 2, 40], 88, -4);
  assert.equal(y.reduce((a, b) => a + b, 0), 88);
  assert.ok(y[3]! > y[2]! && y[2]! >= y[1]!);
  assert.deepEqual(scaleYards([], 50, 0), []);
  assert.deepEqual(scaleYards([1, 1], 0, -2), [0, 0]);
});

// ───────────── multi-week playoff games on the scoreboard / schedule ─────────────
import type { Matchup } from "@prisma/client";
import { playoffGameContexts } from "@/lib/playoffs/bracket";
import { countGames, gameResultFor, gameStateShort, patchGameWeek } from "@/components/scoring/playoff-game";
import { scoreChanged, scoreUpdateEvent } from "@/lib/team/matchup";

function row(p: Partial<Matchup>): Matchup {
  return {
    id: Math.random().toString(36).slice(2), leagueId: "L", season: 2026, week: 15, homeTeamId: "A", awayTeamId: "B", homeScore: 0, awayScore: 0,
    homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, status: "UPCOMING", winnerTeamId: null, isPlayoff: true, isConsolation: false,
    isChampionship: false, bracketRound: 1, bracketSlot: 1, homeSeed: 1, awaySeed: 4, label: null, updatedAt: new Date(), ...p,
  };
}

test("schedule counts a two-week playoff game once, played only when both weeks are final", () => {
  const rows = [
    row({ id: "r1", week: 1, isPlayoff: false, bracketRound: null, bracketSlot: null, status: "FINAL" }),
    row({ id: "a1", week: 15, status: "FINAL", homeScore: 100, awayScore: 140 }),
    row({ id: "a2", week: 16, status: "LIVE", homeScore: 60, awayScore: 20 }),
  ];
  const ctx = playoffGameContexts(rows);
  const games = rows.map((r) => ({ id: r.id, status: r.status, game: ctx.get(r.id) ?? null }));
  assert.deepEqual(countGames(games), { total: 2, played: 1 });
  const done = playoffGameContexts(rows.map((r) => (r.id === "a2" ? { ...r, status: "FINAL", homeScore: 145, awayScore: 90, winnerTeamId: "A" } : r.id === "a1" ? { ...r, winnerTeamId: "A" } : r)));
  assert.deepEqual(countGames(rows.map((r) => ({ id: r.id, status: "FINAL", game: done.get(r.id) ?? null }))), { total: 2, played: 2 });
  // week 1's row shows the game result (A), not the week's winner (B)
  assert.equal(gameResultFor(done.get("a1")!, "A"), "W");
  assert.equal(gameResultFor(done.get("a1")!, "B"), "L");
  // where the game stands now (100+60 to 140+20), on week 1's row too
  assert.equal(gameStateShort(ctx.get("a1")!, { homeId: "A", home: "AAA", away: "BBB" }), "Wk 1 of 2 · Tied 160.0–160.0");
  // a live score update of week 2 moves the combined score
  const live = patchGameWeek(ctx.get("a2")!, "a2", 80, 20, "LIVE");
  assert.equal(gameStateShort(live, { homeId: "A", home: "AAA", away: "BBB" }), "Wk 2 of 2 · AAA leads 180.0–160.0");
  assert.equal(patchGameWeek(live, "unknown", 1, 1, "LIVE"), live, "other rows' updates leave it alone");
});

test("refreshTeamMatchup publishes only rows whose live fields changed", () => {
  const a = row({ id: "x", homeScore: 10, awayScore: 5, homeWinProb: 0.6, status: "LIVE" });
  assert.equal(scoreChanged(a, { ...a }), false);
  assert.equal(scoreChanged(a, { ...a, homeWinProb: 0.4 }), true, "e.g. a reverse-scoring week flips the odds");
  assert.equal(scoreChanged(a, { ...a, winnerTeamId: "A" }), true);
  assert.deepEqual(scoreUpdateEvent(a), { matchupId: "x", week: 15, homeTeamId: "A", awayTeamId: "B", homeScore: 10, awayScore: 5, homeProjected: 0, awayProjected: 0, homeWinProb: 0.6, status: "LIVE" });
});
