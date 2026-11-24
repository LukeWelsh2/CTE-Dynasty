import { test } from "node:test";
import assert from "node:assert/strict";
import type { Matchup } from "@prisma/client";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import { bracketGames, gameKey, type StoredBracket } from "@/lib/playoffs/bracket";
import { bracketPlan, SLOT_BASE } from "@/lib/playoffs/structure";
import { championshipStatusFrom, eliminationBlock, eliminationBlocks, eliminationRuleActive, type ChampionshipStatus } from "@/lib/playoffs/elimination";
import { resolveWaiverClaims, type EngineRules, type EngineTeam } from "@/lib/waivers/logic";

function settings(patch: (s: LeagueSettings) => void = () => {}): LeagueSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
}

const TEAMS = Array.from({ length: 12 }, (_, i) => `T${i + 1}`);

/** 6-team championship bracket seeded T1..T6 (seeds 1 and 2 have first-round byes). */
const stored: StoredBracket = {
  version: 1,
  season: 2026,
  createdAt: "2026-12-15T00:00:00.000Z",
  winners: TEAMS.slice(0, 6).map((teamId, i) => ({ teamId, seed: i + 1, displaySeed: i + 1 })),
  sides: [],
  thirdPlace: true,
  reseed: false,
  placementGames: [],
};
const ROUNDS = bracketPlan(stored.winners.length).rounds; // 3: quarterfinal, semifinal, championship

let n = 0;
function row(o: Partial<Matchup> & { week: number }): Matchup {
  n++;
  return {
    id: `m${n}`,
    leagueId: "L",
    season: 2026,
    homeTeamId: null,
    awayTeamId: null,
    homeScore: 0,
    awayScore: 0,
    homeProjected: 100,
    awayProjected: 100,
    homeWinProb: 0.5,
    status: "UPCOMING",
    winnerTeamId: null,
    isPlayoff: true,
    isConsolation: false,
    isChampionship: false,
    bracketRound: 1,
    bracketSlot: 1,
    homeSeed: null,
    awaySeed: null,
    label: null,
    updatedAt: new Date(0),
    ...o,
  };
}

/** Round 1 with two-week rounds (weeks 15–16): slot 2 = 4 v 5, slot 4 = 3 v 6. Scores per week. */
function roundOne(wk15: "UPCOMING" | "FINAL", wk16: "UPCOMING" | "LIVE" | "FINAL") {
  const leg = (week: number, status: string, home: string, away: string, slot: number, hs: number, as: number, seeds: [number, number]) =>
    row({ week, status, homeTeamId: home, awayTeamId: away, bracketRound: 1, bracketSlot: slot, homeSeed: seeds[0], awaySeed: seeds[1], homeScore: status === "UPCOMING" ? 0 : hs, awayScore: status === "UPCOMING" ? 0 : as });
  return [
    leg(15, wk15, "T4", "T5", 2, 120, 100, [4, 5]),
    leg(16, wk16, "T4", "T5", 2, 80, 110, [4, 5]), // T5 wins 210–200 on aggregate after losing week 1
    leg(15, wk15, "T3", "T6", 4, 90, 130, [3, 6]),
    leg(16, wk16, "T3", "T6", 4, 100, 95, [3, 6]), // T6 wins 225–190
  ];
}

const statusOf = (rows: Matchup[], ties?: Map<string, string>) => championshipStatusFrom(stored, bracketGames(rows, stored, ROUNDS, ties), TEAMS);

test("before the bracket exists nobody is eliminated", () => {
  const out = championshipStatusFrom(null, [], TEAMS);
  assert.equal(out.size, TEAMS.length);
  for (const st of out.values()) assert.deepEqual(st, { alive: true, seed: null });
});

