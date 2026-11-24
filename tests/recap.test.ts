import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import {
  allPlayWins,
  analyzeTeamWeek,
  bestDecision,
  commissionerRosterEvent,
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
  previewWinProb,
  isRecapDueFor,
  recapSendTime,
  rosterAt,
  showWinnerLow,
  sideResults,
  standingsMovement,
  statLine,
  tzOffsetMs,
  weekCompletedAt,
  zonedHourToUtc,
  type AwardMatchup,
  type RosterEvent,
  type SlotStart,
  type TeamWeekAnalysis,
} from "@/lib/recap/compute";
import { buildHeadline, buildIntro, fill, hashSeed, matchupBlurb, pickVariant, poss, rotateVariant, type NarrativeFacts } from "@/lib/recap/narrative";
import { escapeHtml, renderRecapEmail, safeColor } from "@/lib/recap/html";
import { wantsRecapEmail } from "@/lib/recap/jobs";
import { RECAP_VERSION, isRecapContent, isRecapShape, type PlayerPerf, type RecapContent } from "@/lib/recap/types";

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

test("recap send time: first recap day/hour after the week ends, DST-aware, with catch-up and staleness", () => {
  // 9 AM New York on a date in EST (UTC-5) and in EDT (UTC-4)
  assert.equal(new Date(zonedHourToUtc(2026, 11, 24, 9, "America/New_York")).toISOString(), "2026-11-24T14:00:00.000Z");
  assert.equal(new Date(zonedHourToUtc(2026, 10, 13, 9, "America/New_York")).toISOString(), "2026-10-13T13:00:00.000Z");
  assert.equal(tzOffsetMs(Date.parse("2026-07-01T12:00:00Z"), "America/Los_Angeles"), -7 * 3_600_000);

  // Week ends after Monday Night Football (Tue Nov 24 2026, 01:15 UTC kickoff + 4h = Mon 11:15 PM New York)
  const mnf = Date.parse("2026-11-24T01:15:00Z");
  const done = weekCompletedAt([Date.parse("2026-11-19T01:15:00Z"), mnf], []);
  assert.equal(done, mnf + 4 * 3_600_000);
  assert.equal(new Date(recapSendTime(done, "America/New_York", "TUE", 9)).toISOString(), "2026-11-24T14:00:00.000Z");
  // a Monday 9 AM recap waits for the following Monday
  assert.equal(new Date(recapSendTime(done, "America/New_York", "MON", 9)).toISOString(), "2026-11-30T14:00:00.000Z");
  // same day, later hour
  assert.equal(new Date(recapSendTime(Date.parse("2026-11-24T12:00:00Z"), "America/New_York", "TUE", 9)).toISOString(), "2026-11-24T14:00:00.000Z");
  // across the November DST change (Sun Nov 1 2026): Tuesday Nov 3 at 9 AM EST
  assert.equal(new Date(recapSendTime(Date.parse("2026-11-03T05:00:00Z"), "America/New_York", "TUE", 9)).toISOString(), "2026-11-03T14:00:00.000Z");

  assert.equal(isRecapDueFor(new Date("2026-11-24T13:59:00Z"), done, "America/New_York", "TUE", 9), false);
  assert.equal(isRecapDueFor(new Date("2026-11-24T14:10:00Z"), done, "America/New_York", "TUE", 9), true);
  // the server was down on Tuesday: Wednesday's run still delivers
  assert.equal(isRecapDueFor(new Date("2026-11-25T15:10:00Z"), done, "America/New_York", "TUE", 9), true);
  // weeks-old completions are never mailed out late
  assert.equal(isRecapDueFor(new Date("2026-12-01T14:10:00Z"), done, "America/New_York", "TUE", 9), false);
  // fall back to matchup timestamps when no NFL games are known; unknown timezones fall back to New York
  assert.equal(weekCompletedAt([], [5, 9, 7]), 9);
  assert.equal(recapSendTime(done, "Not/AZone", "TUE", 9), recapSendTime(done, "America/New_York", "TUE", 9));
});

