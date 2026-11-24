// Pure helpers for the players module (search filters, free-agent acquisition rules, injury status
// normalization, name matching for external feeds). No database access: safe for client + tests.
import { deadMoneyCharges, isPreseasonPhase } from "@/lib/roster-rules";
import type { LeagueSettings } from "@/lib/settings/schema";
import { DEFAULT_STAT_COLUMNS, normalizePosition } from "@/lib/settings/stat-catalog";
import type { StatMap } from "@/lib/scoring/engine";

// ───────────────────────────── Positions ─────────────────────────────

export const OFFENSE_FILTERS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF"] as const;
export const IDP_FILTERS = ["DL", "LB", "DB"] as const;
export type PositionFilter = "ALL" | (typeof OFFENSE_FILTERS)[number] | (typeof IDP_FILTERS)[number];

/** Raw `Player.position` values stored for each fantasy position */
export const RAW_POSITIONS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K", "PK"],
  DEF: ["DEF"],
  DL: ["DL", "DE", "DT", "NT", "EDGE"],
  LB: ["LB", "ILB", "OLB", "MLB"],
  DB: ["DB", "CB", "S", "SS", "FS"],
};

export function positionFilterOptions(settings: Pick<LeagueSettings, "roster">): PositionFilter[] {
  return ["ALL", ...OFFENSE_FILTERS, ...(settings.roster.idpEnabled ? IDP_FILTERS : [])];
}

export function parsePositionFilter(raw: string | null | undefined, settings: Pick<LeagueSettings, "roster">): PositionFilter {
  const v = (raw ?? "").toUpperCase();
  const opts = positionFilterOptions(settings) as string[];
  if (v === "DST" || v === "D/ST") return "DEF";
  return (opts.includes(v) ? v : "ALL") as PositionFilter;
}

/** Fantasy positions covered by a position filter */
export function fantasyPositionsFor(filter: PositionFilter, settings: Pick<LeagueSettings, "roster">): string[] {
  if (filter === "ALL") return ["QB", "RB", "WR", "TE", "K", "DEF", ...(settings.roster.idpEnabled ? IDP_FILTERS : [])];
  if (filter === "FLEX") return ["RB", "WR", "TE"];
  return [filter];
}

/** Raw DB position values for a filter (used in Prisma `position: { in }`) */
export function rawPositionsFor(filter: PositionFilter, settings: Pick<LeagueSettings, "roster">): string[] {
  return fantasyPositionsFor(filter, settings).flatMap((p) => RAW_POSITIONS[p] ?? [p]);
}

/** Stat columns shown for a position filter */
export function statColumnsFor(filter: PositionFilter): string[] {
  if (filter === "DL" || filter === "LB" || filter === "DB") return DEFAULT_STAT_COLUMNS.IDP;
  return DEFAULT_STAT_COLUMNS[filter] ?? DEFAULT_STAT_COLUMNS.ALL;
}

/** Stat columns for one player's own position (profile / card) */
export function statColumnsForPosition(position: string): string[] {
  const p = normalizePosition(position);
  if (p === "DL" || p === "LB" || p === "DB") return DEFAULT_STAT_COLUMNS.IDP;
  return DEFAULT_STAT_COLUMNS[p] ?? DEFAULT_STAT_COLUMNS.ALL;
}

// ───────────────────────────── Timeframes ─────────────────────────────

export const TIMEFRAMES = ["season", "avg", "last", "week", "proj", "ros"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export function parseTimeframe(raw: string | null | undefined): Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(raw ?? "") ? (raw as Timeframe) : "season";
}

export function timeframeLabel(tf: Timeframe, ctx: { week: number; season: number; specificWeek?: number | null }): string {
  switch (tf) {
    case "season":
      return `${ctx.season} totals`;
    case "avg":
      return `${ctx.season} per game`;
    case "last":
      return `Last week (Wk ${Math.max(1, ctx.week - 1)})`;
    case "week":
      return `Week ${ctx.specificWeek ?? ctx.week}`;
    case "proj":
      return `Week ${ctx.week} projection`;
    case "ros":
      return "Rest-of-season projection";
  }
}

