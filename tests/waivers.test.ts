import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import {
  awardNote,
  bidVisible,
  groupByPlayer,
  groupRuns,
  isRunDue,
  moveInOrder,
  priorityValues,
  resolveWaiverClaims,
  reverseStandingsOrder,
  rulesFromSettings,
  waiverContractYears,
  waiverMinBid,
  waiverSigningSalary,
  type EngineClaim,
  type EngineRules,
  type EngineTeam,
  type WaiverRunInput,
} from "@/lib/waivers/logic";
import { describeTransactionType, groupTransactions, toCsv, txTypesFor } from "@/lib/waivers/tx-logic";

function settings(patch: (s: LeagueSettings) => void = () => {}): LeagueSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
}

function rules(over: Partial<EngineRules> = {}): EngineRules {
  return {
    mode: "FAB",
    tiebreaker: "PRIORITY",
    minBid: 0,
    maxActiveRoster: 5,
    positionMax: { K: 1 },
    capEnforced: true,
    cap: 100,
    maxPerWeek: null,
    maxPerSeason: null,
    salaryForBid: () => 1,
    ...over,
  };
}

function team(id: string, over: Partial<EngineTeam> = {}): EngineTeam {
  return {
    id,
    name: `Team ${id}`,
    faab: 100,
    committed: 50,
    roster: [
      { playerId: `${id}-x`, name: `${id} Bench Guy`, position: "WR", status: "ACTIVE", capHit: 5, deadIfDropped: 2 },
      { playerId: `${id}-y`, name: `${id} Backup`, position: "RB", status: "ACTIVE", capHit: 1, deadIfDropped: 0 },
    ],
    acquisitionsWeek: 0,
    acquisitionsSeason: 0,
    ...over,
  };
}

let seq = 0;
function claim(teamId: string, playerId: string, bid: number, over: Partial<EngineClaim> = {}): EngineClaim {
  seq++;
  return {
    id: over.id ?? `c${seq}`,
    teamId,
    playerId,
    playerName: `Player ${playerId}`,
    position: "WR",
    dropPlayerId: null,
    bid,
    priority: 1,
    createdAt: new Date(Date.UTC(2026, 10, 20, 12, 0, seq)),
    ...over,
  };
}

function run(input: Partial<WaiverRunInput> & { claims: EngineClaim[] }) {
  const teams = input.teams ?? [team("A"), team("B"), team("C")];
  return resolveWaiverClaims({
    rules: input.rules ?? rules(),
    teams,
    claims: input.claims,
    priorityOrder: input.priorityOrder ?? teams.map((t) => t.id),
    recordOrder: input.recordOrder,
    rosteredPlayerIds: input.rosteredPlayerIds ?? teams.flatMap((t) => t.roster.map((r) => r.playerId)),
    lockedPlayerIds: input.lockedPlayerIds,
    blockedTeams: input.blockedTeams,
    blockedPlayers: input.blockedPlayers,
  });
}

const status = (r: ReturnType<typeof run>, id: string) => r.results.find((x) => x.claimId === id);

test("highest FAB bid wins; losers are outbid with the winning amount", () => {
  const r = run({ claims: [claim("A", "p1", 5, { id: "a" }), claim("B", "p1", 12, { id: "b" }), claim("C", "p1", 8, { id: "c" })] });
  assert.equal(r.awards.length, 1);
  assert.equal(r.awards[0].teamId, "B");
  assert.equal(status(r, "b")?.status, "WON");
  assert.equal(status(r, "a")?.status, "LOST");
  assert.equal(status(r, "a")?.note, "Outbid: $12 by Team B");
  assert.equal(status(r, "c")?.note, "Outbid: $12 by Team B");
});

test("tied bids go to the better waiver priority and the winner moves to the back (rolling)", () => {
  const r = run({ priorityOrder: ["C", "B", "A"], claims: [claim("A", "p1", 10, { id: "a" }), claim("B", "p1", 10, { id: "b" })] });
  assert.equal(r.awards[0].teamId, "B");
  assert.equal(r.awards[0].decidedByTiebreak, true);
  assert.match(status(r, "a")!.note, /Tied at \$10 — Team B won the tiebreaker \(waiver priority\)/);
  assert.deepEqual(r.order, ["C", "A", "B"]);
});

test("WORST_RECORD tiebreaker uses reverse standings, order is not rotated", () => {
  const r = run({
    rules: rules({ tiebreaker: "WORST_RECORD" }),
    recordOrder: ["A", "C", "B"],
    claims: [claim("B", "p1", 7, { id: "b" }), claim("A", "p1", 7, { id: "a" })],
  });
  assert.equal(r.awards[0].teamId, "A");
  assert.match(status(r, "b")!.note, /worse record/);
  assert.deepEqual(r.order, ["A", "B", "C"]);
});

