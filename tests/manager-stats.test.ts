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
