import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, type LeagueSettings } from "@/lib/settings/schema";
import {
  buildKeyDates,
  checkLineup,
  countdownLabel,
  formatWhen,
  groupFeed,
  injuryLevel,
  injuryRank,
  lineupSummary,
  liveStarterSummary,
  nextOpponents,
  openVotesFirst,
  parseOdds,
  pctLabel,
  phaseLabel,
  pickLineupWeek,
  pickStandingsRows,
  playoffCutRank,
  playoffRoundLabel,
  previewText,
  rankBy,
  recapTeaser,
  shortPlayerName,
  tradeReceipts,
  weekStatus,
  type FeedTxInput,
  type KeyDateInput,
  type LineupSlotInput,
} from "@/components/home/logic";

function settingsWith(patch: (s: LeagueSettings) => void): LeagueSettings {
  const s = structuredClone(DEFAULT_SETTINGS);
  patch(s);
  return s;
}

const player = (id: string, over: Partial<{ team: string | null; injuryStatus: string | null; position: string }> = {}) => ({
  id,
  fullName: `Player ${id}`,
  position: over.position ?? "WR",
  team: over.team === undefined ? "KC" : over.team,
  injuryStatus: over.injuryStatus ?? null,
});

test("injuryLevel normalizes designations", () => {
  assert.equal(injuryLevel(null), null);
  assert.equal(injuryLevel(""), null);
  assert.equal(injuryLevel("Questionable"), "QUESTIONABLE");
  assert.equal(injuryLevel("Q"), "QUESTIONABLE");
  assert.equal(injuryLevel("Doubtful"), "DOUBTFUL");
  assert.equal(injuryLevel("Out"), "OUT");
  assert.equal(injuryLevel("IR"), "OUT");
  assert.equal(injuryLevel("Injured Reserve"), "OUT");
  assert.equal(injuryLevel("PUP"), "OUT");
  assert.equal(injuryLevel("Sus"), "OUT");
  assert.equal(injuryLevel("NA"), "OUT");
  assert.equal(injuryLevel("Active"), null);
  assert.ok(injuryRank("Out") < injuryRank("Doubtful"));
  assert.ok(injuryRank("Doubtful") < injuryRank("Questionable"));
  assert.ok(injuryRank("Questionable") < injuryRank(null));
});

test("checkLineup flags empty, bye, free agent and injured starters but skips locked slots", () => {
  const slots: LineupSlotInput[] = [
    { slotLabel: "QB", player: player("1", { position: "QB" }), onBye: false, locked: false },
    { slotLabel: "RB", player: null, onBye: false, locked: false },
    { slotLabel: "RB", player: player("2", { injuryStatus: "Out" }), onBye: false, locked: false },
    { slotLabel: "WR", player: player("3", { injuryStatus: "Questionable" }), onBye: false, locked: false },
    { slotLabel: "WR", player: player("4", { injuryStatus: "Doubtful" }), onBye: true, locked: false },
    { slotLabel: "TE", player: player("5", { team: null }), onBye: true, locked: false },
    { slotLabel: "FLEX", player: player("6", { injuryStatus: "IR" }), onBye: false, locked: true },
    { slotLabel: "K", player: null, onBye: false, locked: true },
  ];
  const r = checkLineup(slots);
  assert.deepEqual(
    r.issues.map((i) => i.kind),
    ["EMPTY", "NO_TEAM", "BYE", "OUT", "QUESTIONABLE"],
  );
  assert.equal(r.actionable, 4);
  assert.equal(r.watch, 1);
  assert.equal(r.counts.BYE, 1, "bye takes precedence over the injury tag");
  assert.equal(lineupSummary(r.counts), "1 empty slot · 1 free agent · 1 on bye · 1 out");
  const clean = checkLineup([{ slotLabel: "QB", player: player("1"), onBye: false, locked: false }]);
  assert.equal(clean.actionable, 0);
  assert.equal(clean.issues.length, 0);
  assert.equal(lineupSummary({ EMPTY: 2, NO_TEAM: 0, BYE: 0, OUT: 0, DOUBTFUL: 3, QUESTIONABLE: 1 }), "2 empty slots · 3 doubtful");
});

