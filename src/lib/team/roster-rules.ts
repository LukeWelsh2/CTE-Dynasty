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
}

function hypothetical(roster: RuleSpot[], playerId: string, status: string | null) {
  return roster
    .filter((r) => !(r.playerId === playerId && status === null))
    .map((r) => ({ status: r.playerId === playerId && status ? status : r.status, salary: r.salary, player: r.player }));
}

/** Can `kind` be applied to `spot` right now? Returns the first blocking reason. */
export function rosterMoveCheck(kind: RosterMoveKind, spot: RuleSpot, roster: RuleSpot[], m: MoveContext): Check {
  const s = m.settings;
  const name = spot.player.fullName;
  if (kind === "IR") {
    if (spot.status !== "ACTIVE") return { ok: false, reason: `${name} isn't on the active roster.` };
    if (s.roster.irSlots <= 0) return { ok: false, reason: "This league has no IR slots." };
    if (!isIrEligible(spot.player, s)) return { ok: false, reason: `Only players listed ${s.roster.irEligibleStatuses.join(" / ")} can go on IR.` };
    const ir = roster.filter((r) => r.status === "IR").length;
    if (ir >= s.roster.irSlots) return { ok: false, reason: `IR is full (${ir}/${s.roster.irSlots}).` };
    if (m.lockedStarter) return { ok: false, reason: `${name} is locked in this week's lineup.` };
  }
  if (kind === "TAXI") {
    if (spot.status !== "ACTIVE") return { ok: false, reason: `${name} isn't on the active roster.` };
    if (s.roster.taxiSlots <= 0) return { ok: false, reason: "This league has no taxi squad." };
    if (!isTaxiEligible(spot.player, s)) return { ok: false, reason: `Taxi squad is for players with ≤ ${s.roster.taxiMaxYearsExp} year${s.roster.taxiMaxYearsExp === 1 ? "" : "s"} of NFL experience.` };
    const taxi = roster.filter((r) => r.status === "TAXI").length;
    if (taxi >= s.roster.taxiSlots) return { ok: false, reason: `Taxi squad is full (${taxi}/${s.roster.taxiSlots}).` };
    if (!taxiWindowOpen(s, m.phase, m.week, m.taxiDeadlineKickedOff)) return { ok: false, reason: `The taxi deadline (Week ${s.roster.taxiDeadlineWeek}) has passed — players can only be promoted.` };
    if (m.lockedStarter) return { ok: false, reason: `${name} is locked in this week's lineup.` };
  }
  if (kind === "ACTIVATE" && spot.status !== "IR") return { ok: false, reason: `${name} isn't on IR.` };
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

/** Whether a week's lineup can still be edited. */
export function lineupWeekState(settings: LeagueSettings, phase: string, currentWeek: number, week: number): WeekState {
  const last = lastFantasyWeek(settings);
  if (phase === "OFFSEASON" || phase === "KEEPER") return { editable: false, reason: "The season is over — lineups are final." };
  if (week > last) return { editable: false, reason: `The fantasy season ends in Week ${last}.` };
  if (week < currentWeek) return { editable: false, reason: `Week ${week} is complete — past lineups are read-only.` };
  if (week > currentWeek && !settings.lineup.allowFutureWeekLineups) return { editable: false, reason: `Future lineups are disabled — set Week ${week} once it begins.` };
  return { editable: true, reason: null };
}

export function inSeason(phase: string) {
  return isInSeasonPhase(phase);
}
