import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import {
  allPlayWins,
  analyzeTeamWeek,
  bestDecision,
  completedWeeks,
  computeAwards,
  downsample,
  efficiencyBoard,
  isInjuryConcern,
  isRecapDue,
  latestCompletedWeek,
  localWeekdayHour,
  lockTimeFor,
  marqueeGames,
  median,
  oddsMovement,
  ownershipAtLock,
  pickMatchupOfWeek,
  pickOddsSnapshots,
  rosterAt,
  sideResults,
  standingsMovement,
  statLine,
  type AwardMatchup,
  type RosterEvent,
  type SlotStart,
  type TeamWeekAnalysis,
} from "@/lib/recap/compute";
import { buildHeadline, buildIntro, fill, hashSeed, matchupBlurb, pickVariant, poss, type NarrativeFacts } from "@/lib/recap/narrative";
import { escapeHtml, renderRecapEmail, safeColor } from "@/lib/recap/html";
import { wantsRecapEmail } from "@/lib/recap/jobs";
import { RECAP_VERSION, isRecapContent, type PlayerPerf, type RecapContent } from "@/lib/recap/types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** QB, RB×2, WR×2, FLEX(RB/WR/TE), K — small league config for lineup tests */
function settingsWith(): LeagueSettings {
  const s = clone(DEFAULT_SETTINGS);
  s.roster.slots = [
    { key: "QB", label: "QB", count: 1, eligible: ["QB"] },
    { key: "RB", label: "RB", count: 2, eligible: ["RB"] },
    { key: "WR", label: "WR", count: 2, eligible: ["WR"] },
    { key: "FLEX", label: "W/R/T", count: 1, eligible: ["RB", "WR", "TE"] },
    { key: "K", label: "K", count: 1, eligible: ["K"] },
  ];
  return s;
}

const P = (id: string, position: string, points: number, projected = points): PlayerPerf => ({ id, name: `Player ${id}`, position, nflTeam: "KC", points, projected });

function starters(list: [string, string, string[], PlayerPerf | null][]): SlotStart[] {
  const idx = new Map<string, number>();
  return list.map(([slot, label, eligible, player]) => {
    const i = idx.get(slot) ?? 0;
    idx.set(slot, i + 1);
    return { slot, slotIndex: i, label, eligible, player };
  });
}

const S = settingsWith();

test("analyzeTeamWeek: optimal lineup, efficiency, points left and the biggest bench miss", () => {
  const input = {
    teamId: "A",
    starters: starters([
      ["QB", "QB", ["QB"], P("qb1", "QB", 20, 22)],
      ["RB", "RB", ["RB"], P("rb1", "RB", 15, 14)],
      ["RB", "RB", ["RB"], P("rb2", "RB", 3, 12)],
      ["WR", "WR", ["WR"], P("wr1", "WR", 18, 15)],
      ["WR", "WR", ["WR"], P("wr2", "WR", 10, 13)],
      ["FLEX", "W/R/T", ["RB", "WR", "TE"], P("te1", "TE", 6, 9)],
      ["K", "K", ["K"], P("k1", "K", 9, 8)],
    ]),
    bench: [P("rb3", "RB", 21, 11), P("wr3", "WR", 4, 10), P("qb2", "QB", 30, 16), P("k2", "K", 2, 7)],
  };
  const a = analyzeTeamWeek(input, S);
  assert.equal(a.starterPoints, 81);
  assert.equal(a.projected, 93);
  // optimal: QB qb2 30, RB rb3 21 + rb1 15, WR wr1 18 + wr2 10, FLEX best remaining (te1 6 / wr3 4 / rb2 3) = 6, K 9
  assert.equal(a.optimalPoints, 109);
  assert.equal(a.pointsLeft, 28);
  assert.ok(Math.abs(a.efficiency - 81 / 109) < 1e-9);
  assert.equal(a.top?.id, "qb1");
  // biggest miss: rb3 (21) benched for rb2 (3) at RB → 18; qb2 over qb1 is only 10
  assert.equal(a.biggestMiss?.benched.id, "rb3");
  assert.equal(a.biggestMiss?.started.id, "rb2");
  assert.equal(a.biggestMiss?.diff, 18);
  // FLEX decision compares against the best eligible bench option (rb3)
  const flex = a.decisions.find((d) => d.slotLabel === "W/R/T")!;
  assert.equal(flex.alternative.id, "rb3");
  assert.equal(flex.margin, -15);
  assert.ok(a.optimalIds.includes("qb2") && a.optimalIds.includes("rb3"));
});