test("EARLIEST_CLAIM tiebreaker favours the first claim placed", () => {
  const early = claim("C", "p1", 3, { id: "early", createdAt: new Date("2026-11-20T10:00:00Z") });
  const late = claim("A", "p1", 3, { id: "late", createdAt: new Date("2026-11-21T10:00:00Z") });
  const r = run({ rules: rules({ tiebreaker: "EARLIEST_CLAIM" }), claims: [late, early] });
  assert.equal(r.awards[0].claimId, "early");
});

test("a bid larger than the team's FAB is invalid and the next bid wins", () => {
  const r = run({ teams: [team("A", { faab: 20 }), team("B")], claims: [claim("A", "p1", 30, { id: "a" }), claim("B", "p1", 15, { id: "b" })] });
  assert.equal(status(r, "a")?.status, "INVALID");
  assert.match(status(r, "a")!.note, /Not enough FAB: \$20 left for a \$30 bid/);
  assert.equal(status(r, "b")?.status, "WON");
});

test("bids below the league minimum are invalid", () => {
  const r = run({ rules: rules({ minBid: 1 }), claims: [claim("A", "p1", 0, { id: "a" })] });
  assert.equal(status(r, "a")?.status, "INVALID");
});

test("a drop player who is no longer rostered invalidates the claim", () => {
  const r = run({ claims: [claim("A", "p1", 10, { id: "a", dropPlayerId: "someone-else" }), claim("B", "p1", 1, { id: "b" })] });
  assert.equal(status(r, "a")?.status, "INVALID");
  assert.match(status(r, "a")!.note, /no longer on your roster/);
  assert.equal(status(r, "b")?.status, "WON");
});

test("team claim order is respected when FAB runs short (chained claims)", () => {
  const A = team("A", { faab: 50 });
  const r = run({
    teams: [A, team("B")],
    claims: [claim("A", "p2", 45, { id: "second", priority: 2 }), claim("A", "p1", 40, { id: "first", priority: 1 })],
  });
  assert.equal(status(r, "first")?.status, "WON");
  assert.equal(status(r, "second")?.status, "INVALID");
  assert.match(status(r, "second")!.note, /\$10 left for a \$45 bid/);
});

test("the same drop player can only be used once", () => {
  const r = run({
    claims: [claim("A", "p1", 5, { id: "one", priority: 1, dropPlayerId: "A-x" }), claim("A", "p2", 5, { id: "two", priority: 2, dropPlayerId: "A-x" })],
  });
  assert.equal(status(r, "one")?.status, "WON");
  assert.equal(status(r, "two")?.status, "INVALID");
  assert.match(status(r, "two")!.note, /already released for your claim on Player p1/);
  assert.equal(r.awards[0].dropPlayerId, "A-x");
});

test("losing a higher-ranked claim lets a lower-ranked claim win", () => {
  const r = run({
    claims: [claim("A", "p1", 10, { id: "a1", priority: 1 }), claim("A", "p2", 5, { id: "a2", priority: 2 }), claim("B", "p1", 20, { id: "b1" })],
  });
  assert.equal(status(r, "b1")?.status, "WON");
  assert.equal(status(r, "a1")?.status, "LOST");
  assert.equal(status(r, "a2")?.status, "WON");
});

test("cross-priority deadlock resolves by bids (each team wins the player it bid most on)", () => {
  const r = run({
    claims: [
      claim("A", "p1", 10, { id: "a1", priority: 1 }),
      claim("A", "p2", 30, { id: "a2", priority: 2 }),
      claim("B", "p2", 20, { id: "b2", priority: 1 }),
      claim("B", "p1", 15, { id: "b1", priority: 2 }),
    ],
  });
  assert.equal(status(r, "a2")?.status, "WON");
  assert.equal(status(r, "b1")?.status, "WON");
  assert.equal(status(r, "a1")?.status, "LOST");
  assert.equal(status(r, "b2")?.status, "LOST");
});