test("winner's low is only called out when the winner actually trailed its starting odds", () => {
  assert.equal(showWinnerLow(null, 0.4), false);
  assert.equal(showWinnerLow(0.76, 0.55), false);
  assert.equal(showWinnerLow(0.2, 0.55), true);
  assert.equal(showWinnerLow(0.45, null), true);
  assert.equal(showWinnerLow(0.6, null), false);
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
  // within a season the same slot rotates week to week, and stays stable for a given week
  const picks = [1, 2, 3, 4, 5, 6].map((week) => rotateVariant(v, { seed: `L:2026:${week}`, series: "L:2026", week }, "headline"));
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1]);
  assert.equal(rotateVariant(v, { seed: "L:2026:4", series: "L:2026", week: 4 }, "headline"), picks[3]);
  assert.equal(rotateVariant(v, { seed: "L:2026:4", week: 4 }, "headline"), pickVariant(v, "L:2026:4:headline"));
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

test("commissioner transactions: force add / drop / move change rosters, edits and FAB don't", () => {
  const base = { at: 100, teamId: "A", relatedTeamId: null as string | null, playerId: "p1" };
  assert.deepEqual(commissionerRosterEvent({ ...base, description: "Commissioner added Joe Flacco (QB CIN) to Alpha: $1, 1 yr" }), { at: 100, kind: "ADD", teamId: "A", playerId: "p1" });
  assert.deepEqual(commissionerRosterEvent({ ...base, description: "Restored Joe Flacco (trade reversal) — $1, 1 yr" }), { at: 100, kind: "ADD", teamId: "A", playerId: "p1" });
  assert.deepEqual(commissionerRosterEvent({ ...base, description: "Commissioner dropped Joe Flacco (QB CIN) from Alpha (no dead money)" }), { at: 100, kind: "DROP", teamId: "A", playerId: "p1" });
  assert.deepEqual(commissionerRosterEvent({ ...base, relatedTeamId: "B", description: "Commissioner moved Joe Flacco (QB CIN) from Bravo to Alpha ($1, 1 yr)" }), {
    at: 100,
    kind: "MOVE",
    fromTeamId: "B",
    toTeamId: "A",
    playerId: "p1",
  });
  assert.equal(commissionerRosterEvent({ ...base, description: "Commissioner moved Joe Flacco (QB CIN) from Alpha to Alpha" }), null, "a move needs an origin team");
  assert.equal(commissionerRosterEvent({ ...base, description: "Commissioner edited Joe Burrow (QB CIN) on Alpha: salary $59 → $60" }), null);
  assert.equal(commissionerRosterEvent({ ...base, description: "Commissioner used amnesty cut 2 of 2 to wipe $8 dead money" }), null);
  assert.equal(commissionerRosterEvent({ ...base, playerId: null, description: "Commissioner added $5 FAB to Alpha: QA" }), null);
  // a force add followed by a move, undone from the current rosters
  const current = new Map([["p1", "B"]]);
  const events = [
    commissionerRosterEvent({ ...base, at: 50, description: "Commissioner added X to Alpha" })!,
    commissionerRosterEvent({ ...base, at: 60, teamId: "B", relatedTeamId: "A", description: "Commissioner moved X from Alpha to Bravo" })!,
  ];
  assert.equal(rosterAt(current, events, 40).get("p1"), undefined);
  assert.equal(rosterAt(current, events, 55).get("p1"), "A");
  assert.equal(rosterAt(current, events, 65).get("p1"), "B");
});

test("next-week preview odds need projections on both sides", () => {
  assert.equal(previewWinProb(0, 0, () => 0.5), null);
  assert.equal(previewWinProb(120, 0, () => 0.9), null);
  assert.equal(previewWinProb(130, 120, () => 0.62), 0.62);
  assert.equal(previewWinProb(130, 120, () => Number.NaN), null);
  assert.equal(previewWinProb(130, 120, () => 1.2), 1);
});