test("analyzeTeamWeek: perfect lineup is 100% efficient, empty slots and starters on the bench list are handled", () => {
  const input = {
    teamId: "B",
    starters: starters([
      ["QB", "QB", ["QB"], P("qb1", "QB", 25)],
      ["RB", "RB", ["RB"], P("rb1", "RB", 12)],
      ["RB", "RB", ["RB"], null],
      ["WR", "WR", ["WR"], P("wr1", "WR", 11)],
      ["WR", "WR", ["WR"], P("wr2", "WR", 9)],
      ["FLEX", "W/R/T", ["RB", "WR", "TE"], P("wr3", "WR", 8)],
      ["K", "K", ["K"], P("k1", "K", 7)],
    ]),
    bench: [P("qb1", "QB", 25), P("wr4", "WR", 2)],
  };
  const a = analyzeTeamWeek(input, S);
  assert.equal(a.starterPoints, 72);
  // the empty RB slot can't be filled by anyone on the bench; wr4 only fits FLEX/WR and scores less than every WR starter
  assert.equal(a.optimalPoints, 72);
  assert.equal(a.efficiency, 1);
  assert.equal(a.pointsLeft, 0);
  assert.equal(a.biggestMiss, null);
});

test("analyzeTeamWeek: no points at all is treated as 100% efficient", () => {
  const a = analyzeTeamWeek({ teamId: "C", starters: starters([["QB", "QB", ["QB"], P("q", "QB", 0)]]), bench: [] }, S);
  assert.equal(a.optimalPoints, 0);
  assert.equal(a.efficiency, 1);
});

test("efficiencyBoard ranks by efficiency then fewer points left", () => {
  const mk = (teamId: string, starterPoints: number, optimalPoints: number): TeamWeekAnalysis => ({
    teamId,
    starterPoints,
    projected: 0,
    optimalPoints,
    efficiency: optimalPoints ? starterPoints / optimalPoints : 1,
    pointsLeft: optimalPoints - starterPoints,
    top: null,
    decisions: [],
    biggestMiss: null,
    optimalIds: [],
  });
  const board = efficiencyBoard([mk("a", 90, 100), mk("b", 100, 100), mk("c", 45, 50), mk("d", 120, 160)]);
  assert.deepEqual(
    board.map((r) => r.teamId),
    ["b", "c", "a", "d"],
  );
});

test("bestDecision prefers real close calls over trivial starter-vs-backup gaps", () => {
  const d = (margin: number, startedProj: number, altProj: number, altPts = 5) => ({
    slotLabel: "RB",
    started: P("s", "RB", altPts + margin, startedProj),
    alternative: P("a", "RB", altPts, altProj),
    margin,
    projGap: startedProj - altProj,
  });
  const pick = bestDecision([
    { teamId: "trivial", decision: d(25, 20, 4) }, // backup projected way lower
    { teamId: "close", decision: d(12, 12, 13) }, // started the lower projection and won the call
    { teamId: "small", decision: d(4, 11, 10) },
  ]);
  assert.equal(pick?.teamId, "close");
  // no close calls → plausible ones
  const pick2 = bestDecision([
    { teamId: "trivial", decision: d(25, 20, 4) },
    { teamId: "plausible", decision: d(9, 15, 10) },
  ]);
  assert.equal(pick2?.teamId, "plausible");
  // only negative margins → nothing to award
  assert.equal(bestDecision([{ teamId: "x", decision: d(-3, 10, 10) }]), null);
});

function analysis(teamId: string, starterPoints: number, optimalPoints: number, extra: Partial<TeamWeekAnalysis> = {}): TeamWeekAnalysis {
  return {
    teamId,
    starterPoints,
    projected: starterPoints,
    optimalPoints,
    efficiency: optimalPoints ? starterPoints / optimalPoints : 1,
    pointsLeft: Math.round((optimalPoints - starterPoints) * 100) / 100,
    top: P(`${teamId}-top`, "WR", 20),
    decisions: [],
    biggestMiss: null,
    optimalIds: [],
    ...extra,
  };
}

