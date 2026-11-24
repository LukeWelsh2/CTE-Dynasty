// Roster-move and lineup-week rules shared by the My Team page (to show what's possible) and the server
// actions (to enforce it). Pure given their inputs; reads league settings, never hardcodes limits.
import type { Player } from "@prisma/client";
import { lastFantasyWeek } from "@/lib/league-week";
import { isIrEligible, isTaxiEligible, validateRoster } from "@/lib/roster";
import type { LeagueSettings } from "@/lib/settings/schema";
import { isInSeasonPhase, taxiPromotionOpen, taxiWindowOpen } from "@/lib/team/contracts";

export type Check = { ok: true } | { ok: false; reason: string };

export type RosterMoveKind = "IR" | "ACTIVATE" | "TAXI" | "PROMOTE" | "DROP";

export interface RuleSpot {
  playerId: string;
  status: string;
  salary: number;
  player: Pick<Player, "position" | "injuryStatus" | "status" | "yearsExp" | "fullName">;
}

export interface MoveContext {
  settings: LeagueSettings;
  phase: string;
  week: number;
  /** player is a starter in the current week's lineup and his game has locked */
  lockedStarter: boolean;
  /** player's current-week NFL game is in progress */
  gameLive: boolean;
  /** first kickoff of the taxi deadline week has passed */
  taxiDeadlineKickedOff: boolean;
  /** dead money already on the books this season */
  deadMoney: number;
  /** how the player joined this team (RosterSpot.acquiredVia) — taxi squad sources */
  acquiredVia?: string;
  /** weeks the player has been on IR this season (null = unknown / placed in an earlier season) */
  weeksOnIr?: number | null;
  /** player was promoted off this team's taxi squad before */
  promotedBefore?: boolean;
  /** names of IR players who are no longer IR-eligible (settings.roster.irActivationPolicy) */
  healthyOnIr?: string[];
  now?: Date;
}

/** Taxi-squad source (settings.roster.taxiAddSources) for an acquisition type; null = not restricted. */
export function taxiSourceFor(acquiredVia: string | undefined): string | null {
  switch (acquiredVia) {
    case "ROOKIE_DRAFT":
      return "ROOKIE_DRAFT";
    case "AUCTION":
    case "DRAFT":
      return "AUCTION";
    case "WAIVER":
      return "WAIVERS";
    case "FREE_AGENT":
      return "FREE_AGENCY";
    case "TRADE":
      return "TRADE";
    default:
      return null; // keepers / commissioner assignments
  }
}

const TAXI_SOURCE_LABEL: Record<string, string> = { ROOKIE_DRAFT: "the rookie draft", AUCTION: "the auction", WAIVERS: "waivers", FREE_AGENCY: "free agency", TRADE: "trades" };

/**
 * Roster settings in force: before the cutdown date in the offseason the active roster may grow to
 * settings.roster.offseasonMaxActiveRoster.
 */
export function effectiveRosterSettings(settings: LeagueSettings, phase: string, now: Date = new Date()): LeagueSettings {
  const r = settings.roster;
  if (r.offseasonMaxActiveRoster === null || r.offseasonMaxActiveRoster === undefined || r.offseasonMaxActiveRoster <= r.maxActiveRoster) return settings;
  if (isInSeasonPhase(phase)) return settings;
  const cutdown = r.rosterCutdownDate ? new Date(r.rosterCutdownDate) : null;
  if (cutdown && !Number.isNaN(cutdown.getTime()) && now >= cutdown) return settings;
  return { ...settings, roster: { ...r, maxActiveRoster: r.offseasonMaxActiveRoster } };
}

function hypothetical(roster: RuleSpot[], playerId: string, status: string | null) {
  return roster
    .filter((r) => !(r.playerId === playerId && status === null))
    .map((r) => ({ status: r.playerId === playerId && status ? status : r.status, salary: r.salary, player: r.player }));
}