test("a full roster without a drop is invalid; with a drop it is fine", () => {
  const full = team("A", {
    roster: Array.from({ length: 5 }, (_, i) => ({ playerId: `A-${i}`, name: `A ${i}`, position: "WR", status: "ACTIVE", capHit: 1, deadIfDropped: 0 })),
  });
  const r = run({ teams: [full], claims: [claim("A", "p1", 1, { id: "nodrop" }), claim("A", "p2", 1, { id: "drop", priority: 2, dropPlayerId: "A-0" })] });
  assert.equal(status(r, "nodrop")?.status, "INVALID");
  assert.match(status(r, "nodrop")!.note, /Roster full/);
  assert.equal(status(r, "drop")?.status, "WON");
});

test("IR players don't count toward active roster room", () => {
  const t = team("A", {
    roster: [
      ...Array.from({ length: 4 }, (_, i) => ({ playerId: `A-${i}`, name: `A ${i}`, position: "WR", status: "ACTIVE", capHit: 1, deadIfDropped: 0 })),
      { playerId: "A-ir", name: "Hurt", position: "RB", status: "IR", capHit: 1, deadIfDropped: 0 },
    ],
  });
  const r = run({ teams: [t], claims: [claim("A", "p1", 1, { id: "ok" })] });
  assert.equal(status(r, "ok")?.status, "WON");
});

test("signing salary must fit under the cap (drop counts net of dead money)", () => {
  const salary = (bid: number) => Math.max(1, bid);
  const t = team("A", { committed: 95 });
  const over = run({ rules: rules({ salaryForBid: salary }), teams: [t], claims: [claim("A", "p1", 10, { id: "x" })] });
  assert.equal(status(over, "x")?.status, "INVALID");
  assert.match(status(over, "x")!.note, /over the \$100 cap/);
  // dropping A-x frees 5 - 2 dead = 3 → 95 + 8 - 3 = 100 (fits)
  const fits = run({ rules: rules({ salaryForBid: salary }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 8, { id: "y", dropPlayerId: "A-x" })] });
  assert.equal(status(fits, "y")?.status, "WON");
});

test("acquisition limits stop a team after its limit", () => {
  const r = run({
    rules: rules({ maxPerWeek: 1 }),
    claims: [claim("A", "p1", 5, { id: "one", priority: 1 }), claim("A", "p2", 5, { id: "two", priority: 2 })],
  });
  assert.equal(status(r, "one")?.status, "WON");
  assert.equal(status(r, "two")?.status, "INVALID");
  assert.match(status(r, "two")!.note, /Weekly acquisition limit/);
});

test("position maximums are enforced", () => {
  const t = team("A", { roster: [{ playerId: "A-k", name: "Kicker", position: "K", status: "ACTIVE", capHit: 1, deadIfDropped: 0 }] });
  const r = run({ teams: [t], claims: [claim("A", "k2", 1, { id: "k", position: "K" }), claim("A", "k3", 1, { id: "k-swap", position: "K", priority: 2, dropPlayerId: "A-k" })] });
  assert.equal(status(r, "k")?.status, "INVALID");
  assert.equal(status(r, "k-swap")?.status, "WON");
});

test("players already rostered and locked drop players are invalid", () => {
  const r = run({
    rosteredPlayerIds: ["A-x", "A-y", "B-x", "B-y", "C-x", "C-y", "taken"],
    lockedPlayerIds: ["B-x"],
    claims: [claim("A", "taken", 4, { id: "gone" }), claim("B", "p1", 4, { id: "locked", dropPlayerId: "B-x" })],
  });
  assert.equal(status(r, "gone")?.status, "INVALID");
  assert.match(status(r, "gone")!.note, /no longer available/);
  assert.equal(status(r, "locked")?.status, "INVALID");
  assert.match(status(r, "locked")!.note, /locked lineup/);
});

test("PRIORITY waivers: best priority wins and rolls to the back each time", () => {
  const r = run({
    rules: rules({ mode: "PRIORITY" }),
    priorityOrder: ["A", "B", "C"],
    claims: [
      claim("A", "p1", 0, { id: "a1", priority: 1 }),
      claim("A", "p2", 0, { id: "a2", priority: 2 }),
      claim("B", "p1", 0, { id: "b1", priority: 1 }),
      claim("B", "p2", 0, { id: "b2", priority: 2 }),
      claim("C", "p2", 0, { id: "c2", priority: 1 }),
    ],
  });
  assert.equal(status(r, "a1")?.status, "WON");
  assert.equal(status(r, "b1")?.status, "LOST");
  assert.equal(status(r, "b1")?.note, "Claimed by Team A (higher waiver priority)");
  // after A wins it moves to the back: order B, C, A → B wins p2
  assert.equal(status(r, "b2")?.status, "WON");
  assert.equal(status(r, "c2")?.status, "LOST");
  assert.equal(status(r, "a2")?.status, "LOST");
  assert.deepEqual(r.order, ["C", "A", "B"]);
});

