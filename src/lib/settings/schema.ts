// League settings: the single source of truth for every rule the commissioner can configure.
// Stored as JSON on League.settings. Always read through resolveSettings() so that missing keys
// (e.g. after new settings are added in a later release) fall back to DEFAULT_SETTINGS.

import { z } from "zod";

export type Weekday = "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";

export interface RosterSlotDef {
  /** Unique key, e.g. "QB", "RB", "FLEX", "SFLEX", "IDP_FLEX" */
  key: string;
  label: string;
  count: number;
  /** Fantasy positions that may fill this slot */
  eligible: string[];
}

export interface BonusRule {
  id: string;
  label: string;
  /** Stat key compared against threshold (can be a combined key: "rush_rec_yd" or "pass_rush_yd") */
  stat: string;
  threshold: number;
  points: number;
  /** Restrict to positions (empty = all) */
  positions?: string[];
  /** If set, bonus is awarded again for every `repeatEvery` beyond threshold */
  repeatEvery?: number | null;
}

export interface TierRule {
  /** inclusive upper bound */
  max: number;
  points: number;
}

export interface DistanceRule {
  min: number;
  max: number;
  points: number;
}

export interface CustomRule {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  /** Optional season this rule took effect */
  since?: number | null;
}

export interface LeagueSettings {
  general: {
    leagueName: string;
    shortName: string;
    teamCount: number;
    divisions: { id: string; name: string }[];
    timezone: string;
    regularSeasonWeeks: number;
    firstWeek: number;
    commissionerMessage: string;
    leagueDues: number;
    payouts: { place: string; amount: number }[];
    showInactiveTeams: boolean;
    allowCoManagers: boolean;
  };
  roster: {
    slots: RosterSlotDef[];
    benchSize: number;
    /** Max players on the active roster (starters + bench). IR / taxi are additional. */
    maxActiveRoster: number;
    minActiveRoster: number;
    irSlots: number;
    irEligibleStatuses: string[];
    irRequireInjuryStatus: boolean;
    irCountsAgainstCap: boolean;
    taxiSlots: number;
    taxiMaxYearsExp: number;
    taxiCountsAgainstCap: boolean;
    taxiCapPercent: number;
    taxiPromotionAllowedInSeason: boolean;
    taxiDeadlineWeek: number | null;
    taxiPoachingAllowed: boolean;
    positionLimits: Record<string, { min: number; max: number | null }>;
    idpEnabled: boolean;
  };
  scoring: {
    preset: "PPR" | "HALF_PPR" | "STANDARD" | "CUSTOM";
    decimals: number;
    /** points per unit of stat (e.g. pass_yd: 0.04) */
    rules: Record<string, number>;
    /** position-specific overrides of `rules`, e.g. { TE: { rec: 1.5 } } (TE premium) */
    positionOverrides: Record<string, Record<string, number>>;
    bonuses: BonusRule[];
    fieldGoalsByDistance: DistanceRule[];
    useFieldGoalDistance: boolean;
    pointsAllowedTiers: TierRule[];
    yardsAllowedTiers: TierRule[];
    /** Extra points per touchdown longer than X yards (applies to any offensive TD) */
    longTdBonuses: { minYards: number; points: number }[];
    negativePointsFloor: number | null;
    roundToDecimals: boolean;
  };
  lineup: {
    lockType: "PER_GAME" | "FIRST_GAME_OF_WEEK" | "SUNDAY_FIRST_GAME";
    allowFutureWeekLineups: boolean;
    autoSubOutPlayers: boolean;
    emptySlotPenalty: number;
    benchPointsTiebreaker: boolean;
    autoSetForInactiveManagers: boolean;
  };
  matchups: {
    format: "H2H" | "H2H_PLUS_MEDIAN" | "ALL_PLAY" | "POINTS_ONLY";
    allowTies: boolean;
    tiebreaker: "NONE" | "BENCH_POINTS" | "HIGHEST_STARTER" | "HOME_TEAM";
    scheduleType: "ROUND_ROBIN" | "DIVISION_WEIGHTED" | "MANUAL";
    divisionGamesTwice: boolean;
    rivalryWeek: number | null;
    rivalries: [string, string][];
  };
  standings: {
    tiebreakers: ("H2H" | "POINTS_FOR" | "DIVISION_RECORD" | "POINTS_AGAINST" | "ALL_PLAY" | "COIN_FLIP")[];
    divisionWinnersTopSeeds: boolean;
    showPowerRankings: boolean;
    powerRanking: { recordWeight: number; pointsWeight: number; allPlayWeight: number; recentFormWeight: number };
  };
  playoffs: {
    teams: number;
    startWeek: number;
    weeksPerRound: number;
    championshipWeeks: number;
    byes: number;
    reseed: boolean;
    seeding: "RECORD" | "POINTS_FOR";
    wildcardsByPoints: number;
    consolationBracket: boolean;
    thirdPlaceGame: boolean;
    toiletBowl: boolean;
    lockRostersInPlayoffs: boolean;
  };
  salaryCap: {
    enabled: boolean;
    cap: number;
    floor: number;
    minSalary: number;
    maxSalary: number | null;
    enforceInSeason: boolean;
    annualCapIncrease: number;
    allowCapSpaceTrading: boolean;
    deadMoney: {
      enabled: boolean;
      currentSeasonPercent: number;
      futureSeasonPercent: number;
      rookieContractsExempt: boolean;
      waivedInSeasonBeforeWeek: number | null;
    };
  };
  contracts: {
    enabled: boolean;
    minYears: number;
    maxYears: number;
    defaultFreeAgentYears: number;
    auctionWinnerChoosesYears: boolean;
    annualRaisePercent: number;
    extensionsAllowed: boolean;
    extensionRaisePercent: number;
    franchiseTag: { enabled: boolean; perTeam: number; costMethod: "TOP5_AVG_AT_POSITION" | "RAISE_PERCENT"; raisePercent: number };
    rookieContractYears: number;
    rookieFourthYearOption: boolean;
    rookieOptionRaisePercent: number;
    /** salary by pick number within each round. Index 0 = pick 1. */
    rookieScale: Record<string, number[]>;
    expiredContractsBecome: "FREE_AGENT" | "RFA";
  };
  keepers: {
    enabled: boolean;
    maxKeepers: number | null;
    minKeepers: number;
    deadline: string | null; // ISO datetime
    windowOpens: string | null;
    escalation: { type: "PERCENT" | "FLAT" | "NONE"; value: number; minIncrease: number };
    maxYearsKept: number | null;
    requireContractYears: boolean;
    allowKeepingIR: boolean;
    mustBeCapCompliant: boolean;
    releasedPlayersReturnTo: "AUCTION_POOL" | "FREE_AGENCY";
    rookiesCountTowardLimit: boolean;
  };
  waivers: {
    type: "FAB" | "PRIORITY" | "FREE_FOR_ALL";
    faabBudget: number;
    minBid: number;
    allowZeroBids: boolean;
    tiebreaker: "PRIORITY" | "WORST_RECORD" | "EARLIEST_CLAIM";
    priorityType: "ROLLING" | "RESET_WEEKLY_BY_RECORD";
    waiverPeriodHours: number;
    processDays: Weekday[];
    processHour: number; // local hour 0-23
    lockPlayersAfterGameStart: boolean;
    continuousFreeAgency: boolean;
    salaryEqualsBid: boolean;
    salaryMultiplier: number;
    signedContractYears: number;
    maxAcquisitionsPerWeek: number | null;
    maxAcquisitionsPerSeason: number | null;
    faabRollover: boolean;
    faabTradable: boolean;
    offseasonWaivers: boolean;
    dropCooldownHours: number;
  };
  trades: {
    enabled: boolean;
    deadlineWeek: number | null;
    reviewType: "NONE" | "COMMISSIONER" | "LEAGUE_VOTE";
    reviewPeriodHours: number;
    vetoVotesRequired: number;
    allowDraftPickTrading: boolean;
    futurePickYears: number;
    allowFaabTrading: boolean;
    offerExpirationHours: number;
    allowMultiTeamTrades: boolean;
    maxTeamsPerTrade: number;
    allowDuringPlayoffs: boolean;
    allowOffseasonTrades: boolean;
    requireCapCompliance: boolean;
    tradeBackCooldownDays: number;
    showTradeBlock: boolean;
  };
  draft: {
    rookie: {
      rounds: number;
      style: "LINEAR" | "SNAKE";
      orderMethod: "REVERSE_STANDINGS" | "REVERSE_MAX_PF" | "LOTTERY" | "REVERSE_POTENTIAL_POINTS";
      playoffTeamsByFinish: boolean;
      lottery: { teams: number; odds: number[] };
      pickTimerMinutes: number;
      autopickSource: "BIG_BOARD" | "LEAGUE_RANKINGS" | "ADP";
      eligibility: "ROOKIES_ONLY" | "ROOKIES_AND_FREE_AGENTS";
      scheduledFor: string | null;
    };
    auction: {
      budget: number;
      minBid: number;
      bidIncrement: number;
      nominationSeconds: number;
      bidSeconds: number;
      resetSecondsOnBid: number;
      nominationOrder: "RANDOM" | "REVERSE_STANDINGS" | "CUSTOM";
      maxBidRule: "BUDGET_MINUS_OPEN_SLOTS" | "BUDGET";
      rosterSpotsToFill: number;
      contractYearsMode: "WINNER_CHOOSES" | "FIXED";
      fixedContractYears: number;
      scheduledFor: string | null;
    };
  };
  notifications: {
    touchdownAlertsDefault: "MY_STARTERS" | "MY_ROSTER" | "MY_MATCHUP" | "LEAGUE" | "OFF";
    weeklyRecapEnabled: boolean;
    weeklyRecapDay: Weekday;
    weeklyRecapHour: number;
    tradeAlertsToLeague: boolean;
    transactionsToChat: boolean;
    injuryAlerts: boolean;
    lineupReminderHoursBefore: number;
  };
  commissioner: {
    canEditLineups: boolean;
    canEditPastScores: boolean;
    coCommissionerFullPowers: boolean;
    managersSeeOtherQueues: boolean;
    publicTradeVotes: boolean;
  };
  niche: {
    medianGameEachWeek: boolean;
    weeklyHighScoreBonusWin: boolean;
    weeklyHighScorePrize: number;
    guillotine: boolean;
    lastPlacePunishment: string;
    tacoTrophy: boolean;
    reverseScoringWeek: number | null;
    minimumStartersOrForfeit: number;
    tankingProtection: boolean;
    inactiveManagerFlagDays: number;
    survivorPoolEnabled: boolean;
    custom: CustomRule[];
  };
}

