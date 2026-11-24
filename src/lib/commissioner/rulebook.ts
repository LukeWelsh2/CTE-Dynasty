// Readable rulebook prose generated from the live league settings. Pure + testable.
//
// Every sentence describes what the site actually does with a setting (the code paths are named next to each rule),
// so the published rulebook never promises a rule nothing applies. Settings flagged `notEnforced` in the catalog
// (settings-meta.ts) are left out; option values that aren't applied yet are described by what really happens.
import type { LeagueSettings } from "@/lib/settings/schema";
import { lastRegularWeek, playoffEndWeek } from "@/lib/commissioner/settings-validate";
import { WEEKDAY_LABELS } from "@/lib/commissioner/settings-meta";
import { STAT_BY_KEY } from "@/lib/settings/stat-catalog";
import { tiebreakChain, type TieBreak } from "@/lib/scoreboard-rules";

export interface RulebookContext {
  teamNames: Map<string, string>;
  teamCount: number;
  season: number;
}

const $ = (n: number) => `$${n.toLocaleString()}`;
const plural = (n: number, word: string, pl = `${word}s`) => `${n} ${n === 1 ? word : pl}`;
const hour = (h: number) => (h % 24 === 0 ? "12 AM" : h % 24 === 12 ? "12 PM" : h % 24 < 12 ? `${h % 24} AM` : `${(h % 24) - 12} PM`);
const list = (items: string[], conj = "and") => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ${conj} ${items[items.length - 1]}`);
/** "a, then b, then c" */
const chainText = (items: string[]) => items.join(", then ");
const posName = (p: string) => (p === "DEF" ? "DST" : p);

/** standings.tiebreakers / divisionTiebreakers (@/lib/standings stepValues) */
const STANDINGS_TB: Record<string, string> = {
  H2H: "head-to-head record",
  POINTS_FOR: "points for",
  DIVISION_RECORD: "division record",
  POINTS_AGAINST: "more points against",
  ALL_PLAY: "all-play record",
  COIN_FLIP: "a coin flip drawn once per season",
};
/** matchup tiebreak chain (@/lib/scoreboard-rules decideWinner) */
const MATCHUP_TB: Record<TieBreak, string> = {
  BENCH_POINTS: "the team with more bench points",
  HIGHEST_STARTER: "the team with the highest-scoring starter",
  HOME_TEAM: "the home team",
};
/** standings.playoffMatchupTiebreakers (@/lib/playoffs/structure resolvePlayoffTie) */
const PLAYOFF_TB: Record<string, string> = {
  BENCH_POINTS: "more bench points",
  HIGHER_SEED: "the higher seed",
  HIGHEST_STARTER: "the highest-scoring starter",
  COIN_FLIP: "a coin flip",
};
/** standings.draftOrderTiebreakers (@/lib/draft/logic draftTiebreakCompare: the listed side picks first) */
const DRAFT_TB: Record<string, string> = {
  MAX_POTENTIAL_POINTS: "lower max potential points",
  POINTS_FOR: "fewer points for",
  POINTS_AGAINST: "more points against",
  COIN_FLIP: "a coin flip",
};
const TAXI_SOURCES: Record<string, string> = { ROOKIE_DRAFT: "the rookie draft", AUCTION: "the salary auction", WAIVERS: "waivers", FREE_AGENCY: "free agency", TRADE: "trades" };
const AUTOPICK: Record<string, string> = {
  BIG_BOARD: "the team's queue, then its big board, then the league rookie rankings, then ADP",
  LEAGUE_RANKINGS: "the team's queue, then the league rookie rankings, then ADP",
  ADP: "the team's queue, then ADP",
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
  // league-refresh.ts + stat-corrections.ts: the daily re-score of last week stops at the cutoff
  out.push(
    `All deadlines, lineup locks and waiver runs use ${g.timezone.replace(/_/g, " ")} time. Stat corrections count until the first ${WEEKDAY_LABELS[g.statCorrectionDay]} at ${hour(g.statCorrectionHour)} that is at least 12 hours after a week's last kickoff; after that the week's results are final${
      s.commissioner.canEditPastScores ? " unless the commissioner re-scores it (logged as an override)" : ""
    }.`,
  );
  // general.allowCoManagers / maxManagersPerTeam / showInactiveTeams aren't stated: nothing applies them yet.
  return out;
}

export function rosterProse(s: LeagueSettings): string[] {
  const r = s.roster;
  const starters = r.slots.reduce((a, x) => a + x.count, 0);
  const out: string[] = [];
  // roster-rules.ts activeRosterLimit: the one limit adds (players/actions), waiver claims (waivers/logic + process),
  // trades (trades/rules), the auction (draft/auction), IR / taxi moves (team/roster-rules) and commissioner tools use
  const offseason =
    r.offseasonMaxActiveRoster !== null && r.offseasonMaxActiveRoster > r.maxActiveRoster
      ? ` Outside the regular season and playoffs${r.rosterCutdownDate ? " (until the roster cutdown deadline)" : ""}, the limit is ${r.offseasonMaxActiveRoster} active players for every move: adds, waiver claims, trades, the salary auction, IR activations and taxi promotions.`
      : "";
  out.push(
    `Each team starts ${starters} players and may carry up to ${r.maxActiveRoster} active players (starters + bench)${
      r.minActiveRoster ? `, with a minimum of ${r.minActiveRoster} (an active player can't be dropped below it)` : ""
    }. IR and taxi spots are in addition to the active roster.${offseason}`,
  );
  if (r.idpEnabled) out.push("Individual defensive players (DL, LB, DB) are used.");
  if (r.irSlots) {
    const statuses = r.irRequireInjuryStatus ? `players listed as ${list(r.irEligibleStatuses, "or")}` : "any player";
    out.push(
      `Injured reserve: ${plural(r.irSlots, "slot")} for ${statuses}.${r.irCountsAgainstCap ? " IR salaries still count against the cap." : " IR salaries don't count against the cap."}${
        r.irMinWeeks ? ` During the season a player must stay on IR at least ${plural(r.irMinWeeks, "week")}.` : ""
      }${r.irAllowInOffseason ? "" : " IR isn't available in the offseason."}${
        r.irActivationPolicy === "BLOCK_MOVES"
          ? " Once a player on IR is healthy, his team can't make other IR or taxi moves until he is activated or dropped."
          : r.irActivationPolicy === "AUTO_BENCH"
            ? " Managers are alerted when a player on IR is healthy again so they can activate him."
            : ""
      }`,
    );
  } else out.push("There is no injured reserve.");
  if (r.taxiSlots) {
    const exp = r.taxiMaxYearsExp === 0 ? "rookies" : `players with ${r.taxiMaxYearsExp} or fewer years of NFL experience`;
    const cap = r.taxiCountsAgainstCap ? "full salary counts against the cap" : r.taxiCapPercent ? `${r.taxiCapPercent}% of salary counts against the cap` : "salaries don't count against the cap";
    const sources = r.taxiAddSources.filter((x) => TAXI_SOURCES[x]);
    const from =
      sources.length >= Object.keys(TAXI_SOURCES).length
        ? ""
        : sources.length
          ? ` Only players acquired through ${list(sources.map((x) => TAXI_SOURCES[x]), "or")} can join it.`
          : " Players can't be placed on it.";
    out.push(
      `Taxi squad: ${plural(r.taxiSlots, "slot")} for ${exp}; ${cap}.${from}${r.taxiDeadlineWeek ? ` New taxi placements close at Week ${r.taxiDeadlineWeek}'s first kickoff.` : ""}${
        r.taxiPromotionAllowedInSeason ? " Promotions are allowed during the season" : " Promotions happen in the offseason only"
      }${r.taxiAllowReturnAfterPromotion ? " and promoted players may return." : ", and promoted players can't return."}${
        r.taxiPlayersCanStart ? " Taxi players can be started." : " Taxi players can't be started."
      } Players who outgrow the experience limit move to the active roster at the season rollover.`,
    );
  }
  // roster.ts rosterLimitProblems enforces maximums; minimums are only flagged on Commissioner Home
  const limits = Object.entries(r.positionLimits).filter(([, l]) => l.min || l.max !== null);
  if (limits.length) {
    const hasMin = limits.some(([, l]) => l.min);
    out.push(
      `Position limits (whole roster, IR and taxi included): ${list(
        limits.map(([p, l]) => `${posName(p)} ${l.min ? `at least ${l.min}` : ""}${l.min && l.max !== null ? ", " : ""}${l.max !== null ? `at most ${l.max}` : ""}`),
      )}.${hasMin ? " Maximums are enforced on every move; the commissioner checks the minimums." : ""}`,
    );
  }
  // scoreboard.ts zeroPointTeams; BLOCK_MOVES isn't applied yet, so it reads like COMMISSIONER
  out.push(
    `Adds, claims and roster moves that would break a roster limit are refused. ${
      r.illegalRosterPolicy === "ZERO_POINTS"
        ? "A team that is over a roster limit (active roster, IR, taxi or a position maximum) at any time while a week is being played scores zero points that week."
        : "The commissioner resolves rosters that end up over a limit."
    }`,
  );
  return out;
}

export function lineupProse(s: LeagueSettings): string[] {
  const l = s.lineup;
  const off = Math.max(0, l.lockOffsetMinutes ?? 0);
  // lineup.ts isLocked: the offset applies to every lock type
  const at = (what: string) => (off ? `${plural(off, "minute")} before ${what}` : `at ${what}`);
  const lock =
    l.lockType === "PER_GAME"
      ? `each player locks ${at("his own kickoff")}`
      : l.lockType === "FIRST_GAME_OF_WEEK"
        ? `the whole lineup locks ${at("the week's first kickoff")}`
        : `the whole lineup locks ${at("the first Sunday kickoff")} (Thursday and Saturday players lock ${at("their own kickoff")})`;
  const out = [`Lineups: ${lock}.${l.allowFutureWeekLineups ? " Lineups can be set for future weeks." : ""}`];
  // lineup.ts getLineup (a week's lineup is created on first view) + saveLineup (a change also rewrites later weeks
  // that still match the replaced lineup)
  out.push(
    `${
      l.defaultCarryOver === "PREVIOUS_WEEK"
        ? "Each week starts with your previous lineup (players who can no longer start are removed) until you change it, and a lineup change carries into later weeks you haven't changed."
        : `${
            l.defaultCarryOver === "OPTIMAL_PROJECTED" ? "Each week starts with your best projected lineup until you change it." : "Each week starts with empty starting slots until you set your lineup."
          } A lineup change also updates any later week that still shows the lineup you replaced.`
    }${l.defaultCarryOver === "OPTIMAL_PROJECTED" ? "" : " Your first lineup of the season is filled automatically with your best projected lineup."}${
      s.roster.allowEmptyStarterSlots ? "" : " A lineup can't leave a starting slot empty while an eligible, unlocked bench player could fill it."
    }`,
  );
  // scoreboard.ts buildTeamWeekScore
  if (l.bestBall) out.push("Best ball: your starters are your best possible lineup from actual points, chosen automatically after the games (live projections while games are in progress); saved lineups don't count.");
  else if (l.autoSubOutPlayers)
    out.push(
      `Auto-subs: a starter who doesn't play (ruled out — Out, IR, PUP, suspended or not active — or his game ends without a stat line) is replaced by the highest-scoring eligible bench player who plays${
        l.autoSubRequireLaterKickoff ? " and kicks off later" : ""
      }${l.autoSubsMaxPerWeek ? `, up to ${plural(l.autoSubsMaxPerWeek, "sub")} per week` : ""}. Starters on bye and empty slots aren't filled.`,
    );
  if (l.emptySlotPenalty) out.push(`Each empty starting slot costs ${l.emptySlotPenalty} points.`);
  // scoreboard.ts refreshWeekMatchups + scoreboard-rules playingStarters; the playoff bracket (playoffs/bracket.ts
  // bracketGames) advances the higher score, so the forfeit only decides regular season results
  if (s.niche.minimumStartersOrForfeit)
    out.push(
      `A team with fewer than ${s.niche.minimumStartersOrForfeit} starters who play (empty slots and starters on bye, ruled out or without a stat line don't count; auto-subs do) loses its regular season matchup whatever the score; if both teams fall short, the score decides.`,
    );
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