test("once the bracket exists, teams outside it are out and seeded teams (incl. byes) are alive", () => {
  const out = statusOf(roundOne("UPCOMING", "UPCOMING"));
  for (const id of TEAMS.slice(0, 6)) assert.equal(out.get(id)?.alive, true, id);
  for (const id of TEAMS.slice(6)) assert.deepEqual(out.get(id), { alive: false, reason: "Missed the playoffs", seed: null });
  assert.equal(out.get("T1")?.seed, 1);
  assert.equal(out.get("T6")?.seed, 6);
});

test("two-week round: losing week 1 doesn't eliminate; the aggregate after both weeks does", () => {
  // week 15 final, week 16 still to play: T5 and T3 trail but are alive
  let out = statusOf(roundOne("FINAL", "UPCOMING"));
  for (const id of ["T3", "T4", "T5", "T6"]) assert.equal(out.get(id)?.alive, true, id);
  out = statusOf(roundOne("FINAL", "LIVE"));
  for (const id of ["T3", "T4", "T5", "T6"]) assert.equal(out.get(id)?.alive, true, id);
  // both weeks final: the aggregate decides (T4 won week 1 but loses 200–210)
  out = statusOf(roundOne("FINAL", "FINAL"));
  assert.deepEqual(out.get("T4"), { alive: false, reason: "Lost in the quarterfinal", seed: 4, eliminatedRound: 1 });
  assert.deepEqual(out.get("T3"), { alive: false, reason: "Lost in the quarterfinal", seed: 3, eliminatedRound: 1 });
  assert.equal(out.get("T5")?.alive, true);
  assert.equal(out.get("T6")?.alive, true);
  // the bye teams have no game yet and stay alive
  assert.equal(out.get("T1")?.alive, true);
  assert.equal(out.get("T2")?.alive, true);
});

test("later rounds, side brackets and tied games", () => {
  const r1 = roundOne("FINAL", "FINAL");
  const semis = [
    row({ week: 17, status: "FINAL", homeTeamId: "T1", awayTeamId: "T5", bracketRound: 2, bracketSlot: 1, homeSeed: 1, awaySeed: 5, homeScore: 140, awayScore: 99 }),
    row({ week: 18, status: "FINAL", homeTeamId: "T1", awayTeamId: "T5", bracketRound: 2, bracketSlot: 1, homeSeed: 1, awaySeed: 5, homeScore: 101, awayScore: 98 }),
    row({ week: 17, status: "FINAL", homeTeamId: "T2", awayTeamId: "T6", bracketRound: 2, bracketSlot: 2, homeSeed: 2, awaySeed: 6, homeScore: 100, awayScore: 110 }),
    row({ week: 18, status: "UPCOMING", homeTeamId: "T2", awayTeamId: "T6", bracketRound: 2, bracketSlot: 2, homeSeed: 2, awaySeed: 6 }),
  ];
  // consolation / placement / 3rd place rows never change the championship answer
  const sides = [
    row({ week: 15, status: "FINAL", homeTeamId: "T7", awayTeamId: "T10", isConsolation: true, bracketRound: 1, bracketSlot: SLOT_BASE.CONSOLATION + 1, homeScore: 150, awayScore: 60 }),
    row({ week: 17, status: "FINAL", homeTeamId: "T3", awayTeamId: "T4", isConsolation: true, bracketRound: 2, bracketSlot: SLOT_BASE.PLACEMENT + 1, homeScore: 90, awayScore: 91 }),
  ];
  let out = statusOf([...r1, ...semis, ...sides]);
  assert.deepEqual(out.get("T5"), { alive: false, reason: "Lost in the semifinal", seed: 5, eliminatedRound: 2 });
  assert.equal(out.get("T1")?.alive, true);
  assert.equal(out.get("T2")?.alive, true); // second leg still to play
  assert.equal(out.get("T6")?.alive, true);
  assert.equal(out.get("T7")?.reason, "Missed the playoffs");
  assert.equal(out.get("T3")?.reason, "Lost in the quarterfinal");

  // a tied completed game goes to the tiebreak winner (advancePlayoffs' resolveTies), else the higher seed
  const tiedFinal = [
    ...r1,
    ...semis.slice(0, 2),
    row({ week: 17, status: "FINAL", homeTeamId: "T2", awayTeamId: "T6", bracketRound: 2, bracketSlot: 2, homeSeed: 2, awaySeed: 6, homeScore: 100, awayScore: 110 }),
    row({ week: 18, status: "FINAL", homeTeamId: "T2", awayTeamId: "T6", bracketRound: 2, bracketSlot: 2, homeSeed: 2, awaySeed: 6, homeScore: 110, awayScore: 100 }),
  ];
  out = statusOf(tiedFinal);
  assert.equal(out.get("T6")?.alive, false); // 210–210 → higher seed T2
  assert.equal(out.get("T2")?.alive, true);
  out = statusOf(tiedFinal, new Map([[gameKey("WINNERS", 2, 2), "T6"]]));
  assert.equal(out.get("T2")?.reason, "Lost in the semifinal");
  assert.equal(out.get("T6")?.alive, true);

  // the championship loser is out; the champion stays alive
  const final = row({ week: 19, status: "FINAL", homeTeamId: "T1", awayTeamId: "T6", bracketRound: 3, bracketSlot: 1, homeSeed: 1, awaySeed: 6, homeScore: 88, awayScore: 120, isChampionship: true });
  out = statusOf([...tiedFinal, final], new Map([[gameKey("WINNERS", 2, 2), "T6"]]));
  assert.equal(out.get("T1")?.reason, "Lost in the championship");
  assert.equal(out.get("T6")?.alive, true);
});