test("email + text handle previews without projections and backfilled (historical) previews", () => {
  const c = sampleContent();
  c.nextWeek = {
    week: 12,
    historical: true,
    matchups: [{ id: "n1", label: null, home: { teamId: "A", projected: 0, winProb: null }, away: { teamId: "B", projected: 0, winProb: null } }],
    marquee: [],
  };
  const e = renderRecapEmail(c, "CTE Dynasty", { appUrl: "https://cte.example" });
  assert.ok(!/50%/.test(e.html), "no fake coin-flip odds");
  assert.match(e.html, /Win probabilities appear once projections are posted/);
  assert.match(e.html, /written after Week 12 kicked off/);
  assert.match(e.text, /no projection yet/);
  assert.ok(!/NaN|undefined/.test(e.html + e.text));
});

// ───────────────────────────── Multi-week playoff games ─────────────────────────────
import { gameScores, legPhrase, optimalFlips, previewGameNote, recapGameLine, resultPhrase } from "@/lib/recap/compute";
import { legBlurb, motwCopy } from "@/lib/recap/narrative";
import { recapGameOf } from "@/lib/recap/generate";
import type { PlayoffGameContext } from "@/lib/playoffs/bracket";

/** Week 2 of 2: A won the week 145–90 after losing week 1 100–140 → A wins the game 245–230. */
const legGameDecided: AwardMatchup = {
  id: "g2",
  home: { teamId: "A", score: 145 },
  away: { teamId: "B", score: 90 },
  winnerTeamId: "A",
  game: { leg: 2, legs: 2, homeScore: 245, awayScore: 230, decided: true, winnerTeamId: "A" },
};
/** Week 1 of 2: C won the week 120–118 — nobody has won the game. */
const legGameOpen: AwardMatchup = {
  id: "h1",
  home: { teamId: "C", score: 120 },
  away: { teamId: "D", score: 118 },
  winnerTeamId: null,
  game: { leg: 1, legs: 2, homeScore: 120, awayScore: 118, decided: false, winnerTeamId: null },
};
/** Week 2 of 2 where the week's winner lost the game: F won the week but E wins 200–199 on aggregate. */
const legGameFlip: AwardMatchup = {
  id: "k2",
  home: { teamId: "E", score: 80 },
  away: { teamId: "F", score: 110 },
  winnerTeamId: "E",
  game: { leg: 2, legs: 2, homeScore: 200, awayScore: 199, decided: true, winnerTeamId: "E" },
};

test("sideResults: a week of a multi-week game carries the game's result, and none before its last week", () => {
  const r = sideResults([legGameDecided, legGameOpen, legGameFlip]);
  const of = (t: string) => r.find((x) => x.teamId === t)!;
  assert.equal(of("A").result, "W");
  assert.deepEqual(of("A").game, { score: 245, opponentScore: 230, leg: 2, legs: 2, decided: true });
  assert.equal(of("C").result, "P");
  assert.equal(of("D").result, "P");
  assert.equal(of("F").result, "L", "won the week, lost the game");
  assert.equal(of("E").result, "W");
  assert.deepEqual(gameScores(of("E")), { score: 200, opponentScore: 199, weeks: 2 });
  assert.equal(legPhrase({ leg: 1, legs: 2 }), "after week 1 of 2");
  // a decided game with no stored winner falls back to the combined score
  const noWinner = sideResults([{ ...legGameFlip, game: { ...legGameFlip.game!, winnerTeamId: null } }]);
  assert.equal(noWinner.find((x) => x.teamId === "E")!.result, "W");
});