const week: AwardMatchup[] = [
  { id: "m1", home: { teamId: "A", score: 150 }, away: { teamId: "B", score: 90 }, winnerTeamId: "A" }, // blowout
  { id: "m2", home: { teamId: "C", score: 101 }, away: { teamId: "D", score: 100.5 }, winnerTeamId: "C" }, // closest; C lucky
  { id: "m3", home: { teamId: "E", score: 130 }, away: { teamId: "F", score: 135 }, winnerTeamId: "F" }, // E unlucky
];
const analyses = new Map([
  ["A", analysis("A", 150, 152)],
  ["B", analysis("B", 90, 155)],
  ["C", analysis("C", 101, 120)],
  ["D", analysis("D", 100.5, 104)],
  ["E", analysis("E", 130, 140)],
  ["F", analysis("F", 135, 136)],
]);
const names: Record<string, string> = { A: "Alpha", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot" };
const ALL = new Set(["TOP_SCORE", "LOWEST_SCORE", "BIGGEST_BLOWOUT", "CLOSEST_GAME", "BENCH_BLUNDER", "WAIVER_HERO"] as const);

test("sideResults + allPlayWins + median", () => {
  const r = sideResults(week);
  assert.equal(r.length, 6);
  assert.equal(r.find((x) => x.teamId === "D")?.result, "L");
  assert.equal(r.find((x) => x.teamId === "C")?.opponentId, "D");
  const scores = r.map((x) => x.score);
  assert.equal(allPlayWins(150, scores), 5);
  assert.equal(allPlayWins(90, scores), 0);
  assert.equal(median(scores), (101 + 130) / 2);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), 0);
  // ties: no winner recorded and equal scores
  const t = sideResults([{ id: "t", home: { teamId: "X", score: 100 }, away: { teamId: "Y", score: 100 }, winnerTeamId: null }]);
  assert.deepEqual(
    t.map((x) => x.result),
    ["T", "T"],
  );
});

test("computeAwards: every award with correct winners", () => {
  const awards = computeAwards({
    matchups: week,
    analyses,
    name: (id) => names[id],
    decimals: 2,
    enabled: ALL,
    pickups: [
      { teamId: "C", player: P("w1", "WR", 18), started: true, via: "WAIVER", faab: 12, acquiredLabel: "Nov 4" },
      { teamId: "D", player: P("w2", "RB", 26), started: false, via: "FREE_AGENT", faab: null, acquiredLabel: "Nov 10" },
    ],
    highScorePrize: 25,
  });
  const by = Object.fromEntries(awards.map((a) => [a.key, a]));
  assert.equal(by.TOP_SCORE.teamId, "A");
  assert.match(by.TOP_SCORE.detail, /\$25 weekly high-score prize/);
  assert.equal(by.LOWEST_SCORE.teamId, "B");
  assert.equal(by.BIGGEST_BLOWOUT.teamId, "A");
  assert.equal(by.BIGGEST_BLOWOUT.value, "+60.00");
  assert.equal(by.CLOSEST_GAME.teamId, "C");
  assert.equal(by.CLOSEST_GAME.value, "0.50 pts");
  assert.equal(by.BENCH_BLUNDER.teamId, "B"); // 65 points left, enough to beat Alpha
  assert.match(by.BENCH_BLUNDER.detail, /optimal lineup would have beaten Alpha/);
  // median = 115.5 → C won with 101 (below median); E lost with 130 (above median)
  assert.equal(by.LUCKIEST_WIN.teamId, "C");
  assert.equal(by.UNLUCKIEST_LOSS.teamId, "E");
  assert.match(by.UNLUCKIEST_LOSS.detail, /beats 3 of 5 teams/);
  // only started pickups count: w2 scored more but sat on the bench
  assert.equal(by.WAIVER_HERO.teamId, "C");
  assert.equal(by.WAIVER_HERO.player?.id, "w1");
  assert.match(by.WAIVER_HERO.detail, /\$12 FAB on Nov 4/);
  // display order is fixed
  assert.deepEqual(
    awards.map((a) => a.key),
    ["TOP_SCORE", "LOWEST_SCORE", "BIGGEST_BLOWOUT", "CLOSEST_GAME", "BENCH_BLUNDER", "LUCKIEST_WIN", "UNLUCKIEST_LOSS", "WAIVER_HERO"],
  );
});

test("computeAwards respects settings.niche.weeklyAwards and skips awards with no qualifier", () => {
  const awards = computeAwards({ matchups: week, analyses, name: (id) => names[id], decimals: 1, enabled: new Set(["TOP_SCORE"] as const), pickups: [], highScorePrize: 0 });
  const keys = awards.map((a) => a.key);
  assert.ok(keys.includes("TOP_SCORE"));
  for (const k of ["LOWEST_SCORE", "BIGGEST_BLOWOUT", "CLOSEST_GAME", "BENCH_BLUNDER", "WAIVER_HERO"]) assert.ok(!keys.includes(k as never), k);
  // always-on analytics awards remain
  assert.ok(keys.includes("LUCKIEST_WIN") && keys.includes("UNLUCKIEST_LOSS"));
  assert.doesNotMatch(awards[0].detail, /prize/);
  // a week where every winner beat the median has no luckiest win
  const fair = computeAwards({
    matchups: [
      { id: "x", home: { teamId: "A", score: 120 }, away: { teamId: "B", score: 80 }, winnerTeamId: "A" },
      { id: "y", home: { teamId: "C", score: 110 }, away: { teamId: "D", score: 90 }, winnerTeamId: "C" },
    ],
    analyses,
    name: (id) => names[id],
    decimals: 2,
    enabled: ALL,
    pickups: [],
    highScorePrize: 0,
  });
  assert.ok(!fair.some((a) => a.key === "LUCKIEST_WIN" || a.key === "UNLUCKIEST_LOSS" || a.key === "WAIVER_HERO"));
  assert.deepEqual(computeAwards({ matchups: [], analyses, name: (id) => id, decimals: 2, enabled: ALL, pickups: [], highScorePrize: 0 }), []);
});