/** True when projection-based (fractional stats) */
export function isProjectionTimeframe(tf: Timeframe) {
  return tf === "proj" || tf === "ros";
}

/**
 * First week of the "rest of season": the current week while any of its games has not kicked off,
 * otherwise the next week. Clamped to [1, lastWeek].
 */
export function restOfSeasonFrom(week: number, anyGameRemainingThisWeek: boolean, lastWeek: number): number {
  return Math.min(lastWeek, Math.max(1, anyGameRemainingThisWeek ? week : week + 1));
}

// ───────────────────────────── Stats math ─────────────────────────────

/** Did the player appear in the game? Mirrors `seasonPoints` in @/lib/points. */
export function playedInGame(stats: StatMap | null | undefined, points: number): boolean {
  if (!stats) return false;
  return Number(stats.gp ?? stats.gms_active ?? 0) > 0 || points !== 0;
}

export function sumStats(lines: (StatMap | null | undefined)[]): StatMap {
  const out: StatMap = {};
  for (const l of lines) {
    if (!l) continue;
    for (const [k, v] of Object.entries(l)) {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      out[k] = (out[k] ?? 0) + n;
    }
  }
  return out;
}

export function perGame(totals: StatMap, games: number): StatMap {
  if (!games) return {};
  const out: StatMap = {};
  for (const [k, v] of Object.entries(totals)) out[k] = v / games;
  return out;
}

export function round(n: number, d = 2) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

const GROUP_WORD: Record<string, string> = { Passing: "Pass", Rushing: "Rush", Receiving: "Rec" };

/** Readable short stat label that is unique across groups: "Pass Yds", "Rush TD", "Rec", "Tgt", "FL" */
export function statLabel(key: string, def?: { short: string; group: string }): string {
  if (!def) return key;
  const word = GROUP_WORD[def.group];
  if (!word || def.short === "Rec" || def.short === "Tgt") return def.short;
  return `${word} ${def.short}`;
}

/** Format a stat value: integers as-is, fractional values with one decimal */
export function fmtStat(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return v.toFixed(1);
}

/** Average of the last `n` played games (weeks ascending) */
export function lastNAverage(byWeek: Map<number, number> | Record<number, number>, playedWeeks: number[], n: number): number {
  const weeks = [...playedWeeks].sort((a, b) => a - b).slice(-n);
  if (!weeks.length) return 0;
  const get = (w: number) => (byWeek instanceof Map ? byWeek.get(w) : byWeek[w]) ?? 0;
  return round(weeks.reduce((a, w) => a + get(w), 0) / weeks.length);
}

/** Rank (1-based) of `value` among `values` (descending); ties share the best rank. */
export function rankOf(value: number, values: number[]): number {
  return values.filter((v) => v > value).length + 1;
}

// ───────────────────────────── Schedule ─────────────────────────────

/**
 * Bye weeks per NFL team: weeks (that have at least one scheduled game in the data) where the team
 * does not play.
 */
export function byeWeeksByTeam(games: { week: number; homeTeam: string; awayTeam: string }[]): Map<string, number[]> {
  const weeks = new Set<number>();
  const played = new Map<string, Set<number>>();
  for (const g of games) {
    weeks.add(g.week);
    for (const t of [g.homeTeam, g.awayTeam]) {
      if (!played.has(t)) played.set(t, new Set());
      played.get(t)!.add(g.week);
    }
  }
  const sorted = [...weeks].sort((a, b) => a - b);
  const out = new Map<string, number[]>();
  for (const [team, set] of played) out.set(team, sorted.filter((w) => !set.has(w)));
  return out;
}

/** "@ KC" / "vs KC" from a team's perspective */
export function opponentLabel(team: string, game: { homeTeam: string; awayTeam: string }): { opp: string; home: boolean; label: string } {
  const home = game.homeTeam === team;
  const opp = home ? game.awayTeam : game.homeTeam;
  return { opp, home, label: `${home ? "vs" : "@"} ${opp}` };
}