test("PRIORITY waivers ignore bid amounts", () => {
  const r = run({ rules: rules({ mode: "PRIORITY" }), priorityOrder: ["B", "A"], teams: [team("A"), team("B")], claims: [claim("A", "p1", 99, { id: "a" }), claim("B", "p1", 0, { id: "b" })] });
  assert.equal(status(r, "b")?.status, "WON");
});

test("max claims won per run, undroppable drops and blocked teams", () => {
  const r = run({
    rules: rules({ maxWonPerRun: 1, undroppable: ["B-x"] }),
    blockedTeams: new Map([["C", "Eliminated teams can't add players."]]),
    claims: [
      claim("A", "p1", 5, { id: "a1", priority: 1 }),
      claim("A", "p2", 5, { id: "a2", priority: 2 }),
      claim("B", "p3", 5, { id: "b", dropPlayerId: "B-x" }),
      claim("C", "p4", 5, { id: "c" }),
    ],
  });
  assert.equal(status(r, "a1")?.status, "WON");
  assert.match(status(r, "a2")!.note, /maximum of 1 claim/);
  assert.match(status(r, "b")!.note, /undroppable/);
  assert.equal(status(r, "c")?.note, "Eliminated teams can't add players.");
});

test("blocked players (auction pool) can't be claimed; the next player in a team's list still can", () => {
  const r = run({
    blockedPlayers: new Map([["p1", "Returns to the auction pool: he can only be signed in the 2027 auction."]]),
    claims: [
      claim("A", "p1", 40, { id: "a1", priority: 1 }),
      claim("B", "p1", 10, { id: "b1", priority: 1 }),
      claim("A", "p2", 3, { id: "a2", priority: 2 }),
      claim("B", "p2", 2, { id: "b2", priority: 2 }),
    ],
  });
  assert.equal(status(r, "a1")?.status, "INVALID");
  assert.match(status(r, "a1")!.note, /^Returns to the auction pool/);
  assert.equal(status(r, "b1")?.status, "INVALID");
  assert.equal(status(r, "a2")?.status, "WON");
  assert.equal(status(r, "b2")?.status, "LOST");
  assert.equal(r.awards.length, 1);
  // a team block wins over the player block (the team note is what the manager needs to see)
  const both = run({ blockedTeams: new Map([["A", "Your team missed the playoffs."]]), blockedPlayers: new Map([["p1", "Returns to the auction pool"]]), claims: [claim("A", "p1", 5, { id: "x" })] });
  assert.equal(status(both, "x")?.note, "Your team missed the playoffs.");
});

test("frozen order: tie winners don't rotate; hidden bids keep notes amount-free", () => {
  const r = run({ rules: rules({ rotate: false, revealWinningBid: false }), priorityOrder: ["A", "B"], teams: [team("A"), team("B")], claims: [claim("A", "p1", 9, { id: "a" }), claim("B", "p1", 9, { id: "b" }), claim("A", "p2", 1, { id: "a2", priority: 2 }), claim("B", "p2", 2, { id: "b2", priority: 2 })] });
  assert.equal(status(r, "a")?.status, "WON");
  assert.deepEqual(r.order, ["A", "B"]);
  assert.equal(status(r, "b")?.note, "Tied — Team A won the tiebreaker (waiver priority)");
  assert.equal(status(r, "a2")?.note, "Outbid by Team B");
});

test("bid visibility follows revealBids", () => {
  const s = settings((x) => (x.waivers.revealBids = "WINNING_ONLY"));
  assert.equal(bidVisible(s, { teamId: "A", won: false }, { teamId: "B", isCommish: false }), false);
  assert.equal(bidVisible(s, { teamId: "A", won: true }, { teamId: "B", isCommish: false }), true);
  assert.equal(bidVisible(s, { teamId: "A", won: false }, { teamId: "A", isCommish: false }), true);
  const none = settings((x) => (x.waivers.revealBids = "NONE"));
  assert.equal(bidVisible(none, { teamId: "A", won: true }, { teamId: "B", isCommish: false }), false);
  assert.equal(bidVisible(none, { teamId: "A", won: true }, { teamId: null, isCommish: true }), true);
  assert.equal(bidVisible(settings(), { teamId: "A", won: false }, { teamId: null, isCommish: false }), true);
});

test("every claim gets exactly one result", () => {
  const claims = [claim("A", "p1", 3), claim("B", "p1", 4), claim("C", "p2", 1), claim("A", "p2", 2, { priority: 2 }), claim("B", "p3", 200)];
  const r = run({ claims });
  assert.equal(r.results.length, claims.length);
  assert.equal(new Set(r.results.map((x) => x.claimId)).size, claims.length);
});