// ───────────────────────────── Defaults ─────────────────────────────

const BASE_RULES: Record<string, number> = {
  // passing
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  pass_2pt: 2,
  pass_int_td: 0,
  pass_sack: 0,
  pass_fd: 0,
  pass_cmp: 0,
  pass_inc: 0,
  // rushing
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rush_fd: 0,
  rush_att: 0,
  // receiving
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  rec_fd: 0,
  rec_tgt: 0,
  // misc
  fum: 0,
  fum_lost: -2,
  fum_rec_td: 6,
  st_td: 6,
  kr_yd: 0,
  pr_yd: 0,
  // kicking (fgm counts only when distance scoring is off)
  fgm: 3,
  fgmiss: -1,
  xpm: 1,
  xpmiss: -1,
  // team defense
  sack: 1,
  int: 2,
  fum_rec: 2,
  def_td: 6,
  def_st_td: 6,
  safe: 2,
  blk_kick: 2,
  def_2pt: 2,
  ff: 0,
  def_pass_def: 0,
  tkl_loss: 0,
  def_kr_yd: 0,
  def_pr_yd: 0,
  // IDP
  idp_tkl_solo: 1,
  idp_tkl_ast: 0.5,
  idp_tkl_loss: 1,
  idp_sack: 3,
  idp_qb_hit: 0.5,
  idp_int: 3,
  idp_ff: 2,
  idp_fum_rec: 2,
  idp_pass_def: 1,
  idp_def_td: 6,
  idp_safe: 2,
  idp_blk_kick: 2,
};