/** Result from a team's perspective, e.g. "W 27-20", "L 13-30", "T 17-17" */
export function gameResult(team: string, game: { homeTeam: string; homeScore: number; awayScore: number; state: string }): string | null {
  if (game.state !== "post") return null;
  const home = game.homeTeam === team;
  const us = home ? game.homeScore : game.awayScore;
  const them = home ? game.awayScore : game.homeScore;
  return `${us > them ? "W" : us < them ? "L" : "T"} ${us}-${them}`;
}

/** Point spread from a team's perspective ("-3.5", "+2", "PK") given the home spread */
export function teamSpread(team: string, game: { homeTeam: string; spread: number | null }): string | null {
  if (game.spread === null || game.spread === undefined) return null;
  const s = game.homeTeam === team ? game.spread : -game.spread;
  if (s === 0) return "PK";
  return s > 0 ? `+${s}` : `${s}`;
}

// ───────────────────────────── Free agency rules ─────────────────────────────

export type AcquisitionMode =
  | { kind: "add" }
  | { kind: "claim"; reason: string; processAt: Date }
  | { kind: "blocked"; reason: string };

export interface AcquisitionInput {
  settings: LeagueSettings;
  phase: string;
  /** team-level or team+player block (eliminated from the playoffs, re-add cooldown) */
  blockedReason?: string | null;
  /** LeaguePlayerState.waiverClearsAt */
  waiverClearsAt: Date | null;
  /** the player's NFL game this week has kicked off */
  gameStarted: boolean;
  now: Date;
  /** next scheduled waiver run: (from) => Date | null (inject nextWaiverRun) */
  nextRun: (from: Date) => Date | null;
}

/**
 * Should adding this (unrostered) player be immediate, a waiver claim, or blocked?
 *   - Waiver claims when the player is on waivers, when his game has started (lockPlayersAfterGameStart),
 *     or when the league has no continuous free agency (FAB / PRIORITY leagues).
 *   - FREE_FOR_ALL leagues add immediately unless the player is on waivers / game-locked.
 */
export function acquisitionMode(i: AcquisitionInput): AcquisitionMode {
  const w = i.settings.waivers;
  if (i.phase === "PLAYOFFS" && i.settings.playoffs.lockRostersInPlayoffs) return { kind: "blocked", reason: "Rosters are locked for the playoffs." };
  if (w.disableAdds) return { kind: "blocked", reason: "The commissioner has frozen all adds." };
  if (i.blockedReason) return { kind: "blocked", reason: i.blockedReason };
  const offseason = i.phase === "OFFSEASON" || i.phase === "KEEPER";
  if (offseason && !w.offseasonWaivers) return { kind: "add" };
  const onWaivers = !!i.waiverClearsAt && i.waiverClearsAt > i.now;
  const gameLocked = w.lockPlayersAfterGameStart && i.gameStarted && !offseason;
  const ffa = w.type === "FREE_FOR_ALL";
  // playoffMode FAB_ONLY: once the playoffs start every add goes through a claim
  const playoffClaimsOnly = i.phase === "PLAYOFFS" && w.playoffMode === "FAB_ONLY";
  const leagueRequiresClaims = (!ffa && !w.continuousFreeAgency) || playoffClaimsOnly;
  if (!onWaivers && !gameLocked && !leagueRequiresClaims) return { kind: "add" };

  let processAt: Date | null;
  if (onWaivers) {
    // first scheduled run at or after the moment he clears waivers
    processAt = i.nextRun(new Date(i.waiverClearsAt!.getTime() - 60_000));
    if (processAt && processAt <= i.now) processAt = i.nextRun(i.now);
  } else {
    processAt = i.nextRun(i.now);
  }
  if (!processAt) {
    if (onWaivers) return { kind: "blocked", reason: "He is on waivers and no waiver run is scheduled. Ask the commissioner to set waiver processing days." };
    if (gameLocked) return { kind: "blocked", reason: "His game has started. He can be added after the game." };
    return { kind: "blocked", reason: "No waiver run is scheduled. Ask the commissioner to set waiver processing days." };
  }
  const reason = onWaivers
    ? "On waivers"
    : gameLocked
      ? "Game has started — locked until waivers run"
      : playoffClaimsOnly
        ? "Playoff adds go through waivers"
        : "League adds go through waivers";
  return { kind: "claim", reason, processAt };
}