test("closest game award handles ties", () => {
  const awards = computeAwards({
    matchups: [{ id: "t", home: { teamId: "A", score: 99 }, away: { teamId: "B", score: 99 }, winnerTeamId: null }],
    analyses,
    name: (id) => names[id],
    decimals: 2,
    enabled: ALL,
    pickups: [],
    highScorePrize: 0,
  });
  const closest = awards.find((a) => a.key === "CLOSEST_GAME")!;
  assert.equal(closest.value, "Tie");
  assert.match(closest.detail, /dead even/);
  assert.ok(!awards.some((a) => a.key === "BIGGEST_BLOWOUT"));
});

test("rosterAt undoes adds, drops and trades that happened later", () => {
  const current = new Map([
    ["p1", "A"], // added by A at t=50
    ["p2", "B"], // traded A → B at t=60
    ["p4", "A"],
  ]);
  const events: RosterEvent[] = [
    { at: 50, kind: "ADD", teamId: "A", playerId: "p1" },
    { at: 55, kind: "DROP", teamId: "B", playerId: "p3" },
    { at: 60, kind: "MOVE", fromTeamId: "A", toTeamId: "B", playerId: "p2" },
  ];
  const at40 = rosterAt(current, events, 40);
  assert.equal(at40.get("p1"), undefined);
  assert.equal(at40.get("p2"), "A");
  assert.equal(at40.get("p3"), "B");
  assert.equal(at40.get("p4"), "A");
  const at57 = rosterAt(current, events, 57);
  assert.equal(at57.get("p1"), "A");
  assert.equal(at57.get("p2"), "A");
  assert.equal(at57.get("p3"), undefined);
  // a trade that was executed and then reversed nets out
  const rev: RosterEvent[] = [
    { at: 70, kind: "MOVE", fromTeamId: "A", toTeamId: "B", playerId: "p4" },
    { at: 80, kind: "MOVE", fromTeamId: "B", toTeamId: "A", playerId: "p4" },
  ];
  assert.equal(rosterAt(current, rev, 65).get("p4"), "A");
  assert.equal(rosterAt(current, rev, 75).get("p4"), "B");
});

test("ownershipAtLock uses each player's own lock time", () => {
  const current = new Map([["late", "A"], ["early", "B"], ["bye", "C"]]);
  const events: RosterEvent[] = [
    { at: 150, kind: "ADD", teamId: "A", playerId: "late" }, // added after his Thursday lock → not A's that week
    { at: 150, kind: "MOVE", fromTeamId: "A", toTeamId: "B", playerId: "early" }, // traded after his lock → still A's
    { at: 300, kind: "ADD", teamId: "C", playerId: "bye" }, // added after the week → not C's
  ];
  const lock = new Map([
    ["late", 100],
    ["early", 100],
  ]);
  const own = ownershipAtLock(current, events, lock, 200);
  assert.equal(own.get("late"), undefined);
  assert.equal(own.get("early"), "A");
  assert.equal(own.get("bye"), undefined);
});

test("lockTimeFor follows the league lock type and offset", () => {
  const wk = { firstKickoff: 1_000_000, firstSundayKickoff: 5_000_000 };
  const lineup = (lockType: LeagueSettings["lineup"]["lockType"], lockOffsetMinutes = 0) => ({ lockType, lockOffsetMinutes });
  assert.equal(lockTimeFor(9_000_000, wk, lineup("PER_GAME")), 9_000_000);
  assert.equal(lockTimeFor(9_000_000, wk, lineup("PER_GAME", 5)), 9_000_000 - 300_000);
  assert.equal(lockTimeFor(9_000_000, wk, lineup("FIRST_GAME_OF_WEEK")), 1_000_000);
  assert.equal(lockTimeFor(9_000_000, wk, lineup("SUNDAY_FIRST_GAME")), 5_000_000);
  assert.equal(lockTimeFor(2_000_000, wk, lineup("SUNDAY_FIRST_GAME")), 2_000_000); // Thursday game locks itself
});

