// Readable rulebook prose generated from the live league settings. Pure + testable.
import type { LeagueSettings } from "@/lib/settings/schema";
import { lastRegularWeek, playoffEndWeek } from "@/lib/commissioner/settings-validate";
import { WEEKDAY_LABELS } from "@/lib/commissioner/settings-meta";
import { STAT_BY_KEY } from "@/lib/settings/stat-catalog";

export interface RulebookContext {
  teamNames: Map<string, string>;
  teamCount: number;
  season: number;
}

const $ = (n: number) => `$${n.toLocaleString()}`;
const plural = (n: number, word: string, pl = `${word}s`) => `${n} ${n === 1 ? word : pl}`;
const hour = (h: number) => (h % 24 === 0 ? "12 AM" : h % 24 === 12 ? "12 PM" : h % 24 < 12 ? `${h % 24} AM` : `${(h % 24) - 12} PM`);
const list = (items: string[], conj = "and") => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`);
const posName = (p: string) => (p === "DEF" ? "DST" : p);

const TB: Record<string, string> = {
  H2H: "head-to-head record",
  POINTS_FOR: "points for",
  DIVISION_RECORD: "division record",
  POINTS_AGAINST: "points against",
  ALL_PLAY: "all-play record",
  COIN_FLIP: "a coin flip",
  BENCH_POINTS: "bench points",
  HIGHER_SEED: "the higher seed",
  HIGHEST_STARTER: "the highest-scoring starter",
  MAX_POTENTIAL_POINTS: "lower max potential points",
};

export function basicsProse(s: LeagueSettings, c: RulebookContext): string[] {
  const g = s.general;
  const out: string[] = [];
  const type = g.leagueType === "DYNASTY" ? "dynasty" : g.leagueType === "KEEPER" ? "keeper" : "redraft";
  const divs = g.divisions.length ? ` split into ${plural(g.divisions.length, "division")} (${list(g.divisions.map((d) => d.name))})` : "";
  out.push(`${g.leagueName} is a ${c.teamCount}-team ${type}${s.salaryCap.enabled ? " salary-cap" : ""} league${divs}.`);
  const end = playoffEndWeek(s.playoffs);
  out.push(
    `The regular season runs Weeks ${g.firstWeek}-${lastRegularWeek(s)}${s.playoffs.teams ? ` and the playoffs run Weeks ${s.playoffs.startWeek}-${end}` : ""}. The champion takes home ${g.championTrophyName}.`,
  );
  out.push(`All deadlines, lineup locks and waiver runs use ${g.timezone.replace(/_/g, " ")} time. Stat corrections count until ${WEEKDAY_LABELS[g.statCorrectionDay]} at ${hour(g.statCorrectionHour)}; later corrections don't change results.`);
  if (g.allowCoManagers) out.push(`Teams may have co-managers (up to ${g.maxManagersPerTeam} per team).`);
  return out;
}

