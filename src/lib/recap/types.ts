// Structured weekly recap content (stored as WeeklyRecap.content JSON). Every section is computed from
// the week's real data by src/lib/recap/generate.ts; renderers (web page + email) only read this shape.
// Safe to import from client components (no server dependencies).

/** Bump when the content shape changes: older stored recaps are rebuilt on demand. */
export const RECAP_VERSION = 2;

export type AwardKey =
  | "TOP_SCORE"
  | "LOWEST_SCORE"
  | "BIGGEST_BLOWOUT"
  | "CLOSEST_GAME"
  | "BEST_DECISION"
  | "BENCH_BLUNDER"
  | "LUCKIEST_WIN"
  | "UNLUCKIEST_LOSS"
  | "WAIVER_HERO";

/** Awards that commissioners toggle in settings.niche.weeklyAwards (the rest are always handed out). */
export const CONFIGURABLE_AWARDS = ["TOP_SCORE", "LOWEST_SCORE", "BIGGEST_BLOWOUT", "CLOSEST_GAME", "BENCH_BLUNDER", "WAIVER_HERO"] as const;
export type ConfigurableAward = (typeof CONFIGURABLE_AWARDS)[number];

export interface RecapTeam {
  id: string;
  name: string;
  abbrev: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  owner: string | null;
  /** record after this week ("7-4"), regular season only */
  record: string | null;
  /** standings rank after this week */
  rank: number | null;
}

export interface RecapPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
}

export interface PlayerPerf extends RecapPlayer {
  points: number;
  projected: number;
  /** lineup slot label when started ("RB", "W/R/T") */
  slot?: string | null;
}

export interface BenchMiss {
  benched: PlayerPerf;
  started: PlayerPerf;
  slotLabel: string;
  /** benched − started */
  diff: number;
}

export interface LineupDecision {
  slotLabel: string;
  started: PlayerPerf;
  alternative: PlayerPerf;
  /** started − alternative (actual points) */
  margin: number;
  /** projected(started) − projected(alternative): small or negative = a real choice */
  projGap: number;
}

export interface RecapSide {
  teamId: string;
  /** official matchup score (includes commissioner adjustments) */
  score: number;
  /** pre-game projected total of the lineup that was started */
  projected: number;
  starterPoints: number;
  optimalPoints: number;
  /** starterPoints / optimalPoints (1 = perfect) */
  efficiency: number;
  pointsLeft: number;
  top: PlayerPerf | null;
  benchMiss: BenchMiss | null;
  won: boolean;
  /** lost, but the hindsight-optimal lineup would have won */
  optimalWouldWin: boolean;
}

export type MatchupKind = "REGULAR" | "PLAYOFF" | "CONSOLATION";

export interface RecapMatchup {
  id: string;
  label: string | null;
  kind: MatchupKind;
  home: RecapSide;
  away: RecapSide;
  winnerTeamId: string | null;
  margin: number;
  combined: number;
  /** pre-game home win probability (first live win-probability point), when tracked */
  preGameHomeWinProb: number | null;
  /** lowest win probability the eventual winner had during the week, when tracked */
  winnerLowWinProb: number | null;
  /** home win probability over the week (downsampled, 0..1) */
  wpSeries: number[];
  rivalry: string | null;
  blurb: string;
}

export interface MatchupOfWeek {
  matchupId: string;
  reason: "COMEBACK" | "CLOSEST" | "SHOOTOUT" | "UPSET";
  reasonLabel: string;
  summary: string;
  /** max − min home win probability during the game (0..1) */
  wpSwing: number | null;
}

export interface RecapAward {
  key: AwardKey;
  title: string;
  teamId: string;
  /** big value on the card ("172.4 pts", "+18.2", "96%") */
  value: string;
  detail: string;
  player?: PlayerPerf | null;
  matchupId?: string | null;
}

export interface EfficiencyRow {
  teamId: string;
  starterPoints: number;
  optimalPoints: number;
  efficiency: number;
  pointsLeft: number;
}