/**
 * Is a free agent locked because his NFL game this week kicked off (settings.waivers.lockPlayersAfterGameStart)?
 * The lock lasts until the next scheduled waiver run after kickoff; leagues without waiver runs only lock
 * while the game is in progress.
 */
export function isGameLocked(
  game: { startTime: Date; state: string } | null | undefined,
  settings: LeagueSettings,
  now: Date,
  lastRun: Date | null,
): boolean {
  if (!settings.waivers.lockPlayersAfterGameStart || !game) return false;
  const started = game.state !== "pre" || game.startTime <= now;
  if (!started) return false;
  if (lastRun) return game.startTime > lastRun;
  return game.state !== "post";
}

/**
 * Is a free agent locked by his NFL game? This week's game once it kicks off, and also last week's game while
 * it kicked off after the most recent waiver run (e.g. Tuesday, before the Wednesday run, after the NFL week
 * rolled over).
 */
export function freeAgentGameLocked(
  team: string | null,
  settings: LeagueSettings,
  games: Map<string, { startTime: Date; state: string }>,
  prevGames: Map<string, { startTime: Date; state: string }>,
  now: Date,
  lastRun: Date | null,
): boolean {
  if (!team) return false;
  if (isGameLocked(games.get(team), settings, now, lastRun)) return true;
  return !!lastRun && isGameLocked(prevGames.get(team), settings, now, lastRun);
}

/** Does a claim in this league carry a FAB bid? */
export function claimUsesFab(settings: LeagueSettings): boolean {
  return settings.waivers.type === "FAB";
}

/** Salary a player signs for when acquired off waivers / free agency */
export function signingSalary(settings: LeagueSettings, bid: number): number {
  const min = settings.salaryCap.minSalary;
  let s = settings.waivers.salaryEqualsBid ? Math.round(bid * (settings.waivers.salaryMultiplier || 1)) : min;
  s = Math.max(min, s);
  if (settings.salaryCap.maxSalary !== null && settings.salaryCap.maxSalary !== undefined) s = Math.min(settings.salaryCap.maxSalary, s);
  return s;
}

/** Contract years for a free-agent signing */
export function signingYears(settings: LeagueSettings): number {
  if (!settings.contracts.enabled) return 1;
  const y = settings.waivers.signedContractYears || settings.contracts.defaultFreeAgentYears || 1;
  return Math.max(Math.max(1, settings.contracts.minYears), Math.min(settings.contracts.maxYears, y));
}

/** Lowest legal FAB bid */
export function minimumBid(settings: LeagueSettings): number {
  return settings.waivers.allowZeroBids ? Math.max(0, settings.waivers.minBid) : Math.max(1, settings.waivers.minBid);
}

/** FAB bids must be a multiple of settings.waivers.bidIncrement */
export function bidStep(settings: LeagueSettings): number {
  return Math.max(1, Math.floor(settings.waivers.bidIncrement ?? 1));
}

/** Validate a FAB bid; returns an error message or null */
export function validateBid(settings: LeagueSettings, bid: number, balance: number): string | null {
  if (!Number.isInteger(bid) || bid < 0) return "Bid must be a whole number of dollars.";
  const min = minimumBid(settings);
  if (bid < min) return `The minimum bid is $${min}.`;
  const step = bidStep(settings);
  if (bid % step !== 0) return `Bids go up in $${step} increments.`;
  if (bid > balance) return `You only have $${balance} of FAB remaining.`;
  return null;
}