test("signing salary, contract years and minimum bid follow league settings", () => {
  assert.equal(waiverSigningSalary(settings(), 37), 1);
  const bidSalary = settings((s) => {
    s.waivers.salaryEqualsBid = true;
    s.waivers.salaryMultiplier = 0.5;
    s.salaryCap.minSalary = 2;
    s.salaryCap.maxSalary = 15;
  });
  assert.equal(waiverSigningSalary(bidSalary, 9), 5); // round(4.5)
  assert.equal(waiverSigningSalary(bidSalary, 1), 2); // min
  assert.equal(waiverSigningSalary(bidSalary, 100), 15); // max
  assert.equal(waiverContractYears(settings((s) => (s.waivers.signedContractYears = 9))), 5);
  assert.equal(waiverContractYears(settings((s) => (s.contracts.enabled = false))), 1);
  assert.equal(waiverMinBid(settings((s) => (s.waivers.allowZeroBids = false))), 1);
  const r = rulesFromSettings(settings((s) => (s.waivers.type = "PRIORITY")));
  assert.equal(r.mode, "PRIORITY");
  assert.equal(r.minBid, 0);
  assert.equal(r.positionMax.K, 3);
});

test("order helpers", () => {
  assert.deepEqual(reverseStandingsOrder(["A", "B", "C"]), ["C", "B", "A"]);
  assert.deepEqual(reverseStandingsOrder(["A", "B"], ["A", "B", "Z"]), ["B", "A", "Z"]);
  assert.deepEqual(moveInOrder(["x", "y", "z"], "z", "up"), ["x", "z", "y"]);
  assert.deepEqual(moveInOrder(["x", "y", "z"], "x", "up"), ["x", "y", "z"]);
  assert.deepEqual(moveInOrder(["x", "y", "z"], "x", "down"), ["y", "x", "z"]);
  assert.deepEqual([...priorityValues(["b", "a"])], [["b", 1], ["a", 2]]);
});

test("isRunDue compares the last scheduled run with the last processed time", () => {
  const sched = new Date("2026-11-25T08:00:00Z");
  assert.equal(isRunDue(null, null), false);
  assert.equal(isRunDue(sched, null), true);
  assert.equal(isRunDue(sched, new Date("2026-11-25T08:01:00Z")), false);
  assert.equal(isRunDue(sched, new Date("2026-11-24T22:00:00Z")), true);
});

test("processed claims group into runs and by player", () => {
  const base = { bidAmount: 0, teamId: "A", addPlayerId: "p1" };
  const runs = groupRuns([
    { ...base, id: "1", status: "WON", processedAt: new Date("2026-11-18T08:00:00Z"), bidAmount: 9 },
    { ...base, id: "2", status: "LOST", processedAt: new Date("2026-11-18T08:00:01Z"), bidAmount: 4, teamId: "B" },
    { ...base, id: "3", status: "WON", processedAt: new Date("2026-11-11T08:00:00Z"), addPlayerId: "p2" },
    { ...base, id: "4", status: "CANCELLED", processedAt: new Date("2026-11-12T08:00:00Z") },
    { ...base, id: "5", status: "PENDING", processedAt: null },
  ]);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].claims.length, 2);
  const byPlayer = groupByPlayer(runs[0].claims);
  assert.equal(byPlayer.length, 1);
  assert.equal(byPlayer[0].winner?.id, "1");
  assert.equal(byPlayer[0].others[0].id, "2");
});

// ───────────────────────────── Transaction log helpers ─────────────────────────────

test("transaction type filters map to stored types", () => {
  assert.deepEqual(txTypesFor("draft"), ["AUCTION", "ROOKIE_DRAFT", "DRAFT"]);
  assert.equal(txTypesFor("all"), null);
  assert.equal(txTypesFor("nonsense"), null);
  assert.equal(describeTransactionType("WAIVER"), "Waiver claim");
});