test("which rules apply: only in the playoffs, by setting", () => {
  const base = settings();
  assert.equal(eliminationRuleActive(base, "PLAYOFFS", "ADD"), false);
  assert.equal(eliminationRuleActive(base, "PLAYOFFS", "TRADE"), false);
  const noAdds = settings((s) => (s.waivers.eliminatedTeamsCanAdd = false));
  assert.equal(eliminationRuleActive(noAdds, "PLAYOFFS", "ADD"), true);
  assert.equal(eliminationRuleActive(noAdds, "PLAYOFFS", "TRADE"), false);
  assert.equal(eliminationRuleActive(noAdds, "REGULAR", "ADD"), false);
  const noMoves = settings((s) => (s.playoffs.eliminatedTeamsCanTransact = false));
  assert.equal(eliminationRuleActive(noMoves, "PLAYOFFS", "ADD"), true);
  assert.equal(eliminationRuleActive(noMoves, "PLAYOFFS", "TRADE"), true);
  for (const phase of ["PRESEASON", "REGULAR", "OFFSEASON", "KEEPER"]) {
    assert.equal(eliminationRuleActive(noMoves, phase, "ADD"), false, phase);
    assert.equal(eliminationRuleActive(noMoves, phase, "TRADE"), false, phase);
  }
});