test("pickLineupWeek moves to next week once every game is final", () => {
  assert.equal(pickLineupWeek(11, ["post", "post"], 17), 12);
  assert.equal(pickLineupWeek(11, ["post", "in"], 17), 11);
  assert.equal(pickLineupWeek(11, ["pre"], 17), 11);
  assert.equal(pickLineupWeek(11, [], 17), 11);
  assert.equal(pickLineupWeek(17, ["post"], 17), 17, "never past the last fantasy week");
});

test("weekStatus describes the NFL week", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const g = (state: string, at: string) => ({ state, startTime: new Date(at) });
  assert.equal(weekStatus([], now).state, "none");
  const pre = weekStatus([g("pre", "2026-11-27T01:15:00Z"), g("pre", "2026-11-26T18:00:00Z")], now);
  assert.equal(pre.state, "pre");
  assert.equal(pre.nextKickoff, "2026-11-26T18:00:00.000Z");
  assert.equal(weekStatus([g("post", "2026-11-20T01:15:00Z"), g("pre", "2026-11-29T18:00:00Z")], now).state, "between");
  const live = weekStatus([g("in", "2026-11-26T11:00:00Z"), g("post", "2026-11-20T01:15:00Z"), g("pre", "2026-11-29T18:00:00Z")], now);
  assert.equal(live.state, "live");
  assert.equal(live.live, 1);
  assert.equal(weekStatus([g("post", "2026-11-20T01:15:00Z")], now).state, "final");
});

test("playoffRoundLabel names rounds from settings", () => {
  const s = settingsWith((x) => {
    x.playoffs.teams = 6;
    x.playoffs.startWeek = 15;
    x.playoffs.weeksPerRound = 1;
  });
  assert.equal(playoffRoundLabel(14, s), null);
  assert.equal(playoffRoundLabel(15, s), "Quarterfinals");
  assert.equal(playoffRoundLabel(16, s), "Semifinals");
  assert.equal(playoffRoundLabel(17, s), "Championship");
  const four = settingsWith((x) => {
    x.playoffs.teams = 4;
    x.playoffs.startWeek = 14;
    x.playoffs.weeksPerRound = 2;
  });
  assert.equal(playoffRoundLabel(15, four), "Semifinals");
  assert.equal(playoffRoundLabel(16, four), "Championship");
  assert.equal(phaseLabel("REGULAR"), "Regular season");
  assert.equal(phaseLabel("KEEPER"), "Keeper window");
});

test("pickStandingsRows keeps the top rows and appends my team", () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ teamId: `t${i + 1}`, rank: i + 1 }));
  const a = pickStandingsRows(rows, "t3", 6);
  assert.equal(a.rows.length, 6);
  assert.equal(a.myRowDetached, false);
  const b = pickStandingsRows(rows, "t9", 6);
  assert.deepEqual(
    b.rows.map((r) => r.teamId),
    ["t1", "t2", "t3", "t4", "t5", "t6", "t9"],
  );
  assert.equal(b.myRowDetached, true);
  assert.equal(pickStandingsRows(rows, null, 3).rows.length, 3);
});

test("playoffCutRank only draws a line when seeds are the top N", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ teamId: `t${i + 1}`, rank: i + 1 }));
  assert.equal(playoffCutRank(rows, ["t1", "t2", "t3", "t4"]), 4);
  assert.equal(playoffCutRank(rows, ["t1", "t2", "t5", "t4"]), null);
  assert.equal(playoffCutRank(rows, []), null);
  assert.equal(playoffCutRank(rows, rows.map((r) => r.teamId)), null, "everyone makes it: no line");
});

test("rankBy uses competition ranking", () => {
  const r = rankBy(
    [
      { id: "a", v: 10 },
      { id: "b", v: 30 },
      { id: "c", v: 10 },
      { id: "d", v: 5 },
    ],
    (x) => x.id,
    (x) => x.v,
  );
  assert.deepEqual([r.get("b"), r.get("a"), r.get("c"), r.get("d")], [1, 2, 2, 4]);
});