/**
 * Re-add cooldown (settings.waivers.dropCooldownHours): a team can't re-acquire a player it dropped until
 * this many hours have passed. Returns when the cooldown ends, or null when it doesn't apply.
 */
export function readdCooldownUntil(
  settings: LeagueSettings,
  state: { lastDroppedById: string | null; lastDroppedAt: Date | null } | null | undefined,
  teamId: string | null | undefined,
  now: Date,
): Date | null {
  const hours = settings.waivers.dropCooldownHours ?? 0;
  if (!hours || !teamId || !state?.lastDroppedAt || state.lastDroppedById !== teamId) return null;
  const until = new Date(state.lastDroppedAt.getTime() + hours * 3600_000);
  return until > now ? until : null;
}

/** settings.waivers.maxPendingClaims: error when a team already has the maximum number of pending claims */
export function pendingClaimLimitError(settings: LeagueSettings, pending: number): string | null {
  const max = settings.waivers.maxPendingClaims;
  if (max === null || max === undefined || pending < max) return null;
  return `You already have ${pending} pending claim${pending === 1 ? "" : "s"} (league max ${max}). Cancel one on the Waivers page first.`;
}

/** settings.waivers.undroppablePlayerIds */
export function isUndroppable(settings: LeagueSettings, playerId: string): boolean {
  return (settings.waivers.undroppablePlayerIds ?? []).includes(playerId);
}

// ───────────────────────────── Auction pool ─────────────────────────────

/** Block reason for players held for the auction pool (settings.keepers.releasedPlayersReturnTo = AUCTION_POOL). */
export const AUCTION_POOL_REASON = "Returns to the auction pool";

/** Was this transaction a contract-expiry release at the season rollover (tagged by @/lib/season/rollover)? */
export function isRolloverRelease(tx: { type: string; details: unknown }): boolean {
  if (tx.type !== "KEEPER" || !tx.details || typeof tx.details !== "object") return false;
  return (tx.details as { rolloverRelease?: unknown }).rolloverRelease === true;
}

/**
 * settings.keepers.releasedPlayersReturnTo = AUCTION_POOL: players released at this season's rollover can't be
 * added as free agents or claimed on waivers until that season's salary auction is complete. Returns the
 * block reason, or null when the player is free to acquire.
 */
export function auctionPoolHold(
  settings: Pick<LeagueSettings, "keepers">,
  player: { releasedAtRollover: boolean },
  league: { auctionComplete: boolean },
): string | null {
  if (settings.keepers.releasedPlayersReturnTo !== "AUCTION_POOL") return null;
  if (!player.releasedAtRollover || league.auctionComplete) return null;
  return AUCTION_POOL_REASON;
}

/** Longer explanation for the add / claim dialog. */
export function auctionPoolDetail(season: number): string {
  return `${AUCTION_POOL_REASON}: his contract expired when the league rolled over to ${season}, so he can only be signed in the ${season} auction. He becomes a free agent once that auction is complete.`;
}

/** Dead money that dropping this contract would create (mirrors dropPlayerFromTeam in @/lib/roster-ops). */
export function deadMoneyPreview(
  spot: { salary: number; contractYears: number; isRookieContract?: boolean },
  settings: LeagueSettings,
  season: number,
  week: number,
  phase?: string | null,
): { season: number; amount: number }[] {
  return deadMoneyCharges(spot, settings, season, week, { preseason: isPreseasonPhase(phase) });
}

/** Acquisition-limit check. Returns an error or null. */
export function acquisitionLimitError(settings: LeagueSettings, usedThisWeek: number, usedThisSeason: number): string | null {
  const w = settings.waivers;
  if (w.maxAcquisitionsPerWeek !== null && w.maxAcquisitionsPerWeek !== undefined && usedThisWeek >= w.maxAcquisitionsPerWeek)
    return `Weekly acquisition limit reached (${usedThisWeek}/${w.maxAcquisitionsPerWeek}).`;
  if (w.maxAcquisitionsPerSeason !== null && w.maxAcquisitionsPerSeason !== undefined && usedThisSeason >= w.maxAcquisitionsPerSeason)
    return `Season acquisition limit reached (${usedThisSeason}/${w.maxAcquisitionsPerSeason}).`;
  return null;
}

