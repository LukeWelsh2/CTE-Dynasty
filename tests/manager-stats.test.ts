import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allPlay,
  bestAndWorst,
  currentStreak,
  efficiency,
  gamesFromMatchups,
  headToHead,
  inactiveAtWeekEnd,
  luckIndex,
  rankOf,
  recordsBook,
  resultFor,
  rosterAtWeekEnd,
  rosterEventsFor,
  salaryByPosition,
  seasonPointRecords,
  streakRecords,
  streaks,
  summarizeGames,
  weekEfficiency,
  weeklyScores,
  weeklyVsLeague,
  type MatchupLike,
  type TxLike,
} from "@/lib/stats/manager-stats";
import { optimalLineup } from "@/lib/lineup";
import { DEFAULT_SETTINGS } from "@/lib/settings/schema";

let n = 0;
function m(season: number, week: number, home: string, away: string, hs: number, as: number, extra: Partial<MatchupLike> = {}): MatchupLike {
  return { id: `m${++n}`, season, week, homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, status: "FINAL", winnerTeamId: null, isPlayoff: false, isConsolation: false, isChampionship: false, ...extra };
}
const owners: Record<string, string> = { A: "ua", B: "ub", C: "uc", D: "ud" };
const ownerOf = (t: string) => owners[t] ?? null;

test("resultFor honours recorded winners and scores", () => {
  assert.equal(resultFor({ homeTeamId: "A", awayTeamId: "B", homeScore: 100, awayScore: 90, winnerTeamId: null }, "home"), "W");
  assert.equal(resultFor({ homeTeamId: "A", awayTeamId: "B", homeScore: 100, awayScore: 90, winnerTeamId: null }, "away"), "L");
  assert.equal(resultFor({ homeTeamId: "A", awayTeamId: "B", homeScore: 90, awayScore: 90, winnerTeamId: null }, "home"), "T");
  // bench-points tiebreak recorded as the winner
  assert.equal(resultFor({ homeTeamId: "A", awayTeamId: "B", homeScore: 90, awayScore: 90, winnerTeamId: "B" }, "away"), "W");
});

test("gamesFromMatchups skips byes and unfinished games, maps owners", () => {
  const games = gamesFromMatchups(
    [m(2026, 1, "A", "B", 110, 100), { ...m(2026, 2, "A", "C", 0, 0), status: "UPCOMING" }, { ...m(2026, 1, "C", "D", 1, 1), awayTeamId: null }, m(2026, 1, "Z", "A", 80, 120)],
    ownerOf,
  );
  assert.equal(games.length, 4);
  const a = games.filter((g) => g.ownerKey === "ua");
  assert.equal(a.length, 2);
  assert.ok(games.some((g) => g.ownerKey === "team:Z"));
});

test("summarizeGames: record, averages, high/low", () => {
  const games = gamesFromMatchups([m(2026, 1, "A", "B", 110, 100), m(2026, 2, "A", "C", 90, 95), m(2026, 3, "D", "A", 80, 80)], ownerOf).filter((g) => g.teamId === "A");
  const s = summarizeGames(games);
  assert.deepEqual([s.wins, s.losses, s.ties, s.games], [1, 1, 1, 3]);
  assert.equal(s.pct, 0.5);
  assert.equal(s.pf, 280);
  assert.equal(s.avgPf, 93.33);
  assert.equal(s.high?.pf, 110);
  assert.equal(s.low?.pf, 80);
});

test("headToHead groups by opponent owner with streak and margin", () => {
  const games = gamesFromMatchups(
    [m(2025, 1, "A", "B", 100, 90), m(2025, 8, "B", "A", 120, 100), m(2026, 2, "A", "B", 130, 100), m(2026, 3, "A", "C", 100, 101), m(2026, 15, "A", "B", 99, 98, { isPlayoff: true })],
    ownerOf,
  ).filter((g) => g.ownerKey === "ua");
  const rows = headToHead(games);
  const vsB = rows.find((r) => r.oppKey === "ub")!;
  assert.deepEqual([vsB.wins, vsB.losses, vsB.games], [3, 1, 4]);
  assert.equal(vsB.playoffWins, 1);
  assert.equal(vsB.streak, "W2");
  assert.equal(vsB.avgMargin, (100 - 90 + 100 - 120 + 130 - 100 + 99 - 98) / 4);
  assert.equal(rows[0].oppKey, "ub"); // most games first
});