test("nextOpponents lists future matchups with opponent context", () => {
  const ms = [
    { id: "m1", week: 11, homeTeamId: "me", awayTeamId: "a", label: null, isPlayoff: false },
    { id: "m2", week: 12, homeTeamId: "b", awayTeamId: "me", label: null, isPlayoff: false },
    { id: "m3", week: 13, homeTeamId: "me", awayTeamId: null, label: null, isPlayoff: false },
    { id: "m4", week: 14, homeTeamId: "c", awayTeamId: "me", label: "Rivalry Week", isPlayoff: false },
    { id: "m5", week: 15, homeTeamId: "me", awayTeamId: "a", label: null, isPlayoff: true },
    { id: "x", week: 12, homeTeamId: "a", awayTeamId: "c", label: null, isPlayoff: false },
  ];
  const stats = [
    { teamId: "me", wins: 7, losses: 4, ties: 0, pointsFor: 1500, rank: 2 },
    { teamId: "a", wins: 8, losses: 3, ties: 0, pointsFor: 1400, rank: 1 },
    { teamId: "b", wins: 5, losses: 5, ties: 1, pointsFor: 1600, rank: 3 },
    { teamId: "c", wins: 2, losses: 9, ties: 0, pointsFor: 1100, rank: 4 },
  ];
  const r = nextOpponents(ms, "me", 11, stats);
  assert.deepEqual(
    r.map((o) => [o.week, o.opponentId]),
    [
      [12, "b"],
      [13, null],
      [14, "c"],
    ],
  );
  assert.equal(r[0].record, "5-5-1");
  assert.equal(r[0].pfRank, 1);
  assert.equal(r[0].rank, 3);
  assert.equal(r[1].record, null);
  assert.equal(r[2].label, "Rivalry Week");
});

const windows = new Map<number, { first: Date; last: Date }>([
  [11, { first: new Date("2026-11-20T01:15:00Z"), last: new Date("2026-11-24T01:15:00Z") }],
  [12, { first: new Date("2026-11-26T17:30:00Z"), last: new Date("2026-12-01T01:15:00Z") }],
  [15, { first: new Date("2026-12-18T01:15:00Z"), last: new Date("2026-12-22T01:15:00Z") }],
  [17, { first: new Date("2027-01-01T01:15:00Z"), last: new Date("2027-01-05T01:15:00Z") }],
]);

function keyInput(over: Partial<KeyDateInput> & { patch?: (s: LeagueSettings) => void } = {}): KeyDateInput {
  const settings = settingsWith((s) => {
    s.trades.enabled = true;
    s.trades.deadlineWeek = 11;
    s.playoffs.teams = 6;
    s.playoffs.byes = 2;
    s.playoffs.startWeek = 15;
    s.playoffs.weeksPerRound = 1;
    s.playoffs.championshipWeeks = 1;
    s.waivers.type = "FAB";
    s.waivers.disableAdds = false;
    s.waivers.playoffMode = "SAME_AS_REGULAR";
    s.keepers.enabled = false;
    s.roster.taxiDeadlineWeek = null;
    s.roster.rosterCutdownDate = null;
    s.salaryCap.complianceDate = null;
    s.general.duesDueDate = null;
    s.general.championTrophyName = "";
    s.draft.rookie.scheduledFor = null;
    s.draft.auction.scheduledFor = null;
    over.patch?.(s);
  });
  return {
    now: new Date("2026-11-24T12:00:00Z"),
    phase: "REGULAR",
    week: 12,
    settings,
    weekWindows: windows,
    nextWaiver: new Date("2026-11-25T08:00:00Z"),
    drafts: [],
    lastWeek: 17,
    ...over,
  };
}

test("buildKeyDates derives in-season milestones from settings", () => {
  const r = buildKeyDates(keyInput());
  assert.deepEqual(
    r.map((k) => k.key),
    ["waivers", "playoffs", "championship", "trade-deadline"],
  );
  const dl = r.find((k) => k.key === "trade-deadline")!;
  assert.equal(dl.status, "past");
  assert.equal(dl.label, "Trade deadline passed");
  assert.equal(dl.at, "2026-11-24T01:15:00.000Z");
  const po = r.find((k) => k.key === "playoffs")!;
  assert.equal(po.detail, "Week 15 · 6 teams · top 2 get byes");
  assert.equal(po.at, "2026-12-18T01:15:00.000Z");
  assert.equal(r.find((k) => k.key === "championship")!.detail, "Week 17");
});