test("computeAwards: blowouts and close games go by the whole game, luck skips multi-week games", () => {
  const regular: AwardMatchup = { id: "r", home: { teamId: "C", score: 60 }, away: { teamId: "D", score: 140 }, winnerTeamId: "D" };
  const awards = computeAwards({ matchups: [legGameDecided, legGameOpen, legGameFlip, { ...regular, home: { teamId: "X", score: 60 }, away: { teamId: "Y", score: 140 }, winnerTeamId: "Y" }], analyses, name: (id) => names[id] ?? id, decimals: 2, enabled: ALL, pickups: [], highScorePrize: 0 });
  const by = Object.fromEntries(awards.map((a) => [a.key, a]));
  // the 1-point aggregate win is the closest decided game; the open week-1 game decided nothing
  assert.equal(by.CLOSEST_GAME.teamId, "E");
  assert.equal(by.CLOSEST_GAME.value, "1.00 pts");
  assert.match(by.CLOSEST_GAME.detail, /Echo edged Foxtrot 200\.00–199\.00 over 2 weeks/);
  assert.equal(by.BIGGEST_BLOWOUT.teamId, "Y", "80-point week beats A's 15-point two-week win");
  // top score of the week: A's 145, described against the game
  assert.equal(by.TOP_SCORE.teamId, "A");
  assert.match(by.TOP_SCORE.detail, /on the way to a 2-week win over Bravo/);
  // luck compares one week's score with that week's result: multi-week games never qualify
  assert.ok(!["E", "F", "A", "B", "C", "D"].includes(by.LUCKIEST_WIN?.teamId ?? ""));
  assert.ok(!["E", "F", "A", "B", "C", "D"].includes(by.UNLUCKIEST_LOSS?.teamId ?? ""));

  // a week where every playoff game is only halfway: no blowout / closest game at all
  const half = computeAwards({ matchups: [legGameOpen, { ...legGameOpen, id: "h2", home: { teamId: "E", score: 150 }, away: { teamId: "F", score: 90 }, game: { ...legGameOpen.game!, homeScore: 150, awayScore: 90 } }], analyses, name: (id) => names[id], decimals: 2, enabled: ALL, pickups: [], highScorePrize: 0 });
  const hb = Object.fromEntries(half.map((a) => [a.key, a]));
  assert.equal(hb.BIGGEST_BLOWOUT, undefined);
  assert.equal(hb.CLOSEST_GAME, undefined);
  assert.match(hb.TOP_SCORE.detail, /to lead Foxtrot 150\.00–90\.00 after week 1 of 2/);
  assert.match(hb.LOWEST_SCORE.detail, /and trails Echo 90\.00–150\.00 after week 1 of 2/);
});

test("resultPhrase and optimalFlips judge a multi-week game on its combined score", () => {
  const f = (n: number) => n.toFixed(1);
  const [a, b] = sideResults([legGameDecided]);
  assert.equal(resultPhrase(b!, (id) => names[id], f, "low"), "as Alpha won the 2-week game");
  const [, d] = sideResults([legGameOpen]);
  assert.equal(resultPhrase(d!, (id) => names[id], f, "high"), "but still trails Charlie 118.0–120.0 after week 1 of 2");
  // B (230 over two weeks, 90 this week): an optimal 150 this week would have made it 290 > 245 → flips the game
  assert.equal(optimalFlips(b!, 150, 90), true);
  assert.equal(optimalFlips(b!, 100, 90), false, "240 < 245");
  assert.equal(optimalFlips(a!, 200, 145), false, "a winner can't flip");
  assert.equal(optimalFlips(d!, 300, 118), false, "nothing to flip before the game is decided");
});

