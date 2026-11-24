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
    // ── appended (commissioner settings catalog) ──
    leagueType: "DYNASTY" | "KEEPER" | "REDRAFT";
    /** League constitution / bylaws preamble shown at the top of the rulebook (plain text, blank lines = paragraphs) */
    constitution: string;
    maxManagersPerTeam: number;
    /** Stat corrections after this day/hour (league timezone) no longer change results */
    statCorrectionDay: Weekday;
    statCorrectionHour: number;
    duesDueDate: string | null;
    /** Teams that have paid this season's dues (commissioner tracker) */
    duesPaidTeamIds: string[];
    championTrophyName: string;
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
    // ── appended ──
    /** Larger active-roster limit allowed in the offseason (null = same as in season) */
    offseasonMaxActiveRoster: number | null;
    /** Date the offseason roster must be cut down to maxActiveRoster */
    rosterCutdownDate: string | null;
    allowEmptyStarterSlots: boolean;
    illegalRosterPolicy: "BLOCK_MOVES" | "ZERO_POINTS" | "COMMISSIONER";
    irMinWeeks: number;
    irAllowInOffseason: boolean;
    irActivationPolicy: "BLOCK_MOVES" | "AUTO_BENCH" | "NONE";
    taxiMaxSeasonsOnTaxi: number;
    taxiAddSources: ("ROOKIE_DRAFT" | "AUCTION" | "WAIVERS" | "FREE_AGENCY" | "TRADE")[];
    taxiAllowReturnAfterPromotion: boolean;
    taxiPlayersCanStart: boolean;
    taxiPoachCompensation: "NONE" | "FAAB" | "DRAFT_PICK" | "SALARY_RAISE";
    taxiPoachSalaryMultiplier: number;
    taxiOwnerCanMatchPoach: boolean;
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
    // ── appended ──
    /** Minutes before kickoff that a player locks */
    lockOffsetMinutes: number;
    defaultCarryOver: "PREVIOUS_WEEK" | "OPTIMAL_PROJECTED" | "EMPTY";
    autoSubsMaxPerWeek: number;
    autoSubRequireLaterKickoff: boolean;
    bestBall: boolean;
    eliminatedTeamsSetLineups: boolean;
    emptyStarterAlerts: boolean;
  };
  matchups: {
    format: "H2H" | "H2H_PLUS_MEDIAN" | "ALL_PLAY" | "POINTS_ONLY";
    allowTies: boolean;
    tiebreaker: "NONE" | "BENCH_POINTS" | "HIGHEST_STARTER" | "HOME_TEAM";
    scheduleType: "ROUND_ROBIN" | "DIVISION_WEIGHTED" | "MANUAL";
    divisionGamesTwice: boolean;
    rivalryWeek: number | null;
    rivalries: [string, string][];
    // ── appended ──
    /** Odd team counts: a weekly bye, or the extra team plays the league median */
    oddTeamCountPolicy: "BYE" | "MEDIAN_OPPONENT";
    /** Division-weighted schedules put the extra division games at the end of the regular season */
    divisionGamesLate: boolean;
  };
  standings: {
    tiebreakers: ("H2H" | "POINTS_FOR" | "DIVISION_RECORD" | "POINTS_AGAINST" | "ALL_PLAY" | "COIN_FLIP")[];
    divisionWinnersTopSeeds: boolean;
    showPowerRankings: boolean;
    powerRanking: { recordWeight: number; pointsWeight: number; allPlayWeight: number; recentFormWeight: number };
    // ── appended ──
    divisionTiebreakers: ("H2H" | "DIVISION_RECORD" | "POINTS_FOR" | "POINTS_AGAINST" | "ALL_PLAY" | "COIN_FLIP")[];
    /** How a tied playoff matchup is decided (playoff games never end in a tie) */
    playoffMatchupTiebreakers: ("BENCH_POINTS" | "HIGHER_SEED" | "HIGHEST_STARTER" | "COIN_FLIP")[];
    /** Ties in rookie draft order */
    draftOrderTiebreakers: ("MAX_POTENTIAL_POINTS" | "POINTS_FOR" | "POINTS_AGAINST" | "COIN_FLIP")[];
    showAllPlayRecord: boolean;
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
    // ── appended ──
    divisionWinnersQualify: boolean;
    placementGames: ("FIFTH" | "SEVENTH")[];
    medianGameInPlayoffs: boolean;
    eliminatedTeamsCanTransact: boolean;
    consolationStakes: "NONE" | "ROOKIE_PICK" | "PUNISHMENT" | "FAAB_BONUS";
    manualSeedingAllowed: boolean;
  };
  salaryCap: {
    enabled: boolean;
    cap: number;
    floor: number;
    minSalary: number;
    maxSalary: number | null;
    enforceInSeason: boolean;
    /** Flat dollars added to `cap` at each season rollover (not a percent). */
    annualCapIncrease: number;
    allowCapSpaceTrading: boolean;
    deadMoney: {
      enabled: boolean;
      currentSeasonPercent: number;
      futureSeasonPercent: number;
      rookieContractsExempt: boolean;
      waivedInSeasonBeforeWeek: number | null;
      // ── appended ──
      retirementForgives: boolean;
      /** Reduced current-season penalty for cuts before Week 1 (null = no discount) */
      preseasonCutPercent: number | null;
      /** Dead money is forgiven when another team claims the player off waivers */
      forgivenIfClaimed: boolean;
      deadMoneyTradable: boolean;
      /** Penalty-free "amnesty" releases each team may use over the life of the league */
      amnestyCutsPerTeam: number;
    };
    // ── appended ──
    capType: "HARD" | "SOFT";
    softCapMaxOverage: number | null;
    luxuryTaxRate: number;
    luxuryTaxPaidAs: "NEXT_YEAR_CAP" | "FAAB" | "DUES";
    floorPenalty: "NONE" | "CHARGE_DIFFERENCE" | "FORFEIT_PICK";
    /** Cap charge for each empty active-roster spot */
    emptyRosterSpotCharge: number;
    rolloverMode: "NONE" | "PERCENT_UNUSED" | "FULL_UNUSED";
    rolloverPercent: number;
    rolloverMax: number | null;
    offseasonEnforcement: "BLOCK_OVER_CAP_MOVES" | "ALLOW_UNTIL_COMPLIANCE_DATE" | "WARN_ONLY";
    complianceDate: string | null;
    overCapPenalty: "COMMISSIONER_RESOLVES" | "FREEZE_TRANSACTIONS" | "FORFEIT_PICK";
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
    franchiseTag: {
      enabled: boolean;
      perTeam: number;
      costMethod: "TOP5_AVG_AT_POSITION" | "RAISE_PERCENT";
      raisePercent: number;
      // ── appended ──
      topN: number;
      eligibility: "EXPIRING_ONLY" | "ANY_PLAYER";
      consecutiveMultiplier: number;
      maxConsecutive: number;
      years: number;
    };
    rookieContractYears: number;
    rookieFourthYearOption: boolean;
    rookieOptionRaisePercent: number;
    /** salary by pick number within each round. Index 0 = pick 1. */
    rookieScale: Record<string, number[]>;
    expiredContractsBecome: "FREE_AGENT" | "RFA";
    // ── appended ──
    extensionWindow: "FINAL_YEAR_OFFSEASON" | "ANY_OFFSEASON" | "ANY_TIME";
    extensionMaxYearsAdded: number;
    extensionsPerTeamPerSeason: number | null;
    /** e.g. at most 3 contracts of 4+ years per team */
    lengthLimits: { years: number; maxCount: number }[];
    inSeasonPickupMaxYears: number;
    raiseRounding: "UP" | "NEAREST" | "DOWN";
    raiseAppliesTo: "ALL" | "ALL_EXCEPT_ROOKIE" | "VETERANS_ONLY";
    rfaMatchWindowHours: number;
    rookieOptionRounds: number[];
    /** Salary for undrafted rookies signed in free agency (null = league minimum) */
    undraftedRookieSalary: number | null;
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
    // ── appended ──
    selectionBy: "OWNERS" | "COMMISSIONER";
    tradeCarriesKeeperCost: boolean;
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
    // ── appended ──
    bidIncrement: number;
    newPlayersStartOnWaivers: boolean;
    playoffMode: "SAME_AS_REGULAR" | "FAB_ONLY" | "FROZEN";
    eliminatedTeamsCanAdd: boolean;
    undroppablePlayerIds: string[];
    revealBids: "ALL_BIDS" | "WINNING_ONLY" | "NONE";
    /** Commissioner freeze on all adds */
    disableAdds: boolean;
    maxPendingClaims: number | null;
    maxClaimsWonPerRun: number | null;
    weeklyFaabAllowance: number;
    addDropFee: number;
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
    // ── appended ──
    voteEligibility: "NON_INVOLVED_TEAMS" | "ALL_TEAMS";
    allowUnbalanced: boolean;
    irPlayersTradable: boolean;
    taxiPlayersTradable: boolean;
    salaryRetentionMaxPercent: number;
    pickTradingRequiresPaidDues: boolean;
    commissionerTradesReviewedBy: "NONE" | "CO_COMMISSIONER" | "LEAGUE_VOTE";
    lockedPlayersPolicy: "PROCESS_AFTER_UNLOCK" | "BLOCK";
    maxPlayersPerSide: number | null;
  };
  draft: {
    rookie: {
      rounds: number;
      style: "LINEAR" | "SNAKE";
      orderMethod: "REVERSE_STANDINGS" | "REVERSE_MAX_PF" | "LOTTERY" | "REVERSE_POTENTIAL_POINTS";
      playoffTeamsByFinish: boolean;
      lottery: {
        teams: number;
        odds: number[];
        // ── appended ──
        /** How many picks are drawn by lottery (null = every lottery pick) */
        picksDrawn: number | null;
        /** A team can fall at most this many spots below its pre-lottery slot (null = no limit) */
        maxDropSpots: number | null;
        liveReveal: boolean;
      };
      pickTimerMinutes: number;
      autopickSource: "BIG_BOARD" | "LEAGUE_RANKINGS" | "ADP";
      eligibility: "ROOKIES_ONLY" | "ROOKIES_AND_FREE_AGENTS";
      scheduledFor: string | null;
      // ── appended ──
      consolationWinnerPick: "NONE" | "FIRST_NON_PLAYOFF" | "FIRST_OVERALL";
      onTimeout: "AUTOPICK" | "SKIP";
      overnightPause: boolean;
      pauseStartHour: number;
      pauseEndHour: number;
      tradingDuringDraft: boolean;
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
      // ── appended ──
      proxyBidding: boolean;
      autoNominateOnTimeout: boolean;
      nominatorOpeningBid: "ANY_AMOUNT" | "MIN_BID";
      includesRookies: boolean;
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
    // ── appended ──
    /** Default for the "notify managers" checkbox when the commissioner saves settings */
    settingsChangeNotifyDefault: boolean;
    announcementsToChat: boolean;
    announcementsNotify: boolean;
  };
  commissioner: {
    canEditLineups: boolean;
    canEditPastScores: boolean;
    coCommissionerFullPowers: boolean;
    managersSeeOtherQueues: boolean;
    publicTradeVotes: boolean;
    // ── appended ──
    /** Show the commissioner action log on the public rulebook page */
    auditLogVisibleToLeague: boolean;
    /** Settings sections that cannot be edited during the regular season / playoffs */
    lockedSectionsInSeason: string[];
    /** Settings sections whose in-season changes need a league vote (the commissioner records the result) */
    sectionsRequiringVote: string[];
    voteThresholdPercent: number;
    ownTeamActionsRequireCoCommish: boolean;
    /** Notify a team's manager when the commissioner edits their roster, contracts or FAB */
    notifyAffectedOwners: boolean;
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
    // ── appended ──
    guillotineEliminatedPerWeek: number;
    lastPlaceDeterminedBy: "TOILET_BOWL_LOSER" | "REGULAR_SEASON_RECORD" | "POINTS_FOR";
    lastPlaceTrophyName: string;
    lastPlaceDraftPenalty: "NONE" | "LOSE_FAAB" | "PICK_SWAP";
    punishmentDeadline: string | null;
    pickemEnabled: boolean;
    bountyEnabled: boolean;
    bountyDescription: string;
    /** Real-money fine per empty starting slot (collected with dues) */
    emptyStarterFine: number;
    chaosWeek: number | null;
    chaosWeekRule: string;
    rivalryTrophies: { name: string; teamA: string; teamB: string }[];
    weeklyAwards: ("TOP_SCORE" | "LOWEST_SCORE" | "BIGGEST_BLOWOUT" | "CLOSEST_GAME" | "BENCH_BLUNDER" | "WAIVER_HERO")[];
    hallOfFameEnabled: boolean;
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
    leagueType: "DYNASTY",
    constitution: "",
    maxManagersPerTeam: 2,
    statCorrectionDay: "THU",
    statCorrectionHour: 6,
    duesDueDate: null,
    duesPaidTeamIds: [],
    championTrophyName: "The CTE Dynasty Trophy",
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
    offseasonMaxActiveRoster: null,
    rosterCutdownDate: null,
    allowEmptyStarterSlots: true,
    illegalRosterPolicy: "BLOCK_MOVES",
    irMinWeeks: 0,
    irAllowInOffseason: true,
    irActivationPolicy: "BLOCK_MOVES",
    taxiMaxSeasonsOnTaxi: 3,
    taxiAddSources: ["ROOKIE_DRAFT", "TRADE"],
    taxiAllowReturnAfterPromotion: false,
    taxiPlayersCanStart: false,
    taxiPoachCompensation: "NONE",
    taxiPoachSalaryMultiplier: 2,
    taxiOwnerCanMatchPoach: true,
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
    lockOffsetMinutes: 0,
    defaultCarryOver: "PREVIOUS_WEEK",
    autoSubsMaxPerWeek: 0,
    autoSubRequireLaterKickoff: true,
    bestBall: false,
    eliminatedTeamsSetLineups: true,
    emptyStarterAlerts: true,
  },
  matchups: {
    format: "H2H",
    allowTies: true,
    tiebreaker: "NONE",
    scheduleType: "ROUND_ROBIN",
    divisionGamesTwice: false,
    rivalryWeek: null,
    rivalries: [],
    oddTeamCountPolicy: "BYE",
    divisionGamesLate: true,
  },
  standings: {
    tiebreakers: ["H2H", "POINTS_FOR", "DIVISION_RECORD", "POINTS_AGAINST", "COIN_FLIP"],
    divisionWinnersTopSeeds: false,
    showPowerRankings: true,
    powerRanking: { recordWeight: 0.35, pointsWeight: 0.35, allPlayWeight: 0.2, recentFormWeight: 0.1 },
    divisionTiebreakers: ["H2H", "DIVISION_RECORD", "POINTS_FOR", "COIN_FLIP"],
    playoffMatchupTiebreakers: ["BENCH_POINTS", "HIGHER_SEED"],
    draftOrderTiebreakers: ["POINTS_FOR", "COIN_FLIP"],
    showAllPlayRecord: true,
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
    divisionWinnersQualify: false,
    placementGames: [],
    medianGameInPlayoffs: false,
    eliminatedTeamsCanTransact: true,
    consolationStakes: "NONE",
    manualSeedingAllowed: true,
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
      retirementForgives: true,
      preseasonCutPercent: null,
      forgivenIfClaimed: false,
      deadMoneyTradable: false,
      amnestyCutsPerTeam: 0,
    },
    capType: "HARD",
    softCapMaxOverage: null,
    luxuryTaxRate: 0,
    luxuryTaxPaidAs: "NEXT_YEAR_CAP",
    floorPenalty: "NONE",
    emptyRosterSpotCharge: 0,
    rolloverMode: "NONE",
    rolloverPercent: 0,
    rolloverMax: null,
    offseasonEnforcement: "ALLOW_UNTIL_COMPLIANCE_DATE",
    complianceDate: null,
    overCapPenalty: "COMMISSIONER_RESOLVES",
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
    franchiseTag: {
      enabled: true,
      perTeam: 1,
      costMethod: "TOP5_AVG_AT_POSITION",
      raisePercent: 20,
      topN: 5,
      eligibility: "EXPIRING_ONLY",
      consecutiveMultiplier: 1.2,
      maxConsecutive: 2,
      years: 1,
    },
    rookieContractYears: 3,
    rookieFourthYearOption: true,
    rookieOptionRaisePercent: 50,
    rookieScale: ROOKIE_SCALE,
    expiredContractsBecome: "FREE_AGENT",
    extensionWindow: "FINAL_YEAR_OFFSEASON",
    extensionMaxYearsAdded: 3,
    extensionsPerTeamPerSeason: null,
    lengthLimits: [],
    inSeasonPickupMaxYears: 1,
    raiseRounding: "NEAREST",
    raiseAppliesTo: "ALL",
    rfaMatchWindowHours: 48,
    rookieOptionRounds: [1],
    undraftedRookieSalary: null,
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
    selectionBy: "OWNERS",
    tradeCarriesKeeperCost: true,
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
    bidIncrement: 1,
    newPlayersStartOnWaivers: true,
    playoffMode: "SAME_AS_REGULAR",
    eliminatedTeamsCanAdd: true,
    undroppablePlayerIds: [],
    revealBids: "ALL_BIDS",
    disableAdds: false,
    maxPendingClaims: null,
    maxClaimsWonPerRun: null,
    weeklyFaabAllowance: 0,
    addDropFee: 0,
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
    voteEligibility: "NON_INVOLVED_TEAMS",
    allowUnbalanced: true,
    irPlayersTradable: true,
    taxiPlayersTradable: true,
    salaryRetentionMaxPercent: 0,
    pickTradingRequiresPaidDues: false,
    commissionerTradesReviewedBy: "NONE",
    lockedPlayersPolicy: "PROCESS_AFTER_UNLOCK",
    maxPlayersPerSide: null,
  },
  draft: {
    rookie: {
      rounds: 2,
      style: "LINEAR",
      orderMethod: "REVERSE_STANDINGS",
      playoffTeamsByFinish: true,
      lottery: { teams: 6, odds: [25, 20, 17.5, 15, 12.5, 10], picksDrawn: null, maxDropSpots: null, liveReveal: true },
      pickTimerMinutes: 240,
      autopickSource: "BIG_BOARD",
      eligibility: "ROOKIES_ONLY",
      scheduledFor: null,
      consolationWinnerPick: "NONE",
      onTimeout: "AUTOPICK",
      overnightPause: false,
      pauseStartHour: 23,
      pauseEndHour: 8,
      tradingDuringDraft: true,
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
      proxyBidding: false,
      autoNominateOnTimeout: true,
      nominatorOpeningBid: "ANY_AMOUNT",
      includesRookies: true,
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
    settingsChangeNotifyDefault: true,
    announcementsToChat: true,
    announcementsNotify: true,
  },
  commissioner: {
    canEditLineups: true,
    canEditPastScores: true,
    coCommissionerFullPowers: false,
    managersSeeOtherQueues: false,
    publicTradeVotes: false,
    auditLogVisibleToLeague: true,
    lockedSectionsInSeason: [],
    sectionsRequiringVote: [],
    voteThresholdPercent: 67,
    ownTeamActionsRequireCoCommish: false,
    notifyAffectedOwners: true,
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
    guillotineEliminatedPerWeek: 1,
    lastPlaceDeterminedBy: "TOILET_BOWL_LOSER",
    lastPlaceTrophyName: "The Taco",
    lastPlaceDraftPenalty: "NONE",
    punishmentDeadline: null,
    pickemEnabled: false,
    bountyEnabled: false,
    bountyDescription: "",
    emptyStarterFine: 0,
    chaosWeek: null,
    chaosWeekRule: "",
    rivalryTrophies: [],
    weeklyAwards: ["TOP_SCORE", "BIGGEST_BLOWOUT", "CLOSEST_GAME", "BENCH_BLUNDER"],
    hallOfFameEnabled: true,
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
  return pruneTombstones(deepMerge(DEFAULT_SETTINGS, stored ?? {}));
}

// Record-style maps merge key-by-key with the defaults, so a default entry that the commissioner removed
// (e.g. the TE reception premium) would come back on the next resolve. A stored `null` entry is a
// tombstone that means "removed": resolveSettings drops it, withTombstones() writes it.
type NumMap = Record<string, number>;

function cleanNumMap(m: unknown): NumMap {
  const out: NumMap = {};
  if (!isPlainObject(m)) return out;
  for (const [k, v] of Object.entries(m)) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}

function pruneTombstones(s: LeagueSettings): LeagueSettings {
  const overrides: Record<string, NumMap> = {};
  for (const [pos, rules] of Object.entries((s.scoring.positionOverrides ?? {}) as Record<string, unknown>)) {
    const clean = cleanNumMap(rules);
    if (Object.keys(clean).length) overrides[pos] = clean;
  }
  const limits: LeagueSettings["roster"]["positionLimits"] = {};
  for (const [pos, lim] of Object.entries((s.roster.positionLimits ?? {}) as Record<string, unknown>)) {
    if (isPlainObject(lim)) limits[pos] = lim as { min: number; max: number | null };
  }
  const scale: Record<string, number[]> = {};
  for (const [round, arr] of Object.entries((s.contracts.rookieScale ?? {}) as Record<string, unknown>)) {
    if (Array.isArray(arr)) scale[round] = arr as number[];
  }
  return {
    ...s,
    scoring: { ...s.scoring, positionOverrides: overrides },
    roster: { ...s.roster, positionLimits: limits },
    contracts: { ...s.contracts, rookieScale: scale },
  };
}

/**
 * Settings JSON to store on League.settings: the full settings plus `null` tombstones for default map
 * entries (position overrides, position limits, rookie-scale rounds) that were removed.
 */
export function withTombstones(settings: LeagueSettings): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(settings)) as LeagueSettings & Record<string, unknown>;
  const po = out.scoring.positionOverrides as Record<string, Record<string, number | null> | null>;
  for (const [pos, rules] of Object.entries(DEFAULT_SETTINGS.scoring.positionOverrides)) {
    if (!po[pos]) {
      po[pos] = null;
      continue;
    }
    for (const stat of Object.keys(rules)) if (!(stat in po[pos]!)) po[pos]![stat] = null;
  }
  const limits = out.roster.positionLimits as Record<string, unknown>;
  for (const pos of Object.keys(DEFAULT_SETTINGS.roster.positionLimits)) if (!(pos in limits)) limits[pos] = null;
  const scale = out.contracts.rookieScale as Record<string, unknown>;
  for (const round of Object.keys(DEFAULT_SETTINGS.contracts.rookieScale)) if (!(round in scale)) scale[round] = null;
  return out;
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