test("allPlay + luck: expected wins sum to N/2 per week and luck sums to zero", () => {
  const ms = [m(2026, 1, "A", "B", 150, 140), m(2026, 1, "C", "D", 100, 90), m(2026, 2, "A", "C", 80, 120), m(2026, 2, "B", "D", 130, 70)];
  const games = gamesFromMatchups(ms, ownerOf);
  const ap = allPlay(weeklyScores(games));
  // week1: A beats 3, B beats 2, C beats 1, D 0 → xW A=1, B=.667, C=.333, D=0
  assert.equal(ap.get("A")!.wins, 3 + 1);
  assert.equal(ap.get("A")!.expectedWins, 1.33);
  const totalX = [...ap.values()].reduce((a, r) => a + r.expectedWins, 0);
  assert.ok(Math.abs(totalX - 4) < 0.02); // 2 weeks × 4 teams / 2
  const luck = ["A", "B", "C", "D"].map((t) => {
    const g = games.filter((x) => x.teamId === t);
    return luckIndex(g.filter((x) => x.result === "W").length, g.filter((x) => x.result === "T").length, ap.get(t)!.expectedWins);
  });
  assert.ok(Math.abs(luck.reduce((a, b) => a + b, 0)) < 0.05);
  // B lost to the week-1 high score with the 2nd best score → unlucky
  assert.ok(luck[1] < 0);
});

test("allPlay counts ties as half wins and ignores playoff games in weeklyScores", () => {
  const games = gamesFromMatchups([m(2026, 1, "A", "B", 100, 100), m(2026, 15, "A", "B", 100, 50, { isPlayoff: true })], ownerOf);
  const ap = allPlay(weeklyScores(games));
  assert.equal(ap.get("A")!.ties, 1);
  assert.equal(ap.get("A")!.expectedWins, 0.5);
  assert.equal(ap.get("A")!.weeks, 1);
});

test("rankOf: higher is better, ties share rank", () => {
  assert.equal(rankOf([3, 2, 2, 1], 2), 2);
  assert.equal(rankOf([3, 2, 2, 1], 3), 1);
  assert.equal(rankOf([3, 2, 2, 1], 1, true), 1);
});

test("efficiency handles zero and caps at 100%", () => {
  assert.deepEqual(efficiency(0, 0), { efficiency: 1, benchLeft: 0 });
  assert.deepEqual(efficiency(90, 100), { efficiency: 0.9, benchLeft: 10 });
  assert.equal(efficiency(110, 100).efficiency, 1);
});

test("weekEfficiency vs optimalLineup from league settings", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.roster.slots = [
    { key: "QB", label: "QB", count: 1, eligible: ["QB"] },
    { key: "RB", label: "RB", count: 1, eligible: ["RB"] },
    { key: "FLEX", label: "FLEX", count: 1, eligible: ["RB", "WR", "TE"] },
  ];
  const players = [
    { id: "q1", position: "QB" },
    { id: "q2", position: "QB" },
    { id: "r1", position: "RB" },
    { id: "r2", position: "RB" },
    { id: "w1", position: "WR" },
  ];
  const pts = new Map([
    ["q1", 20],
    ["q2", 25],
    ["r1", 10],
    ["r2", 15],
    ["w1", 12],
  ]);
  const opt = (ps: { id: string; position: string }[], v: Map<string, number>) => optimalLineup(ps, v, settings);
  const w = weekEfficiency(2026, 3, ["q1", "r1", "w1"], players, pts, opt);
  assert.equal(w.actual, 42);
  assert.equal(w.optimal, 25 + 15 + 12);
  assert.equal(w.benchLeft, 10);
  assert.ok(Math.abs(w.efficiency - 42 / 52) < 1e-9);
  assert.deepEqual(w.missed.map((x) => x.playerId), ["q2", "r2"]);
});

test("historical rosters: undo later adds, drops and trades (incl. reversals)", () => {
  const tx = (id: string, type: string, week: number, at: number, playerId: string | null, extra: Partial<TxLike> = {}): TxLike => ({
    id, type, week, season: 2026, createdAt: new Date(at), teamId: "A", playerId, tradeId: null, description: "", details: {}, ...extra,
  });
  const assets = new Map([["t1", [{ type: "PLAYER", playerId: "p9", fromTeamId: "B", toTeamId: "A" }, { type: "PLAYER", playerId: "p3", fromTeamId: "A", toTeamId: "B" }]]]);
  const txs: TxLike[] = [
    tx("1", "WAIVER", 2, 10, "p5"),
    tx("2", "DROP", 2, 11, "p4"),
    tx("3", "TRADE", 5, 20, "p9", { tradeId: "t1" }),
    tx("4", "TRADE", 7, 30, "p3", { tradeId: "t1", details: { reversal: true } }),
    tx("5", "ADD", 6, 25, "p6", { teamId: "B" }), // other team
    tx("6", "COMMISSIONER", 8, 40, "p7", { description: "Added Someone — $1, 1 yr" }),
  ];
  const events = rosterEventsFor("A", 2026, txs, assets);
  assert.equal(events.length, 2 + 2 + 2 + 1);
  const current = ["p1", "p2", "p3", "p5", "p7"]; // after reversal: p3 back, p9 gone
  assert.deepEqual([...rosterAtWeekEnd(current, events, 9)].sort(), ["p1", "p2", "p3", "p5", "p7"]);
  assert.deepEqual([...rosterAtWeekEnd(current, events, 6)].sort(), ["p1", "p2", "p5", "p9"]); // mid-trade, before commish add
  assert.deepEqual([...rosterAtWeekEnd(current, events, 3)].sort(), ["p1", "p2", "p3", "p5"]);
  assert.deepEqual([...rosterAtWeekEnd(current, events, 1)].sort(), ["p1", "p2", "p3", "p4"]);
});