/** The standings tiebreaker sentence (@/lib/standings rankTeams / rankLeague). */
export function standingsTiebreakProse(s: LeagueSettings): string {
  const chain = s.standings.tiebreakers;
  const tail = ["POINTS_FOR", "COIN_FLIP"].filter((t) => !(chain as readonly string[]).includes(t));
  const div = s.standings.divisionTiebreakers.length ? s.standings.divisionTiebreakers : chain;
  const bonus = s.niche.medianGameEachWeek || s.matchups.format === "H2H_PLUS_MEDIAN" || s.niche.weeklyHighScoreBonusWin;
  return [
    `Standings rank teams by win percentage (a tie counts as half a win${bonus ? "; median-game and high-score bonus results count too" : ""}).`,
    chain.length ? `Standings tiebreakers: ${chainText(chain.map((t) => STANDINGS_TB[t] ?? t))}.` : "",
    "Ties among three or more teams are broken as a group: head-to-head uses the record in games among the tied teams when they all met equally often (otherwise only a clean sweep counts); once a step separates teams, the teams still tied start the list again.",
    tail.length ? `${chain.length ? "Last resort" : "Teams with the same win percentage are ranked by"}: ${chainText(tail.map((t) => STANDINGS_TB[t]))}.` : "",
    s.general.divisions.length ? `Division ranks use ${chainText([...div.map((t) => STANDINGS_TB[t] ?? t), "the overall standings order"])}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function matchupProse(s: LeagueSettings, c?: RulebookContext): string[] {
  const m = s.matchups;
  // standings.ts counts head-to-head results (+ the median game); ALL_PLAY / POINTS_ONLY aren't applied yet
  const median = s.niche.medianGameEachWeek || m.format === "H2H_PLUS_MEDIAN";
  const out = [
    `Matchups are head-to-head${median ? ", plus a weekly game against the league median: a score above the week's median is an extra win, below it an extra loss" : ""}.`,
  ];
  // scoreboard-rules.ts tiebreakChain (regular season)
  const chain = tiebreakChain(s);
  out.push(
    chain.length
      ? `A tied regular season matchup goes to ${chainText(chain.map((t) => MATCHUP_TB[t]))}${m.allowTies && !chain.includes("HOME_TEAM") ? "; if still level, it stays a tie" : ""}.`
      : "Tied regular season matchups stay ties.",
  );
  if (c && c.teamCount % 2 === 1) out.push("With an odd number of teams, one team has a bye each week (no result).");
  out.push(
    `The schedule is ${m.scheduleType === "DIVISION_WEIGHTED" ? "division-weighted" : m.scheduleType === "MANUAL" ? "set by the commissioner" : "a round robin"}${m.divisionGamesTwice || m.scheduleType === "DIVISION_WEIGHTED" ? `, with extra division games${m.divisionGamesLate ? " late in the season" : ""}` : ""}.`,
  );
  if (m.rivalryWeek && m.rivalries.length) out.push(`Rivalry week is Week ${m.rivalryWeek}.`);
  out.push(standingsTiebreakProse(s));
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
  // playoffs/bracket.ts resolveTies → structure.ts resolvePlayoffTie (falls back to the higher seed)
  const tb = s.standings.playoffMatchupTiebreakers;
  const multiWeek = p.weeksPerRound === 2 || p.championshipWeeks === 2;
  const settles = tb.includes("HIGHER_SEED") || tb.includes("COIN_FLIP");
  out.push(
    `${p.weeksPerRound === 2 ? "Each round is two weeks (scores combined). " : ""}${p.championshipWeeks === 2 ? "The championship is a two-week total. " : ""}${p.reseed ? "Teams are re-seeded each round. " : ""}Playoff games never end in a tie: a tied game${
      multiWeek ? " (combined score)" : ""
    } goes to ${chainText([...tb.map((t) => PLAYOFF_TB[t]), ...(settles ? [] : ["the higher seed"])])}.`,
  );
  const extras: string[] = [];
  if (p.thirdPlaceGame) extras.push("a third-place game");
  if (p.placementGames.includes("FIFTH")) extras.push("a fifth-place game");
  if (p.placementGames.includes("SEVENTH")) extras.push("a seventh-place game");
  if (p.consolationBracket) extras.push("a consolation bracket");
  if (p.toiletBowl) extras.push("a toilet bowl (the loser advances)");
  // bracket.ts bracketGames: the higher (combined) score advances; scoreboard forfeits and reverse scoring don't apply
  const n = s.niche;
  const reverseInPlayoffs = n.reverseScoringWeek !== null && n.reverseScoringWeek >= p.startWeek && n.reverseScoringWeek <= (end ?? p.startWeek);
  const ignored = [
    ...(n.minimumStartersOrForfeit ? ["the minimum-starters forfeit"] : []),
    ...(reverseInPlayoffs ? [`Week ${n.reverseScoringWeek}'s reverse scoring`] : []),
  ];
  if (ignored.length) out.push(`Playoff games are decided by the score alone: ${list(ignored)} ${ignored.length === 1 ? "doesn't" : "don't"} apply to them.`);
  if (extras.length) out.push(`There is also ${list(extras)}${p.consolationStakes !== "NONE" ? `, played for ${p.consolationStakes === "ROOKIE_PICK" ? "rookie draft position" : p.consolationStakes === "PUNISHMENT" ? "avoiding the last-place punishment" : "a FAB bonus"}` : ""}.`);
  if (p.lockRostersInPlayoffs) out.push("Rosters lock once the playoffs begin: no adds, drops or trades.");
  else {
    // playoffs/elimination.ts eliminationRuleActive
    const noTrades = p.eliminatedTeamsCanTransact === false;
    const noAdds = noTrades || s.waivers.eliminatedTeamsCanAdd === false;
    if (noAdds)
      out.push(
        `During the playoffs, teams out of the championship bracket (including teams that missed the playoffs) can't ${noTrades ? "add players, make waiver claims or trade" : "add players or make waiver claims"}. A first-round bye never eliminates a team, and a multi-week round eliminates its losers only once all its weeks are final.`,
      );
  }
  return out;
}