/** Transaction types that count as acquisitions toward limits */
export const ACQUISITION_TX_TYPES = ["ADD", "WAIVER"];

// ───────────────────────────── Injuries ─────────────────────────────

/** Normalize feed statuses ("Injured Reserve", "out", "Q") to the app's vocabulary. Healthy → "Active". */
export function normalizeInjuryStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "active" || s === "a" || s === "healthy" || s === "probable") return "Active";
  if (s === "q" || s.startsWith("question")) return "Questionable";
  if (s === "d" || s.startsWith("doubt")) return "Doubtful";
  if (s === "o" || s === "out") return "Out";
  if (s === "ir" || s.includes("injured reserve") || s === "ir-r") return "IR";
  if (s.includes("pup") || s.includes("physically unable")) return "PUP";
  if (s.startsWith("sus")) return "Sus";
  if (s === "na" || s.includes("non-football") || s === "nfi") return "NA";
  if (s.includes("day-to-day") || s === "dtd") return "Questionable";
  return raw!.trim();
}

/** 0 healthy · 1 questionable · 2 doubtful · 3 out / suspended / NA · 4 IR / PUP */
export function injurySeverity(status: string | null | undefined): number {
  const s = normalizeInjuryStatus(status);
  switch (s) {
    case "Active":
      return 0;
    case "Questionable":
      return 1;
    case "Doubtful":
      return 2;
    case "Out":
    case "Sus":
    case "NA":
    case "COV":
    case "DNR":
      return 3;
    case "IR":
    case "PUP":
      return 4;
    default:
      return 1;
  }
}

export type InjuryGroup = "OUT" | "IR" | "DOUBTFUL" | "QUESTIONABLE" | "OTHER";
export const INJURY_GROUPS: { key: InjuryGroup; label: string }[] = [
  { key: "OUT", label: "Out" },
  { key: "IR", label: "Injured reserve / PUP" },
  { key: "DOUBTFUL", label: "Doubtful" },
  { key: "QUESTIONABLE", label: "Questionable" },
  { key: "OTHER", label: "Other designations" },
];

export function injuryGroup(status: string | null | undefined): InjuryGroup {
  const s = normalizeInjuryStatus(status);
  if (s === "Out") return "OUT";
  if (s === "IR" || s === "PUP") return "IR";
  if (s === "Doubtful") return "DOUBTFUL";
  if (s === "Questionable") return "QUESTIONABLE";
  return "OTHER";
}

export interface EffectiveInjury {
  /** null = healthy */
  status: string | null;
  bodyPart: string | null;
  note: string | null;
  detail: string | null;
  returnDate: Date | null;
  updatedAt: Date | null;
  source: "ESPN" | "SLEEPER" | null;
}

/**
 * Current injury designation. The ESPN report (synced every few minutes) wins when it is recent;
 * otherwise fall back to the Sleeper player record (synced daily).
 */
export function effectiveInjury(
  player: { injuryStatus: string | null; injuryBodyPart?: string | null; injuryNotes?: string | null },
  latest: { status: string; bodyPart: string | null; shortComment: string | null; longComment: string | null; returnDate: Date | null; reportedAt: Date } | null | undefined,
  now = new Date(),
  maxAgeDays = 45,
): EffectiveInjury {
  if (latest && now.getTime() - latest.reportedAt.getTime() <= maxAgeDays * 86_400_000) {
    const s = normalizeInjuryStatus(latest.status);
    if (s === "Active")
      return { status: null, bodyPart: null, note: latest.shortComment, detail: latest.longComment, returnDate: null, updatedAt: latest.reportedAt, source: "ESPN" };
    return {
      status: s,
      bodyPart: latest.bodyPart ?? player.injuryBodyPart ?? null,
      note: latest.shortComment,
      detail: latest.longComment,
      returnDate: latest.returnDate,
      updatedAt: latest.reportedAt,
      source: "ESPN",
    };
  }
  if (!player.injuryStatus) return { status: null, bodyPart: null, note: null, detail: null, returnDate: null, updatedAt: null, source: null };
  return {
    status: normalizeInjuryStatus(player.injuryStatus),
    bodyPart: player.injuryBodyPart ?? null,
    note: player.injuryNotes ?? null,
    detail: null,
    returnDate: null,
    updatedAt: null,
    source: "SLEEPER",
  };
}

