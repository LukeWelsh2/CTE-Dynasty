// Shared payload shapes for live events (server publishes, client consumes).

/** topic league:<id>, type "score.update" — one per matchup whose score changed */
export interface ScoreUpdateEvent {
  matchupId: string;
  week: number;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeScore: number;
  awayScore: number;
  homeProjected: number;
  awayProjected: number;
  homeWinProb: number;
  status: string;
}

/** topic league:<id>, type "player.points" — a player's fantasy points changed (live) */
export interface PlayerPointsEvent {
  playerId: string;
  week: number;
  points: number;
  delta: number;
  description?: string;
  teamIds: string[]; // fantasy teams that roster the player
}

/** topic league:<id>, type "scoring.play" — big play / touchdown ticker */
export interface ScoringPlayEvent {
  id: string;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  statKey: string;
  points: number;
  description: string;
  fantasyTeamId: string | null;
  at: string;
}

/** topic league:<id>, type "scores.refresh" — clients should router.refresh() */
export interface ScoresRefreshEvent {
  week: number;
}