/** Can `kind` be applied to `spot` right now? Returns the first blocking reason. */
export function rosterMoveCheck(kind: RosterMoveKind, spot: RuleSpot, roster: RuleSpot[], m: MoveContext): Check {
  const s = effectiveRosterSettings(m.settings, m.phase, m.now);
  const name = spot.player.fullName;
  // irActivationPolicy BLOCK_MOVES: healthy players must come off IR before other roster moves
  const healthy = (m.healthyOnIr ?? []).filter((n) => n !== name);
  if (s.roster.irActivationPolicy === "BLOCK_MOVES" && healthy.length && (kind === "IR" || kind === "TAXI" || kind === "PROMOTE"))
    return { ok: false, reason: `Activate (or drop) ${healthy.join(", ")} first — healthy players can't stay on IR.` };
  if (kind === "IR") {
    if (spot.status !== "ACTIVE") return { ok: false, reason: `${name} isn't on the active roster.` };
    if (s.roster.irSlots <= 0) return { ok: false, reason: "This league has no IR slots." };
    if (!isIrEligible(spot.player, s)) return { ok: false, reason: `Only players listed ${s.roster.irEligibleStatuses.join(" / ")} can go on IR.` };
    const ir = roster.filter((r) => r.status === "IR").length;
    if (ir >= s.roster.irSlots) return { ok: false, reason: `IR is full (${ir}/${s.roster.irSlots}).` };
    if (m.lockedStarter) return { ok: false, reason: `${name} is locked in this week's lineup.` };
    if (!s.roster.irAllowInOffseason && !isInSeasonPhase(m.phase)) return { ok: false, reason: "IR isn't available in the offseason." };
  }
  if (kind === "TAXI") {
    if (spot.status !== "ACTIVE") return { ok: false, reason: `${name} isn't on the active roster.` };
    if (s.roster.taxiSlots <= 0) return { ok: false, reason: "This league has no taxi squad." };
    if (!isTaxiEligible(spot.player, s)) return { ok: false, reason: `Taxi squad is for players with ≤ ${s.roster.taxiMaxYearsExp} year${s.roster.taxiMaxYearsExp === 1 ? "" : "s"} of NFL experience.` };
    const taxi = roster.filter((r) => r.status === "TAXI").length;
    if (taxi >= s.roster.taxiSlots) return { ok: false, reason: `Taxi squad is full (${taxi}/${s.roster.taxiSlots}).` };
    if (!taxiWindowOpen(s, m.phase, m.week, m.taxiDeadlineKickedOff)) return { ok: false, reason: `The taxi deadline (Week ${s.roster.taxiDeadlineWeek}) has passed — players can only be promoted.` };
    const source = taxiSourceFor(m.acquiredVia);
    const sources = s.roster.taxiAddSources ?? [];
    if (source && !(sources as string[]).includes(source))
      return { ok: false, reason: `Only players acquired via ${sources.length ? sources.map((x) => TAXI_SOURCE_LABEL[x] ?? x).join(" or ") : "no source"} can join the taxi squad.` };
    if (m.promotedBefore && !s.roster.taxiAllowReturnAfterPromotion) return { ok: false, reason: `${name} was promoted from the taxi squad and can't return to it.` };
    if (m.lockedStarter) return { ok: false, reason: `${name} is locked in this week's lineup.` };
  }
  if (kind === "ACTIVATE") {
    if (spot.status !== "IR") return { ok: false, reason: `${name} isn't on IR.` };
    const min = s.roster.irMinWeeks ?? 0;
    if (min > 0 && m.weeksOnIr !== null && m.weeksOnIr !== undefined && m.weeksOnIr < min && isInSeasonPhase(m.phase))
      return { ok: false, reason: `Players must stay on IR at least ${min} week${min === 1 ? "" : "s"} — ${name} can be activated in Week ${m.week + (min - m.weeksOnIr)}.` };
  }
  if (kind === "PROMOTE") {
    if (spot.status !== "TAXI") return { ok: false, reason: `${name} isn't on the taxi squad.` };
    if (!taxiPromotionOpen(s, m.phase)) return { ok: false, reason: "Taxi promotions are only allowed in the offseason." };
  }
  if (kind === "DROP") {
    if (m.lockedStarter) return { ok: false, reason: `${name} is locked in this week's lineup — drop him after the week.` };
    if (m.gameLive && s.waivers.lockPlayersAfterGameStart) return { ok: false, reason: `${name}'s game is in progress.` };
    if (s.playoffs.lockRostersInPlayoffs && m.phase === "PLAYOFFS") return { ok: false, reason: "Rosters are locked during the playoffs." };
    const active = roster.filter((r) => r.status === "ACTIVE").length;
    if (spot.status === "ACTIVE" && active - 1 < s.roster.minActiveRoster) return { ok: false, reason: `Active roster can't go below ${s.roster.minActiveRoster} players.` };
    return { ok: true };
  }
  const next = hypothetical(roster, spot.playerId, kind === "IR" ? "IR" : kind === "TAXI" ? "TAXI" : "ACTIVE");
  const errors = validateRoster(next, s, { checkCap: true, deadMoney: m.deadMoney });
  // only block on problems this move causes (a roster that was already invalid shouldn't freeze every move)
  const before = new Set(validateRoster(hypothetical(roster, spot.playerId, spot.status), s, { checkCap: true, deadMoney: m.deadMoney }));
  const fresh = errors.filter((e) => !before.has(e));
  if (fresh.length) return { ok: false, reason: fresh[0] };
  return { ok: true };
}

export interface WeekState {
  editable: boolean;
  reason: string | null;
}

/**
 * Whether a week's lineup can still be edited. `hasMatchup` (when known) = the team plays that week; in the current
 * playoff week teams without a game only set lineups when settings.lineup.eliminatedTeamsSetLineups is on (future
 * playoff matchups may not be scheduled yet, so they stay editable).
 */
export function lineupWeekState(settings: LeagueSettings, phase: string, currentWeek: number, week: number, opts: { hasMatchup?: boolean } = {}): WeekState {
  const last = lastFantasyWeek(settings);
  if (phase === "OFFSEASON" || phase === "KEEPER") return { editable: false, reason: "The season is over — lineups are final." };
  if (week > last) return { editable: false, reason: `The fantasy season ends in Week ${last}.` };
  if (week < currentWeek) return { editable: false, reason: `Week ${week} is complete — past lineups are read-only.` };
  if (week > currentWeek && !settings.lineup.allowFutureWeekLineups) return { editable: false, reason: `Future lineups are disabled — set Week ${week} once it begins.` };
  if (opts.hasMatchup === false && week === currentWeek && week >= settings.playoffs.startWeek && !settings.lineup.eliminatedTeamsSetLineups)
    return { editable: false, reason: `No playoff game in Week ${week} — eliminated teams don't set lineups in this league.` };
  return { editable: true, reason: null };
}

/**
 * Clock to evaluate lineup locks at. The foundation isLocked() (@/lib/lineup) now applies
 * settings.lineup.lockOffsetMinutes itself, so this is just "now" — kept so callers read clearly.
 */
export function lockClock(_settings: LeagueSettings, now: Date = new Date()): Date {
  return now;
}

/** Can a player in this roster status be in the starting lineup? (taxi players only with taxiPlayersCanStart) */
export function canStartStatus(status: string, settings: LeagueSettings): boolean {
  return status === "ACTIVE" || (status === "TAXI" && settings.roster.taxiPlayersCanStart);
}

export function inSeason(phase: string) {
  return isInSeasonPhase(phase);
}