test("buildKeyDates honors waiver, trade and trophy settings", () => {
  const ffa = buildKeyDates(keyInput({ patch: (s) => (s.waivers.type = "FREE_FOR_ALL") }));
  assert.ok(!ffa.some((k) => k.key === "waivers"));
  const frozen = buildKeyDates(keyInput({ phase: "PLAYOFFS", week: 15, patch: (s) => (s.waivers.playoffMode = "FROZEN") }));
  assert.ok(!frozen.some((k) => k.key === "waivers"));
  assert.ok(!frozen.some((k) => k.key === "playoffs"), "playoffs already started");
  const noTrades = buildKeyDates(keyInput({ patch: (s) => (s.trades.enabled = false) }));
  assert.ok(!noTrades.some((k) => k.key === "trade-deadline"));
  const early = buildKeyDates(keyInput({ week: 9 }));
  const dl = early.find((k) => k.key === "trade-deadline")!;
  assert.equal(dl.status, "upcoming");
  assert.equal(dl.href, "/trades");
  const trophy = buildKeyDates(keyInput({ phase: "PLAYOFFS", week: 17, patch: (s) => (s.general.championTrophyName = "Golden Helmet") }));
  const champ = trophy.find((k) => k.key === "championship")!;
  assert.equal(champ.label, "Golden Helmet game");
  assert.equal(champ.status, "live");
  assert.equal(trophy[0].key, "championship", "live items lead");
});

test("buildKeyDates covers drafts, keepers and offseason deadlines", () => {
  const r = buildKeyDates(
    keyInput({
      phase: "OFFSEASON",
      week: 17,
      nextWaiver: new Date("2027-02-03T08:00:00Z"),
      now: new Date("2027-02-01T12:00:00Z"),
      drafts: [{ type: "ROOKIE", status: "SCHEDULED", startTime: new Date("2027-05-02T23:00:00Z"), name: "2027 Rookie Draft" }],
      patch: (s) => {
        s.waivers.offseasonWaivers = false;
        s.keepers.enabled = true;
        s.keepers.maxKeepers = 8;
        s.keepers.windowOpens = "2027-02-10T00:00:00Z";
        s.keepers.deadline = "2027-03-01T00:00:00Z";
        s.draft.rookie.scheduledFor = "2027-04-01T00:00:00Z";
        s.draft.auction.scheduledFor = "2027-08-20T23:00:00Z";
        s.general.leagueDues = 100;
        s.general.duesDueDate = "2027-08-01T00:00:00Z";
      },
    }),
  );
  assert.deepEqual(
    r.map((k) => k.key),
    ["keeper-window", "keeper-deadline", "rookie-draft", "dues", "auction"],
  );
  assert.equal(r.find((k) => k.key === "rookie-draft")!.at, "2027-05-02T23:00:00.000Z", "Draft row wins over the settings date");
  assert.equal(r.find((k) => k.key === "keeper-deadline")!.detail, "Up to 8 keepers");
  const live = buildKeyDates(keyInput({ drafts: [{ type: "AUCTION", status: "LIVE", startTime: null, name: "Startup Auction" }] }));
  assert.equal(live[0].key, "auction");
  assert.equal(live[0].status, "live");
  const stale = buildKeyDates(keyInput({ patch: (s) => (s.draft.rookie.scheduledFor = "2026-05-01T00:00:00Z") }));
  assert.ok(!stale.some((k) => k.key === "rookie-draft"), "past settings dates are hidden");
});

const tx = (id: string, type: string, at: number, over: Partial<FeedTxInput> = {}): FeedTxInput => ({
  id,
  type,
  teamId: "t1",
  tradeId: null,
  playerId: `p-${id}`,
  createdAt: new Date(1_800_000_000_000 + at),
  details: {},
  ...over,
});

test("groupFeed merges trade legs and add/drop pairs", () => {
  const rows = [
    tx("a", "TRADE", 10_000, { tradeId: "T1", teamId: "t1" }),
    tx("b", "TRADE", 10_001, { tradeId: "T1", teamId: "t2" }),
    tx("c", "ADD", 5_000, { teamId: "t3" }),
    tx("d", "DROP", 5_200, { teamId: "t3" }),
    tx("e", "WAIVER", 1_000, { teamId: "t4", details: { dropPlayerId: "p-f" } }),
    tx("f", "DROP", 60_000 * -1, { teamId: "t4" }),
    tx("g", "DROP", 3_000, { teamId: "t5" }),
  ];
  const g = groupFeed(rows);
  assert.deepEqual(
    g.map((x) => [x.kind, x.rowIds.join("+")]),
    [
      ["trade", "b+a"],
      ["move", "c+d"],
      ["move", "g"],
      ["move", "e+f"],
    ],
  );
  assert.equal(g[0].tradeId, "T1");
  assert.equal(groupFeed(rows, 2).length, 2);
});