test("pickMatchupOfWeek: comeback > close game > upset > shootout", () => {
  const base = { homeTeamId: "H", awayTeamId: "A", winnerTeamId: null, preGameHomeWinProb: null as number | null, wpHome: [] as number[] };
  const blowout = { ...base, id: "blow", homeScore: 180, awayScore: 100 };
  const close = { ...base, id: "close", homeScore: 120, awayScore: 115 };
  const comeback = { ...base, id: "comeback", homeScore: 140, awayScore: 120, wpHome: [0.5, 0.3, 0.12, 0.6, 1] };
  const upset = { ...base, id: "upset", homeScore: 150, awayScore: 120, preGameHomeWinProb: 0.2 };
  assert.equal(pickMatchupOfWeek([blowout, close, comeback, upset])?.reason, "COMEBACK");
  const c = pickMatchupOfWeek([blowout, close, comeback, upset])!;
  assert.equal(c.matchupId, "comeback");
  assert.ok(Math.abs((c.winnerLowWinProb ?? 0) - 0.12) < 1e-9);
  assert.ok(Math.abs((c.wpSwing ?? 0) - 0.88) < 1e-9);
  assert.equal(pickMatchupOfWeek([blowout, close, upset])?.matchupId, "close");
  assert.equal(pickMatchupOfWeek([blowout, upset])?.reason, "UPSET");
  assert.equal(pickMatchupOfWeek([blowout, { ...base, id: "b2", homeScore: 100, awayScore: 60 }])?.matchupId, "blow");
  assert.equal(pickMatchupOfWeek([]), null);
  // away winner: WP is inverted
  const awayComeback = { ...base, id: "ac", homeScore: 100, awayScore: 110, wpHome: [0.4, 0.9, 0.95, 0.2, 0] };
  assert.ok(Math.abs((pickMatchupOfWeek([awayComeback])!.winnerLowWinProb ?? 0) - 0.05) < 1e-9);
});

test("downsample keeps endpoints and caps length", () => {
  const s = Array.from({ length: 200 }, (_, i) => i / 199);
  const d = downsample(s, 40);
  assert.equal(d.length, 40);
  assert.equal(d[0], 0);
  assert.equal(d[39], 1);
  assert.deepEqual(downsample([0.5, 0.25]), [0.5, 0.25]);
});

test("standingsMovement computes rank changes and this week's result", () => {
  const rows = standingsMovement(
    [
      { teamId: "A", rank: 2, wins: 6, losses: 4, ties: 0, pointsFor: 1300, streak: "L1" },
      { teamId: "B", rank: 1, wins: 7, losses: 3, ties: 0, pointsFor: 1400, streak: "W3" },
      { teamId: "C", rank: 3, wins: 5, losses: 5, ties: 0, pointsFor: 1200, streak: "W1" },
    ],
    new Map([
      ["A", 1],
      ["B", 3],
      ["C", 2],
    ]),
    new Map([
      ["A", "L"],
      ["B", "W"],
    ]),
  );
  assert.deepEqual(
    rows.map((r) => [r.teamId, r.change, r.result]),
    [
      ["B", 2, "W"],
      ["A", -1, "L"],
      ["C", -1, null],
    ],
  );
  const first = standingsMovement([{ teamId: "A", rank: 1, wins: 1, losses: 0, ties: 0, pointsFor: 100, streak: "W1" }], null, new Map());
  assert.equal(first[0].prevRank, null);
  assert.equal(first[0].change, 0);
});

test("pickOddsSnapshots + oddsMovement bracket this week's results", () => {
  const snaps = [
    { id: "s12", throughWeek: 11, computedAt: 300 },
    { id: "s11b", throughWeek: 10, computedAt: 250 },
    { id: "s11a", throughWeek: 10, computedAt: 200 },
    { id: "s10", throughWeek: 9, computedAt: 100 },
  ];
  const w11 = pickOddsSnapshots(snaps, 11);
  assert.equal(w11.after?.id, "s12");
  assert.equal(w11.before?.id, "s11b");
  const w10 = pickOddsSnapshots(snaps, 10);
  assert.equal(w10.after?.id, "s11b");
  assert.equal(w10.before?.id, "s10");
  assert.deepEqual(pickOddsSnapshots(snaps, 8), { before: null, after: null });
  const moves = oddsMovement(
    [
      { teamId: "A", playoffPct: 0.5 },
      { teamId: "B", playoffPct: 0.9 },
    ],
    [
      { teamId: "A", playoffPct: 0.75, champPct: 0.1 },
      { teamId: "B", playoffPct: 0.8, champPct: 0.2 },
      { teamId: "C", playoffPct: 0.1 },
    ],
  );
  assert.deepEqual(
    moves.map((m) => [m.teamId, m.delta]),
    [
      ["B", -0.1],
      ["A", 0.25],
      ["C", 0],
    ],
  );
});