export function rosterProse(s: LeagueSettings): string[] {
  const r = s.roster;
  const starters = r.slots.reduce((a, x) => a + x.count, 0);
  const out: string[] = [];
  out.push(
    `Each team starts ${starters} players and may carry up to ${r.maxActiveRoster} active players (starters + bench)${r.minActiveRoster ? `, with a minimum of ${r.minActiveRoster}` : ""}. IR and taxi spots are in addition to the active roster.${
      r.offseasonMaxActiveRoster ? ` In the offseason the active limit rises to ${r.offseasonMaxActiveRoster}.` : ""
    }`,
  );
  if (r.idpEnabled) out.push("Individual defensive players (DL, LB, DB) are used.");
  if (r.irSlots) {
    const statuses = r.irRequireInjuryStatus ? `players listed as ${list(r.irEligibleStatuses, "or")}` : "any player";
    out.push(
      `Injured reserve: ${plural(r.irSlots, "slot")} for ${statuses}.${r.irCountsAgainstCap ? " IR salaries still count against the cap." : " IR salaries don't count against the cap."}${r.irMinWeeks ? ` Players must stay on IR at least ${plural(r.irMinWeeks, "week")}.` : ""}${
        r.irActivationPolicy === "BLOCK_MOVES" ? " Once a player on IR is healthy, he must be activated before the team can make other moves." : r.irActivationPolicy === "AUTO_BENCH" ? " Healthy IR players move to the bench automatically." : ""
      }`,
    );
  } else out.push("There is no injured reserve.");
  if (r.taxiSlots) {
    const exp = r.taxiMaxYearsExp === 0 ? "rookies" : `players with ${r.taxiMaxYearsExp} or fewer years of NFL experience`;
    const cap = r.taxiCountsAgainstCap ? "full salary counts against the cap" : r.taxiCapPercent ? `${r.taxiCapPercent}% of salary counts against the cap` : "salaries don't count against the cap";
    out.push(
      `Taxi squad: ${plural(r.taxiSlots, "slot")} for ${exp}, for up to ${plural(r.taxiMaxSeasonsOnTaxi, "season")}; ${cap}.${r.taxiDeadlineWeek ? ` Players can be placed on the taxi squad through Week ${r.taxiDeadlineWeek}.` : ""}${
        r.taxiPromotionAllowedInSeason ? " Promotions are allowed during the season" : " Promotions happen in the offseason only"
      }${r.taxiAllowReturnAfterPromotion ? " and promoted players may return." : ", and promoted players can't return."}${r.taxiPoachingAllowed ? ` Other teams may poach taxi players${r.taxiOwnerCanMatchPoach ? " (the owner can block by promoting him)" : ""}.` : " Taxi players can't be poached."}`,
    );
  }
  const limits = Object.entries(r.positionLimits).filter(([, l]) => l.min || l.max !== null);
  if (limits.length) out.push(`Position limits: ${list(limits.map(([p, l]) => `${posName(p)} ${l.min ? `at least ${l.min}` : ""}${l.min && l.max !== null ? ", " : ""}${l.max !== null ? `at most ${l.max}` : ""}`))}.`);
  out.push(
    r.illegalRosterPolicy === "ZERO_POINTS" ? "A team with an illegal roster scores zero until it is fixed." : r.illegalRosterPolicy === "BLOCK_MOVES" ? "A team with an illegal roster can't make other moves until it is fixed." : "The commissioner resolves illegal rosters.",
  );
  return out;
}

export function lineupProse(s: LeagueSettings): string[] {
  const l = s.lineup;
  const lock = l.lockType === "PER_GAME" ? "each player locks at his own kickoff" : l.lockType === "FIRST_GAME_OF_WEEK" ? "the whole lineup locks at the week's first kickoff" : "the whole lineup locks at the first Sunday kickoff (Thursday/Saturday players lock at their own kickoff)";
  const out = [`Lineups: ${lock}${l.lockOffsetMinutes ? `, ${l.lockOffsetMinutes} minutes early` : ""}.${l.allowFutureWeekLineups ? " Lineups can be set for future weeks." : ""}`];
  out.push(l.defaultCarryOver === "PREVIOUS_WEEK" ? "If you don't set a lineup, last week's lineup carries over." : l.defaultCarryOver === "OPTIMAL_PROJECTED" ? "If you don't set a lineup, the best projected lineup is used." : "If you don't set a lineup, your slots stay empty.");
  if (l.bestBall) out.push("Best ball: your highest-scoring lineup is selected automatically after the games.");
  if (l.autoSubOutPlayers) out.push(`Starters ruled OUT are auto-subbed by the best eligible bench player${l.autoSubsMaxPerWeek ? ` (up to ${l.autoSubsMaxPerWeek} per week)` : ""}${l.autoSubRequireLaterKickoff ? " who plays later" : ""}.`);
  if (l.emptySlotPenalty) out.push(`Each empty starting slot costs ${l.emptySlotPenalty} points.`);
  if (s.niche.minimumStartersOrForfeit) out.push(`Teams starting fewer than ${s.niche.minimumStartersOrForfeit} players forfeit the week.`);
  return out;
}