/**
 * When cap-breaking moves are blocked (roster-rules.ts capEnforcement): "" = always, a phrase like "during the regular
 * season and playoffs", or null = never (in-season enforcement off and the offseason only warns; or a soft cap
 * without a max overage).
 */
function capBlockWhen(c: LeagueSettings["salaryCap"]): string | null {
  if (!c.enabled || (c.capType === "SOFT" && (c.softCapMaxOverage === null || c.softCapMaxOverage === undefined))) return null;
  const mode = c.offseasonEnforcement ?? "BLOCK_OVER_CAP_MOVES";
  const off = mode === "BLOCK_OVER_CAP_MOVES" ? "always" : mode === "ALLOW_UNTIL_COMPLIANCE_DATE" && c.complianceDate ? "after" : "never";
  if (c.enforceInSeason)
    return off === "always" ? "" : off === "after" ? "during the regular season and playoffs, and outside them once the cap compliance deadline has passed" : "during the regular season and playoffs";
  return off === "always" ? "outside the regular season and playoffs" : off === "after" ? "outside the regular season and playoffs once the cap compliance deadline has passed" : null;
}

export function capProse(s: LeagueSettings): string[] {
  const c = s.salaryCap;
  if (!c.enabled) return ["There is no salary cap."];
  const out = [
    `Every team has a ${c.capType === "SOFT" ? "soft" : "hard"} salary cap of ${$(c.cap)}${c.floor ? ` and a salary floor of ${$(c.floor)}` : ""}. Salaries range from ${$(c.minSalary)}${c.maxSalary !== null ? ` to ${$(c.maxSalary)}` : " up"}.${c.annualCapIncrease ? ` The cap grows by ${$(c.annualCapIncrease)} each season.` : ""}`,
  ];
  // roster-rules.ts capLimit (the ceiling) + capEnforcement (BLOCK / WARN / OFF for the league phase) via capCheck: the
  // one cap rule adds (players/actions), waiver claims (waivers/logic + actions), trades (trades/rules), auction bids
  // (draft/auction), IR / taxi moves (team/roster-rules) and contract changes (team/contracts) apply
  const tradesChecked = s.trades.enabled && s.trades.requireCapCompliance;
  const soft = c.capType === "SOFT";
  const noCeiling = soft && (c.softCapMaxOverage === null || c.softCapMaxOverage === undefined);
  if (soft) {
    // commissioner/roster-logic.ts luxuryTaxFor
    const paid = c.luxuryTaxPaidAs === "DUES" ? "added to the team's league dues" : c.luxuryTaxPaidAs === "FAAB" ? "paid in FAB (charged by the commissioner)" : "settled by the commissioner";
    out.push(
      `${
        noCeiling
          ? "Teams may go over the cap by any amount, so no move is ever blocked by it."
          : `Teams may go over the cap by up to ${$(c.softCapMaxOverage!)}: every cap check uses the ${$(c.cap + c.softCapMaxOverage!)} soft-cap limit.`
      }${c.luxuryTaxRate > 0 ? ` Each $1 over the cap costs a ${c.luxuryTaxRate}× luxury tax (rounded up to whole dollars), ${paid}.` : " There is no luxury tax."}`,
    );
  }
  if (!noCeiling) {
    const line = soft ? "the soft-cap limit" : "the cap";
    const moves = list(["adds", "waiver claims", ...(tradesChecked ? ["trades"] : []), "salary-auction bids", "roster moves", ...(s.contracts.enabled ? ["contract changes (extensions, franchise tags, rookie options)"] : [])]);
    const inSeason = c.enforceInSeason
      ? `During the regular season and playoffs, ${moves} that would put a team over ${line} are blocked.`
      : "During the regular season and playoffs, nothing is checked against the cap.";
    const mode = c.offseasonEnforcement ?? "BLOCK_OVER_CAP_MOVES";
    // the in-season sentence already lists the moves when it blocks them
    const they = c.enforceInSeason ? "they" : moves;
    const offseason =
      mode === "WARN_ONLY"
        ? `Outside the regular season and playoffs the cap is only a warning: ${c.enforceInSeason ? "the same moves go through" : `${moves} go through`}, with a warning.`
        : mode === "ALLOW_UNTIL_COMPLIANCE_DATE"
          ? c.complianceDate
            ? `Outside the regular season and playoffs, ${they} may put a team over ${line} (with a warning) until the cap compliance deadline; from then on they're blocked.`
            : `Outside the regular season and playoffs, ${they} may put a team over ${line}, with a warning (no cap compliance deadline is set).`
          : c.enforceInSeason
            ? "The same moves are blocked outside the regular season and playoffs."
            : `Outside the regular season and playoffs, ${moves} that would put a team over ${line} are blocked.`;
    const everBlocks = c.enforceInSeason || mode === "BLOCK_OVER_CAP_MOVES" || (mode === "ALLOW_UNTIL_COMPLIANCE_DATE" && !!c.complianceDate);
    out.push(`${inSeason} ${offseason}${everBlocks ? " A move that doesn't add salary is always allowed, even for a team over the cap." : ""}`);
  }
  // dashboard / deadlines only flag these; the commissioner applies the consequence
  if (c.complianceDate)
    out.push(
      c.overCapPenalty === "FREEZE_TRANSACTIONS"
        ? "Teams still over the cap at the compliance deadline have their transactions frozen by the commissioner."
        : c.overCapPenalty === "FORFEIT_PICK"
          ? "Teams still over the cap at the compliance deadline forfeit a draft pick (applied by the commissioner)."
          : "The commissioner resolves teams still over the cap at the compliance deadline.",
    );
  if (c.floor)
    out.push(
      c.floorPenalty === "CHARGE_DIFFERENCE"
        ? "Teams under the floor are charged the difference as dead money by the commissioner."
        : c.floorPenalty === "FORFEIT_PICK"
          ? "Teams under the floor forfeit a draft pick (applied by the commissioner)."
          : "Teams under the floor are flagged for the commissioner.",
    );
  // salaryCap.emptyRosterSpotCharge, rollover*, allowCapSpaceTrading and deadMoneyTradable aren't stated: nothing applies them yet.
  const d = c.deadMoney;
  if (d.enabled) {
    // roster-rules.ts deadMoneyCharges + roster-ops.ts dropPlayerFromTeam / forgiveRetiredDeadMoney
    const pre = d.preseasonCutPercent;
    out.push(
      `Dead money: cutting a player leaves ${d.currentSeasonPercent}% of his salary on this season's cap${d.futureSeasonPercent ? ` and ${d.futureSeasonPercent}% for each remaining contract year` : ""}${
        pre !== null && pre !== d.currentSeasonPercent ? `; cuts during the preseason charge ${pre}% for this season instead` : ""
      }. Minimum-salary players can be cut for free${d.rookieContractsExempt ? ", as can players on rookie contracts" : ""}${
        d.waivedInSeasonBeforeWeek ? `, and cuts before Week ${d.waivedInSeasonBeforeWeek} (outside the preseason) carry no penalty` : ""
      }.${d.forgivenIfClaimed ? " The penalty is forgiven if another team claims the player off waivers." : ""}${
        d.retirementForgives ? " If a released player retires, his dead money for the current and future seasons is wiped." : ""
      }${d.amnestyCutsPerTeam ? ` Each team gets ${plural(d.amnestyCutsPerTeam, "amnesty cut")} with no penalty over the life of the league, made through the commissioner.` : ""}`,
    );
  } else out.push("Cut players carry no dead money.");
  return out;
}

