// Serializable view models for the League Home dashboard (shared by the server loaders in ./data.ts
// and the client widgets). No runtime imports.
import type { KeyDate, LineupIssue, RecapTeaser, UpcomingOpponent, WeekStatus } from "./logic";

export interface TeamLite {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export interface PlayerLite {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  injuryStatus: string | null;
}

/** Result wrapper so one failing module never takes down the whole dashboard */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

// ───────── Hero ─────────
export interface HeroAnnouncement {
  id: string;
  title: string;
  body: string;
  author: string | null;
  createdAt: string;
}

export interface HeroActionItem {
  key: string;
  label: string;
  href: string;
  count: number;
  tone: "brand" | "gold" | "red" | "green";
}

export interface HeroData {
  leagueName: string;
  logoUrl: string | null;
  season: number;
  week: number;
  phase: string;
  phaseLabel: string;
  roundLabel: string | null;
  weekStatus: WeekStatus;
  commissionerMessage: string;
  announcements: HeroAnnouncement[];
  myTeam: (TeamLite & { record: string; rank: number | null; pointsFor: number; teams: number }) | null;
  /** FAB balance when the league uses FAB waivers */
  faab: number | null;
  /** cap space when the salary cap is enabled */
  capSpace: number | null;
  actions: HeroActionItem[];
}

// ───────── Matchup ─────────
export interface MatchupPlayerLite {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  points: number;
  projected: number;
  kickoff: string | null;
}

export interface MatchupSide {
  team: TeamLite;
  ownerName: string | null;
  record: string | null;
  rank: number | null;
  seed: number | null;
  score: number;
  projected: number;
  yetToPlay: number;
  inProgress: number;
  starters: number;
  top: MatchupPlayerLite | null;
  pending: MatchupPlayerLite[];
}

export interface MyMatchupData {
  id: string;
  week: number;
  status: string;
  label: string | null;
  isPlayoff: boolean;
  homeTeamId: string | null;
  /** home win probability (0..1) */
  homeWinProb: number;
  winnerTeamId: string | null;
  me: MatchupSide;
  /** null = bye */
  opponent: MatchupSide | null;
  myIsHome: boolean;
  decimals: number;
}

export interface MatchupModule {
  week: number;
  hasTeam: boolean;
  matchup: MyMatchupData | null;
  /** next scheduled matchup (shown when this week is final or a bye) */
  nextUp: { week: number; opponent: TeamLite | null; matchupId: string } | null;
}

// ───────── Lineup alert ─────────
export interface LineupAlertData {
  week: number;
  /** week differs from the league week (current week is final) */
  isNextWeek: boolean;
  href: string;
  issues: LineupIssue[];
  actionable: number;
  watch: number;
  summary: string;
  emptySlotPenalty: number;
  /** best-ball leagues set lineups automatically */
  bestBall: boolean;
  /** the whole week is locked (first-game lock passed) */
  weekLocked: boolean;
}

// ───────── Scoreboard ─────────
export interface ScoreboardSide {
  team: TeamLite;
  record: string | null;
  score: number;
  projected: number;
}

export interface ScoreboardTile {
  id: string;
  status: string;
  label: string | null;
  isPlayoff: boolean;
  homeWinProb: number;
  winnerTeamId: string | null;
  home: ScoreboardSide | null;
  away: ScoreboardSide | null;
}

export interface ScoreboardData {
  week: number;
  decimals: number;
  tiles: ScoreboardTile[];
}

// ───────── Standings ─────────
export interface StandingsSnapshotRow {
  team: TeamLite;
  rank: number;
  record: string;
  pointsFor: number;
  streak: string;
  gamesBack: number;
  seed: number | null;
  playoffPct: number | null;
  marker: "x" | "y" | "z" | "e" | null;
  isMine: boolean;
}

export interface StandingsSnapshotData {
  rows: StandingsSnapshotRow[];
  myRowDetached: boolean;
  cutAfterRank: number | null;
  playoffTeams: number;
  byes: number;
  hasOdds: boolean;
  oddsAsOf: string | null;
  totalTeams: number;
  anyGames: boolean;
  decimals: number;
}

// ───────── Schedule ─────────
export interface UpcomingData {
  opponents: (UpcomingOpponent & { team: TeamLite | null })[];
  keyDates: KeyDate[];
  timezone: string;
  hasTeam: boolean;
}

// ───────── Transactions ─────────
export interface FeedTrade {
  kind: "trade";
  key: string;
  tradeId: string;
  status: string;
  at: string;
  sides: { team: TeamLite | null; items: string[] }[];
}

export interface FeedMove {
  kind: "move";
  key: string;
  at: string;
  type: string;
  team: TeamLite | null;
  lines: { type: string; text: string; player: PlayerLite | null }[];
}

export type FeedEntry = FeedTrade | FeedMove;

// ───────── News & injuries ─────────
export interface NewsLite {
  id: string;
  headline: string;
  summary: string | null;
  url: string | null;
  source: string;
  category: string;
  publishedAt: string;
  players: PlayerLite[];
}

export interface InjuryLite {
  player: PlayerLite;
  bodyPart: string | null;
  practice: string | null;
  notes: string | null;
  starting: boolean;
  rosterStatus: string;
}

export interface NewsModule {
  hasTeam: boolean;
  news: NewsLite[];
  injuries: InjuryLite[];
}

// ───────── Chat ─────────
export interface ChatAuthor {
  name: string;
  avatarUrl: string | null;
  team: Pick<TeamLite, "abbrev" | "primaryColor"> | null;
}

export interface ChatPreviewMessage {
  id: string;
  userId: string | null;
  kind: string;
  body: string;
  createdAt: string;
}

export interface ChatModule {
  channelId: string | null;
  channelName: string;
  messages: ChatPreviewMessage[];
  authors: Record<string, ChatAuthor>;
}

// ───────── League pulse (rule votes, recap, power) ─────────
export interface RuleVoteLite {
  id: string;
  title: string;
  category: string;
  votingEndsAt: string | null;
  support: number;
  oppose: number;
  abstain: number;
  myVote: number | null;
}

export interface PowerLite {
  team: TeamLite;
  powerRank: number;
  powerScore: number;
  record: string;
  rank: number;
}

export interface PulseData {
  votes: RuleVoteLite[];
  totalVoters: number;
  recap: (RecapTeaser & { week: number; season: number; title: string; createdAt: string; teams: Record<string, TeamLite> }) | null;
  recapsEnabled: boolean;
  recapSchedule: string;
  power: PowerLite[];
  showPower: boolean;
}