export function scoringProse(s: LeagueSettings): string[] {
  const sc = s.scoring;
  const preset = sc.preset === "HALF_PPR" ? "half-point-per-reception" : sc.preset === "STANDARD" ? "standard (no PPR)" : sc.preset === "PPR" ? "full point-per-reception" : "custom";
  const out = [`Scoring is ${preset}, shown to ${plural(sc.decimals, "decimal place")}${sc.roundToDecimals ? " (player totals are rounded)" : ""}.`];
  const overrides = Object.entries(sc.positionOverrides).flatMap(([p, m]) =>
    Object.entries(m).map(([k, v]) => `${posName(p)} ${(STAT_BY_KEY[k]?.label ?? k.replace(/_/g, " ")).toLowerCase()} ${v} (base ${sc.rules[k] ?? 0})`),
  );
  if (overrides.length) out.push(`Position-specific scoring: ${list(overrides)}.`);
  if (sc.bonuses.length) out.push(`${plural(sc.bonuses.length, "milestone bonus", "milestone bonuses")} apply (see below).`);
  if (sc.longTdBonuses.length) out.push(`Long touchdowns earn extra points: ${list(sc.longTdBonuses.map((b) => `${b.minYards}+ yards +${b.points}`))}.`);
  out.push(sc.useFieldGoalDistance ? "Field goals are scored by distance." : `Every made field goal is worth ${sc.rules.fgm ?? 0} points.`);
  if (sc.negativePointsFloor !== null) out.push(`A player can't score below ${sc.negativePointsFloor} points in a game.`);
  return out;
}

export function matchupProse(s: LeagueSettings): string[] {
  const m = s.matchups;
  const fmt = m.format === "H2H" ? "head-to-head" : m.format === "H2H_PLUS_MEDIAN" ? "head-to-head plus a weekly game against the league median" : m.format === "ALL_PLAY" ? "all-play (every team plays every team each week)" : "total points";
  const tie = m.tiebreaker === "NONE" ? " Regular season ties stand." : ` Tied games go to ${m.tiebreaker === "HOME_TEAM" ? "the home team" : TB[m.tiebreaker]}.`;
  const out = [`Matchups are ${fmt}.${tie}`];
  if (s.niche.medianGameEachWeek && m.format !== "H2H_PLUS_MEDIAN") out.push("Every team also plays the league median score each week.");
  out.push(
    `The schedule is ${m.scheduleType === "DIVISION_WEIGHTED" ? "division-weighted" : m.scheduleType === "MANUAL" ? "set by the commissioner" : "a round robin"}${m.divisionGamesTwice || m.scheduleType === "DIVISION_WEIGHTED" ? `, with extra division games${m.divisionGamesLate ? " late in the season" : ""}` : ""}.`,
  );
  if (m.rivalryWeek && m.rivalries.length) out.push(`Rivalry week is Week ${m.rivalryWeek}.`);
  out.push(`Standings tiebreakers: ${list(s.standings.tiebreakers.map((t) => TB[t]), "then")}. Division tiebreakers: ${list(s.standings.divisionTiebreakers.map((t) => TB[t]), "then")}.`);
  return out;
}

