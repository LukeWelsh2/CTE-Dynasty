import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, deepMerge, type LeagueSettings } from "@/lib/settings/schema";
import { nextWaiverRun } from "@/lib/waiver-schedule";
import {
  acquisitionLimitError,
  acquisitionMode,
  byeWeeksByTeam,
  compareValues,
  deadMoneyPreview,
  effectiveInjury,
  espnIdFromUrl,
  fantasyPositionsFor,
  gameResult,
  injuryGroup,
  injurySeverity,
  isGameLocked,
  isInjuryText,
  lastNAverage,
  minimumBid,
  nameKey,
  normalizeInjuryStatus,
  opponentLabel,
  parsePositionFilter,
  parseTimeframe,
  perGame,
  positionFilterOptions,
  rankOf,
  rawPositionsFor,
  restOfSeasonFrom,
  signingSalary,
  signingYears,
  statColumnsFor,
  sumStats,
  teamSpread,
  validateBid,
  bidStep,
  AUCTION_POOL_REASON,
  auctionPoolDetail,
  auctionPoolHold,
  freeAgentGameLocked,
  isRolloverRelease,
  isUndroppable,
  pendingClaimLimitError,
  readdCooldownUntil,
} from "@/lib/players/logic";

const S = DEFAULT_SETTINGS;
const withSettings = (patch: unknown): LeagueSettings => deepMerge(DEFAULT_SETTINGS, patch);

test("position filters respect IDP setting", () => {
  assert.deepEqual(positionFilterOptions(S), ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "DEF"]);
  const idp = withSettings({ roster: { idpEnabled: true } });
  assert.ok(positionFilterOptions(idp).includes("LB"));
  assert.equal(parsePositionFilter("lb", S), "ALL");
  assert.equal(parsePositionFilter("lb", idp), "LB");
  assert.equal(parsePositionFilter("dst", S), "DEF");
  assert.deepEqual(fantasyPositionsFor("FLEX", S), ["RB", "WR", "TE"]);
  assert.ok(rawPositionsFor("DB", idp).includes("CB"));
  assert.ok(!rawPositionsFor("ALL", S).includes("CB"));
  assert.ok(rawPositionsFor("ALL", idp).includes("CB"));
  assert.equal(statColumnsFor("LB")[0], "idp_tkl_solo");
  assert.ok(statColumnsFor("QB").includes("pass_yd"));
});

test("timeframe parsing and ROS start week", () => {
  assert.equal(parseTimeframe("ros"), "ros");
  assert.equal(parseTimeframe("bogus"), "season");
  assert.equal(restOfSeasonFrom(11, true, 17), 11);
  assert.equal(restOfSeasonFrom(11, false, 17), 12);
  assert.equal(restOfSeasonFrom(17, false, 17), 17);
});