export function contractProse(s: LeagueSettings): string[] {
  const c = s.contracts;
  const out: string[] = [];
  if (!c.enabled) out.push("Players don't carry multi-year contracts.");
  else {
    const raise = c.annualRaisePercent
      ? ` Salaries rise ${c.annualRaisePercent}% each season of a contract${c.raiseAppliesTo === "ALL_EXCEPT_ROOKIE" ? " (rookie deals stay flat)" : c.raiseAppliesTo === "VETERANS_ONLY" ? " (veterans only: rookie deals and young players stay flat)" : ""}.`
      : " Salaries stay flat over a contract.";
    out.push(`Contracts run ${c.minYears}-${c.maxYears} years (including the current season).${raise}`);
    if (c.lengthLimits.length) out.push(`Long-contract limits: ${list(c.lengthLimits.map((l) => `at most ${l.maxCount} of ${l.years}+ years`))}.`);
    if (c.extensionsAllowed) out.push(`Extensions add up to ${plural(c.extensionMaxYearsAdded, "year")} at a ${c.extensionRaisePercent}% raise per year (${c.extensionWindow === "ANY_TIME" ? "any time" : c.extensionWindow === "ANY_OFFSEASON" ? "any offseason" : "in the offseason before the final year"}${c.extensionsPerTeamPerSeason !== null ? `, ${c.extensionsPerTeamPerSeason} per team per season` : ""}).`);
    // season/logic.ts planRollover (contracts.expiredContractsBecome = RFA isn't applied yet)
    out.push(`A contract that expires ends at the season rollover${s.keepers.enabled ? " unless the player is kept" : ""} (see Keepers).`);
  }
  const t = c.franchiseTag;
  if (t.enabled) out.push(`Franchise tag: ${plural(t.perTeam, "tag")} per team per season on ${t.eligibility === "EXPIRING_ONLY" ? "expiring contracts" : "any player"}, for ${plural(t.years, "year")}, costing ${t.costMethod === "TOP5_AVG_AT_POSITION" ? `the average of the top ${t.topN} salaries at his position (or his current salary, if higher)` : `his salary plus ${t.raisePercent}%`}. A repeat tag costs ${t.consecutiveMultiplier}× (max ${t.maxConsecutive} in a row).`);
  out.push(`Drafted rookies sign ${c.rookieContractYears}-year contracts on the rookie scale below${c.rookieFourthYearOption ? `, with an option year (+${c.rookieOptionRaisePercent}%) for round ${list(c.rookieOptionRounds.map(String), "and")} picks` : ""}.`);
  return out;
}