test("tradeReceipts lists what each side received", () => {
  const r = tradeReceipts(
    ["t1", "t2"],
    [
      { fromTeamId: "t1", toTeamId: "t2", type: "PLAYER", label: "Old label", playerName: "Rome Odunze", faabAmount: null },
      { fromTeamId: "t2", toTeamId: "t1", type: "PICK", label: "2027 1st (Team X)", playerName: null, faabAmount: null },
      { fromTeamId: "t2", toTeamId: "t1", type: "FAAB", label: null, playerName: null, faabAmount: 10 },
    ],
  );
  assert.deepEqual(r, [
    { teamId: "t1", items: ["2027 1st (Team X)", "$10 FAB"] },
    { teamId: "t2", items: ["Rome Odunze"] },
  ]);
});

test("recapTeaser reads headline, intro and awards defensively", () => {
  const t = recapTeaser("Week 11 Recap", {
    headline: "Bell Ringers roll",
    intro: "A wild week.",
    awards: [{ title: "Top Score", value: "166.98 pts", teamId: "t1" }, { nope: true }, { title: "Closest Game", value: "+2.1" }],
  });
  assert.equal(t.headline, "Bell Ringers roll");
  assert.equal(t.intro, "A wild week.");
  assert.deepEqual(t.awards, [
    { title: "Top Score", value: "166.98 pts", teamId: "t1" },
    { title: "Closest Game", value: "+2.1", teamId: null },
  ]);
  const fallback = recapTeaser("Week 3 Recap", "not an object");
  assert.equal(fallback.headline, "Week 3 Recap");
  assert.equal(fallback.intro, null);
  assert.deepEqual(fallback.awards, []);
});

test("parseOdds and pctLabel", () => {
  const m = parseOdds([{ teamId: "a", playoffPct: 0.734, champPct: 0.12, byePct: 0.3, marker: "x" }, { teamId: "b", playoffPct: "bad" }, null, { teamId: "c", playoffPct: 1.4 }]);
  assert.equal(m.size, 2);
  assert.equal(m.get("a")!.marker, "x");
  assert.equal(m.get("c")!.playoffPct, 1);
  assert.equal(parseOdds("nope").size, 0);
  assert.equal(pctLabel(0.734), "73%");
  assert.equal(pctLabel(0.001), "<1%");
  assert.equal(pctLabel(0.999), ">99%");
  assert.equal(pctLabel(1), "100%");
  assert.equal(pctLabel(0), "0%");
  assert.equal(pctLabel(null), "—");
});

test("previewText strips markdown-lite", () => {
  assert.equal(previewText("**Huge** trade, see [this](https://x.y) and `code`"), "Huge trade, see this and code");
  assert.equal(previewText("hello   _there_ friend"), "hello there friend");
  assert.equal(previewText("a".repeat(30), 10), "aaaaaaaaa…");
});

test("formatWhen and countdownLabel use the league timezone", () => {
  const now = new Date("2026-11-24T17:00:00Z"); // Tue noon ET
  const tz = "America/New_York";
  assert.equal(formatWhen("2026-11-24T23:30:00Z", tz, now), "Today 6:30 PM");
  assert.equal(formatWhen("2026-11-25T13:00:00Z", tz, now), "Tomorrow 8:00 AM");
  assert.equal(formatWhen("2026-11-27T01:20:00Z", tz, now), "Thu 8:20 PM");
  assert.equal(formatWhen("2026-12-20T18:00:00Z", tz, now), "Dec 20");
  assert.equal(formatWhen("2027-01-03T18:00:00Z", tz, now), "Jan 3, 2027");
  assert.equal(formatWhen("2026-11-24T04:00:00Z", tz, now), "Yesterday 11:00 PM");
  assert.equal(formatWhen("2026-11-27T01:20:00Z", "America/Los_Angeles", now), "Thu 5:20 PM");
  assert.equal(formatWhen("2026-11-25T04:30:00Z", "America/Los_Angeles", now), "Today 8:30 PM");
  assert.equal(formatWhen("2026-11-25T13:00:00Z", tz, now, { time: false }), "Tomorrow");
  assert.equal(countdownLabel("2026-11-24T17:30:00Z", now), "in 30m");
  assert.equal(countdownLabel("2026-11-24T22:10:00Z", now), "in 5h 10m");
  assert.equal(countdownLabel("2026-11-27T21:00:00Z", now), "in 3d 4h");
  assert.equal(countdownLabel("2026-11-24T16:00:00Z", now), "now");
});