test("stat aggregation helpers", () => {
  const t = sumStats([{ rec: 5, rec_yd: 60 }, { rec: 3, rec_yd: 40, rec_td: 1 }, null]);
  assert.deepEqual(t, { rec: 8, rec_yd: 100, rec_td: 1 });
  assert.deepEqual(perGame(t, 2), { rec: 4, rec_yd: 50, rec_td: 0.5 });
  assert.deepEqual(perGame(t, 0), {});
  assert.equal(lastNAverage(new Map([[1, 10], [2, 20], [3, 30], [5, 0]]), [1, 2, 3, 5], 3), round2((20 + 30 + 0) / 3));
  assert.equal(lastNAverage({}, [], 3), 0);
  assert.equal(rankOf(20, [30, 20, 20, 10]), 2);
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

test("bye weeks only count weeks that have games", () => {
  const games = [
    { week: 1, homeTeam: "KC", awayTeam: "BUF" },
    { week: 1, homeTeam: "DAL", awayTeam: "NYG" },
    { week: 2, homeTeam: "KC", awayTeam: "DAL" },
    { week: 3, homeTeam: "BUF", awayTeam: "NYG" },
  ];
  const byes = byeWeeksByTeam(games);
  assert.deepEqual(byes.get("KC"), [3]);
  assert.deepEqual(byes.get("BUF"), [2]);
  assert.deepEqual(byes.get("NYG"), [2]);
  assert.deepEqual(byes.get("DAL"), [3]);
});

test("opponent, result and spread labels", () => {
  const g = { homeTeam: "KC", awayTeam: "ARI", homeScore: 34, awayScore: 7, state: "post", spread: -6.5 };
  assert.equal(opponentLabel("ARI", g).label, "@ KC");
  assert.equal(opponentLabel("KC", g).label, "vs ARI");
  assert.equal(gameResult("KC", g), "W 34-7");
  assert.equal(gameResult("ARI", g), "L 7-34");
  assert.equal(gameResult("ARI", { ...g, state: "in" }), null);
  assert.equal(teamSpread("KC", g), "-6.5");
  assert.equal(teamSpread("ARI", g), "+6.5");
  assert.equal(teamSpread("ARI", { ...g, spread: 0 }), "PK");
  assert.equal(teamSpread("ARI", { ...g, spread: null }), null);
});

// Wednesday 3am New York processing (DEFAULT_SETTINGS)
const now = new Date("2026-11-24T15:00:00Z"); // Tue 10am ET
const runs = (from: Date) => nextWaiverRun(S, from);

test("free agents with continuous free agency are immediate adds", () => {
  const m = acquisitionMode({ settings: S, phase: "REGULAR", waiverClearsAt: null, gameStarted: false, now, nextRun: runs });
  assert.deepEqual(m, { kind: "add" });
});

test("game-locked free agents become claims processed at the next run", () => {
  const m = acquisitionMode({ settings: S, phase: "REGULAR", waiverClearsAt: null, gameStarted: true, now, nextRun: runs });
  assert.equal(m.kind, "claim");
  if (m.kind === "claim") assert.equal(m.processAt.toISOString(), "2026-11-25T08:00:00.000Z"); // Wed 3am ET
  const noLock = withSettings({ waivers: { lockPlayersAfterGameStart: false } });
  assert.equal(acquisitionMode({ settings: noLock, phase: "REGULAR", waiverClearsAt: null, gameStarted: true, now, nextRun: (f) => nextWaiverRun(noLock, f) }).kind, "add");
});

test("players on waivers are claimed for the first run after they clear", () => {
  const clears = new Date("2026-11-26T15:00:00Z"); // Thu
  const m = acquisitionMode({ settings: S, phase: "REGULAR", waiverClearsAt: clears, gameStarted: false, now, nextRun: runs });
  assert.equal(m.kind, "claim");
  if (m.kind === "claim") assert.equal(m.processAt.toISOString(), "2026-12-02T08:00:00.000Z"); // following Wed
  const atRun = new Date("2026-11-25T08:00:00Z");
  const m2 = acquisitionMode({ settings: S, phase: "REGULAR", waiverClearsAt: atRun, gameStarted: false, now, nextRun: runs });
  if (m2.kind === "claim") assert.equal(m2.processAt.toISOString(), "2026-11-25T08:00:00.000Z");
  else assert.fail("expected claim");
});

test("game lock lasts until the next waiver run after kickoff", () => {
  const thu = { startTime: new Date("2026-11-20T01:15:00Z"), state: "post" };
  const lastRunBefore = new Date("2026-11-18T08:00:00Z");
  const lastRunAfter = new Date("2026-11-25T08:00:00Z");
  const t = new Date("2026-11-24T15:00:00Z");
  assert.equal(isGameLocked(thu, S, t, lastRunBefore), true);
  assert.equal(isGameLocked(thu, S, new Date("2026-11-25T15:00:00Z"), lastRunAfter), false);
  assert.equal(isGameLocked({ startTime: new Date("2026-11-30T18:00:00Z"), state: "pre" }, S, t, lastRunBefore), false);
  assert.equal(isGameLocked(null, S, t, lastRunBefore), false);
  // no waiver runs: locked only while live
  assert.equal(isGameLocked({ ...thu, state: "in" }, S, t, null), true);
  assert.equal(isGameLocked(thu, S, t, null), false);
  assert.equal(isGameLocked(thu, withSettings({ waivers: { lockPlayersAfterGameStart: false } }), t, lastRunBefore), false);
});

test("leagues without continuous free agency require claims; FFA does not", () => {
  const noCfa = withSettings({ waivers: { continuousFreeAgency: false } });
  assert.equal(acquisitionMode({ settings: noCfa, phase: "REGULAR", waiverClearsAt: null, gameStarted: false, now, nextRun: (f) => nextWaiverRun(noCfa, f) }).kind, "claim");
  const ffa = withSettings({ waivers: { type: "FREE_FOR_ALL", continuousFreeAgency: false } });
  assert.equal(acquisitionMode({ settings: ffa, phase: "REGULAR", waiverClearsAt: null, gameStarted: false, now, nextRun: (f) => nextWaiverRun(ffa, f) }).kind, "add");
  const noDays = withSettings({ waivers: { processDays: [] } });
  const m = acquisitionMode({ settings: noDays, phase: "REGULAR", waiverClearsAt: null, gameStarted: true, now, nextRun: (f) => nextWaiverRun(noDays, f) });
  assert.equal(m.kind, "blocked");
});

test("playoff roster lock and offseason rules", () => {
  const locked = withSettings({ playoffs: { lockRostersInPlayoffs: true } });
  assert.equal(acquisitionMode({ settings: locked, phase: "PLAYOFFS", waiverClearsAt: null, gameStarted: false, now, nextRun: runs }).kind, "blocked");
  assert.equal(acquisitionMode({ settings: S, phase: "OFFSEASON", waiverClearsAt: new Date(now.getTime() + 3600_000), gameStarted: true, now, nextRun: runs }).kind, "add");
  const offW = withSettings({ waivers: { offseasonWaivers: true } });
  assert.equal(acquisitionMode({ settings: offW, phase: "OFFSEASON", waiverClearsAt: new Date(now.getTime() + 3600_000), gameStarted: false, now, nextRun: (f) => nextWaiverRun(offW, f) }).kind, "claim");
});

test("signing salary and contract years follow waiver settings", () => {
  assert.equal(signingSalary(S, 25), S.salaryCap.minSalary);
  const bidSal = withSettings({ waivers: { salaryEqualsBid: true, salaryMultiplier: 0.5 }, salaryCap: { minSalary: 2 } });
  assert.equal(signingSalary(bidSal, 25), 13); // round(12.5)
  assert.equal(signingSalary(bidSal, 1), 2); // floor at minSalary
  const capped = withSettings({ waivers: { salaryEqualsBid: true }, salaryCap: { maxSalary: 20 } });
  assert.equal(signingSalary(capped, 50), 20);
  assert.equal(signingYears(S), 1);
  assert.equal(signingYears(withSettings({ waivers: { signedContractYears: 3 } })), 3);
  assert.equal(signingYears(withSettings({ waivers: { signedContractYears: 9 } })), S.contracts.maxYears);
  assert.equal(signingYears(withSettings({ contracts: { enabled: false }, waivers: { signedContractYears: 3 } })), 1);
});

test("bid validation", () => {
  assert.equal(minimumBid(S), 0);
  assert.equal(validateBid(S, 0, 50), null);
  assert.match(validateBid(S, 51, 50)!, /only have \$50/);
  assert.match(validateBid(S, 1.5, 50)!, /whole number/);
  const noZero = withSettings({ waivers: { allowZeroBids: false, minBid: 0 } });
  assert.equal(minimumBid(noZero), 1);
  assert.match(validateBid(noZero, 0, 50)!, /minimum bid is \$1/);
});

test("dead money preview mirrors roster-ops", () => {
  // 50% current, 25% each future year
  assert.deepEqual(deadMoneyPreview({ salary: 40, contractYears: 3 }, S, 2026, 11), [
    { season: 2026, amount: 20 },
    { season: 2027, amount: 10 },
    { season: 2028, amount: 10 },
  ]);
  assert.deepEqual(deadMoneyPreview({ salary: 1, contractYears: 2 }, S, 2026, 11), []); // min salary
  const exempt = withSettings({ salaryCap: { deadMoney: { rookieContractsExempt: true } } });
  assert.deepEqual(deadMoneyPreview({ salary: 10, contractYears: 3, isRookieContract: true }, exempt, 2026, 11), []);
  const early = withSettings({ salaryCap: { deadMoney: { waivedInSeasonBeforeWeek: 3 } } });
  assert.deepEqual(deadMoneyPreview({ salary: 10, contractYears: 1 }, early, 2026, 2), []);
  assert.deepEqual(deadMoneyPreview({ salary: 10, contractYears: 1 }, withSettings({ salaryCap: { deadMoney: { enabled: false } } }), 2026, 5), []);
});

test("acquisition limits", () => {
  assert.equal(acquisitionLimitError(S, 99, 99), null);
  const lim = withSettings({ waivers: { maxAcquisitionsPerWeek: 2, maxAcquisitionsPerSeason: 10 } });
  assert.equal(acquisitionLimitError(lim, 1, 5), null);
  assert.match(acquisitionLimitError(lim, 2, 5)!, /Weekly/);
  assert.match(acquisitionLimitError(lim, 0, 10)!, /Season/);
});

test("injury status normalization, severity and groups", () => {
  assert.equal(normalizeInjuryStatus("Injured Reserve"), "IR");
  assert.equal(normalizeInjuryStatus("out"), "Out");
  assert.equal(normalizeInjuryStatus("Q"), "Questionable");
  assert.equal(normalizeInjuryStatus("Active"), "Active");
  assert.equal(normalizeInjuryStatus(null), "Active");
  assert.ok(injurySeverity("IR") > injurySeverity("Out"));
  assert.ok(injurySeverity("Out") > injurySeverity("Doubtful"));
  assert.ok(injurySeverity("Doubtful") > injurySeverity("Questionable"));
  assert.equal(injurySeverity("Active"), 0);
  assert.equal(injuryGroup("Injured Reserve"), "IR");
  assert.equal(injuryGroup("PUP"), "IR");
  assert.equal(injuryGroup("Sus"), "OTHER");
});

test("effective injury prefers a recent ESPN report", () => {
  const n = new Date("2026-11-24T12:00:00Z");
  const p = { injuryStatus: "Questionable", injuryBodyPart: "Knee", injuryNotes: null };
  const rep = { status: "Out", bodyPart: "Knee (sprain)", shortComment: "Ruled out", longComment: null, returnDate: null, reportedAt: new Date("2026-11-23T12:00:00Z") };
  assert.equal(effectiveInjury(p, rep, n).status, "Out");
  assert.equal(effectiveInjury(p, { ...rep, status: "Active" }, n).status, null);
  assert.equal(effectiveInjury(p, { ...rep, reportedAt: new Date("2026-08-01T00:00:00Z") }, n).status, "Questionable");
  assert.equal(effectiveInjury(p, null, n).source, "SLEEPER");
  assert.equal(effectiveInjury({ injuryStatus: null }, null, n).status, null);
});

test("injury text heuristic", () => {
  assert.ok(isInjuryText("Rams TE Terrance Ferguson needs season-ending ankle surgery"));
  assert.ok(isInjuryText("Darnold (quadriceps/ribs) was suited up for Monday's practice"));
  assert.ok(isInjuryText("Love (back) did not practice Wednesday"));
  assert.ok(isInjuryText("Commanders RB activated from IR ahead of MNF"));
  assert.ok(!isInjuryText("Fantasy football trade deadline: 7 players to trade for, 5 to trade away"));
  assert.ok(!isInjuryText("Back-to-back wins have the Giants feeling good"));
  assert.ok(!isInjuryText("Cardinals fire DC Nick Rallis; Teryl Austin takes over"));
});

test("name keys and ESPN ids", () => {
  assert.equal(nameKey("Travis Etienne Jr."), "travisetienne");
  assert.equal(nameKey("Travis Etienne"), "travisetienne");
  assert.equal(nameKey("Ja'Marr Chase"), "jamarrchase");
  assert.equal(nameKey("D.J. Moore"), "djmoore");
  assert.equal(nameKey("Greg Newsome II"), "gregnewsome");
  assert.equal(nameKey("Jacory Croskey-Merritt"), "jacorycroskeymerritt");
  assert.equal(espnIdFromUrl("https://www.espn.com/nfl/player/_/id/4362628/jamarr-chase"), "4362628");
  assert.equal(espnIdFromUrl("https://www.espn.com/nfl/team/_/name/sea"), null);
});

test("compareValues keeps nulls last in both directions", () => {
  const vals = [3, null, 1, 2];
  assert.deepEqual([...vals].sort((a, b) => compareValues(a, b, "asc")), [1, 2, 3, null]);
  assert.deepEqual([...vals].sort((a, b) => compareValues(a, b, "desc")), [3, 2, 1, null]);
  assert.deepEqual(["b", null, "a"].sort((a, b) => compareValues(a, b, "asc")), ["a", "b", null]);
});

test("player filters parse from and serialize to the URL", async () => {
  const { parsePlayerFilters, filtersToQuery, sortHref, playersHref, DEFAULT_FILTERS } = await import("@/lib/players/filters");
  assert.deepEqual(parsePlayerFilters({}, S), DEFAULT_FILTERS);
  assert.equal(filtersToQuery(DEFAULT_FILTERS), "");
  const f = parsePlayerFilters({ pos: "wr", status: "team:abc123", nfl: "kc", health: "injured", rookies: "1", q: " chase ", tf: "week", wk: "3", sort: "stat:rec_yd", page: "2" }, S);
  assert.equal(f.pos, "WR");
  assert.equal(f.status, "team");
  assert.equal(f.owner, "abc123");
  assert.equal(f.nfl, "KC");
  assert.equal(f.q, "chase");
  assert.equal(f.wk, 3);
  assert.equal(f.dir, "desc");
  assert.equal(f.page, 2);
  const again = parsePlayerFilters(Object.fromEntries(new URLSearchParams(filtersToQuery(f).slice(1))), S);
  assert.deepEqual(again, f);
  // invalid values fall back to defaults
  const bad = parsePlayerFilters({ sort: "stat:nope", page: "-4", tf: "x", status: "bogus", nfl: "toolong" }, S);
  assert.equal(bad.sort, "pts");
  assert.equal(bad.page, 1);
  assert.equal(bad.tf, "season");
  assert.equal(bad.status, "all");
  assert.equal(bad.nfl, null);
  // sorting: same column flips, new column takes its default direction; page resets
  assert.equal(sortHref({ ...DEFAULT_FILTERS, page: 3 }, "pts"), "/players?dir=asc");
  assert.equal(sortHref(DEFAULT_FILTERS, "name"), "/players?sort=name");
  assert.equal(playersHref(DEFAULT_FILTERS, { status: "available" }), "/players?status=available");
});

test("practice participation from report notes and stat labels", async () => {
  const { practiceFromText, statLabel } = await import("@/lib/players/logic");
  const { STAT_BY_KEY } = await import("@/lib/settings/stat-catalog");
  assert.equal(practiceFromText("Ferguson (knee/ankle) was listed as a non-participant on Monday's practice estimate."), "DNP");
  assert.equal(practiceFromText("Kincaid (thumb/ankle) was listed as a limited participant on Monday's practice estimate."), "LP");
  assert.equal(practiceFromText("He was a full participant Thursday."), "FP");
  assert.equal(practiceFromText("Coach said he is day-to-day."), null);
  assert.equal(statLabel("rec_yd", STAT_BY_KEY.rec_yd), "Rec Yds");
  assert.equal(statLabel("rush_td", STAT_BY_KEY.rush_td), "Rush TD");
  assert.equal(statLabel("rec", STAT_BY_KEY.rec), "Rec");
  assert.equal(statLabel("rec_tgt", STAT_BY_KEY.rec_tgt), "Tgt");
  assert.equal(statLabel("fgm", STAT_BY_KEY.fgm), "FGM");
});

test("kickoff labels in the league time zone", async () => {
  const { fmtKickoff, fmtWeekday } = await import("@/lib/players/format");
  assert.equal(fmtKickoff("2026-11-29T18:00:00Z", "America/New_York"), "Sun 1:00 PM");
  assert.equal(fmtKickoff("2026-12-20T05:00:00Z", "America/New_York"), "Sun · TBD");
  assert.equal(fmtWeekday("2026-11-25T08:00:00Z", "America/New_York"), "Wed");
});

test("commissioner add freeze, team blocks and FAB-only playoffs", () => {
  const frozen = withSettings({ waivers: { disableAdds: true } });
  const f = acquisitionMode({ settings: frozen, phase: "REGULAR", waiverClearsAt: null, gameStarted: false, now, nextRun: (x) => nextWaiverRun(frozen, x) });
  assert.equal(f.kind, "blocked");
  if (f.kind === "blocked") assert.match(f.reason, /frozen/);
  const b = acquisitionMode({ settings: S, phase: "REGULAR", blockedReason: "Teams eliminated from the playoffs can't add players.", waiverClearsAt: null, gameStarted: false, now, nextRun: runs });
  assert.deepEqual(b, { kind: "blocked", reason: "Teams eliminated from the playoffs can't add players." });
  const fabOnly = withSettings({ waivers: { playoffMode: "FAB_ONLY" } });
  const p = acquisitionMode({ settings: fabOnly, phase: "PLAYOFFS", waiverClearsAt: null, gameStarted: false, now, nextRun: (x) => nextWaiverRun(fabOnly, x) });
  assert.equal(p.kind, "claim");
  if (p.kind === "claim") assert.match(p.reason, /Playoff/);
  // regular season with the same setting: still continuous free agency
  assert.equal(acquisitionMode({ settings: fabOnly, phase: "REGULAR", waiverClearsAt: null, gameStarted: false, now, nextRun: runs }).kind, "add");
});

test("bid increments", () => {
  const five = withSettings({ waivers: { bidIncrement: 5 } });
  assert.equal(bidStep(five), 5);
  assert.equal(bidStep(withSettings({ waivers: { bidIncrement: 0 } })), 1);
  assert.equal(validateBid(five, 10, 50), null);
  assert.equal(validateBid(five, 0, 50), null);
  assert.match(validateBid(five, 7, 50)!, /\$5 increments/);
});

test("re-add cooldown only applies to the team that dropped the player", () => {
  const cd = withSettings({ waivers: { dropCooldownHours: 24 } });
  const dropped = { lastDroppedById: "teamA", lastDroppedAt: new Date(now.getTime() - 5 * 3600_000) };
  assert.equal(readdCooldownUntil(cd, dropped, "teamA", now)?.toISOString(), new Date(dropped.lastDroppedAt.getTime() + 24 * 3600_000).toISOString());
  assert.equal(readdCooldownUntil(cd, dropped, "teamB", now), null);
  assert.equal(readdCooldownUntil(cd, { ...dropped, lastDroppedAt: new Date(now.getTime() - 25 * 3600_000) }, "teamA", now), null);
  assert.equal(readdCooldownUntil(S, dropped, "teamA", now), null); // 0 hours = off
  assert.equal(readdCooldownUntil(cd, null, "teamA", now), null);
});

test("pending-claim limit and undroppable list", () => {
  assert.equal(pendingClaimLimitError(S, 50), null);
  const max2 = withSettings({ waivers: { maxPendingClaims: 2 } });
  assert.equal(pendingClaimLimitError(max2, 1), null);
  assert.match(pendingClaimLimitError(max2, 2)!, /league max 2/);
  const und = withSettings({ waivers: { undroppablePlayerIds: ["4046"] } });
  assert.equal(isUndroppable(und, "4046"), true);
  assert.equal(isUndroppable(und, "6770"), false);
  assert.equal(isUndroppable(S, "4046"), false);
});

test("auction pool: rollover releases are held until the season's auction is complete", () => {
  const release = { type: "KEEPER", details: { deadMoney: [], rolloverRelease: true, fromSeason: 2026, returnTo: "AUCTION_POOL" } };
  assert.equal(isRolloverRelease(release), true);
  assert.equal(isRolloverRelease({ type: "KEEPER", details: { deadMoney: [] } }), false); // a kept player / lock row
  assert.equal(isRolloverRelease({ type: "DROP", details: { rolloverRelease: true } }), false);
  assert.equal(isRolloverRelease({ type: "KEEPER", details: null }), false);

  const pool = withSettings({ keepers: { releasedPlayersReturnTo: "AUCTION_POOL" } });
  const fa = withSettings({ keepers: { releasedPlayersReturnTo: "FREE_AGENCY" } });
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false }), AUCTION_POOL_REASON);
  assert.equal(AUCTION_POOL_REASON, "Returns to the auction pool");
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: true }), null);
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: false }, { auctionComplete: false }), null);
  assert.equal(auctionPoolHold(fa, { releasedAtRollover: true }, { auctionComplete: false }), null);
  assert.match(auctionPoolDetail(2027), /^Returns to the auction pool: .*2027 auction/);
  // an auction is scheduled but not complete: held in every phase
  for (const phase of ["PRESEASON", "REGULAR", "PLAYOFFS"]) {
    assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false, auctionScheduled: true, phase }), AUCTION_POOL_REASON, phase);
  }
  // no auction exists for the season at all: held through the preseason, released once the regular season starts
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false, auctionScheduled: false, phase: "PRESEASON" }), AUCTION_POOL_REASON);
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false, auctionScheduled: false, phase: "KEEPER" }), AUCTION_POOL_REASON);
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false, auctionScheduled: false, phase: "REGULAR" }), null);
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false, auctionScheduled: false, phase: "PLAYOFFS" }), null);
  assert.equal(auctionPoolHold(pool, { releasedAtRollover: true }, { auctionComplete: false, auctionScheduled: false }), AUCTION_POOL_REASON); // phase unknown: strict

  // the hold is a player block: the add becomes blocked with the reason, in every phase
  const base = { settings: withSettings({ waivers: { type: "FREE_FOR_ALL" } }), waiverClearsAt: null, gameStarted: false, now: new Date(), nextRun: () => null };
  for (const phase of ["PRESEASON", "REGULAR", "OFFSEASON"]) {
    assert.deepEqual(acquisitionMode({ ...base, phase, blockedReason: AUCTION_POOL_REASON }), { kind: "blocked", reason: AUCTION_POOL_REASON });
  }
});

test("free agents stay locked after the NFL week rolls over until the waiver run", () => {
  const lastRun = new Date("2026-11-18T08:00:00Z"); // Wed 3am ET before week 11
  const tue = new Date("2026-11-24T15:00:00Z");
  const prev = new Map([["KC", { startTime: new Date("2026-11-22T18:00:00Z"), state: "post" }]]);
  const cur = new Map([["KC", { startTime: new Date("2026-11-29T18:00:00Z"), state: "pre" }]]);
  assert.equal(freeAgentGameLocked("KC", S, cur, prev, tue, lastRun), true);
  // after Wednesday's run the previous week no longer locks him
  const wed = new Date("2026-11-25T15:00:00Z");
  assert.equal(freeAgentGameLocked("KC", S, cur, prev, wed, new Date("2026-11-25T08:00:00Z")), false);
  // without scheduled runs a finished game never locks
  assert.equal(freeAgentGameLocked("KC", S, cur, prev, tue, null), false);
  assert.equal(freeAgentGameLocked(null, S, cur, prev, tue, lastRun), false);
  assert.equal(freeAgentGameLocked("KC", withSettings({ waivers: { lockPlayersAfterGameStart: false } }), cur, prev, tue, lastRun), false);
});