test("block reasons name the team and the round", () => {
  const out = statusOf(roundOne("FINAL", "FINAL"));
  const noMoves = settings((s) => (s.playoffs.eliminatedTeamsCanTransact = false));
  assert.equal(eliminationBlock(noMoves, "PLAYOFFS", out.get("T9"), "ADD"), "Your team missed the playoffs. Teams eliminated from the playoffs can't add players in this league.");
  assert.equal(
    eliminationBlock(noMoves, "PLAYOFFS", out.get("T4"), "TRADE", "Helmet to Helmet"),
    "Helmet to Helmet lost in the quarterfinal. Teams eliminated from the playoffs can't make trades in this league.",
  );
  assert.equal(eliminationBlock(noMoves, "PLAYOFFS", out.get("T1"), "ADD"), null); // bye team
  assert.equal(eliminationBlock(noMoves, "PLAYOFFS", undefined, "ADD"), null);
  assert.equal(eliminationBlock(noMoves, "REGULAR", out.get("T9"), "ADD"), null);
  // eliminatedTeamsCanAdd off alone stops adds but not trades
  const noAdds = settings((s) => (s.waivers.eliminatedTeamsCanAdd = false));
  assert.match(eliminationBlock(noAdds, "PLAYOFFS", out.get("T4"), "ADD")!, /can't add players/);
  assert.equal(eliminationBlock(noAdds, "PLAYOFFS", out.get("T4"), "TRADE"), null);

  const blocks = eliminationBlocks(noMoves, "PLAYOFFS", out, "ADD");
  assert.deepEqual([...blocks.keys()].sort(), ["T10", "T11", "T12", "T3", "T4", "T7", "T8", "T9"]);
  assert.equal(eliminationBlocks(settings(), "PLAYOFFS", out, "ADD").size, 0);
});

test("waiver run: eliminated teams' claims are invalid, bye teams' claims still win", () => {
  const statuses: Map<string, ChampionshipStatus> = statusOf(roundOne("FINAL", "FINAL"));
  const s = settings((x) => (x.waivers.eliminatedTeamsCanAdd = false));
  const blocked = eliminationBlocks(s, "PLAYOFFS", statuses, "ADD");
  const rules: EngineRules = { mode: "FAB", tiebreaker: "PRIORITY", minBid: 0, maxActiveRoster: 10, positionMax: {}, capEnforced: false, cap: 1000, maxPerWeek: null, maxPerSeason: null, salaryForBid: () => 1 };
  const team = (id: string): EngineTeam => ({ id, name: id, faab: 100, committed: 0, roster: [], acquisitionsWeek: 0, acquisitionsSeason: 0 });
  const at = new Date("2026-12-30T08:00:00Z");
  const r = resolveWaiverClaims({
    rules,
    teams: ["T1", "T4", "T9"].map(team),
    claims: [
      { id: "c4", teamId: "T4", playerId: "p1", playerName: "P1", position: "WR", dropPlayerId: null, bid: 30, priority: 1, createdAt: at },
      { id: "c9", teamId: "T9", playerId: "p1", playerName: "P1", position: "WR", dropPlayerId: null, bid: 20, priority: 1, createdAt: at },
      { id: "c1", teamId: "T1", playerId: "p1", playerName: "P1", position: "WR", dropPlayerId: null, bid: 5, priority: 1, createdAt: at },
    ],
    priorityOrder: ["T9", "T4", "T1"],
    rosteredPlayerIds: [],
    blockedTeams: blocked,
  });
  const res = new Map(r.results.map((x) => [x.claimId, x]));
  assert.equal(res.get("c1")?.status, "WON");
  assert.equal(res.get("c4")?.status, "INVALID");
  assert.match(res.get("c4")!.note, /lost in the quarterfinal/);
  assert.equal(res.get("c9")?.status, "INVALID");
  assert.match(res.get("c9")!.note, /missed the playoffs/);
});

test("trade draft holds: only picks of a season whose rookie draft is under way", async () => {
  const { draftHeldSeasons, rookieDraftsText } = await import("@/lib/trades/execute");
  const assets = [
    { type: "PLAYER", pick: null },
    { type: "PICK", pick: { season: 2028 } },
    { type: "PICK", pick: { season: 2027 } },
    { type: "PICK", pick: { season: 2027 } },
    { type: "FAAB" },
  ];
  assert.deepEqual(draftHeldSeasons(assets, []), [], "no draft running");
  assert.deepEqual(draftHeldSeasons(assets, [2029]), [], "a running draft of another season");
  assert.deepEqual(draftHeldSeasons(assets, [2027]), [2027]);
  assert.deepEqual(draftHeldSeasons(assets, new Set([2028, 2027])), [2027, 2028], "sorted, one entry per season");
  assert.equal(rookieDraftsText([2027]), "the 2027 rookie draft");
  assert.equal(rookieDraftsText([2027, 2028]), "the 2027 and 2028 rookie drafts");
});
