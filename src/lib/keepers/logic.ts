// Pure keeper rules (no database access — shared by the keepers page, server actions, the deadline job,
// the season rollover and unit tests).
//
// Dynasty semantics (settings.contracts.enabled):
//  • Players with contract years remaining after this season roll over automatically.
//  • Players whose contract expires this season (contractYears ≤ 1) must be designated to be kept. A kept
//    player signs a one-year keeper deal at the escalated keeper salary; keep him again next offseason to
//    extend it. Undesignated expiring players are released at the rollover.
// Keeper-league semantics (contracts disabled): every rostered player must be designated to be kept.
import type { LeagueSettings } from "@/lib/settings/schema";

/** Cap hit for a contract (mirrors capHit in @/lib/roster, kept here so this module stays client-safe). */
export function projectedCapHit(spot: { salary: number; status: string }, settings: Pick<LeagueSettings, "roster">): number {
  if (spot.status === "IR" && !settings.roster.irCountsAgainstCap) return 0;
  if (spot.status === "TAXI") {
    if (settings.roster.taxiCountsAgainstCap) return spot.salary;
    return Math.round((spot.salary * (settings.roster.taxiCapPercent ?? 0)) / 100);
  }
  return spot.salary;
}

/**
 * Does the annual contract raise apply to this contract? (settings.contracts.raiseAppliesTo)
 * ALL_EXCEPT_ROOKIE skips rookie-scale deals; VETERANS_ONLY also skips players who haven't played out a
 * standard rookie contract yet (fewer NFL seasons than contracts.rookieContractYears).
 */
export function raiseApplies(spot: { isRookieContract?: boolean; yearsExp?: number | null } | undefined, settings: Pick<LeagueSettings, "contracts">): boolean {
  const mode = settings.contracts.raiseAppliesTo ?? "ALL";
  if (!spot || mode === "ALL") return true;
  if (spot.isRookieContract) return false;
  if (mode === "VETERANS_ONLY") return (spot.yearsExp ?? 0) >= (settings.contracts.rookieContractYears ?? 3);
  return true;
}

/** Salary after `years` annual raises, honoring raiseAppliesTo and raiseRounding. */
export function salaryAfterRaises(
  salary: number,
  years: number,
  settings: Pick<LeagueSettings, "contracts">,
  spot?: { isRookieContract?: boolean; yearsExp?: number | null },
): number {
  const raise = settings.contracts.annualRaisePercent ?? 0;
  if (!raise || years <= 0 || !raiseApplies(spot, settings)) return salary;
  const raw = salary * Math.pow(1 + raise / 100, years);
  const mode = settings.contracts.raiseRounding ?? "NEAREST";
  // guard against float noise (e.g. 20 × 1.1 = 22.000000000000004)
  const v = Math.round(raw * 1e6) / 1e6;
  return mode === "UP" ? Math.ceil(v) : mode === "DOWN" ? Math.floor(v) : Math.round(v);
}

export type KeeperWindowStatus = "DISABLED" | "NOT_OPEN" | "OPEN" | "LOCKED";