/** Rookie salary scale (12-team default): pick 1.01 = $10 ... 2.12 = $1 */
const ROOKIE_SCALE: Record<string, number[]> = {
  "1": [10, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4],
  "2": [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1],
};

export const DEFAULT_SETTINGS: LeagueSettings = {
  general: {
    leagueName: "CTE Dynasty",
    shortName: "CTE",
    teamCount: 12,
    divisions: [
      { id: "east", name: "East" },
      { id: "west", name: "West" },
    ],
    timezone: "America/New_York",
    regularSeasonWeeks: 14,
    firstWeek: 1,
    commissionerMessage: "Welcome to CTE Dynasty. Set your lineups, respect the cap, and may the best GM win.",
    leagueDues: 0,
    payouts: [
      { place: "Champion", amount: 0 },
      { place: "Runner-up", amount: 0 },
      { place: "Regular season points leader", amount: 0 },
    ],
    showInactiveTeams: false,
    allowCoManagers: true,
  },
  roster: {
    slots: [
      { key: "QB", label: "QB", count: 1, eligible: ["QB"] },
      { key: "RB", label: "RB", count: 2, eligible: ["RB"] },
      { key: "WR", label: "WR", count: 3, eligible: ["WR"] },
      { key: "TE", label: "TE", count: 1, eligible: ["TE"] },
      { key: "FLEX", label: "W/R/T", count: 1, eligible: ["RB", "WR", "TE"] },
      { key: "SFLEX", label: "SUPERFLEX", count: 1, eligible: ["QB", "RB", "WR", "TE"] },
      { key: "K", label: "K", count: 1, eligible: ["K"] },
      { key: "DEF", label: "DST", count: 1, eligible: ["DEF"] },
    ],
    benchSize: 16,
    maxActiveRoster: 27,
    minActiveRoster: 0,
    irSlots: 3,
    irEligibleStatuses: ["IR", "Out", "PUP", "Sus", "NA", "COV", "Doubtful"],
    irRequireInjuryStatus: true,
    irCountsAgainstCap: true,
    taxiSlots: 4,
    taxiMaxYearsExp: 1,
    taxiCountsAgainstCap: false,
    taxiCapPercent: 0,
    taxiPromotionAllowedInSeason: true,
    taxiDeadlineWeek: 1,
    taxiPoachingAllowed: false,
    positionLimits: {
      QB: { min: 0, max: null },
      RB: { min: 0, max: null },
      WR: { min: 0, max: null },
      TE: { min: 0, max: null },
      K: { min: 0, max: 3 },
      DEF: { min: 0, max: 3 },
    },
    idpEnabled: false,
  },
  scoring: {
    preset: "PPR",
    decimals: 2,
    rules: BASE_RULES,
    positionOverrides: {
      TE: { rec: 1.5 },
    },
    bonuses: [
      { id: "pass300", label: "300+ passing yards", stat: "pass_yd", threshold: 300, points: 2 },
      { id: "pass400", label: "400+ passing yards", stat: "pass_yd", threshold: 400, points: 2 },
      { id: "rush100", label: "100+ rushing yards", stat: "rush_yd", threshold: 100, points: 2 },
      { id: "rush200", label: "200+ rushing yards", stat: "rush_yd", threshold: 200, points: 2 },
      { id: "rec100", label: "100+ receiving yards", stat: "rec_yd", threshold: 100, points: 2 },
      { id: "rec200", label: "200+ receiving yards", stat: "rec_yd", threshold: 200, points: 2 },
    ],
    fieldGoalsByDistance: [
      { min: 0, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: 59, points: 5 },
      { min: 60, max: 99, points: 6 },
    ],
    useFieldGoalDistance: true,
    pointsAllowedTiers: [
      { max: 0, points: 10 },
      { max: 6, points: 7 },
      { max: 13, points: 4 },
      { max: 20, points: 1 },
      { max: 27, points: 0 },
      { max: 34, points: -1 },
      { max: 999, points: -4 },
    ],
    yardsAllowedTiers: [
      { max: 99, points: 5 },
      { max: 199, points: 3 },
      { max: 299, points: 2 },
      { max: 349, points: 0 },
      { max: 399, points: -1 },
      { max: 449, points: -3 },
      { max: 9999, points: -5 },
    ],
    longTdBonuses: [{ minYards: 40, points: 1 }],
    negativePointsFloor: null,
    roundToDecimals: true,
  },
  lineup: {
    lockType: "PER_GAME",
    allowFutureWeekLineups: true,
    autoSubOutPlayers: false,
    emptySlotPenalty: 0,
    benchPointsTiebreaker: false,
    autoSetForInactiveManagers: false,
  },
  matchups: {
    format: "H2H",
    allowTies: true,
    tiebreaker: "NONE",
    scheduleType: "ROUND_ROBIN",
    divisionGamesTwice: false,
    rivalryWeek: null,
    rivalries: [],
  },
  standings: {
    tiebreakers: ["H2H", "POINTS_FOR", "DIVISION_RECORD", "POINTS_AGAINST", "COIN_FLIP"],
    divisionWinnersTopSeeds: false,
    showPowerRankings: true,
    powerRanking: { recordWeight: 0.35, pointsWeight: 0.35, allPlayWeight: 0.2, recentFormWeight: 0.1 },
  },
  playoffs: {
    teams: 6,
    startWeek: 15,
    weeksPerRound: 1,
    championshipWeeks: 1,
    byes: 2,
    reseed: false,
    seeding: "RECORD",
    wildcardsByPoints: 0,
    consolationBracket: true,
    thirdPlaceGame: true,
    toiletBowl: true,
    lockRostersInPlayoffs: false,
  },
  salaryCap: {
    enabled: true,
    cap: 300,
    floor: 150,
    minSalary: 1,
    maxSalary: null,
    enforceInSeason: true,
    annualCapIncrease: 0,
    allowCapSpaceTrading: false,
    deadMoney: {
      enabled: true,
      currentSeasonPercent: 50,
      futureSeasonPercent: 25,
      rookieContractsExempt: false,
      waivedInSeasonBeforeWeek: null,
    },
  },
  contracts: {
    enabled: true,
    minYears: 1,
    maxYears: 5,
    defaultFreeAgentYears: 1,
    auctionWinnerChoosesYears: true,
    annualRaisePercent: 0,
    extensionsAllowed: true,
    extensionRaisePercent: 20,
    franchiseTag: { enabled: true, perTeam: 1, costMethod: "TOP5_AVG_AT_POSITION", raisePercent: 20 },
    rookieContractYears: 3,
    rookieFourthYearOption: true,
    rookieOptionRaisePercent: 50,
    rookieScale: ROOKIE_SCALE,
    expiredContractsBecome: "FREE_AGENT",
  },
  keepers: {
    enabled: true,
    maxKeepers: null,
    minKeepers: 0,
    deadline: null,
    windowOpens: null,
    escalation: { type: "PERCENT", value: 10, minIncrease: 1 },
    maxYearsKept: null,
    requireContractYears: false,
    allowKeepingIR: true,
    mustBeCapCompliant: true,
    releasedPlayersReturnTo: "AUCTION_POOL",
    rookiesCountTowardLimit: false,
  },
  waivers: {
    type: "FAB",
    faabBudget: 100,
    minBid: 0,
    allowZeroBids: true,
    tiebreaker: "PRIORITY",
    priorityType: "RESET_WEEKLY_BY_RECORD",
    waiverPeriodHours: 48,
    processDays: ["WED"],
    processHour: 3,
    lockPlayersAfterGameStart: true,
    continuousFreeAgency: true,
    salaryEqualsBid: false,
    salaryMultiplier: 1,
    signedContractYears: 1,
    maxAcquisitionsPerWeek: null,
    maxAcquisitionsPerSeason: null,
    faabRollover: false,
    faabTradable: true,
    offseasonWaivers: false,
    dropCooldownHours: 0,
  },
  trades: {
    enabled: true,
    deadlineWeek: 11,
    reviewType: "COMMISSIONER",
    reviewPeriodHours: 24,
    vetoVotesRequired: 4,
    allowDraftPickTrading: true,
    futurePickYears: 3,
    allowFaabTrading: true,
    offerExpirationHours: 72,
    allowMultiTeamTrades: true,
    maxTeamsPerTrade: 3,
    allowDuringPlayoffs: false,
    allowOffseasonTrades: true,
    requireCapCompliance: true,
    tradeBackCooldownDays: 0,
    showTradeBlock: true,
  },
  draft: {
    rookie: {
      rounds: 2,
      style: "LINEAR",
      orderMethod: "REVERSE_STANDINGS",
      playoffTeamsByFinish: true,
      lottery: { teams: 6, odds: [25, 20, 17.5, 15, 12.5, 10] },
      pickTimerMinutes: 240,
      autopickSource: "BIG_BOARD",
      eligibility: "ROOKIES_ONLY",
      scheduledFor: null,
    },
    auction: {
      budget: 300,
      minBid: 1,
      bidIncrement: 1,
      nominationSeconds: 60,
      bidSeconds: 30,
      resetSecondsOnBid: 15,
      nominationOrder: "RANDOM",
      maxBidRule: "BUDGET_MINUS_OPEN_SLOTS",
      rosterSpotsToFill: 25,
      contractYearsMode: "WINNER_CHOOSES",
      fixedContractYears: 2,
      scheduledFor: null,
    },
  },
  notifications: {
    touchdownAlertsDefault: "MY_MATCHUP",
    weeklyRecapEnabled: true,
    weeklyRecapDay: "TUE",
    weeklyRecapHour: 9,
    tradeAlertsToLeague: true,
    transactionsToChat: true,
    injuryAlerts: true,
    lineupReminderHoursBefore: 2,
  },
  commissioner: {
    canEditLineups: true,
    canEditPastScores: true,
    coCommissionerFullPowers: false,
    managersSeeOtherQueues: false,
    publicTradeVotes: false,
  },
  niche: {
    medianGameEachWeek: false,
    weeklyHighScoreBonusWin: false,
    weeklyHighScorePrize: 0,
    guillotine: false,
    lastPlacePunishment: "",
    tacoTrophy: true,
    reverseScoringWeek: null,
    minimumStartersOrForfeit: 0,
    tankingProtection: false,
    inactiveManagerFlagDays: 21,
    survivorPoolEnabled: false,
    custom: [],
  },
};