test("pickMatchupOfWeek: multi-week games are close by the combined score and are never comebacks or upsets", () => {
  const cand = (m: AwardMatchup) => ({ id: m.id, homeTeamId: m.home.teamId, awayTeamId: m.away.teamId, homeScore: m.home.score, awayScore: m.away.score, winnerTeamId: m.winnerTeamId, wpHome: [], preGameHomeWinProb: null, game: m.game ?? null });
  // the week was 80–110 but the game was decided by one point
  const pick = pickMatchupOfWeek([cand(legGameDecided), cand(legGameFlip)]);
  assert.equal(pick?.matchupId, "k2");
  assert.equal(pick?.reason, "CLOSEST");
  assert.equal(pick?.winnerLowWinProb, null);
  const copy = motwCopy("CLOSEST", { seed: "s", decimals: 2, winnerName: "Echo", loserName: "Foxtrot", winnerScore: 200, loserScore: 199, lowWinProb: null, preGameWinProb: null, tie: false, game: { leg: 2, legs: 2, decided: true, weekCombined: 190 } });
  assert.equal(copy.summary, "Echo outlasted Foxtrot by 1.00 over 2 weeks, 200.00–199.00.");
  const open = motwCopy("CLOSEST", { seed: "s", decimals: 2, winnerName: "Charlie", loserName: "Delta", winnerScore: 120, loserScore: 118, lowWinProb: null, preGameWinProb: null, tie: false, game: { leg: 1, legs: 2, decided: false, weekCombined: 238 } });
  assert.equal(open.summary, "Charlie leads Delta by just 2.00 after week 1 of 2.");
  const shoot = motwCopy("SHOOTOUT", { seed: "s", decimals: 1, winnerName: "Alpha", loserName: "Bravo", winnerScore: 245, loserScore: 230, lowWinProb: null, preGameWinProb: null, tie: false, game: { leg: 2, legs: 2, decided: true, weekCombined: 235 } });
  assert.equal(shoot.summary, "235.0 combined points in the deciding week as Alpha beat Bravo 245.0–230.0 over 2 weeks.");
  assert.equal(motwCopy("CLOSEST", { seed: "s", decimals: 0, winnerName: "A", loserName: "B", winnerScore: 200, loserScore: 200, lowWinProb: null, preGameWinProb: null, tie: false, game: { leg: 2, legs: 2, decided: true, weekCombined: 190 } }).label, "Dead heat");
});