test("trade legs and paired add/drops group into single entries", () => {
  const t0 = new Date("2026-11-18T08:00:00Z");
  const rows = [
    { id: "w", type: "WAIVER", teamId: "A", tradeId: null, playerId: "p1", createdAt: t0, details: { dropPlayerId: "d1" } },
    { id: "d", type: "DROP", teamId: "A", tradeId: null, playerId: "d1", createdAt: new Date(t0.getTime() - 200), details: {} },
    { id: "t1", type: "TRADE", teamId: "A", tradeId: "T", playerId: "p9", createdAt: new Date("2026-11-10T00:00:00Z"), details: {} },
    { id: "t2", type: "TRADE", teamId: "B", tradeId: "T", playerId: "p8", createdAt: new Date("2026-11-10T00:00:00Z"), details: {} },
    { id: "solo", type: "DROP", teamId: "B", tradeId: null, playerId: "zz", createdAt: new Date("2026-11-01T00:00:00Z"), details: {} },
  ];
  const entries = groupTransactions(rows);
  assert.deepEqual(
    entries.map((e) => [e.kind, e.rowIds]),
    [
      ["single", ["w", "d"]],
      ["trade", ["t1", "t2"]],
      ["single", ["solo"]],
    ],
  );
});

test("CSV escaping", () => {
  assert.equal(toCsv([["a", 'say "hi"', "x,y"], [1, null, "line\nbreak"]]), 'a,"say ""hi""","x,y"\r\n1,,"line\nbreak"');
});

test("CSV cells that would run as spreadsheet formulas are neutralized (numbers untouched)", () => {
  assert.equal(toCsv([["=HYPERLINK(\"x\")", "+1", "@SUM", "-2", -5, "Team -A"]]), `"'=HYPERLINK(""x"")",'+1,'@SUM,'-2,-5,Team -A`);
});

// ── claims that wait for room made by the same team's other claim ──

/** cap 100; A sits at 98 with an expensive player (10, no dead money) it may drop */
function capped() {
  return team("A", {
    committed: 98,
    roster: [
      { playerId: "A-big", name: "Big Contract", position: "RB", status: "ACTIVE", capHit: 10, deadIfDropped: 0 },
      { playerId: "A-y", name: "A Backup", position: "RB", status: "ACTIVE", capHit: 1, deadIfDropped: 0 },
    ],
  });
}
const bySalary = (bid: number) => Math.max(1, bid);

test("a claim short of cap space waits for the team's earlier claim whose drop makes room", () => {
  const r = run({
    rules: rules({ salaryForBid: bySalary }),
    teams: [capped(), team("B")],
    claims: [claim("A", "p1", 2, { id: "drop-first", priority: 1, dropPlayerId: "A-big" }), claim("A", "p2", 5, { id: "needs-room", priority: 2 })],
  });
  assert.equal(status(r, "drop-first")?.status, "WON");
  assert.equal(status(r, "needs-room")?.status, "WON"); // 98 + 2 − 10 = 90 → +5 = 95 fits
});

test("a waiting claim is invalid (with the cap reason) when the claim that could make room loses", () => {
  const r = run({
    rules: rules({ salaryForBid: bySalary }),
    teams: [capped(), team("B")],
    claims: [
      claim("A", "p1", 2, { id: "loses", priority: 1, dropPlayerId: "A-big" }),
      claim("B", "p1", 9, { id: "b-wins" }),
      claim("A", "p2", 5, { id: "stuck", priority: 2 }),
    ],
  });
  assert.equal(status(r, "b-wins")?.status, "WON");
  assert.equal(status(r, "loses")?.status, "LOST");
  assert.equal(status(r, "stuck")?.status, "INVALID");
  assert.match(status(r, "stuck")!.note, /over the \$100 cap/);
});

test("a player whose best bid is waiting isn't awarded to a lower bid in the meantime", () => {
  const r = run({
    rules: rules({ salaryForBid: () => 5 }),
    teams: [capped(), team("B")],
    claims: [
      // A's top claim (p1, $30) only fits after A's other claim (p2, dropping A-big) is processed
      claim("A", "p1", 30, { id: "a-top", priority: 1 }),
      claim("A", "p2", 1, { id: "a-room", priority: 2, dropPlayerId: "A-big" }),
      claim("B", "p1", 20, { id: "b-lower" }),
    ],
  });
  assert.equal(status(r, "a-room")?.status, "WON");
  assert.equal(status(r, "a-top")?.status, "WON");
  assert.equal(status(r, "b-lower")?.status, "LOST");
  assert.equal(status(r, "b-lower")?.note, "Outbid: $30 by Team A");
});