export function playoffProse(s: LeagueSettings, c: RulebookContext): string[] {
  const p = s.playoffs;
  if (!p.teams) return ["There are no playoffs: the regular season champion wins the league."];
  const end = playoffEndWeek(p);
  const out = [
    `${p.teams} of ${c.teamCount} teams make the playoffs (Weeks ${p.startWeek}-${end})${p.byes ? `; the top ${plural(p.byes, "seed")} get a first-round bye` : ""}. Seeds are set by ${p.seeding === "RECORD" ? "record" : "total points"}${
      p.divisionWinnersQualify ? ", every division winner qualifies" : ""
    }${s.standings.divisionWinnersTopSeeds ? ", division winners are seeded first" : ""}${p.wildcardsByPoints ? `, and the last ${plural(p.wildcardsByPoints, "spot")} go to the highest scorers not already in` : ""}.`,
  ];
  out.push(`${p.weeksPerRound === 2 ? "Each round is two weeks (scores combined). " : ""}${p.championshipWeeks === 2 ? "The championship is a two-week total. " : ""}${p.reseed ? "Teams are re-seeded each round. " : ""}Tied playoff games go to ${list(s.standings.playoffMatchupTiebreakers.map((t) => TB[t]), "then")}.`);
  const extras: string[] = [];
  if (p.thirdPlaceGame) extras.push("a third-place game");
  if (p.placementGames.includes("FIFTH")) extras.push("a fifth-place game");
  if (p.placementGames.includes("SEVENTH")) extras.push("a seventh-place game");
  if (p.consolationBracket) extras.push("a consolation bracket");
  if (p.toiletBowl) extras.push("a toilet bowl (the loser advances)");
  if (extras.length) out.push(`There is also ${list(extras)}${p.consolationStakes !== "NONE" ? `, played for ${p.consolationStakes === "ROOKIE_PICK" ? "rookie draft position" : p.consolationStakes === "PUNISHMENT" ? "avoiding the last-place punishment" : "a FAB bonus"}` : ""}.`);
  if (p.lockRostersInPlayoffs) out.push("Rosters lock once the playoffs begin.");
  return out;
}

export function capProse(s: LeagueSettings): string[] {
  const c = s.salaryCap;
  if (!c.enabled) return ["There is no salary cap."];
  const out = [
    `Every team has a ${c.capType === "SOFT" ? "soft" : "hard"} salary cap of ${$(c.cap)}${c.floor ? ` and a floor of ${$(c.floor)}` : ""}. Salaries range from ${$(c.minSalary)}${c.maxSalary !== null ? ` to ${$(c.maxSalary)}` : " up"}.${c.annualCapIncrease ? ` The cap grows by ${$(c.annualCapIncrease)} each season.` : ""}`,
  ];
  if (c.capType === "SOFT") out.push(`Going over the cap${c.softCapMaxOverage !== null ? ` (by up to ${$(c.softCapMaxOverage)})` : ""} costs a ${c.luxuryTaxRate}× luxury tax, paid as ${c.luxuryTaxPaidAs === "NEXT_YEAR_CAP" ? "less cap room next season" : c.luxuryTaxPaidAs === "FAAB" ? "FAB" : "real money"}.`);
  out.push(
    `${c.enforceInSeason ? "In season, moves that would put a team over the cap are blocked." : "The cap isn't enforced during the season."} ${
      c.offseasonEnforcement === "ALLOW_UNTIL_COMPLIANCE_DATE" ? "In the offseason teams may be over the cap until the compliance deadline." : c.offseasonEnforcement === "WARN_ONLY" ? "In the offseason the cap is advisory." : "Over-cap moves are blocked in the offseason too."
    }`,
  );
  if (c.emptyRosterSpotCharge) out.push(`Each empty active-roster spot is charged ${$(c.emptyRosterSpotCharge)} against the cap.`);
  if (c.rolloverMode !== "NONE") out.push(`Unused cap room rolls over (${c.rolloverMode === "FULL_UNUSED" ? "all of it" : `${c.rolloverPercent}%`}${c.rolloverMax !== null ? `, up to ${$(c.rolloverMax)}` : ""}).`);
  const d = c.deadMoney;
  if (d.enabled) {
    out.push(
      `Dead money: cutting a player leaves ${d.currentSeasonPercent}% of his salary on this season's cap${d.futureSeasonPercent ? ` and ${d.futureSeasonPercent}% for each remaining contract year` : ""}. Minimum-salary players can be cut for free${
        d.rookieContractsExempt ? ", as can players on rookie contracts" : ""
      }${d.waivedInSeasonBeforeWeek ? `, and cuts before Week ${d.waivedInSeasonBeforeWeek} carry no penalty` : ""}.${d.forgivenIfClaimed ? " The penalty is forgiven if another team claims the player." : ""}${d.retirementForgives ? " Retirements wipe the remaining years." : ""}${
        d.amnestyCutsPerTeam ? ` Each team gets ${plural(d.amnestyCutsPerTeam, "amnesty cut")} with no penalty.` : ""
      }`,
    );
  } else out.push("Cut players carry no dead money.");
  return out;
}