test("inactiveAtWeekEnd undoes later IR / activation moves", () => {
  const ev = [
    { at: 1, week: 4, playerId: "p1", type: "IR" },
    { at: 2, week: 6, playerId: "p2", type: "ACTIVATE" },
  ];
  assert.deepEqual([...inactiveAtWeekEnd(["p1"], ev, 3)], ["p2"]);
  assert.deepEqual([...inactiveAtWeekEnd(["p1"], ev, 5)].sort(), ["p1", "p2"]);
  assert.deepEqual([...inactiveAtWeekEnd(["p1"], ev, 6)], ["p1"]);
});

test("streaks and current streak", () => {
  assert.deepEqual(streaks(["W", "W", "L", "W", "W", "W", "T", "L", "L"]), { longestWin: 3, longestLoss: 2 });
  assert.deepEqual(currentStreak(["W", "L", "L"]), { kind: "L", length: 2 });
  assert.equal(currentStreak([]), null);
});

test("bestAndWorst + weeklyVsLeague", () => {
  const games = gamesFromMatchups([m(2026, 1, "A", "B", 150, 100), m(2026, 1, "C", "D", 110, 60), m(2026, 2, "A", "C", 70, 90), m(2026, 2, "B", "D", 100, 80)], ownerOf);
  const a = games.filter((g) => g.teamId === "A");
  const bw = bestAndWorst(a, 1);
  assert.equal(bw.best[0].pf, 150);
  assert.equal(bw.worst[0].pf, 70);
  const wv = weeklyVsLeague(a, games);
  assert.deepEqual(wv.map((w) => [w.week, w.pts, w.leagueAvg]), [
    [1, 150, 105],
    [2, 70, 85],
  ]);
});

test("salaryByPosition groups and orders by position", () => {
  const s = salaryByPosition([
    { position: "WR", salary: 30, capHit: 30 },
    { position: "QB", salary: 50, capHit: 50 },
    { position: "WR", salary: 20, capHit: 0 },
  ]);
  assert.deepEqual(s.map((x) => [x.position, x.salary, x.capHit, x.count]), [
    ["QB", 50, 50, 1],
    ["WR", 50, 30, 2],
  ]);
  assert.equal(s[0].share, 0.5);
});

test("recordsBook: one row per matchup for blowouts / closest games", () => {
  const games = gamesFromMatchups([m(2025, 1, "A", "B", 180, 60), m(2025, 2, "C", "D", 100.5, 100), m(2026, 1, "A", "C", 90, 90), m(2026, 2, "B", "D", 40, 130)], ownerOf);
  const r = recordsBook(games, 2);
  assert.equal(r.highest[0].value, 180);
  assert.equal(r.lowest[0].value, 40);
  assert.equal(r.blowouts[0].value, 120);
  assert.equal(r.blowouts[0].game.teamId, "A");
  assert.equal(r.closest[0].value, 0); // the tie
  assert.equal(r.closest[1].value, 0.5);
  assert.equal(new Set(r.blowouts.map((x) => x.game.matchupId)).size, r.blowouts.length);
});

test("streakRecords spans seasons per owner and skips consolation games", () => {
  const games = gamesFromMatchups(
    [m(2025, 13, "A", "B", 100, 90), m(2025, 14, "A", "C", 100, 90), m(2025, 16, "A", "D", 50, 90, { isPlayoff: true, isConsolation: true }), m(2026, 1, "A", "B", 100, 90), m(2026, 2, "A", "B", 80, 90)],
    ownerOf,
  );
  const s = streakRecords(games, 3);
  const aWin = s.find((x) => x.owner === "ua" && x.kind === "W")!;
  assert.equal(aWin.length, 3);
  assert.equal(aWin.from.season, 2025);
  assert.equal(aWin.to.season, 2026);
});