test("a waiting rival that never gets room is INVALID, not outbid", () => {
  const r = run({
    rules: rules({ salaryForBid: () => 5 }),
    teams: [capped(), team("B")],
    claims: [
      claim("A", "p1", 30, { id: "a-top", priority: 1 }),
      // dropping A-y frees only $1: not enough for p1 afterwards
      claim("A", "p2", 1, { id: "a-small", priority: 2, dropPlayerId: "A-y" }),
      claim("B", "p1", 20, { id: "b" }),
    ],
  });
  assert.equal(status(r, "a-small")?.status, "INVALID"); // 98 + 5 − 1 = 102 > 100 itself
  assert.equal(status(r, "a-top")?.status, "INVALID");
  assert.match(status(r, "a-top")!.note, /over the \$100 cap/);
  assert.equal(status(r, "b")?.status, "WON");
});

test("position limits can be freed by the team's earlier claim dropping a player at that position", () => {
  const t = team("A", {
    roster: [
      { playerId: "A-k", name: "Old Kicker", position: "K", status: "ACTIVE", capHit: 1, deadIfDropped: 0 },
      { playerId: "A-y", name: "A Backup", position: "RB", status: "ACTIVE", capHit: 1, deadIfDropped: 0 },
    ],
  });
  const r = run({
    teams: [t],
    claims: [
      claim("A", "wr1", 1, { id: "swap", priority: 1, dropPlayerId: "A-k" }),
      claim("A", "k2", 1, { id: "kicker", priority: 2, position: "K" }),
    ],
  });
  assert.equal(status(r, "swap")?.status, "WON");
  assert.equal(status(r, "kicker")?.status, "WON");
});

// ───────────────────────── League-wide cap ceiling / roster limit / enforcement in the waiver run ─────────────────────────

/** League settings for the run: $100 cap, salary = bid, a 5-player active roster that may grow to 6 in the offseason. */
function capLeague(patch: (s: LeagueSettings) => void = () => {}): LeagueSettings {
  return settings((s) => {
    s.salaryCap.enabled = true;
    s.salaryCap.cap = 100;
    s.salaryCap.capType = "HARD";
    s.salaryCap.softCapMaxOverage = null;
    s.salaryCap.enforceInSeason = true;
    s.salaryCap.minSalary = 1;
    s.salaryCap.maxSalary = null;
    s.waivers.type = "FAB";
    s.waivers.salaryEqualsBid = true;
    s.waivers.salaryMultiplier = 1;
    s.waivers.allowZeroBids = true;
    s.waivers.minBid = 0;
    s.roster.maxActiveRoster = 5;
    s.roster.offseasonMaxActiveRoster = 6;
    s.roster.rosterCutdownDate = null;
    patch(s);
  });
}

test("rulesFromSettings: the waiver run uses the league ceiling, the phase's roster limit and enforcement mode", () => {
  const hard = rulesFromSettings(capLeague(), { phase: "REGULAR" });
  assert.equal(hard.cap, 100);
  assert.equal(hard.capEnforced, true);
  assert.equal(hard.maxActiveRoster, 5);
  assert.equal(rulesFromSettings(capLeague(), { phase: "OFFSEASON" }).maxActiveRoster, 6);
  const soft = rulesFromSettings(capLeague((s) => ((s.salaryCap.capType = "SOFT"), (s.salaryCap.softCapMaxOverage = 20))), { phase: "REGULAR" });
  assert.equal(soft.cap, 120);
  assert.equal(soft.capLabel, "soft-cap limit");
  const warn = rulesFromSettings(capLeague((s) => (s.salaryCap.offseasonEnforcement = "WARN_ONLY")), { phase: "KEEPER" });
  assert.equal(warn.capEnforced, false);
  assert.equal(warn.capWarning, "The cap is only a warning in the offseason.");
  assert.equal(rulesFromSettings(capLeague((s) => (s.salaryCap.enforceInSeason = false)), { phase: "REGULAR" }).capEnforced, false);
});

test("a claim over the hard cap but under the soft-cap limit wins; past the limit it is invalid", () => {
  const soft = capLeague((s) => {
    s.salaryCap.capType = "SOFT";
    s.salaryCap.softCapMaxOverage = 20;
  });
  // A sits at $95: a $15 bid signs for $15 → $110 (over the $100 cap, under the $120 limit)
  const fits = run({ rules: rulesFromSettings(soft, { phase: "REGULAR" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "fit" })] });
  assert.equal(status(fits, "fit")?.status, "WON");
  assert.equal(status(fits, "fit")?.note, "Won for $15");
  const past = run({ rules: rulesFromSettings(soft, { phase: "REGULAR" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 30, { id: "past" })] });
  assert.equal(status(past, "past")?.status, "INVALID");
  assert.match(status(past, "past")!.note, /would put you at \$125, over the \$120 soft-cap limit/);
  // the same claim with a hard cap is invalid
  const hard = run({ rules: rulesFromSettings(capLeague(), { phase: "REGULAR" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "hard" })] });
  assert.equal(status(hard, "hard")?.status, "INVALID");
  assert.match(status(hard, "hard")!.note, /over the \$100 cap/);
  // a soft cap with no max overage never blocks
  const open = capLeague((s) => (s.salaryCap.capType = "SOFT"));
  assert.equal(status(run({ rules: rulesFromSettings(open, { phase: "REGULAR" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 90, { id: "o" })] }), "o")?.status, "WON");
});