export function contractProse(s: LeagueSettings): string[] {
  const c = s.contracts;
  const out: string[] = [];
  if (!c.enabled) out.push("Players don't carry multi-year contracts.");
  else {
    out.push(`Contracts run ${c.minYears}-${c.maxYears} years (including the current season). Free agents sign ${plural(c.defaultFreeAgentYears, "year")} deals; in-season pickups can sign for at most ${plural(c.inSeasonPickupMaxYears, "year")}.${c.annualRaisePercent ? ` Salaries rise ${c.annualRaisePercent}% each season of a contract.` : " Salaries stay flat over a contract."}`);
    if (c.lengthLimits.length) out.push(`Long-contract limits: ${list(c.lengthLimits.map((l) => `at most ${l.maxCount} of ${l.years}+ years`))}.`);
    if (c.extensionsAllowed) out.push(`Extensions add up to ${plural(c.extensionMaxYearsAdded, "year")} at a ${c.extensionRaisePercent}% raise per year (${c.extensionWindow === "ANY_TIME" ? "any time" : c.extensionWindow === "ANY_OFFSEASON" ? "any offseason" : "in the offseason before the final year"}${c.extensionsPerTeamPerSeason !== null ? `, ${c.extensionsPerTeamPerSeason} per team per season` : ""}).`);
    out.push(c.expiredContractsBecome === "RFA" ? `Expiring players become restricted free agents; the owner has ${c.rfaMatchWindowHours} hours to match the winning bid.` : "Expiring players become free agents.");
  }
  const t = c.franchiseTag;
  if (t.enabled) out.push(`Franchise tag: ${plural(t.perTeam, "tag")} per team per season on ${t.eligibility === "EXPIRING_ONLY" ? "expiring contracts" : "any player"}, for ${plural(t.years, "year")}, costing ${t.costMethod === "TOP5_AVG_AT_POSITION" ? `the average of the top ${t.topN} salaries at his position (at least a ${t.raisePercent}% raise)` : `his salary plus ${t.raisePercent}%`}. A repeat tag costs ${t.consecutiveMultiplier}× (max ${t.maxConsecutive} in a row).`);
  out.push(`Drafted rookies sign ${plural(c.rookieContractYears, "year")} contracts on the rookie scale below${c.rookieFourthYearOption ? `, with an option year (+${c.rookieOptionRaisePercent}%) for round ${list(c.rookieOptionRounds.map(String), "and")} picks` : ""}. Undrafted rookies sign for ${c.undraftedRookieSalary !== null ? $(c.undraftedRookieSalary) : "the league minimum"}.`);
  return out;
}

export function keeperProse(s: LeagueSettings): string[] {
  const k = s.keepers;
  if (!k.enabled) return ["There are no keeper designations: every rostered player carries over with his contract."];
  const out = [
    `${k.selectionBy === "COMMISSIONER" ? "The commissioner designates" : "Managers designate"} keepers each offseason${k.maxKeepers !== null ? ` (up to ${k.maxKeepers}${k.minKeepers ? `, at least ${k.minKeepers}` : ""})` : k.minKeepers ? ` (at least ${k.minKeepers})` : " with no limit"}${k.rookiesCountTowardLimit ? "" : "; rookie contracts don't count toward the limit"}.`,
  ];
  if (k.escalation.type !== "NONE") out.push(`A kept player's salary rises ${k.escalation.type === "PERCENT" ? `${k.escalation.value}%` : $(k.escalation.value)} (at least ${$(k.escalation.minIncrease)}).`);
  if (k.maxYearsKept !== null) out.push(`A player can be kept at most ${plural(k.maxYearsKept, "season")}.`);
  out.push(`Released players go to the ${k.releasedPlayersReturnTo === "AUCTION_POOL" ? "next salary auction" : "free agent pool"}.${k.mustBeCapCompliant ? " Keepers must fit under next season's cap." : ""}`);
  return out;
}