/** niche.lastPlaceDeterminedBy as applied to the final standings (@/lib/playoffs/structure applyLastPlaceRule). */
function lastPlaceBasis(s: LeagueSettings): string {
  const by = s.niche.lastPlaceDeterminedBy;
  if (by === "POINTS_FOR") return "fewest points among non-playoff teams";
  if (by === "REGULAR_SEASON_RECORD") return "the worst regular season record among non-playoff teams";
  return s.playoffs.toiletBowl && s.playoffs.teams ? "the toilet bowl" : "the final standings";
}

/** Where players released at the rollover go (keepers.releasedPlayersReturnTo, @/lib/players/logic auctionPoolHold). */
function releasedTo(s: LeagueSettings): string {
  return s.keepers.releasedPlayersReturnTo === "AUCTION_POOL"
    ? "Released players can only be signed in the new season's salary auction, and become free agents once it is complete (or once the regular season starts, if no auction is held that season)."
    : "Released players become free agents.";
}

export function keeperProse(s: LeagueSettings): string[] {
  const k = s.keepers;
  // season/logic.ts planRollover + keepers/logic.ts needsDesignation
  if (!k.enabled) {
    if (!s.contracts.enabled) return ["There are no keeper designations: every rostered player carries over."];
    return [`There are no keeper designations: players under contract carry over, and expiring contracts end at the season rollover. ${releasedTo(s)}`];
  }
  const out = [
    `${k.selectionBy === "COMMISSIONER" ? "The commissioner designates" : "Managers designate"} keepers each offseason${k.maxKeepers !== null ? ` (up to ${k.maxKeepers}${k.minKeepers ? `, at least ${k.minKeepers}` : ""})` : k.minKeepers ? ` (at least ${k.minKeepers})` : " with no limit"}${k.rookiesCountTowardLimit ? "" : "; rookie contracts don't count toward the limit"}. ${
      s.contracts.enabled ? "Players under contract carry over automatically; a player whose contract is expiring must be kept to stay." : "Every player must be kept to stay on the roster."
    } Players who aren't kept are released at the season rollover.${k.allowKeepingIR ? "" : " Players on IR can't be kept."}`,
  ];
  if (k.escalation.type !== "NONE") out.push(`A kept player's salary rises ${k.escalation.type === "PERCENT" ? `${k.escalation.value}%` : $(k.escalation.value)} (at least ${$(k.escalation.minIncrease)}).`);
  if (k.maxYearsKept !== null) out.push(`A player can be kept at most ${plural(k.maxYearsKept, "season")}.`);
  out.push(`${releasedTo(s)}${k.mustBeCapCompliant ? " Keepers must fit under next season's cap." : ""}`);
  return out;
}