export interface KeeperWindow {
  status: KeeperWindowStatus;
  opensAt: Date | null;
  deadline: Date | null;
  label: string;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function keeperWindowState(input: {
  settings: Pick<LeagueSettings, "keepers">;
  phase: string;
  now?: Date;
  /** designations for next season are already locked */
  locked?: boolean;
}): KeeperWindow {
  const k = input.settings.keepers;
  const now = input.now ?? new Date();
  const opensAt = parseDate(k.windowOpens);
  const deadline = parseDate(k.deadline);
  if (!k.enabled) return { status: "DISABLED", opensAt, deadline, label: "Keepers are turned off in this league" };
  if (input.locked || (deadline && deadline <= now)) return { status: "LOCKED", opensAt, deadline, label: "Keeper deadline has passed — designations are locked" };
  if (input.phase === "KEEPER" || (opensAt && opensAt <= now)) return { status: "OPEN", opensAt, deadline, label: "Keeper window is open" };
  return { status: "NOT_OPEN", opensAt, deadline, label: opensAt ? "Keeper window opens soon" : "Keeper window is not open yet" };
}

/** Salary a kept player carries next season (settings.keepers.escalation). */
export function keeperSalary(salary: number, settings: Pick<LeagueSettings, "keepers" | "salaryCap">): number {
  const e = settings.keepers.escalation;
  let next = salary;
  if (e.type === "PERCENT") next = salary + Math.max(e.minIncrease ?? 0, Math.ceil((salary * (e.value ?? 0)) / 100));
  else if (e.type === "FLAT") next = salary + (e.value ?? 0);
  next = Math.max(settings.salaryCap.minSalary, Math.round(next));
  const max = settings.salaryCap.maxSalary;
  if (max !== null && max !== undefined) next = Math.min(max, next);
  return next;
}

export interface KeeperSpot {
  status: string;
  salary: number;
  contractYears: number;
  keeperCount: number;
  isRookieContract: boolean;
}

/** Does this player have to be designated to stay on the roster next season? */
export function needsDesignation(spot: Pick<KeeperSpot, "contractYears">, settings: Pick<LeagueSettings, "contracts">): boolean {
  if (!settings.contracts.enabled) return true;
  return spot.contractYears <= 1;
}

/** Contract years a kept player has next season. */
export function keeperContractYears(spot: Pick<KeeperSpot, "contractYears">): number {
  return Math.max(1, spot.contractYears - 1);
}

export function keeperEligibility(spot: KeeperSpot, settings: Pick<LeagueSettings, "keepers" | "contracts">): { eligible: boolean; reason: string | null } {
  const k = settings.keepers;
  if (!k.enabled) return { eligible: false, reason: "Keepers are turned off" };
  if (!needsDesignation(spot, settings)) return { eligible: false, reason: "Under contract — rolls over automatically" };
  if (k.requireContractYears && spot.contractYears <= 1) return { eligible: false, reason: "League rule: only players with contract years remaining can be kept" };
  if (k.maxYearsKept !== null && k.maxYearsKept !== undefined && spot.keeperCount >= k.maxYearsKept)
    return { eligible: false, reason: `Already kept ${spot.keeperCount} time${spot.keeperCount === 1 ? "" : "s"} (max ${k.maxYearsKept})` };
  if (!k.allowKeepingIR && spot.status === "IR") return { eligible: false, reason: "Players on IR can't be kept" };
  return { eligible: true, reason: null };
}

export function countsTowardLimit(spot: Pick<KeeperSpot, "isRookieContract">, settings: Pick<LeagueSettings, "keepers">): boolean {
  return settings.keepers.rookiesCountTowardLimit || !spot.isRookieContract;
}

/** Years of NFL experience a player will have next season. */
export function experienceNextSeason(p: { yearsExp: number | null; rookieYear: number | null }, nextSeason: number): number {
  if (p.rookieYear) return Math.max(0, nextSeason - p.rookieYear);
  return (p.yearsExp ?? 0) + 1;
}

export interface ProjectionSpot extends KeeperSpot {
  playerId: string;
  yearsExp: number | null;
  rookieYear: number | null;
}

export interface ProjectionRow {
  playerId: string;
  outcome: "ROLLS" | "KEPT" | "RELEASED";
  salaryNext: number;
  yearsNext: number;
  statusNext: string;
  capHitNext: number;
}

export interface CapProjection {
  season: number;
  cap: number;
  committed: number;
  deadMoney: number;
  space: number;
  rows: ProjectionRow[];
  overCap: boolean;
}

/** Status a player carries into next season (taxi players who outgrow taxi eligibility are promoted). */
export function statusNextSeason(spot: Pick<ProjectionSpot, "status" | "yearsExp" | "rookieYear">, settings: Pick<LeagueSettings, "roster">, nextSeason: number): string {
  if (spot.status === "TAXI" && experienceNextSeason(spot, nextSeason) > settings.roster.taxiMaxYearsExp) return "ACTIVE";
  return spot.status;
}

/** Next season's cap sheet for a team given the set of designated keepers. */
export function projectNextSeason(input: {
  spots: ProjectionSpot[];
  designated: Set<string>;
  settings: LeagueSettings;
  nextSeason: number;
  /** dead money already charged to next season */
  deadMoney: number;
}): CapProjection {
  const { settings: s, nextSeason } = input;
  const rows: ProjectionRow[] = input.spots.map((sp) => {
    const statusNext = statusNextSeason(sp, s, nextSeason);
    if (!needsDesignation(sp, s)) {
      const salaryNext = salaryAfterRaises(sp.salary, 1, s, sp);
      return { playerId: sp.playerId, outcome: "ROLLS", salaryNext, yearsNext: sp.contractYears - 1, statusNext, capHitNext: projectedCapHit({ salary: salaryNext, status: statusNext }, s) };
    }
    if (input.designated.has(sp.playerId)) {
      const salaryNext = keeperSalary(sp.salary, s);
      return { playerId: sp.playerId, outcome: "KEPT", salaryNext, yearsNext: keeperContractYears(sp), statusNext, capHitNext: projectedCapHit({ salary: salaryNext, status: statusNext }, s) };
    }
    return { playerId: sp.playerId, outcome: "RELEASED", salaryNext: 0, yearsNext: 0, statusNext, capHitNext: 0 };
  });
  const cap = nextSeasonCap(s);
  const committed = rows.reduce((a, r) => a + r.capHitNext, 0) + input.deadMoney;
  return { season: nextSeason, cap, committed, deadMoney: input.deadMoney, space: cap - committed, rows, overCap: s.salaryCap.enabled && committed > cap };
}

export function nextSeasonCap(settings: Pick<LeagueSettings, "salaryCap">): number {
  return settings.salaryCap.cap + (settings.salaryCap.annualCapIncrease ?? 0);
}

export interface SelectionCheck {
  errors: string[];
  warnings: string[];
  counted: number;
  max: number | null;
  min: number;
}

/**
 * Validate a team's designations. `spots` = the team's roster, `designated` = player ids being kept.
 * Errors block saving; warnings are shown (e.g. below the minimum).
 */
export function checkSelection(input: { spots: ProjectionSpot[]; designated: Set<string>; settings: LeagueSettings; projection: CapProjection }): SelectionCheck {
  const { settings: s } = input;
  const k = s.keepers;
  const errors: string[] = [];
  const warnings: string[] = [];
  const chosen = input.spots.filter((sp) => input.designated.has(sp.playerId));
  for (const sp of chosen) {
    const e = keeperEligibility(sp, s);
    if (!e.eligible) errors.push(e.reason ?? "Not eligible");
  }
  const counted = chosen.filter((sp) => countsTowardLimit(sp, s)).length;
  const max = k.maxKeepers ?? null;
  if (max !== null && counted > max) errors.push(`You can keep at most ${max} player${max === 1 ? "" : "s"}${k.rookiesCountTowardLimit ? "" : " (rookie contracts don't count)"}.`);
  const eligibleCount = input.spots.filter((sp) => keeperEligibility(sp, s).eligible && countsTowardLimit(sp, s)).length;
  const min = Math.min(k.minKeepers ?? 0, eligibleCount);
  if (counted < min) warnings.push(`Keep at least ${min} player${min === 1 ? "" : "s"} (${counted} designated).`);
  if (k.mustBeCapCompliant && input.projection.overCap)
    errors.push(`Next season's payroll would be $${input.projection.committed}, over the $${input.projection.cap} cap.`);
  return { errors: [...new Set(errors)], warnings, counted, max, min };
}

/** Which reminder (if any) should go out now. Thresholds in ms before the deadline, largest first. */
export const REMINDER_THRESHOLDS: { key: string; ms: number; label: string }[] = [
  { key: "7d", ms: 7 * 864e5, label: "7 days" },
  { key: "1d", ms: 864e5, label: "24 hours" },
  { key: "2h", ms: 2 * 3600_000, label: "2 hours" },
];

/**
 * Reminder due at `now` given those already sent. Only the most urgent passed threshold is returned
 * (earlier ones that were missed are skipped and should be marked as sent).
 */
export function dueReminder(deadline: Date, now: Date, sent: Set<string>): { key: string; label: string; skip: string[] } | null {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return null;
  const passed = REMINDER_THRESHOLDS.filter((t) => left <= t.ms);
  if (!passed.length) return null;
  const mostUrgent = passed[passed.length - 1];
  if (sent.has(mostUrgent.key)) return null;
  return { key: mostUrgent.key, label: mostUrgent.label, skip: passed.slice(0, -1).map((t) => t.key).filter((k) => !sent.has(k)) };
}