export function waiverProse(s: LeagueSettings): string[] {
  const w = s.waivers;
  const days = list(w.processDays.map((d) => WEEKDAY_LABELS[d]));
  const out: string[] = [];
  if (w.type === "FAB") out.push(`Waivers use a free agent budget (FAB): every team gets ${$(w.faabBudget)} per season and bids blind. Minimum bid ${$(w.allowZeroBids ? w.minBid : Math.max(1, w.minBid))}${w.bidIncrement > 1 ? `, in ${$(w.bidIncrement)} steps` : ""}; ties go to ${w.tiebreaker === "PRIORITY" ? "waiver priority" : w.tiebreaker === "WORST_RECORD" ? "the worse record" : "the earliest claim"}.`);
  else if (w.type === "PRIORITY") out.push(`Waivers use a ${w.priorityType === "ROLLING" ? "rolling priority order (a successful claim moves you to the back)" : "priority order reset weekly by reverse standings"}.`);
  else out.push("There are no waivers: free agents are first come, first served.");
  if (w.type !== "FREE_FOR_ALL") out.push(`Claims process ${days} at ${hour(w.processHour)}. Dropped players stay on waivers ${plural(w.waiverPeriodHours, "hour")}${w.continuousFreeAgency ? "; after that they can be added instantly" : ""}.${w.lockPlayersAfterGameStart ? " Players lock once their game starts." : ""}`);
  out.push(`Pickups sign ${plural(w.signedContractYears, "year")} contracts${w.salaryEqualsBid ? ` with a salary equal to the winning bid${w.salaryMultiplier !== 1 ? ` × ${w.salaryMultiplier}` : ""} (at least the league minimum)` : " at the league minimum salary"}.`);
  const limits: string[] = [];
  if (w.maxAcquisitionsPerWeek !== null) limits.push(`${w.maxAcquisitionsPerWeek} per week`);
  if (w.maxAcquisitionsPerSeason !== null) limits.push(`${w.maxAcquisitionsPerSeason} per season`);
  if (limits.length) out.push(`Acquisition limits: ${list(limits)}.`);
  if (w.faabRollover) out.push("Unused FAB rolls over to next season.");
  if (w.weeklyFaabAllowance) out.push(`Every team earns ${$(w.weeklyFaabAllowance)} of FAB each week.`);
  if (w.disableAdds) out.push("Adds are currently frozen by the commissioner.");
  return out;
}