test("legBlurb: the week of a multi-week game reads as part of the game", () => {
  const base = { seed: "s", decimals: 1, aTop: P("t", "RB", 31), bFlip: null, tiebreak: false };
  assert.equal(
    legBlurb({ ...base, leg: 1, legs: 2, decided: false, aName: "Delta", bName: "Alpha", aWeek: 140, bWeek: 100, aTotal: 140, bTotal: 100 }),
    "Delta leads Alpha 140.0–100.0 after week 1 of 2, with Player t's 31.0 leading the way this week. One week to go.",
  );
  assert.equal(legBlurb({ ...base, leg: 1, legs: 3, decided: false, aName: "C", bName: "D", aWeek: 120, bWeek: 120, aTotal: 120, bTotal: 120 }), "C and D are level at 120.0 after week 1 of 3. 2 weeks to go.");
  assert.match(legBlurb({ ...base, leg: 2, legs: 3, decided: false, aName: "C", bName: "D", aWeek: 90, bWeek: 100, aTotal: 230, bTotal: 220 }), /^C leads D 230\.0–220\.0 after week 2 of 3, though D won this week 100\.0–90\.0\. One week to go\.$/);
  const won = legBlurb({ ...base, leg: 2, legs: 2, decided: true, aName: "Alpha", bName: "Delta", aWeek: 145, bWeek: 90, aTotal: 245, bTotal: 230 });
  assert.match(won, /^Alpha (beat|got past|took down) Delta 245\.0–230\.0 over 2 weeks, with Player t's 31\.0 leading the way this week\. Alpha trailed by 40\.0 going into week 2\.$/);
  const lostWeek = legBlurb({ ...base, aTop: null, leg: 2, legs: 2, decided: true, aName: "Echo", bName: "Foxtrot", aWeek: 80, bWeek: 110, aTotal: 200, bTotal: 199, bFlip: { pointsLeft: 12 } });
  assert.match(lostWeek, /Foxtrot won week 2 110\.0–80\.0 but couldn't close the gap\. Foxtrot left 12\.0 points on the bench this week, enough to flip the game\.$/);
  assert.equal(legBlurb({ ...base, leg: 2, legs: 2, decided: true, tiebreak: true, aName: "B", bName: "A", aWeek: 120, bWeek: 100, aTotal: 230, bTotal: 230 }), "B and A finished level at 230.0 over 2 weeks; B wins on the tiebreaker.");
});

test("recapGameOf snapshots the week; game lines and next-week notes", () => {
  const ctx = (over: Partial<PlayoffGameContext>): PlayoffGameContext => ({
    leg: 1, legs: 2, weeks: [15, 16], parts: [], homeBefore: 0, awayBefore: 0, homeThrough: 100, awayThrough: 140, homeTotal: 245, awayTotal: 230, status: "FINAL", winnerTeamId: "A", ...over,
  });
  // week 1's recap, even when built after the game ended: D leads, nobody has won
  assert.deepEqual(recapGameOf(ctx({})), { leg: 1, legs: 2, weeks: [15, 16], homeTotal: 100, awayTotal: 140, decided: false, winnerTeamId: null });
  const last = recapGameOf(ctx({ leg: 2, homeBefore: 100, awayBefore: 140, homeThrough: 245, awayThrough: 230 }))!;
  assert.deepEqual([last.decided, last.winnerTeamId, last.homeTotal], [true, "A", 245]);
  assert.equal(recapGameOf(ctx({ leg: 2, status: "LIVE" }))!.decided, false);
  assert.equal(recapGameOf(undefined), null);
  const A = { id: "A", name: "Alpha" };
  const D = { id: "D", name: "Delta" };
  assert.equal(recapGameLine(recapGameOf(ctx({}))!, A, D, 2), "Delta leads Alpha 140.00–100.00 after week 1 of 2");
  assert.equal(recapGameLine(last, A, D, 1), "Alpha beat Delta 245.0–230.0 over 2 weeks");
  assert.equal(recapGameLine({ leg: 2, legs: 2, homeTotal: 230, awayTotal: 230, decided: true, winnerTeamId: "D" }, A, D, 0), "Delta and Alpha finished level at 230 over 2 weeks; Delta won on the tiebreaker");
  assert.equal(recapGameLine({ leg: 1, legs: 2, homeTotal: 99, awayTotal: 99, decided: false, winnerTeamId: null }, A, D, 0), "Level at 99 after week 1 of 2");
  const teams = { A: { id: "A", name: "Alpha" }, D: { id: "D", name: "Delta" } } as unknown as RecapContent["teams"];
  const pm = { id: "n", label: null, home: { teamId: "A", projected: 120, winProb: 0.3 }, away: { teamId: "D", projected: 118, winProb: 0.7 } };
  assert.equal(previewGameNote({ decimals: 1, teams }, { ...pm, game: { leg: 2, legs: 2, homeBefore: 100, awayBefore: 140 } }), "Week 2 of 2 · Delta leads 140.0–100.0 · odds for the whole game");
  assert.equal(previewGameNote({ decimals: 1, teams }, { ...pm, game: { leg: 1, legs: 2, homeBefore: 0, awayBefore: 0 } }), "Week 1 of 2 · odds for the whole 2-week game");
  assert.equal(previewGameNote({ decimals: 1, teams }, pm), "");
});

test("narrative: multi-week playoff weeks — titles over two weeks, leads into next week, no 'bracket got smaller'", () => {
  const champ = buildHeadline(nf({ championship: { teamId: "E", opponentId: "F", score: 245, opponentScore: 230, result: "W", weeks: 2 } }));
  assert.match(champ, /Echo/);
  assert.match(champ, /2(-week| weeks)/);
  const leads = [
    { teamId: "D", opponentId: "A", score: 140, opponentScore: 100, result: "P" as const, weeks: 1 },
    { teamId: "C", opponentId: "B", score: 120, opponentScore: 118, result: "P" as const, weeks: 1 },
  ];
  const halfway = nf({ isPlayoffs: true, playoffLeg: { leg: 1, legs: 2 }, leads, closest: null, blowout: null, leader: null, weekLabel: "Week 15" });
  const intro = buildIntro(halfway);
  assert.ok(!/bracket just got smaller|Win or go home/.test(intro), intro);
  assert.match(intro, /nobody is out yet: the playoff games run 2 weeks, and one week remains|Week 1 of 2 in the playoffs/);
  assert.match(intro, /Delta leads Alpha by 40\.00 going into week 2, and Charlie leads Bravo by 2\.00 in the tightest game\./);
  assert.match(buildHeadline({ ...halfway, high: null }), /Delta/);
  assert.ok(!/\{|\}|undefined|NaN/.test(intro + buildHeadline(halfway)));
  // a closest game decided on the combined score says so
  const agg = buildIntro(nf({ closest: { teamId: "C", opponentId: "D", score: 200, opponentScore: 199, result: "W", weeks: 2 } }));
  assert.match(agg, /by just 1\.00 over 2 weeks|by 1\.00 over 2 weeks/);
  const low = buildIntro(nf({ low: { teamId: "B", opponentId: "A", score: 80, opponentScore: 110, result: "W", legs: 2 } }));
  assert.match(low, /It still won the 2-week game\./);
});

test("recap content: playoff weeks without multi-week game context are rebuilt; email shows the game line", () => {
  const c = sampleContent();
  const playoff = { ...c, matchups: c.matchups.map((m) => ({ ...m, kind: "PLAYOFF" as const })) };
  assert.equal(isRecapContent(playoff), false, "older playoff recap → rebuilt");
  assert.equal(isRecapShape(playoff), true, "…but still a usable prior (its pre-kickoff preview of next week is kept)");
  assert.equal(isRecapShape({ ...playoff, version: RECAP_VERSION - 1 }), false);
  assert.equal(isRecapContent({ ...playoff, matchups: playoff.matchups.map((m) => ({ ...m, game: null })) }), true);
  assert.equal(isRecapContent(c), true, "regular weeks don't need it");
  const leg = {
    ...playoff,
    weekLabel: "Week 15 · Playoffs (week 1 of 2)",
    matchups: playoff.matchups.map((m) => ({ ...m, winnerTeamId: null, home: { ...m.home, won: false }, game: { leg: 1, legs: 2, weeks: [15, 16], homeTotal: 140, awayTotal: 100, decided: false, winnerTeamId: null } })),
  };
  const email = renderRecapEmail(leg, "CTE Dynasty", { appUrl: "https://cte.example", teamId: "B" });
  assert.ok(email.html.includes(">Alpha &lt;script&gt; leads Bravo 140.00–100.00 after week 1 of 2<"));
  assert.ok(!email.html.includes("Week 1 of 2 · Alpha"), "the week of the game is said once");
  assert.match(email.text, /YOUR WEEK: Trailing Alpha <script> 100\.00-140\.00 after week 1 of 2 \(this week 100\.00-140\.00\)/);
  assert.match(email.text, /\(Alpha <script> leads Bravo 140\.00–100\.00 after week 1 of 2\)/);
  const done = { ...leg, matchups: leg.matchups.map((m) => ({ ...m, winnerTeamId: "B", game: { ...m.game, leg: 2, homeTotal: 230, awayTotal: 245, decided: true, winnerTeamId: "B" } })) };
  const won = renderRecapEmail(done, "CTE Dynasty", { appUrl: "https://cte.example", teamId: "B" });
  assert.ok(won.html.includes("Bravo beat Alpha &lt;script&gt; 245.00–230.00 over 2 weeks"));
  assert.match(won.text, /YOUR WEEK: Beat Alpha <script> 245\.00-230\.00 over 2 weeks/);
});