export interface TopPerformer extends PlayerPerf {
  ownerTeamId: string | null;
  started: boolean;
  statLine: string;
}

export interface RecapTradeSide {
  teamId: string;
  received: string[];
}

export interface RecapTrade {
  tradeId: string;
  at: string;
  status: "COMPLETED" | "REVERSED";
  sides: RecapTradeSide[];
}

export interface RecapMove {
  at: string;
  type: "ADD" | "DROP" | "WAIVER";
  teamId: string | null;
  player: RecapPlayer | null;
  faab: number | null;
  description: string;
}

export interface RecapTransactions {
  trades: RecapTrade[];
  moves: RecapMove[];
  adds: number;
  drops: number;
  faabSpent: number;
  mostActiveTeamId: string | null;
  biggestFaab: { teamId: string; player: RecapPlayer | null; amount: number } | null;
}

export interface StandingsMoveRow {
  teamId: string;
  rank: number;
  prevRank: number | null;
  /** positive = moved up */
  change: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  streak: string;
  result: "W" | "L" | "T" | null;
}

export interface OddsMoveRow {
  teamId: string;
  before: number;
  after: number;
  delta: number;
  champAfter: number;
}

export interface RecapPlayoffOdds {
  /** results through these weeks */
  fromWeek: number | null;
  toWeek: number | null;
  rows: OddsMoveRow[];
}

export interface PreviewSide {
  teamId: string;
  projected: number;
  winProb: number;
}

export interface PreviewMatchup {
  id: string;
  label: string | null;
  home: PreviewSide;
  away: PreviewSide;
}

export interface MarqueeGame {
  id: string;
  away: string;
  home: string;
  kickoff: string;
  spread: number | null;
  overUnder: number | null;
  oddsDetails: string | null;
  /** league starters playing in this game */
  starters: number;
  starterProjection: number;
}

export interface RecapNextWeek {
  week: number;
  matchups: PreviewMatchup[];
  marquee: MarqueeGame[];
}

export interface InjuryWatchRow {
  teamId: string;
  player: RecapPlayer;
  status: string;
  bodyPart: string | null;
  practice: string | null;
  projected: number;
  slot: string;
}

export interface RecapWeekStats {
  teams: number;
  highScore: number;
  lowScore: number;
  average: number;
  median: number;
  totalPoints: number;
  averageEfficiency: number;
}

export interface RecapContent {
  version: number;
  leagueId: string;
  leagueName: string;
  season: number;
  week: number;
  /** "Week 11" or "Week 15 · Playoffs" */
  weekLabel: string;
  /** decimals used for fantasy points (settings.scoring.decimals) */
  decimals: number;
  /** league timezone (settings.general.timezone) for rendering times */
  timezone: string;
  generatedAt: string;
  headline: string;
  intro: string;
  /** chaos week / special rule note, when configured for this week */
  specialNote: string | null;
  teams: Record<string, RecapTeam>;
  stats: RecapWeekStats;
  matchupOfWeek: MatchupOfWeek | null;
  matchups: RecapMatchup[];
  awards: RecapAward[];
  efficiency: EfficiencyRow[];
  topPerformers: TopPerformer[];
  transactions: RecapTransactions;
  standings: StandingsMoveRow[];
  /** last-place trophy holder after the week (settings.niche.tacoTrophy) */
  lastPlace: { teamId: string; trophy: string } | null;
  playoffOdds: RecapPlayoffOdds | null;
  nextWeek: RecapNextWeek | null;
  injuries: InjuryWatchRow[];
}

/** Light shape check for stored JSON (older or foreign rows fail and get rebuilt). */
export function isRecapContent(v: unknown): v is RecapContent {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<RecapContent>;
  return c.version === RECAP_VERSION && typeof c.headline === "string" && Array.isArray(c.matchups) && Array.isArray(c.awards) && !!c.teams && typeof c.teams === "object";
}