export function tradeProse(s: LeagueSettings, c: RulebookContext): string[] {
  const t = s.trades;
  if (!t.enabled) return ["Trading is turned off."];
  const review = t.reviewType === "NONE" ? "Accepted trades process immediately." : t.reviewType === "COMMISSIONER" ? `Accepted trades wait up to ${plural(t.reviewPeriodHours, "hour")} for commissioner approval.` : `Accepted trades go to a ${plural(t.reviewPeriodHours, "hour")} league vote; ${t.vetoVotesRequired} veto votes (of ${Math.max(1, c.teamCount - 2)} eligible teams) overturn a trade.`;
  const out = [`${t.deadlineWeek !== null ? `The trade deadline is Week ${t.deadlineWeek}.` : "There is no trade deadline."} ${review}`];
  const assets: string[] = ["players"];
  if (t.allowDraftPickTrading) assets.push(`rookie draft picks (${plural(t.futurePickYears, "season")} out)`);
  if (t.allowFaabTrading && s.waivers.faabTradable) assets.push("FAB");
  if (s.salaryCap.allowCapSpaceTrading) assets.push("cap space");
  out.push(`Tradable assets: ${list(assets)}.${t.requireCapCompliance && s.salaryCap.enabled ? " Every team must be cap-compliant after the trade." : ""}${t.allowMultiTeamTrades ? ` Trades can include up to ${t.maxTeamsPerTrade} teams.` : ""}`);
  out.push(`Offers expire after ${plural(t.offerExpirationHours, "hour")}.${t.allowDuringPlayoffs ? "" : " No trades during the playoffs."}${t.allowOffseasonTrades ? " Trading is open all offseason." : ""}${t.tradeBackCooldownDays ? ` A player can't be traded back to his old team for ${plural(t.tradeBackCooldownDays, "day")}.` : ""}`);
  return out;
}

export function draftProse(s: LeagueSettings): string[] {
  const r = s.draft.rookie;
  const a = s.draft.auction;
  const order =
    r.orderMethod === "REVERSE_STANDINGS"
      ? "reverse order of the final standings"
      : r.orderMethod === "REVERSE_MAX_PF"
        ? "reverse order of max potential points"
        : r.orderMethod === "REVERSE_POTENTIAL_POINTS"
          ? "reverse order of potential points"
          : `a lottery among the ${r.lottery.teams} non-playoff teams${r.lottery.picksDrawn ? ` (the first ${r.lottery.picksDrawn} picks are drawn)` : ""}`;
  const out = [
    `The rookie draft is ${plural(r.rounds, "round")}, ${r.style === "SNAKE" ? "snake" : "linear"}, in ${order}${r.playoffTeamsByFinish ? "; playoff teams pick in reverse order of playoff finish" : ""}. ${r.eligibility === "ROOKIES_ONLY" ? "Only rookies are eligible." : "Rookies and free agents are eligible."} The clock is ${plural(r.pickTimerMinutes, "minute")} per pick${r.overnightPause ? ` (paused ${hour(r.pauseStartHour)}-${hour(r.pauseEndHour)})` : ""}; ${r.onTimeout === "AUTOPICK" ? "expired picks are made automatically" : "expired picks can be made later"}.`,
  ];
  out.push(`The salary auction gives each team ${$(a.budget)} to fill ${a.rosterSpotsToFill} spots: minimum bid ${$(a.minBid)}, raises of ${$(a.bidIncrement)}, ${a.bidSeconds}-second bid clock (resets to ${a.resetSecondsOnBid}s on each bid). ${a.contractYearsMode === "WINNER_CHOOSES" ? "The winning bidder chooses the contract length." : `Auction contracts are ${plural(a.fixedContractYears, "year")}.`}`);
  return out;
}

export function nicheProse(s: LeagueSettings): string[] {
  const n = s.niche;
  const out: string[] = [];
  if (n.weeklyHighScoreBonusWin) out.push("The week's top scorer earns an extra win.");
  if (n.weeklyHighScorePrize) out.push(`The week's top score wins ${$(n.weeklyHighScorePrize)}.`);
  if (n.reverseScoringWeek) out.push(`Week ${n.reverseScoringWeek} is reverse scoring: the lowest score wins.`);
  if (n.chaosWeek) out.push(`Week ${n.chaosWeek} is chaos week${n.chaosWeekRule ? `: ${n.chaosWeekRule}` : ""}.`);
  if (n.guillotine) out.push(`Guillotine: the lowest scorer${n.guillotineEliminatedPerWeek > 1 ? `s (${n.guillotineEliminatedPerWeek})` : ""} each week is eliminated.`);
  if (n.tacoTrophy) out.push(`Last place (decided by ${n.lastPlaceDeterminedBy === "TOILET_BOWL_LOSER" ? "the toilet bowl" : n.lastPlaceDeterminedBy === "POINTS_FOR" ? "fewest points" : "regular season record"}) earns ${n.lastPlaceTrophyName}.`);
  if (n.lastPlacePunishment) out.push(`Last-place punishment: ${n.lastPlacePunishment}`);
  if (n.tankingProtection) out.push("Knowingly starting inactive players to tank can be penalized by the commissioner.");
  if (n.emptyStarterFine) out.push(`Each empty starting slot costs a ${$(n.emptyStarterFine)} fine.`);
  if (n.survivorPoolEnabled) out.push("A survivor pool runs alongside the league.");
  if (n.pickemEnabled) out.push("An NFL pick'em side game runs every week.");
  if (n.bountyEnabled) out.push(`Bounties: ${n.bountyDescription || "see the commissioner"}.`);
  return out;
}