test("marqueeGames ranks by league starters' projected points then over/under", () => {
  const games = [
    { id: "g1", homeTeam: "KC", awayTeam: "BUF", startTime: 1, spread: -3, overUnder: 47.5, oddsDetails: "KC -3" },
    { id: "g2", homeTeam: "DET", awayTeam: "CHI", startTime: 2, spread: 2.5, overUnder: 55.5, oddsDetails: "CHI -2.5" },
    { id: "g3", homeTeam: "NYG", awayTeam: "IND", startTime: 3, spread: null, overUnder: null, oddsDetails: null },
    { id: "g4", homeTeam: "LV", awayTeam: "CLE", startTime: 4, spread: -4.5, overUnder: 41.5, oddsDetails: null },
  ];
  const starters = new Map([
    ["KC", { count: 3, projected: 40 }],
    ["BUF", { count: 2, projected: 30 }],
    ["DET", { count: 4, projected: 50 }],
  ]);
  const m = marqueeGames(games, starters, 3);
  assert.deepEqual(
    m.map((g) => g.id),
    ["g1", "g2", "g4"],
  );
  assert.equal(m[0].starters, 5);
  assert.equal(m[0].starterProjection, 70);
});

test("schedule helpers: recap due in the league timezone, completed weeks", () => {
  // Tue Nov 24 2026 14:00 UTC = 9:00 AM in New York
  const now = new Date("2026-11-24T14:00:00Z");
  assert.deepEqual(localWeekdayHour(now, "America/New_York"), { weekday: "TUE", hour: 9 });
  assert.equal(isRecapDue(now, "America/New_York", "TUE", 9), true);
  assert.equal(isRecapDue(now, "America/New_York", "TUE", 10), false);
  assert.equal(isRecapDue(now, "America/Los_Angeles", "TUE", 9), false); // 6 AM there
  assert.equal(isRecapDue(now, "America/New_York", "MON", 0), false);
  assert.equal(isRecapDue(new Date("2026-11-25T03:30:00Z"), "America/New_York", "TUE", 9), true); // 10:30 PM Tue
  const ms = [
    { week: 10, status: "FINAL" },
    { week: 10, status: "FINAL" },
    { week: 11, status: "FINAL" },
    { week: 11, status: "LIVE" },
    { week: 9, status: "FINAL" },
  ];
  assert.equal(latestCompletedWeek(ms), 10);
  assert.deepEqual(completedWeeks(ms), [10, 9]);
  assert.equal(latestCompletedWeek([{ week: 1, status: "UPCOMING" }]), null);
});

test("statLine formats box scores by position", () => {
  assert.equal(statLine({ pass_yd: 325, pass_td: 4, pass_int: 1, rush_yd: 9 }, "QB"), "325 pass yds, 4 TD, 1 INT");
  assert.equal(statLine({ pass_yd: 250, pass_td: 2, rush_yd: 41, rush_td: 1 }, "QB"), "250 pass yds, 2 TD · 41 rush yds, 1 TD");
  assert.equal(statLine({ rush_yd: 111, rush_td: 3, rec: 4, rec_yd: 18 }, "RB"), "111 rush yds, 3 TD · 4 rec, 18 yds");
  assert.equal(statLine({ rec: 11, rec_yd: 132, rec_td: 1 }, "WR"), "11 rec, 132 yds, 1 TD");
  assert.equal(statLine({ fgm: 3, fga: 4, xpm: 2 }, "K"), "3/4 FG, 2 XP");
  assert.equal(statLine({ sack: 4, int: 2, def_td: 1, pts_allow: 10 }, "DEF"), "4 sacks, 2 INT, 1 TD, 10 PA");
  assert.equal(statLine(null, "WR"), "");
});

test("injury concerns", () => {
  for (const s of ["Questionable", "Doubtful", "Out", "IR", "Sus", "PUP"]) assert.equal(isInjuryConcern(s), true, s);
  for (const s of [null, "", "Active", "NA"]) assert.equal(isInjuryConcern(s), false, String(s));
});

const nf = (over: Partial<NarrativeFacts> = {}): NarrativeFacts => ({
  seed: "L:2026:11",
  week: 11,
  weekLabel: "Week 11",
  isPlayoffs: false,
  decimals: 2,
  name: (id) => names[id] ?? id,
  high: { teamId: "A", opponentId: "B", score: 150, opponentScore: 90, result: "W" },
  low: { teamId: "B", opponentId: "A", score: 90, opponentScore: 150, result: "L" },
  highTop: P("x", "WR", 40),
  average: 118,
  closest: { teamId: "C", opponentId: "D", score: 101, opponentScore: 100.5, result: "W" },
  blowout: { teamId: "A", opponentId: "B", score: 150, opponentScore: 90, result: "W" },
  comeback: null,
  upset: null,
  leader: { teamId: "F", record: "8-3", streak: "W4", isNew: false },
  benchBlunder: { teamId: "B", pointsLeft: 40, wouldHaveWon: false },
  topPerformer: { name: "Player x", points: 40, ownerName: "Alpha", started: true },
  championship: null,
  ...over,
});