test("seasonPointRecords ignores seasons without games", () => {
  const rows = [
    { ownerKey: "ua", teamId: "A", teamName: "A", season: 2025, wins: 10, losses: 4, ties: 0, pointsFor: 1800, pointsAgainst: 1500 },
    { ownerKey: "ub", teamId: "B", teamName: "B", season: 2025, wins: 4, losses: 10, ties: 0, pointsFor: 1400, pointsAgainst: 1700 },
    { ownerKey: "uc", teamId: "C", teamName: "C", season: 2026, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
  ];
  const r = seasonPointRecords(rows, 5);
  assert.deepEqual(r.most.map((x) => x.teamId), ["A", "B"]);
  assert.equal(r.fewest[0].teamId, "B");
  assert.equal(r.bestRecord[0].teamId, "A");
});

// ───────────────────────────── History helpers ─────────────────────────────
import { allTimeStandings, seasonSummaries, seasonTotals, weeklyTopScores, type FinishLike } from "@/lib/stats/history";

function fin(season: number, teamId: string, w: number, l: number, pf: number, extra: Partial<FinishLike> = {}): FinishLike {
  return { season, teamId, teamName: `Team ${teamId}`, wins: w, losses: l, ties: 0, pointsFor: pf, pointsAgainst: pf - 10, regularSeasonRank: null, finalRank: null, madePlayoffs: false, champion: false, runnerUp: false, inProgress: false, ...extra };
}

test("allTimeStandings: titles first, playoff record from championship-bracket games only", () => {
  const games = gamesFromMatchups(
    [
      m(2025, 15, "A", "B", 120, 100, { isPlayoff: true }),
      m(2025, 16, "A", "C", 130, 90, { isPlayoff: true, isChampionship: true }),
      m(2025, 16, "B", "D", 80, 95, { isPlayoff: true, isConsolation: true }),
    ],
    ownerOf,
  );
  const finishes = new Map<string, FinishLike[]>([
    ["ua", [fin(2025, "A", 9, 5, 1500, { champion: true, finalRank: 1, regularSeasonRank: 2, madePlayoffs: true }), fin(2026, "A", 5, 6, 1200, { inProgress: true, regularSeasonRank: 1 })]],
    ["ub", [fin(2025, "B", 11, 3, 1600, { finalRank: 3, regularSeasonRank: 1, madePlayoffs: true })]],
    ["uc", [fin(2025, "C", 8, 6, 1400, { runnerUp: true, finalRank: 2, madePlayoffs: true })]],
  ]);
  const rows = allTimeStandings(finishes, games);
  assert.deepEqual(rows.map((r) => r.key), ["ua", "ub", "uc"]);
  const a = rows[0];
  assert.equal(a.seasons, 2);
  assert.equal(a.wins, 14);
  assert.equal(a.losses, 11);
  assert.equal(a.titles, 1);
  assert.equal(a.playoffWins, 2);
  assert.equal(a.playoffLosses, 0);
  assert.equal(a.regularSeasonTitles, 0); // in-progress #1 doesn't count
  assert.equal(a.bestFinish, 1);
  assert.equal(rows[1].regularSeasonTitles, 1);
  assert.equal(rows[1].playoffLosses, 1); // consolation game excluded
  assert.equal(rows[2].runnerUps, 1);
});

test("weeklyTopScores counts regular-season weekly highs (ties share)", () => {
  const games = gamesFromMatchups(
    [m(2026, 1, "A", "B", 150, 120), m(2026, 1, "C", "D", 150, 100), m(2026, 2, "A", "B", 90, 140), m(2026, 2, "C", "D", 100, 110), m(2026, 15, "A", "B", 200, 100, { isPlayoff: true })],
    ownerOf,
  );
  const tops = weeklyTopScores(games);
  assert.equal(tops.get("ua"), 1);
  assert.equal(tops.get("uc"), 1);
  assert.equal(tops.get("ub"), 1);
  assert.equal(tops.get("ud"), undefined);
});

test("seasonSummaries: archived champions and a live championship result", () => {
  const games = gamesFromMatchups([m(2026, 17, "C", "D", 140, 120, { isPlayoff: true, isChampionship: true })], ownerOf);
  const finishes = new Map<string, FinishLike[]>([
    ["ua", [fin(2025, "A", 10, 4, 1500, { champion: true, regularSeasonRank: 1 })]],
    ["ub", [fin(2025, "B", 9, 5, 1450, { runnerUp: true })]],
    ["uc", [fin(2026, "C", 9, 5, 1400, { inProgress: true, regularSeasonRank: 1 })]],
    ["ud", [fin(2026, "D", 8, 6, 1380, { inProgress: true })]],
  ]);
  const s = seasonSummaries(finishes, games, [2025, 2026]);
  assert.deepEqual(s.map((x) => x.season), [2026, 2025]);
  assert.equal(s[0].champion?.key, "uc");
  assert.equal(s[0].runnerUp?.key, "ud");
  assert.equal(s[0].inProgress, false);
  assert.equal(s[1].champion?.key, "ua");
  assert.equal(s[1].runnerUp?.key, "ub");
  assert.equal(s[1].topSeed?.teamId, "A");
  const noFinal = seasonSummaries(new Map([["uc", [fin(2026, "C", 5, 5, 1000, { inProgress: true })]]]), [], [2026]);
  assert.equal(noFinal[0].inProgress, true);
  assert.equal(noFinal[0].champion, null);
  assert.equal(seasonTotals(finishes).length, 4);
});

test("championshipOutcome: a two-week final is decided on total points once both weeks are final", async () => {
  const { championshipOutcome } = await import("@/lib/stats/history");
  const week1 = gamesFromMatchups([m(2026, 16, "C", "D", 140, 100, { isPlayoff: true, isChampionship: true })], ownerOf);
  assert.equal(championshipOutcome(week1, 2), null); // only one of two weeks played
  assert.equal(championshipOutcome(week1, 1)?.winner.teamId, "C");
  const both = gamesFromMatchups(
    [m(2026, 16, "C", "D", 140, 100, { isPlayoff: true, isChampionship: true }), m(2026, 17, "C", "D", 90, 145, { isPlayoff: true, isChampionship: true })],
    ownerOf,
  );
  const o = championshipOutcome(both, 2);
  assert.equal(o?.winner.teamId, "D"); // 245 to 230 over the two weeks
  assert.equal(o?.loser.teamId, "C");
});

// ───────────────────────────── Multi-week playoff games ─────────────────────────────
import { gameWeekLabel, playoffGameKey, weekRows } from "@/lib/stats/manager-stats";
import { championshipOutcome } from "@/lib/stats/history";

/** A two-week playoff game: both weeks' rows share the bracket position and carry the round winner once final. */
function twoWeek(season: number, weeks: [number, number], home: string, away: string, s1: [number, number], s2: [number, number], extra: Partial<MatchupLike> & { winner?: string | null; status2?: string } = {}): MatchupLike[] {
  const { winner = null, status2 = "FINAL", ...rest } = extra;
  const base = { isPlayoff: true, bracketRound: 1, bracketSlot: 1, ...rest };
  return [
    m(season, weeks[0], home, away, s1[0], s1[1], { ...base, winnerTeamId: status2 === "FINAL" ? winner : null, label: "Semifinals (Wk 1 of 2)" }),
    { ...m(season, weeks[1], home, away, s2[0], s2[1], { ...base, winnerTeamId: status2 === "FINAL" ? winner : null, label: "Semifinals (Wk 2 of 2)" }), status: status2 },
  ];
}

const season2026 = (): MatchupLike[] => [
  m(2026, 1, "A", "B", 110, 100),
  m(2026, 2, "C", "D", 90, 120),
  // semifinal 1: A loses week 1 by 40, wins week 2 by 55 → A advances 245–230
  ...twoWeek(2026, [15, 16], "A", "D", [100, 140], [145, 90], { bracketSlot: 1, winner: "A" }),
  // semifinal 2: level after week 1, B wins on aggregate
  ...twoWeek(2026, [15, 16], "B", "C", [120, 120], [110, 100], { bracketSlot: 2, winner: "B" }),
  // a single-week placement game (5th place) the same weeks
  m(2026, 15, "E", "F", 99, 101, { isPlayoff: true, isConsolation: true, bracketRound: 1, bracketSlot: 401, winnerTeamId: "F" }),
  // two-week final: 230–230 (A wins week 1, B week 2), settled by the playoff tiebreakers for B
  ...twoWeek(2026, [17, 18], "A", "B", [130, 110], [100, 120], { bracketRound: 2, bracketSlot: 1, isChampionship: true, winner: "B" }),
  // two-week 3rd place game: D wins on aggregate after losing week 1
  ...twoWeek(2026, [17, 18], "C", "D", [100, 90], [80, 105], { bracketRound: 2, bracketSlot: 101, isConsolation: true, winner: "D" }),
];

test("gamesFromMatchups: every week of a multi-week playoff game is one game with combined points and the round result", () => {
  const games = gamesFromMatchups(season2026(), ownerOf);
  assert.equal(games.length, 2 * 7, "2 regular + 2 semis + placement + final + 3rd place");
  const semiA = games.find((g) => g.teamId === "A" && g.isPlayoff && !g.isChampionship)!;
  assert.deepEqual([semiA.pf, semiA.pa, semiA.result, semiA.weeks, semiA.week, semiA.leg], [245, 230, "W", [15, 16], 15, null]);
  assert.deepEqual(semiA.legs.map((l) => [l.week, l.pf, l.pa]), [[15, 100, 140], [16, 145, 90]]);
  assert.equal(semiA.label, "Semifinals");
  assert.equal(games.find((g) => g.teamId === "D" && g.weeks[0] === 15)!.result, "L", "D won week 1 but lost the game");
  // tied week 1, decided on aggregate
  assert.equal(games.find((g) => g.teamId === "C" && g.weeks[0] === 15)!.result, "L");
  // the tied final goes to the team the bracket advanced
  const finalB = games.find((g) => g.teamId === "B" && g.isChampionship)!;
  assert.deepEqual([finalB.pf, finalB.pa, finalB.result], [230, 230, "W"]);
  // 3rd place and placement games are keyed apart from the semifinals of the same round
  assert.equal(games.find((g) => g.teamId === "D" && g.weeks[0] === 17)!.result, "W");
  assert.equal(games.find((g) => g.teamId === "F")!.result, "W");
  assert.notEqual(playoffGameKey({ season: 2026, isPlayoff: true, isConsolation: true, bracketRound: 2, bracketSlot: 101 }), playoffGameKey({ season: 2026, isPlayoff: true, isConsolation: false, bracketRound: 2, bracketSlot: 1 }));
  assert.equal(playoffGameKey({ season: 2026, isPlayoff: false, isConsolation: false, bracketRound: null, bracketSlot: null }), null);
});

test("gamesFromMatchups: a multi-week game still being played isn't counted; older rows with per-week winners use the combined score", () => {
  const rows = [...twoWeek(2026, [15, 16], "A", "D", [140, 100], [0, 0], { winner: null, status2: "UPCOMING" })];
  assert.equal(gamesFromMatchups(rows, ownerOf).length, 0, "week 1 final, week 2 to come: no game yet");
  // pre-change rows where each week stored its own winner: the combined score decides
  const legacy = twoWeek(2026, [15, 16], "A", "D", [100, 140], [145, 90]).map((r, i) => ({ ...r, winnerTeamId: i === 0 ? "D" : "A" }));
  assert.equal(gamesFromMatchups(legacy, ownerOf).find((g) => g.teamId === "A")!.result, "W");
  // a week stored with home / away swapped is turned around
  const swapped = twoWeek(2026, [15, 16], "A", "D", [100, 140], [145, 90], { winner: "A" });
  swapped[1] = { ...swapped[1]!, homeTeamId: "D", awayTeamId: "A", homeScore: 90, awayScore: 145 };
  const a = gamesFromMatchups(swapped, ownerOf).find((g) => g.teamId === "A")!;
  assert.deepEqual([a.pf, a.pa, a.legs.map((l) => l.pf)], [245, 230, [100, 145]]);
});

test("one playoff win per round: records, head-to-head, all-time standings and streaks count games, not weeks", () => {
  const games = gamesFromMatchups(season2026(), ownerOf);
  const a = games.filter((g) => g.ownerKey === "ua");
  const sum = summarizeGames(a);
  assert.deepEqual([sum.games, sum.wins, sum.losses, sum.weeks], [3, 2, 1, 5], "regular W, semifinal W, final L over 5 weeks");
  assert.equal(sum.pf, 110 + 245 + 230);
  assert.equal(sum.avgPf, Math.round(((110 + 245 + 230) / 5) * 100) / 100, "average score per week");
  assert.equal(sum.high?.pf, 145, "highest single week, not the 245 two-week total");
  assert.equal(sum.high?.week, 16);
  assert.equal(sum.low?.pf, 100);
  const vsB = headToHead(a).find((r) => r.oppKey === "ub")!;
  assert.deepEqual([vsB.games, vsB.wins, vsB.losses, vsB.playoffWins, vsB.playoffLosses], [2, 1, 1, 0, 1]);
  assert.equal(headToHead(a).find((r) => r.oppKey === "ud")!.playoffWins, 1, "the two-week semifinal is one playoff win");
  const finishes = new Map<string, FinishLike[]>([
    ["ua", [fin(2026, "A", 1, 0, 110, { madePlayoffs: true })]],
    ["ub", [fin(2026, "B", 0, 1, 100, { madePlayoffs: true })]],
    ["uc", [fin(2026, "C", 0, 1, 90, { madePlayoffs: true })]],
    ["ud", [fin(2026, "D", 1, 0, 120, { madePlayoffs: true })]],
  ]);
  const at = allTimeStandings(finishes, games);
  const row = (k: string) => at.find((r) => r.key === k)!;
  assert.deepEqual([row("ua").playoffWins, row("ua").playoffLosses], [1, 1]);
  assert.deepEqual([row("ub").playoffWins, row("ub").playoffLosses], [2, 0]);
  assert.deepEqual([row("ud").playoffWins, row("ud").playoffLosses], [0, 1], "the 3rd place game is a consolation game");
  const st = streakRecords(games, 5);
  assert.equal(st.find((s) => s.owner === "ub" && s.kind === "W")!.length, 2, "semifinal + final, one win each");
  assert.equal(st.find((s) => s.owner === "ua" && s.kind === "W")!.length, 2);
  assert.deepEqual(streaks(a.filter((g) => !g.isConsolation).map((g) => g.result)), { longestWin: 2, longestLoss: 1 });
});

test("records book and weekly views: scoring records per week, margins per game", () => {
  const games = gamesFromMatchups(season2026(), ownerOf);
  const book = recordsBook(games, 3);
  assert.equal(book.highest[0].value, 145, "a single week");
  assert.equal(book.highest[0].game.leg, 2);
  assert.equal(gameWeekLabel(book.highest[0].game), "Wk 16 (2 of 2)");
  assert.ok(book.highestCombined.every((r) => r.value <= 250), "combined score in one week");
  assert.equal(book.highestCombined[0].value, 240, "week 15 of the A–D semifinal (week 17's A–B also totals 240)");
  assert.deepEqual([book.highestCombined[0].game.teamId, book.highestCombined[0].game.week, book.highestCombined[0].game.leg], ["A", 15, 1], "the game winner's side, even in the week it lost");
  // margins of whole games: A's semifinal counts once at +15, the tied final at 0
  assert.equal(book.blowouts[0].value, 30, "the regular season D–C game");
  assert.deepEqual(book.closest.slice(0, 2).map((r) => r.value), [0, 2]);
  assert.equal(book.closest[0].game.teamId, "B");
  assert.equal(gameWeekLabel(book.closest[0].game), "Wks 17–18");
  assert.equal(new Set(book.blowouts.map((r) => r.game.matchupId)).size, book.blowouts.length);

  const a = games.filter((g) => g.teamId === "A");
  const bw = bestAndWorst(a, 2);
  assert.deepEqual(bw.best.map((g) => g.pf), [145, 130]);
  const wv = weeklyVsLeague(a, games);
  assert.deepEqual(wv.map((w) => [w.week, w.pts, w.result, w.leg, w.legs]), [
    [1, 110, "W", null, 1],
    [15, 100, "W", 1, 2],
    [16, 145, "W", 2, 2],
    [17, 130, "L", 1, 2],
    [18, 100, "L", 2, 2],
  ]);
  assert.equal(wv[1].leagueAvg, Math.round(((100 + 140 + 120 + 120 + 99 + 101) / 6) * 100) / 100, "week 15 average over every team that played");
  assert.equal(weekRows(games).length, 2 * (2 + 2 * 2 + 1 + 2 * 2));
});

test("championshipOutcome and season summaries take a multi-week final from the bracket's result", () => {
  const games = gamesFromMatchups(season2026(), ownerOf);
  const o = championshipOutcome(games, 2);
  assert.equal(o?.winner.teamId, "B", "a 230–230 final settled by the tiebreakers");
  assert.equal(o?.loser.teamId, "A");
  // three-week final (weeksPerRound 2 + championshipWeeks 2): no champion until every week is final
  const three = [
    ...twoWeek(2026, [16, 17], "A", "B", [130, 110], [100, 120], { bracketRound: 2, bracketSlot: 1, isChampionship: true, winner: null }),
    { ...m(2026, 18, "A", "B", 0, 0, { isPlayoff: true, isChampionship: true, bracketRound: 2, bracketSlot: 1 }), status: "UPCOMING" },
  ];
  assert.equal(championshipOutcome(gamesFromMatchups(three, ownerOf), 2), null, "two of three weeks final");
  const done = three.map((r, i) => ({ ...r, status: "FINAL", winnerTeamId: "A", ...(i === 2 ? { homeScore: 95, awayScore: 90 } : {}) }));
  assert.equal(championshipOutcome(gamesFromMatchups(done, ownerOf), 2)?.winner.teamId, "A");
  const finishes = new Map<string, FinishLike[]>([
    ["ua", [fin(2026, "A", 1, 0, 110, { inProgress: true })]],
    ["ub", [fin(2026, "B", 0, 1, 100, { inProgress: true })]],
  ]);
  const [s] = seasonSummaries(finishes, games, [2026], 2);
  assert.equal(s!.champion?.key, "ub");
  assert.equal(s!.runnerUp?.key, "ua");
  assert.equal(s!.highScore?.pf, 145, "the season high is a single week");
  assert.equal(s!.highScore?.week, 16);
});

import { bracketGames } from "@/lib/playoffs/bracket";
import type { Matchup } from "@prisma/client";

test("playoffGameKey groups rows exactly like the bracket does (a row without a bracket slot included)", () => {
  const legs = twoWeek(2026, [15, 16], "A", "D", [100, 140], [145, 90], { winner: "A", bracketSlot: null });
  const keys = new Set(legs.map((r) => playoffGameKey(r)));
  assert.equal(keys.size, 1, "both weeks are one game");
  assert.ok([...keys][0], "keyed as a bracket game");
  const games = gamesFromMatchups(legs, ownerOf);
  assert.equal(games.length, 2, "one game, two sides");
  assert.deepEqual([games.find((g) => g.teamId === "A")!.pf, games.find((g) => g.teamId === "A")!.result], [245, "W"]);
  const asRows = legs.map((r) => ({ ...r, leagueId: "L", homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, homeSeed: 1, awaySeed: 4, label: r.label ?? null, updatedAt: new Date() }) as unknown as Matchup);
  const bracket = bracketGames(asRows, null, 0);
  assert.equal(bracket.length, 1, "the bracket sees the same single game");
  assert.equal(bracket[0]!.winnerTeamId, "A");
  assert.equal(playoffGameKey({ season: 2026, isPlayoff: true, isConsolation: false, bracketRound: null, bracketSlot: 1 }), null, "no bracket round: not a bracket game");
});

test("an older tied bracket game whose weeks disagree goes to the higher seed in the stats, as in the bracket", () => {
  // A (seed 4) wins week 1, D (seed 1) week 2, 240–240 overall; each row stored its own week's winner
  const legs = twoWeek(2026, [15, 16], "A", "D", [140, 100], [100, 140], { homeSeed: 4, awaySeed: 1 }).map((r, i) => ({ ...r, winnerTeamId: i === 0 ? "A" : "D" }));
  const games = gamesFromMatchups(legs, ownerOf);
  assert.deepEqual([games.find((g) => g.teamId === "D")!.result, games.find((g) => g.teamId === "A")!.result], ["W", "L"]);
  const asRows = legs.map((r) => ({ ...r, leagueId: "L", homeProjected: 0, awayProjected: 0, homeWinProb: 0.5, label: r.label ?? null, updatedAt: new Date() }) as unknown as Matchup);
  assert.equal(bracketGames(asRows, null, 0)[0]!.winnerTeamId, "D");
  // a regular season tie stays a tie
  assert.equal(gamesFromMatchups([m(2026, 1, "A", "B", 100, 100)], ownerOf)[0]!.result, "T");
});

test("championshipOutcome waits for every week of the final round (weeksPerRound + championshipWeeks − 1), as /history passes it", async () => {
  const { playoffSchedule } = await import("@/lib/playoffs/structure");
  const { deepMerge } = await import("@/lib/settings/schema");
  // 2-week rounds with a single championship week: the final round is still two weeks (16–17)
  const s = deepMerge(DEFAULT_SETTINGS, { playoffs: { teams: 4, byes: 0, startWeek: 14, weeksPerRound: 2, championshipWeeks: 1 } });
  const finalWeeks = playoffSchedule(s).roundWeeks.at(-1)!;
  assert.deepEqual(finalWeeks, [16, 17]);
  // championship rows outside the bracket (one game per week): week 16 played, week 17 still to come
  const week16 = gamesFromMatchups([m(2026, 16, "C", "D", 140, 100, { isPlayoff: true, isChampionship: true })], ownerOf);
  assert.equal(championshipOutcome(week16, finalWeeks.length), null, "no champion after week 1 of a 2-week final");
  assert.equal(championshipOutcome(week16, s.playoffs.championshipWeeks)?.winner.teamId, "C", "championshipWeeks alone would crown C a week early");
  const both = gamesFromMatchups(
    [m(2026, 16, "C", "D", 140, 100, { isPlayoff: true, isChampionship: true }), m(2026, 17, "C", "D", 80, 130, { isPlayoff: true, isChampionship: true })],
    ownerOf,
  );
  assert.equal(championshipOutcome(both, finalWeeks.length)?.winner.teamId, "D", "D wins 230–220 over the two weeks");
});