export function waiverProse(s: LeagueSettings): string[] {
  const w = s.waivers;
  const days = list(w.processDays.map((d) => WEEKDAY_LABELS[d]));
  const out: string[] = [];
  if (w.type === "FAB") out.push(`Waivers use a free agent budget (FAB): every team gets ${$(w.faabBudget)} per season and bids blind. Minimum bid ${$(w.allowZeroBids ? w.minBid : Math.max(1, w.minBid))}${w.bidIncrement > 1 ? `, in ${$(w.bidIncrement)} steps` : ""}; ties go to ${w.tiebreaker === "PRIORITY" ? "waiver priority" : w.tiebreaker === "WORST_RECORD" ? "the worse record" : "the earliest claim"}.`);
  else if (w.type === "PRIORITY") out.push(`Waivers use a ${w.priorityType === "ROLLING" ? "rolling priority order (a successful claim moves you to the back)" : "priority order reset weekly by reverse standings"}.`);
  else out.push("There are no waivers: free agents are first come, first served.");
  if (w.type !== "FREE_FOR_ALL")
    out.push(
      `Claims process ${days} at ${hour(w.processHour)}. Dropped players stay on waivers ${plural(w.waiverPeriodHours, "hour")}${
        w.continuousFreeAgency ? "; after that they can be added instantly" : ", and every add is a waiver claim"
      }.${w.lockPlayersAfterGameStart ? " Once a free agent's game starts he can only be claimed on waivers until the next run." : ""}${
        w.playoffMode === "FAB_ONLY" ? " During the playoffs every add is a waiver claim." : w.playoffMode === "FROZEN" && w.type === "PRIORITY" ? " The waiver order is frozen during the playoffs." : ""
      }${w.offseasonWaivers ? "" : " In the offseason free agents can be added instantly."}`,
    );
  out.push(`Pickups sign ${w.signedContractYears}-year contracts${w.salaryEqualsBid ? ` with a salary equal to the winning bid${w.salaryMultiplier !== 1 ? ` × ${w.salaryMultiplier}` : ""} (at least the league minimum)` : " at the league minimum salary"}.`);
  const limits: string[] = [];
  if (w.maxAcquisitionsPerWeek !== null) limits.push(`${w.maxAcquisitionsPerWeek} per week`);
  if (w.maxAcquisitionsPerSeason !== null) limits.push(`${w.maxAcquisitionsPerSeason} per season`);
  if (limits.length) out.push(`Acquisition limits: ${list(limits)}.`);
  if (w.faabRollover) out.push("Unused FAB rolls over to next season.");
  if (w.weeklyFaabAllowance) out.push(`Every team earns ${$(w.weeklyFaabAllowance)} of FAB each week.`);
  if (w.disableAdds) out.push("Adds are currently frozen by the commissioner.");
  return out;
}

