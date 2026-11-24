// Shared types for the live scoring module (server + client safe: no runtime imports).

export type TdScope = "MY_STARTERS" | "MY_ROSTER" | "MY_MATCHUP" | "LEAGUE" | "OFF";
export const TD_SCOPES: TdScope[] = ["MY_STARTERS", "MY_ROSTER", "MY_MATCHUP", "LEAGUE", "OFF"];

export type LiveGameState = "pre" | "in" | "post" | "bye";

/** Compact NFL game used by the scoreboard rail and player cells (serializable). */
export interface GameLite {
  id: string;
  homeTeam: string;
  awayTeam: string;
  state: string;
  statusDetail: string | null;
  homeScore: number;
  awayScore: number;
  period: number | null;
  clock: string | null;
  /** NFL team abbreviation with the ball (normalized from ESPN ids) */
  possession: string | null;
  redZone: boolean;
  startTime: string;
  spread: number | null;
  overUnder: number | null;
  oddsDetails: string | null;
  broadcast: string | null;
}

/** topic league:<id>, type "nfl.games" — NFL game clocks / scores changed (live poller or simulation) */
export interface NflGamesEvent {
  season: number;
  week: number;
  games: GameLite[];
}

/** topic league:<id>, type "sim.status" — commissioner live simulation progress */
export interface SimStatusEvent {
  active: boolean;
  status: "running" | "complete" | "idle";
  season: number;
  week: number;
  step: number;
  totalSteps: number;
  clearsAt: string | null;
}

export interface ScoringBreakdownLine {
  label: string;
  value: number;
  points: number;
}

// ───────────────────────────── Page view models (serializable) ─────────────────────────────

export interface TeamRef {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  record: string;
  rank: number | null;
  managers: { id: string; name: string }[];
}

export interface TopPerformer {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  points: number;
}

export interface CardSide {
  team: TeamRef;
  seed: number | null;
  score: number;
  projected: number;
  yetToPlay: number;
  inProgress: number;
  done: number;
  top: TopPerformer | null;
}

export interface ScoreboardCard {
  id: string;
  week: number;
  status: string;
  label: string | null;
  homeWinProb: number;
  isMine: boolean;
  home: CardSide | null;
  away: CardSide | null;
}

export interface BigPlay {
  id: string;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  statKey: string;
  points: number;
  description: string;
  fantasyTeam: { id: string; abbrev: string; primaryColor: string } | null;
  at: string;
}

export interface PlayerCell {
  slot: string;
  slotLabel: string;
  player: { id: string; name: string; position: string; nflTeam: string | null; injuryStatus: string | null } | null;
  points: number;
  projected: number;
  liveProjected: number;
  gameState: LiveGameState;
  gameId: string | null;
  opp: string;
  statLine: string;
  breakdown: ScoringBreakdownLine[];
  remaining: number;
  /** lineup.autoSubOutPlayers: name of the inactive starter this player replaced */
  autoSubFor?: string | null;
}

export interface MatchupSide {
  team: TeamRef;
  seed: number | null;
  score: number;
  projected: number;
  liveProjected: number;
  yetToPlay: number;
  inProgress: number;
  done: number;
  starters: PlayerCell[];
  bench: PlayerCell[];
  reserve: PlayerCell[];
  benchPoints: number;
  optimalPoints: number;
  adjustments: number;
}

export interface WpPoint {
  at: string;
  homeWinProb: number;
  homeScore: number;
  awayScore: number;
}