test("narrative: headline follows the biggest storyline and is stable per week", () => {
  const h1 = buildHeadline(nf());
  assert.equal(h1, buildHeadline(nf()));
  // 0.5-point game beats a 60-point blowout
  assert.match(h1, /Charlie/);
  const champ = buildHeadline(nf({ championship: { teamId: "E", opponentId: "F", score: 140, opponentScore: 120, result: "W" } }));
  assert.match(champ, /Echo/);
  const comeback = buildHeadline(nf({ comeback: { winner: { teamId: "D", opponentId: "C", score: 110, opponentScore: 100, result: "W" }, lowWinProb: 0.08 } }));
  assert.match(comeback, /Delta/);
  const quiet = buildHeadline(nf({ closest: { teamId: "C", opponentId: "D", score: 110, opponentScore: 100, result: "W" }, blowout: { teamId: "A", opponentId: "B", score: 120, opponentScore: 100, result: "W" }, high: { teamId: "A", opponentId: "B", score: 120, opponentScore: 100, result: "W" } }));
  assert.match(quiet, /Alpha/);
  assert.ok(!/\{|\}/.test(h1 + champ + comeback + quiet), "no unfilled placeholders");
});

test("narrative: intro covers the week's facts without placeholders", () => {
  const intro = buildIntro(nf());
  assert.match(intro, /Week 11/);
  assert.match(intro, /Alpha/);
  assert.match(intro, /150\.00/);
  assert.match(intro, /Charlie/);
  assert.match(intro, /left 40\.00 points on the bench/);
  assert.match(intro, /Foxtrot/);
  assert.match(intro, /4 straight wins/);
  assert.ok(!/\{|\}|undefined|NaN/.test(intro));
  const newLeader = buildIntro(nf({ leader: { teamId: "C", record: "8-3", streak: "W1", isNew: true } }));
  assert.match(newLeader, /Charlie moved into first place at 8-3/);
});