test("shortPlayerName drops generational suffixes", () => {
  assert.equal(shortPlayerName("Michael Pittman Jr."), "Pittman");
  assert.equal(shortPlayerName("Kenneth Walker III"), "Walker");
  assert.equal(shortPlayerName("Marvin Harrison Jr"), "Harrison");
  assert.equal(shortPlayerName("Patrick Mahomes II"), "Mahomes");
  assert.equal(shortPlayerName("Ja'Marr Chase"), "Chase");
  assert.equal(shortPlayerName("  Joe   Burrow "), "Burrow");
  assert.equal(shortPlayerName("Packers"), "Packers");
  assert.equal(shortPlayerName("Jr."), "Jr.");
});

test("openVotesFirst puts open rule votes first, closing soonest first", () => {
  const now = new Date("2026-11-24T15:00:00Z");
  const rows = [
    { id: "ended-old", votingEndsAt: new Date("2026-11-20T00:00:00Z") },
    { id: "no-end", votingEndsAt: null },
    { id: "ends-late", votingEndsAt: "2026-12-05T00:00:00Z" },
    { id: "ended-recent", votingEndsAt: new Date("2026-11-24T14:00:00Z") },
    { id: "ends-soon", votingEndsAt: new Date("2026-11-25T00:00:00Z") },
  ];
  assert.deepEqual(
    openVotesFirst(rows, now).map((r) => r.id),
    ["ends-soon", "ends-late", "no-end", "ended-recent", "ended-old"],
  );
  assert.deepEqual(openVotesFirst([], now), []);
});

test("liveStarterSummary ignores bench / IR / taxi and picks the top scorer among started games", () => {
  const p = (playerId: string, slot: string, gameState: string, points: number) => ({ playerId, name: playerId, slot, gameState, points, projected: 10 });
  const res = liveStarterSummary([
    p("qb", "QB", "in", 12.4),
    p("rb", "RB", "post", 18.2),
    p("wr", "WR", "pre", 0),
    p("flex", "FLEX", "pre", 0),
    p("bench", "BN", "post", 30),
    p("ir", "IR", "post", 25),
    p("taxi", "TAXI", "in", 22),
  ]);
  assert.equal(res.top?.playerId, "rb");
  assert.deepEqual([...res.pendingIds].sort(), ["flex", "wr"]);
  assert.equal(liveStarterSummary([p("wr", "WR", "pre", 0)]).top, null);
});