// ───────────────────────────── Resolve / merge ─────────────────────────────

type Json = unknown;

function isPlainObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge: objects merge recursively, arrays and primitives from `override` replace `base`. */
export function deepMerge<T>(base: T, override: Json): T {
  if (!isPlainObject(override)) return (override === undefined ? base : (override as T));
  if (!isPlainObject(base)) return override as T;
  const out: Record<string, Json> = { ...(base as Record<string, Json>) };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    const b = (base as Record<string, Json>)[k];
    // "record" style maps (rules, positionOverrides, rookieScale, positionLimits) merge key-by-key too
    out[k] = isPlainObject(b) && isPlainObject(v) ? deepMerge(b, v) : v;
  }
  return out as T;
}

export function resolveSettings(stored: Json): LeagueSettings {
  return deepMerge(DEFAULT_SETTINGS, stored ?? {});
}

/** Returns a list of {path, from, to} differences (used for the settings audit history) */
export function diffSettings(before: Json, after: Json, prefix = ""): { path: string; from: Json; to: Json }[] {
  const out: { path: string; from: Json; to: Json }[] = [];
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) out.push(...diffSettings(before[k], after[k], prefix ? `${prefix}.${k}` : k));
    return out;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path: prefix, from: before, to: after });
  return out;
}

// Loose runtime validation for commissioner updates: structure must be an object; numbers must be finite.
export const settingsPatchSchema = z.record(z.string(), z.unknown());

export const SCORING_PRESETS: Record<"PPR" | "HALF_PPR" | "STANDARD", Partial<Record<string, number>>> = {
  PPR: { rec: 1 },
  HALF_PPR: { rec: 0.5 },
  STANDARD: { rec: 0 },
};

export const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Total starting slots */
export function starterSlotCount(s: LeagueSettings): number {
  return s.roster.slots.reduce((a, x) => a + x.count, 0);
}

/** Expand slot defs into an ordered list: [{key:"QB", index:0, label, eligible}, {key:"RB", index:0}, {key:"RB", index:1} ...] */
export function expandSlots(s: LeagueSettings) {
  const out: { key: string; index: number; label: string; eligible: string[] }[] = [];
  for (const def of s.roster.slots) for (let i = 0; i < def.count; i++) out.push({ key: def.key, index: i, label: def.label, eligible: def.eligible });
  return out;
}