test("narrative: matchup blurbs pick verbs by margin and explain bench flips accurately", () => {
  const base = { seed: "s", decimals: 1, winnerName: "Alpha", loserName: "Bravo", winnerTop: P("wt", "RB", 30), loserTop: P("lt", "WR", 12), tie: false, loserFlip: null };
  assert.match(matchupBlurb({ ...base, winnerScore: 150, loserScore: 90 }), /^Alpha (routed|steamrolled|buried) Bravo 150\.0–90\.0 behind Player wt's 30\.0\.$/);
  assert.match(matchupBlurb({ ...base, winnerScore: 100, loserScore: 99 }), /(survived|squeaked past|held off)/);
  assert.equal(matchupBlurb({ ...base, winnerScore: 99, loserScore: 99, tie: true }), "Alpha and Bravo played to a 99.0–99.0 draw.");
  const oneSwap = matchupBlurb({ ...base, winnerScore: 110, loserScore: 100, loserFlip: { benched: P("b", "RB", 22), started: P("s", "RB", 4), diff: 18, pointsLeft: 25 } });
  assert.match(oneSwap, /starting Player b \(22\.0\) over Player s \(4\.0\) would have flipped it/);
  const many = matchupBlurb({ ...base, winnerScore: 130, loserScore: 100, loserFlip: { benched: P("b", "RB", 22), started: P("s", "RB", 4), diff: 18, pointsLeft: 35 } });
  assert.match(many, /left 35\.0 points on the bench, enough to flip the result/);
});

test("narrative helpers", () => {
  assert.equal(fill("{a} and {b} {c}", { a: 1, b: "two" }), "1 and two {c}");
  assert.equal(poss("George Pickens"), "George Pickens'");
  assert.equal(poss("Josh Allen"), "Josh Allen's");
  assert.equal(hashSeed("abc"), hashSeed("abc"));
  assert.notEqual(hashSeed("abc"), hashSeed("abd"));
  const v = ["a", "b", "c"];
  assert.ok(v.includes(pickVariant(v, "x")));
});

function sampleContent(): RecapContent {
  const team = (id: string, name: string, color: string) => ({ id, name, abbrev: id, logoUrl: null, primaryColor: color, secondaryColor: "#f5b301", owner: "Owner", record: "7-4", rank: 1 });
  const side = (teamId: string, score: number, won: boolean) => ({
    teamId,
    score,
    projected: 120,
    starterPoints: score,
    optimalPoints: score + 10,
    efficiency: score / (score + 10),
    pointsLeft: 10,
    top: P(`${teamId}1`, "WR", 30),
    benchMiss: null,
    won,
    optimalWouldWin: false,
  });
  return {
    version: RECAP_VERSION,
    leagueId: "L",
    leagueName: "CTE Dynasty",
    season: 2026,
    week: 11,
    weekLabel: "Week 11",
    decimals: 2,
    timezone: "America/New_York",
    generatedAt: new Date().toISOString(),
    headline: "Alpha <b>wins</b> & more",
    intro: "Intro text.",
    specialNote: null,
    teams: { A: team("A", "Alpha <script>", "#123456"), B: team("B", "Bravo", "red;background:url(x)") },
    stats: { teams: 2, highScore: 140, lowScore: 100, average: 120, median: 120, totalPoints: 240, averageEfficiency: 0.9 },
    matchupOfWeek: { matchupId: "m1", reason: "CLOSEST", reasonLabel: "Closest game", summary: "Close one.", wpSwing: null },
    matchups: [{ id: "m1", label: null, kind: "REGULAR", home: side("A", 140, true), away: side("B", 100, false), winnerTeamId: "A", margin: 40, combined: 240, preGameHomeWinProb: 0.6, winnerLowWinProb: null, wpSeries: [], rivalry: null, blurb: "Alpha beat Bravo." }],
    awards: [{ key: "TOP_SCORE", title: "Manager of the Week", teamId: "A", value: "140.00 pts", detail: "Top." }],
    efficiency: [{ teamId: "A", starterPoints: 140, optimalPoints: 150, efficiency: 0.93, pointsLeft: 10 }],
    topPerformers: [],
    transactions: { trades: [], moves: [], adds: 0, drops: 0, faabSpent: 0, mostActiveTeamId: null, biggestFaab: null },
    standings: [{ teamId: "A", rank: 1, prevRank: 2, change: 1, wins: 7, losses: 4, ties: 0, pointsFor: 1400, streak: "W2", result: "W" }],
    lastPlace: null,
    playoffOdds: null,
    nextWeek: { week: 12, matchups: [{ id: "n1", label: null, home: { teamId: "A", projected: 130, winProb: 0.6 }, away: { teamId: "B", projected: 120, winProb: 0.4 } }], marquee: [] },
    injuries: [],
  };
}

test("email renderer escapes content, sanitizes colors, personalizes and links back to the app", () => {
  const c = sampleContent();
  assert.equal(isRecapContent(c), true);
  assert.equal(isRecapContent({ ...c, version: RECAP_VERSION - 1 }), false);
  assert.equal(isRecapContent(null), false);
  const generic = renderRecapEmail(c, "CTE Dynasty", { appUrl: "https://cte.example" });
  assert.ok(!generic.html.includes("<script>"));
  assert.ok(generic.html.includes("Alpha &lt;script&gt;"));
  assert.ok(generic.html.includes("Alpha &lt;b&gt;wins&lt;/b&gt; &amp; more"));
  assert.ok(!generic.html.includes("url(x)"));
  assert.ok(generic.html.includes("https://cte.example/recaps/11?season=2026"));
  assert.ok(generic.html.includes("https://cte.example/scoring?week=11"));
  assert.ok(!generic.html.includes("Your week"));
  assert.match(generic.subject, /Week 11 Recap/);
  assert.match(generic.text, /MATCHUP OF THE WEEK/);
  assert.match(generic.text, /https:\/\/cte\.example\/recaps\/11/);
  const mine = renderRecapEmail(c, "CTE Dynasty", { appUrl: "https://cte.example", teamId: "A" });
  assert.ok(mine.html.includes("Your week"));
  assert.ok(mine.html.includes("Now 1st in the standings (up 1)"));
  assert.match(mine.text, /YOUR WEEK: Beat Bravo/);
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(safeColor("#abc"), "#abc");
  assert.equal(safeColor("red"), "#1d4ed8");
});

test("recap email opt-outs", () => {
  assert.equal(wantsRecapEmail(null), true);
  assert.equal(wantsRecapEmail({ weeklyRecapEmail: true, prefs: {} }), true);
  assert.equal(wantsRecapEmail({ weeklyRecapEmail: false, prefs: {} }), false);
  assert.equal(wantsRecapEmail({ weeklyRecapEmail: true, prefs: { RECAP: { email: false } } }), false);
  assert.equal(wantsRecapEmail({ weeklyRecapEmail: true, prefs: { RECAP: { push: false } } }), true);
});