test("roster cutdown and cap compliance dates read like the rules read them (home key dates + commissioner deadlines)", async () => {
  const { upcomingDeadlines } = await import("@/lib/commissioner/deadlines");
  const { activeRosterLimit, capEnforcement, deadlineInstant } = await import("@/lib/roster-rules");
  const now = new Date("2027-02-01T12:00:00Z");
  const offseason = (patch: (s: LeagueSettings) => void) =>
    keyInput({
      phase: "OFFSEASON",
      week: 17,
      now,
      nextWaiver: new Date("2027-02-03T08:00:00Z"),
      patch: (s) => {
        s.waivers.offseasonWaivers = false;
        s.roster.offseasonMaxActiveRoster = 35;
        s.roster.rosterCutdownDate = "2027-08-31"; // date-only: the end of Aug 31 in the league time zone
        s.salaryCap.complianceDate = "2027-03-01";
        s.salaryCap.offseasonEnforcement = "ALLOW_UNTIL_COMPLIANCE_DATE";
        patch(s);
      },
    });
  const input = offseason(() => {});
  const r = buildKeyDates(input);
  const cutdown = r.find((k) => k.key === "cutdown")!;
  const compliance = r.find((k) => k.key === "cap-compliance")!;
  // shown as the last moment of the named day in the league time zone (so it reads Aug 31 / Mar 1, not the next day)
  assert.equal(cutdown.at, "2027-09-01T03:59:59.999Z", "Aug 31, 11:59:59 PM in New York (EDT)");
  assert.equal(cutdown.detail, "Active roster max 35 → 27");
  assert.equal(compliance.at, "2027-03-02T04:59:59.999Z", "Mar 1, 11:59:59 PM in New York (EST)");
  assert.equal(compliance.detail, "$300 cap");
  assert.equal(formatWhen(cutdown.at!, "America/New_York", now, { time: false }), "Aug 31");
  assert.equal(formatWhen(compliance.at!, "America/New_York", now, { time: true }), "Mar 1");
  // the instants the rules switch at: the offseason roster limit until the cutdown, the cap blocks from the compliance date
  const s = input.settings;
  const cutdownDue = deadlineInstant(s.roster.rosterCutdownDate, s.general.timezone)!;
  const complianceDue = deadlineInstant(s.salaryCap.complianceDate, s.general.timezone)!;
  assert.equal(Date.parse(cutdown.at!) + 1, cutdownDue.getTime());
  assert.equal(Date.parse(compliance.at!) + 1, complianceDue.getTime());
  assert.equal(activeRosterLimit(s, { phase: "OFFSEASON", now: new Date(cutdown.at!) }), 35);
  assert.equal(activeRosterLimit(s, { phase: "OFFSEASON", now: cutdownDue }), 27);
  assert.equal(capEnforcement(s, "OFFSEASON", new Date(compliance.at!)), "WARN");
  assert.equal(capEnforcement(s, "OFFSEASON", complianceDue), "BLOCK");
  // the commissioner dashboard lists the same instants, passed exactly when the rules switch
  const dl = upcomingDeadlines(s, { now, week: 17 });
  assert.equal(dl.find((d) => d.key === "cutdown")!.at, cutdown.at);
  assert.equal(dl.find((d) => d.key === "compliance")!.at, compliance.at);
  assert.equal(dl.find((d) => d.key === "compliance")!.detail, "Over-cap teams are resolved by the commissioner (over the $300 cap)");
  assert.equal(upcomingDeadlines(s, { now: new Date(compliance.at!), week: 17 }).find((d) => d.key === "compliance")!.passed, false);
  assert.equal(upcomingDeadlines(s, { now: complianceDue, week: 17 }).find((d) => d.key === "compliance")!.passed, true);
  assert.ok(!buildKeyDates({ ...input, now: complianceDue }).some((k) => k.key === "cap-compliance"), "gone from home once it passes");
  // another league time zone moves both
  const la = offseason((x) => (x.general.timezone = "America/Los_Angeles"));
  assert.equal(buildKeyDates(la).find((k) => k.key === "cutdown")!.at, "2027-09-01T06:59:59.999Z");
  assert.equal(upcomingDeadlines(la.settings, { now, week: 17 }).find((d) => d.key === "compliance")!.at, "2027-03-02T07:59:59.999Z");
  // a soft cap: teams must be under the soft-cap limit
  const soft = offseason((x) => {
    x.salaryCap.capType = "SOFT";
    x.salaryCap.softCapMaxOverage = 25;
  });
  assert.equal(buildKeyDates(soft).find((k) => k.key === "cap-compliance")!.detail, "$325 soft-cap limit");
  assert.match(upcomingDeadlines(soft.settings, { now, week: 17 }).find((d) => d.key === "compliance")!.detail!, /over the \$325 soft-cap limit/);
  // no offseason roster limit: the cutdown changes nothing, so it isn't listed
  const plain = offseason((x) => (x.roster.offseasonMaxActiveRoster = null));
  assert.ok(!buildKeyDates(plain).some((k) => k.key === "cutdown"));
  assert.ok(!upcomingDeadlines(plain.settings, { now, week: 17 }).some((d) => d.key === "cutdown"));
  // full ISO datetimes from the settings editor are used as-is; unreadable values are ignored
  const iso = offseason((x) => (x.salaryCap.complianceDate = "2027-03-01T17:00:00.000Z"));
  assert.equal(buildKeyDates(iso).find((k) => k.key === "cap-compliance")!.at, "2027-03-01T17:00:00.000Z");
  const bad = offseason((x) => (x.salaryCap.complianceDate = "2027-02-30"));
  assert.ok(!buildKeyDates(bad).some((k) => k.key === "cap-compliance"));
  assert.ok(!upcomingDeadlines(bad.settings, { now, week: 17 }).some((d) => d.key === "compliance"));
});