// Unambiguous injury vocabulary
/**
 * Practice participation read from an injury-report note when no official designation is on file:
 * "DNP" (did not practice / non-participant), "LP" (limited), "FP" (full).
 */
export function practiceFromText(text: string | null | undefined): "DNP" | "LP" | "FP" | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(did not practice|didn't practice|non-participant|nonparticipant|sat out practice|not practicing|dnp)\b/.test(t)) return "DNP";
  if (/\b(limited participant|limited practice|was limited|limited in practice|practiced on a limited basis)\b/.test(t)) return "LP";
  if (/\b(full participant|practiced fully|full practice|fully participated)\b/.test(t)) return "FP";
  return null;
}

const INJURY_RE =
  /\b(injur(y|ies|ed)|ruled out|out for (the )?(season|year|week|game)|questionable|doubtful|injured reserve|IR|concussion|ankle|knee|hamstring|groin|quadriceps|achilles|acl|mcl|meniscus|pectoral|oblique|illness|sprain(ed)?|strain(ed)?|fracture[ds]?|torn|surgery|season-ending|sidelined|limited practice|did not practice|DNP|week-to-week|day-to-day|PUP|activated from)\b/i;
// Body parts that are also everyday words only count in the Rotowire "Name (back)" form
const BODY_PART_PAREN_RE = /\([^)]*\b(back|hand|foot|toe|hip|chest|neck|shoulder|wrist|elbow|finger|thumb|heel|calf|ribs?|quad|abdomen|knee|ankle|head|eye|jaw|forearm|biceps?|triceps?|glute|lower leg|shin)\b[^)]*\)/i;

/** Heuristic: does a headline / blurb describe an injury? */
export function isInjuryText(text: string | null | undefined): boolean {
  if (!text) return false;
  return INJURY_RE.test(text) || BODY_PART_PAREN_RE.test(text);
}

// ───────────────────────────── Name matching (external feeds) ─────────────────────────────

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Normalized name key: lowercase, no punctuation, no generational suffix ("Travis Etienne Jr." → "travisetienne") */
export function nameKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.'’`]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join("").replace(/[^a-z0-9]/g, "");
}

/** Extract an ESPN athlete id from a player-card URL (".../player/_/id/4362628/jamarr-chase") */
export function espnIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /\/id\/(\d+)(?:\/|$)/.exec(url);
  return m ? m[1]! : null;
}

/** Stable short content key for de-duplicating identical blurbs from two feeds */
export function textKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// ───────────────────────────── Sorting ─────────────────────────────

export type SortDir = "asc" | "desc";

/** Compare with nulls/undefined always last */
export function compareValues(a: number | string | null | undefined, b: number | string | null | undefined, dir: SortDir): number {
  const an = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bn = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  let c: number;
  if (typeof a === "string" || typeof b === "string") c = String(a).localeCompare(String(b));
  else c = (a as number) - (b as number);
  return dir === "asc" ? c : -c;
}

/** Default sort direction for a sort key (names / age / bye ascending, numbers descending) */
export function defaultSortDir(key: string): SortDir {
  return key === "name" || key === "age" || key === "bye" || key === "owner" || key === "rank" || key === "opp" ? "asc" : "desc";
}

export function pageCount(total: number, perPage: number) {
  return Math.max(1, Math.ceil(total / perPage));
}