test("an offseason claim within the offseason roster limit wins without a drop; in season it needs one", () => {
  const full = () =>
    team("A", { roster: Array.from({ length: 5 }, (_, i) => ({ playerId: `A-${i}`, name: `A ${i}`, position: "WR", status: "ACTIVE", capHit: 1, deadIfDropped: 0 })), committed: 5 });
  const s = capLeague();
  const off = run({ rules: rulesFromSettings(s, { phase: "OFFSEASON" }), teams: [full()], claims: [claim("A", "p1", 1, { id: "off" })] });
  assert.equal(status(off, "off")?.status, "WON", "6th active player fits the offseason limit");
  const inSeason = run({ rules: rulesFromSettings(s, { phase: "REGULAR" }), teams: [full()], claims: [claim("A", "p1", 1, { id: "reg" })] });
  assert.equal(status(inSeason, "reg")?.status, "INVALID");
  assert.match(status(inSeason, "reg")!.note, /Roster full \(5\/5 active\)/);
  // once the cutdown deadline has passed the in-season limit applies again
  const cut = capLeague((x) => (x.roster.rosterCutdownDate = "2000-01-01T00:00:00.000Z"));
  assert.equal(status(run({ rules: rulesFromSettings(cut, { phase: "OFFSEASON" }), teams: [full()], claims: [claim("A", "p1", 1, { id: "cut" })] }), "cut")?.status, "INVALID");
});

test("WARN mode never blocks a claim: it wins with the cap warning in its note; BLOCK after the compliance date", () => {
  const warn = capLeague((s) => (s.salaryCap.offseasonEnforcement = "WARN_ONLY"));
  const r = run({ rules: rulesFromSettings(warn, { phase: "OFFSEASON" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "w" })] });
  assert.equal(status(r, "w")?.status, "WON");
  assert.equal(status(r, "w")?.note, "Won for $15. Signing for $15 would put you at $110, over the $100 cap. The cap is only a warning in the offseason.");
  assert.equal(r.awards[0].capWarning, "Signing for $15 would put you at $110, over the $100 cap. The cap is only a warning in the offseason.");
  assert.equal(awardNote({ mode: "FAB" }, r.awards[0]), status(r, "w")?.note);
  // under the cap: no warning
  const under = run({ rules: rulesFromSettings(warn, { phase: "OFFSEASON" }), teams: [team("A", { committed: 50 })], claims: [claim("A", "p1", 15, { id: "u" })] });
  assert.equal(status(under, "u")?.note, "Won for $15");
  assert.equal(under.awards[0].capWarning, null);
  // ALLOW_UNTIL_COMPLIANCE_DATE: a warning until the deadline, then blocked
  const allow = (date: string | null) =>
    capLeague((s) => {
      s.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
      s.salaryCap.complianceDate = date;
    });
  const before = run({ rules: rulesFromSettings(allow("2027-03-01T05:00:00.000Z"), { phase: "OFFSEASON", now: new Date("2027-02-01T00:00:00Z") }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "b" })] });
  assert.equal(status(before, "b")?.status, "WON");
  assert.match(status(before, "b")!.note, /Allowed until the cap compliance deadline \(Mar 1, 2027/);
  const after = run({ rules: rulesFromSettings(allow("2027-03-01T05:00:00.000Z"), { phase: "OFFSEASON", now: new Date("2027-03-02T00:00:00Z") }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "a" })] });
  assert.equal(status(after, "a")?.status, "INVALID");
  const noDate = run({ rules: rulesFromSettings(allow(null), { phase: "OFFSEASON" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "n" })] });
  assert.equal(status(noDate, "n")?.status, "WON", "no compliance date: never blocked");
  // the cap off in season: nothing is checked, no warning
  const off = run({ rules: rulesFromSettings(capLeague((s) => (s.salaryCap.enforceInSeason = false)), { phase: "REGULAR" }), teams: [team("A", { committed: 95 })], claims: [claim("A", "p1", 15, { id: "f" })] });
  assert.equal(status(off, "f")?.note, "Won for $15");
});
