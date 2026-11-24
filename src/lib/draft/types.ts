// JSON shapes sent to the draft room clients (safe to import from client components).

export interface RoomTeam {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  ownerName: string | null;
}

export interface RoomPlayer {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  college: string | null;
  age: number | null;
  injuryStatus: string | null;
  isRookie: boolean;
  /** league rookie ranking */
  rank: number | null;
  tier: number | null;
  adp: number | null;
  /** my big board rank */
  boardRank: number | null;
  searchRank: number | null;
}

export interface RookieBoardPick {
  pickId: string;
  index: number;
  overall: number;
  round: number;
  pickInRound: number;
  ownerTeamId: string;
  originalTeamId: string;
  salary: number;
  selection: null | {
    playerId: string;
    fullName: string;
    position: string;
    team: string | null;
    college: string | null;
    salary: number;
    contractYears: number;
    isAutopick: boolean;
    madeAt: string;
  };
}

export type DraftStatusName = "SCHEDULED" | "LIVE" | "PAUSED" | "COMPLETE";

export interface RookieRoomState {
  kind: "ROOKIE";
  serverNow: string;
  draft: {
    id: string;
    name: string;
    season: number;
    status: DraftStatusName;
    currentIndex: number;
    pickDeadline: string | null;
    startTime: string | null;
    completedAt: string | null;
    pickTimerMinutes: number;
    pausedRemainingMs: number | null;
    rounds: number;
    style: "LINEAR" | "SNAKE";
    eligibility: "ROOKIES_ONLY" | "ROOKIES_AND_FREE_AGENTS";
    autopickSource: "BIG_BOARD" | "LEAGUE_RANKINGS" | "ADP";
    rookieContractYears: number;
  };
  /** teams in round-1 slot order (board columns) */
  teams: RoomTeam[];
  picks: RookieBoardPick[];
  myTeamId: string | null;
  isCommish: boolean;
  available: RoomPlayer[];
  availableTotal: number;
  queue: RoomPlayer[];
  positions: string[];
  timezone: string;
}

export interface AuctionLotView {
  id: string;
  sequence: number;
  status: "OPEN" | "SOLD" | "PASSED";
  player: RoomPlayer;
  nominatedByTeamId: string;
  currentBid: number;
  currentBidTeamId: string | null;
  winnerTeamId: string | null;
  contractYears: number;
  endsAt: string | null;
  soldAt: string | null;
  bids: { teamId: string; amount: number; at: string }[];
}

export interface AuctionBudgetView {
  teamId: string;
  spent: number;
  won: number;
  remaining: number;
  maxBid: number;
  openSpots: number;
  capSpace: number | null;
  wonByPosition: Record<string, number>;
}

export interface AuctionTarget {
  player: RoomPlayer;
  rank: number;
  maxBid: number | null;
  status: "AVAILABLE" | "ON_BLOCK" | "GONE";
}

export interface AuctionRoomState {
  kind: "AUCTION";
  serverNow: string;
  draft: {
    id: string;
    name: string;
    season: number;
    status: DraftStatusName;
    auctionKind: "STARTUP" | "FREE_AGENT";
    pickDeadline: string | null;
    startTime: string | null;
    completedAt: string | null;
    pausedRemainingMs: number | null;
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
    yearOptions: number[];
    defaultYears: number;
    capEnabled: boolean;
  };
  teams: RoomTeam[];
  /** nomination order (team ids) */
  order: string[];
  nominatorTeamId: string | null;
  nominatorIndex: number | null;
  /** upcoming nominators after the current one */
  upNext: string[];
  openLot: AuctionLotView | null;
  recent: AuctionLotView[];
  budgets: AuctionBudgetView[];
  myTeamId: string | null;
  isCommish: boolean;
  targets: AuctionTarget[];
  bestAvailable: RoomPlayer[];
  soldCount: number;
  positions: string[];
}

export type RoomState = RookieRoomState | AuctionRoomState;