export function tradeProse(s: LeagueSettings): string[] {
  const t = s.trades;
  if (!t.enabled) return ["Trading is turned off."];
  const voters = t.voteEligibility === "ALL_TEAMS" ? "any team" : "teams not in the trade";
  const review =
    t.reviewType === "NONE"
      ? "Accepted trades process immediately."
      : t.reviewType === "COMMISSIONER"
        ? `Accepted trades wait up to ${plural(t.reviewPeriodHours, "hour")} for commissioner approval.`
        : `Accepted trades go to a ${plural(t.reviewPeriodHours, "hour")} league vote; ${plural(t.vetoVotesRequired, "veto vote")} from ${voters} ${t.vetoVotesRequired === 1 ? "overturns" : "overturn"} a trade.`;
  const out = [`${t.deadlineWeek !== null ? `The trade deadline is the end of Week ${t.deadlineWeek}.` : "There is no trade deadline."} ${review}`];
  // trades/rules.ts; salaryCap.allowCapSpaceTrading and deadMoneyTradable aren't applied yet. The cap check is the shared
  // roster-rules.ts capCheck: the soft-cap limit for soft caps, and only while capEnforcement blocks (else a warning)
  const assets: string[] = ["players"];
  const capWhen = capBlockWhen(s.salaryCap);
  const capLine = s.salaryCap.capType === "SOFT" ? "the soft-cap limit" : "the cap";
  if (t.allowDraftPickTrading) assets.push(`rookie draft picks (${plural(t.futurePickYears, "season")} out)`);
  if (t.allowFaabTrading && s.waivers.faabTradable && s.waivers.type === "FAB") assets.push("FAB");
  out.push(
    `Tradable assets: ${list(assets)}.${t.irPlayersTradable ? "" : " Players on IR can't be traded."}${t.taxiPlayersTradable ? "" : " Taxi players can't be traded."}${
      t.requireCapCompliance && s.salaryCap.enabled && capWhen !== null
        ? ` ${capWhen ? `${capWhen[0].toUpperCase()}${capWhen.slice(1)}, a` : "A"} trade can't leave a team over ${capLine} with more salary than it had before.`
        : ""
    }${t.allowMultiTeamTrades ? ` Trades can include up to ${t.maxTeamsPerTrade} teams.` : ""}`,
  );
  const picks: string[] = [];
  if (t.allowDraftPickTrading) {
    // draft/trading.ts pickTradingOpen; trades/rules.ts duesPaidForPicks
    if (!s.draft.rookie.tradingDuringDraft) picks.push("Picks of a season can't be traded while that season's rookie draft is under way.");
    if (t.pickTradingRequiresPaidDues && s.general.leagueDues > 0) picks.push("A team can trade picks only once its dues are marked paid.");
  }
  if (picks.length) out.push(picks.join(" "));
  const retention = s.salaryCap.enabled ? Math.max(0, Math.min(100, Math.floor(t.salaryRetentionMaxPercent ?? 0))) : 0;
  if (retention) out.push(`A team trading a player away may keep paying up to ${retention}% of his salary (it stays on its cap as dead money).`);
  out.push(
    `Offers expire after ${plural(t.offerExpirationHours, "hour")}.${t.allowDuringPlayoffs ? "" : " No trades during the playoffs."}${t.allowOffseasonTrades ? " Trading is open all offseason." : " No trades in the offseason."}${
      t.tradeBackCooldownDays ? ` A player can't be traded back to his old team for ${plural(t.tradeBackCooldownDays, "day")}.` : ""
    }`,
  );
  return out;
}

export function draftProse(s: LeagueSettings): string[] {
  const r = s.draft.rookie;
  const a = s.draft.auction;
  // draft/logic.ts composeRookieOrder: both potential-points methods rank by the same best-lineup total
  const potential = r.orderMethod === "REVERSE_MAX_PF" || r.orderMethod === "REVERSE_POTENTIAL_POINTS";
  const lot = r.lottery;
  const order =
    r.orderMethod === "LOTTERY"
      ? `a lottery: the ${lot.teams} lowest teams in reverse standings${r.playoffTeamsByFinish ? " (non-playoff teams first)" : ""} draw for the top picks${
          lot.picksDrawn !== null && lot.picksDrawn < lot.teams ? `; only the first ${plural(lot.picksDrawn, "pick")} ${lot.picksDrawn === 1 ? "is" : "are"} drawn and the other lottery teams keep their pre-lottery order` : ""
        }${lot.maxDropSpots !== null ? `; no team falls more than ${plural(lot.maxDropSpots, "spot")} below its pre-lottery slot` : ""}${r.playoffTeamsByFinish ? "" : ". Everyone else picks in reverse standings order"}`
      : potential
        ? "reverse order of last season's max potential points (each regular season week's best possible lineup from the players the team had that week; lowest total first)"
        : "reverse order of last season's regular season standings (worst record first)";
  const out = [
    `The rookie draft is ${plural(r.rounds, "round")}, ${r.style === "SNAKE" ? "snake (the order reverses each round)" : "linear (the same order every round)"}. The order is ${order}.${
      !r.playoffTeamsByFinish
        ? ""
        : r.orderMethod === "LOTTERY"
          ? " The other non-playoff teams follow in reverse standings order, then the playoff teams in reverse order of playoff finish (the champion picks last)."
          : " Non-playoff teams pick first; playoff teams follow in reverse order of playoff finish (the champion picks last)."
    }`,
  ];
  // draft/logic.ts draftTiebreakCompare, then the standings rank
  const tb = s.standings.draftOrderTiebreakers;
  out.push(`Teams tied on ${potential ? "max potential points" : "record"} are ordered by ${chainText([...tb.map((t) => DRAFT_TB[t]), "the standings (the lower-ranked team picks first)"])}.`);
  // draft/order.ts computeRookieOrder: bonus slot and last-place swap
  const extras: string[] = [];
  if (r.consolationWinnerPick !== "NONE" && s.playoffs.teams && s.playoffs.consolationBracket) {
    extras.push(
      r.consolationWinnerPick === "FIRST_OVERALL" || r.orderMethod !== "LOTTERY"
        ? "Once the consolation bracket is decided, its champion moves to the No. 1 slot in the draft order."
        : "Once the consolation bracket is decided, its champion moves to the first slot after the lottery picks.",
    );
  }
  if (s.niche.lastPlaceDraftPenalty === "PICK_SWAP")
    extras.push(`Once the season is final, the last-place team (decided by ${lastPlaceBasis(s)}) swaps draft slots with the team right after it, so it picks one spot later.`);
  if (extras.length) out.push(extras.join(" "));
  out.push(
    `${r.eligibility === "ROOKIES_ONLY" ? "Only rookies are eligible." : "Rookies and free agents are eligible."} The clock is ${plural(r.pickTimerMinutes, "minute")} per pick${
      r.overnightPause ? ` (paused ${hour(r.pauseStartHour)}-${hour(r.pauseEndHour)})` : ""
    }; ${r.onTimeout === "AUTOPICK" ? `an expired pick is made automatically from ${AUTOPICK[r.autopickSource] ?? "ADP"}` : "a team whose clock runs out is skipped and can still make that pick later while the draft is live"}.`,
  );
  // draft/data.ts auctionRules + draft/logic.ts maxBidFor + draft/auction.ts nominatePlayer / autoNominate / proxy bids
  const minBid = Math.max(1, a.minBid, s.salaryCap.enabled ? s.salaryCap.minSalary : 0);
  // the order is chosen when an auction is created (draft/actions.ts createAuctionDraftAction); the setting is the default
  const nominate = a.nominationOrder === "RANDOM" ? "a random order" : a.nominationOrder === "REVERSE_STANDINGS" ? "reverse standings order" : "an order set by the commissioner";
  const maxSalary = s.salaryCap.maxSalary !== null && s.salaryCap.maxSalary > 0 ? s.salaryCap.maxSalary : null;
  // draft/auction.ts auctionCapSpace: room under the ceiling (capLimit) only while capEnforcement blocks
  const capWhen = capBlockWhen(s.salaryCap);
  const auctionCap = capWhen === null ? "" : ` (never more than its room under ${s.salaryCap.capType === "SOFT" ? "the soft-cap limit" : "the cap"}${capWhen ? ` ${capWhen}` : ""})`;
  out.push(
    `The salary auction gives each team ${$(a.budget)}${auctionCap} to fill ${plural(a.rosterSpotsToFill, "spot")} (fewer if its active roster runs out of room): bids start at ${$(minBid)} and rise by at least ${$(a.bidIncrement)}, with a ${a.bidSeconds}-second bid clock; each new high bid leaves at least ${plural(a.resetSecondsOnBid, "second")} on it. ${
      a.maxBidRule === "BUDGET_MINUS_OPEN_SLOTS" ? `A bid must leave ${$(minBid)} for each of the team's other open spots` : "A team can bid up to its whole remaining budget"
    }${maxSalary !== null ? ` and can't exceed the ${$(maxSalary)} maximum salary` : ""}.`,
  );
  out.push(
    `Teams nominate in the order picked when the auction is created (${nominate} unless the commissioner chooses another), with ${plural(a.nominationSeconds, "second")} to choose; ${a.nominatorOpeningBid === "MIN_BID" ? "every nomination opens at the minimum bid" : "the nominator may open at any amount up to their max bid"}. ${
      a.autoNominateOnTimeout ? "If the clock runs out, the top available player on the nominator's targets list (or the best available by ADP) is nominated at the minimum bid." : "A nominator who runs out of time loses the turn."
    }${a.proxyBidding ? " Managers can set a maximum bid on their targets, and the auction bids for them up to it even while they're away." : ""} ${
      a.includesRookies ? "Rookies can be nominated." : "Rookies aren't part of the auction."
    }${auctionYears(s)} Each auction keeps the rules it started with.`,
  );
  return out;
}

/** Auction contract length (draft/data.ts auctionYearOptions + draft/auction.ts lotYears / applyProxyBids). */
function auctionYears(s: LeagueSettings): string {
  const a = s.draft.auction;
  const c = s.contracts;
  if (!c.enabled) return "";
  if (a.contractYearsMode === "FIXED") return ` Auction contracts are ${plural(a.fixedContractYears, "year")}.`;
  const def = Math.min(c.maxYears, Math.max(c.minYears, c.defaultFreeAgentYears));
  return ` Each bidder picks a contract length (${c.minYears === c.maxYears ? plural(c.minYears, "year") : `${c.minYears}-${c.maxYears} years`}) with the bid, and the winning bid's length applies${
    a.proxyBidding ? `; a lot won by a proxy bid signs for ${plural(def, "year")}` : ""
  }.`;
}

export function nicheProse(s: LeagueSettings): string[] {
  const n = s.niche;
  const out: string[] = [];
  if (n.weeklyHighScoreBonusWin) out.push("The week's top scorer earns an extra win.");
  if (n.weeklyHighScorePrize) out.push(`The week's top score wins ${$(n.weeklyHighScorePrize)}.`);
  // scoreboard.ts refreshWeekMatchups (decideWinner reverse)
  if (n.reverseScoringWeek) {
    const playoffWeek = s.playoffs.teams > 0 && n.reverseScoringWeek >= s.playoffs.startWeek && n.reverseScoringWeek <= (playoffEndWeek(s.playoffs) ?? s.playoffs.startWeek);
    const higher = [
      ...(n.medianGameEachWeek || s.matchups.format === "H2H_PLUS_MEDIAN" ? ["the median game"] : []),
      ...(n.weeklyHighScoreBonusWin ? ["the high-score bonus win"] : []),
      "all-play records",
    ];
    out.push(
      playoffWeek
        ? `Week ${n.reverseScoringWeek} is marked as reverse scoring, but it is a playoff week and playoff games are decided by the normal score.`
        : `Week ${n.reverseScoringWeek} is reverse scoring: the lower score wins each matchup (tied scores still go to the usual tiebreakers; ${list(higher)} still reward the higher score).`,
    );
  }
  if (n.chaosWeek) out.push(`Week ${n.chaosWeek} is chaos week${n.chaosWeekRule ? `: ${n.chaosWeekRule}` : ""}.`);
  // niche.guillotine isn't stated: nothing applies it yet.
  if (n.tacoTrophy) out.push(`Last place (decided by ${lastPlaceBasis(s)}) earns ${n.lastPlaceTrophyName}.`);
  if (n.lastPlacePunishment) out.push(`Last-place punishment: ${n.lastPlacePunishment}`);
  if (n.lastPlaceDraftPenalty === "LOSE_FAAB") out.push("The last-place team also loses FAB (applied by the commissioner).");
  if (n.tankingProtection) out.push("Knowingly starting inactive players to tank can be penalized by the commissioner.");
  if (n.emptyStarterFine) out.push(`Each empty starting slot costs a ${$(n.emptyStarterFine)} fine.`);
  if (n.survivorPoolEnabled) out.push("A survivor pool, run by the commissioner, goes alongside the league.");
  if (n.pickemEnabled) out.push("An NFL pick'em side game, run by the commissioner, goes every week.");
  if (n.bountyEnabled) out.push(`Bounties: ${n.bountyDescription || "see the commissioner"}.`);
  return out;
}
